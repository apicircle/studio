<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle" width="120" height="120" />
</p>

<h1 align="center">@apicircle/mock-server-core</h1>

<p align="center">
  <strong>Turn any OpenAPI, Postman, Insomnia, or Swagger file into a real, running HTTP server — in a few lines of code.</strong><br />
  Built on Hono. Runs on Node; the router is a plain Hono app.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@apicircle/mock-server-core"><img src="https://img.shields.io/npm/v/@apicircle/mock-server-core?color=cb3837&logo=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/parses-OpenAPI%203%20%C2%B7%20Swagger%202%20%C2%B7%20Postman%20v2.x%20%C2%B7%20Insomnia%20v4-blue" alt="Parsers" />
  <img src="https://img.shields.io/badge/runtime-Hono-orange" alt="Hono" />
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen" alt="Node ≥ 20" />
</p>

---

## Why a developer would reach for this

You have a spec, and you need a server that responds **right now** — before
the backend team merges anything, before staging is provisioned, before a
mobile build can hit it on a flight.

`@apicircle/mock-server-core` is the engine that ships with API Circle's free
API workspace, extracted as a standalone npm package. Point it at your spec;
get a real HTTP server. No config DSL, no YAML rules file, no Docker image.

```ts
import { startMockServer, parseSourceToEndpoints } from '@apicircle/mock-server-core';
import type { MockServerSource } from '@apicircle/shared';

const source: MockServerSource = { kind: 'openapi', spec: rawYamlOrJson, format: 'yaml' };
const { endpoints } = await parseSourceToEndpoints(source);

const now = new Date().toISOString();
const mock = await startMockServer({
  id: 'petstore',
  name: 'Petstore',
  source,
  endpoints,
  defaultPort: 4040,
  cors: { enabled: false, origins: [] },
  createdAt: now,
  updatedAt: now,
});
// → POST http://127.0.0.1:4040/pets, GET http://127.0.0.1:4040/pets/{id}, ...
```

That's the whole API surface for the simple case. Everything below is what
makes the simple case scale.

## What makes it different

- **Four importers, one output shape.** OpenAPI 3.x, Swagger 2.0, Postman
  v2/v2.1, and Insomnia v4 all reduce to the same typed `MockEndpoint[]`.
  Swap your team's spec format and nothing downstream changes.
- **Built on Hono.** `startMockServer` serves on Node; `createMockApp(server)`
  returns the plain Hono app for a host that brings its own server.
- **Per-endpoint responses, rules and validation.** Each endpoint carries a
  default response (status, headers, body, delay), conditional response rules,
  request-validation rules and response multipliers — change one without
  touching the source spec. Perfect for testing error paths and slow networks.
- **Real example bodies.** Postman? Picks the first saved response. OpenAPI?
  Uses `example` / the first `examples` entry, else builds one from the schema
  (format-aware defaults; `"string"` / `0` only where the schema gives nothing
  better).
- **CORS when you ask for it.** Off unless `cors.enabled` is set and at least
  one origin is listed; the engine never wildcards silently.
- **Strict in-document $ref resolution.** OpenAPI parsing flows through
  [`@apidevtools/swagger-parser`](https://www.npmjs.com/package/@apidevtools/swagger-parser)
  for compliant dereferencing — `$ref` chains and recursive schemas. A ref into
  another file or a URL is never followed: a spec reaches the parser as a string
  with no base directory to trust, so external refs are reported as warnings.
  A spec split across files can be bundled first with the files you supply
  (`bundleSpec`, below).

## Install

```bash
npm install @apicircle/mock-server-core @apicircle/shared
# pnpm add @apicircle/mock-server-core @apicircle/shared
```

Pulls in Hono, `@hono/node-server`, js-yaml and the swagger parser; no native
modules. `@apicircle/shared` holds the `MockServer` / `MockEndpoint` types.

## Quickstart

### 1. Parse a spec

```ts
import { parseSourceToEndpoints } from '@apicircle/mock-server-core';
import type { MockServerSource } from '@apicircle/shared';

const source: MockServerSource = { kind: 'openapi', spec: rawYamlOrJson, format: 'yaml' };
// Other kinds: { kind: 'postman', collection }, { kind: 'insomnia', export },
// { kind: 'manual', endpoints }.
const { endpoints, warnings } = await parseSourceToEndpoints(source);

warnings.forEach((w) => console.warn(w));
```

> **Browser use:** the package root pulls in swagger-parser (Node-oriented). For
> browser/renderer code, import the `@apicircle/mock-server-core/parsing` subpath
> instead — same `parseSourceToEndpoints` API, no Node runtime. Both entry points
> resolve OpenAPI `$ref`s in-document only and report external refs as warnings,
> so the two differ in bundle weight, not behaviour.

### 2. Start the server

```ts
import { startMockServer } from '@apicircle/mock-server-core';
import type { MockServer } from '@apicircle/shared';

const now = new Date().toISOString();
const server: MockServer = {
  id: 'm1',
  name: 'Petstore',
  source,
  endpoints,
  defaultPort: 4040,
  cors: { enabled: true, origins: ['http://localhost:5173'] },
  createdAt: now,
  updatedAt: now,
};

const handle = await startMockServer(server);
console.log(`http://127.0.0.1:${handle.port}`);
```

It binds to `127.0.0.1` unless you pass `{ host }`, and picks a free port when
`defaultPort` is `null`.

### 3. Change one endpoint's response

```ts
const [first, ...rest] = endpoints;
if (!first) throw new Error('The spec has no operations.');

const flaky = {
  ...first,
  defaultResponse: {
    ...first.defaultResponse,
    status: 503,
    headers: [{ key: 'Retry-After', value: '30', enabled: true }],
    delayMs: 1200,
  },
};

// A second server needs its own port while the first one runs.
const flakyHandle = await startMockServer({
  ...server,
  endpoints: [flaky, ...rest],
  defaultPort: 4041,
});
```

Per-endpoint responses are how you simulate flaky backends, rate-limiters,
slow regions, and "what does the app do when this call returns 500?". For a
response that depends on the request, add `responseRules` to the endpoint.

### 4. Stop it

```ts
await handle.close();
```

## Specs split across files

A spec whose `$ref`s point at other documents (`./schemas/user.yaml#/User`)
can be bundled into one self-contained document before parsing. `bundleSpec`
never reads a file or fetches a URL: you pass the documents' text, keyed by
the target as the spec names it (relative to the root spec's folder).

```ts
import { bundleSpec, parseSourceToEndpoints } from '@apicircle/mock-server-core';

const bundled = bundleSpec(
  { text: rootSpecText, filename: 'openapi.yaml' },
  new Map([['schemas/user.yaml', userSchemaText]]),
);
// bundled.references → every document reached: [{ target: 'schemas/user.yaml', supplied: true }, …]

const { endpoints } = await parseSourceToEndpoints({
  kind: 'openapi',
  spec: bundled.text,
  format: bundled.format,
});
```

Supplied documents are embedded under `x-apicircle-documents` and every
reference into them is rewritten to point inside the same document; a target
you did not supply stays an external reference and is reported unsupplied.
`summarizeSpec` counts a spec's operations and lists the documents it names;
`resolvedSpecMeta` and `mergeExternalRefs` compute what a spec asset's record
becomes once it is read again with its files. All are also exported from
`/parsing`.

## Extracting request-body schemas

The mock pipeline doesn't model request bodies — a mock server responds, it
doesn't validate what you send it — so `parseSourceToEndpoints` drops them. When
you need the **shape a spec declares for a request** (say, to diff it against
what your code actually reads), `parseOpenApiRequestBodies` returns it directly:

```ts
import { parseOpenApiRequestBodies } from '@apicircle/mock-server-core';
// browser / renderer: import from '@apicircle/mock-server-core/parsing'

const { requestBodies, warnings } = await parseOpenApiRequestBodies(rawYamlOrJson, 'yaml');
// → [{ method: 'POST', path: '/pets', contentType: 'application/json',
//      schema: { type: 'object', properties: { … } }, required: true }, … ]
```

One entry per operation that declares a body: OpenAPI 3.x `requestBody` (a JSON
media type preferred) and Swagger 2.0 `in: 'body'` parameters both reduce to the
same `{ method, path, contentType, schema, required }` shape. Join it back to
`parseSourceToEndpoints` by `(method, path)` for an operation's full contract.
Same `$ref` contract as the endpoint parser — in-document refs only on both
entry points, with external refs reported as warnings. A schema the resolver
could not produce reads `{ "x-apicircle-unresolved": "cycle" | "missing" | "external-ref" }`
(`UNRESOLVED_KEY`) — an empty schema to every validator, but one a contract
reader can tell apart from a schema that really is `{}`.

## Format support matrix

| Format   | Versions   | What we pull out                                                                           |
| -------- | ---------- | ------------------------------------------------------------------------------------------ |
| OpenAPI  | 3.0, 3.1   | Path + method, parameters, example responses (request bodies: `parseOpenApiRequestBodies`) |
| Swagger  | 2.0        | Same, dereferenced via `@apidevtools/swagger-parser`                                       |
| Postman  | v2.0, v2.1 | Recursive item walks; first saved response → fallback 200                                  |
| Insomnia | v4 export  | Filters `_type: 'request'`                                                                 |
| Manual   | n/a        | Hand-rolled `MockEndpoint[]` you build yourself                                            |

## Where it runs

- **Node** ≥ 20 — `startMockServer` serves the app with `@hono/node-server`;
  this is what API Circle's desktop app and VS Code extension run.
- **Anywhere else Hono runs** — `createMockApp(server)` returns the Hono app
  without binding a port, for a host that brings its own server. It is exported
  from the package root, which also loads the Node adapter and swagger-parser.

## Use cases

- **Unblock the frontend** while the backend is still being designed.
- **Spin up CI mocks** for integration tests without a docker-compose file.
- **Demo a public API** to prospects before the rate-limited beta is ready.
- **Reproduce production bugs** by overriding one endpoint with the exact
  response that broke the client.
- **Power AI agents** — let an LLM drive a real HTTP server it can probe.

## Where it fits

```
@apicircle/shared              (types + utilities)
└── @apicircle/mock-server-core ◀── you are here
    └── the apicircle-lens CLI and MCP server (paid Lens features of API Circle)
```

The exact same factory powers the desktop `MockManager`, the VS Code
extension, and the paid `apicircle-lens` CLI and MCP server. One engine,
three runtimes.

## Learn more

- **Full mock server guide**: <https://github.com/apicircle/studio/blob/main/docs/mock-server.md>
- **Hono docs**: <https://hono.dev>

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
