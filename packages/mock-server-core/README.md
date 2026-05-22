<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/mock-server-core</h1>

<p align="center">
  <strong>Turn any OpenAPI, Postman, Insomnia, or Swagger file into a real, running HTTP server — in three lines of code.</strong><br />
  Built on Hono. Runs on Node, Bun, Deno, and every edge runtime Hono supports.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@apicircle/mock-server-core"><img src="https://img.shields.io/npm/v/@apicircle/mock-server-core?color=cb3837&logo=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/parses-OpenAPI%203%20%C2%B7%20Swagger%202%20%C2%B7%20Postman%20v2.x%20%C2%B7%20Insomnia%20v4-blue" alt="Parsers" />
  <img src="https://img.shields.io/badge/runtime-Hono-orange" alt="Hono" />
  <img src="https://img.shields.io/badge/runtimes-Node%20%C2%B7%20Bun%20%C2%B7%20Edge-success" alt="Runtimes" />
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen" alt="Node ≥ 20" />
</p>

---

## Why a developer would reach for this

You have a spec, and you need a server that responds **right now** — before
the backend team merges anything, before staging is provisioned, before a
mobile build can hit it on a flight.

`@apicircle/mock-server-core` is the engine that ships with API Circle Studio,
extracted as a standalone npm package. Point it at your spec; get a real HTTP
server. No config DSL, no YAML rules file, no Docker image.

```ts
import { startMockServer, parseSourceToEndpoints } from '@apicircle/mock-server-core';

const { endpoints } = await parseSourceToEndpoints({
  kind: 'openapi',
  spec: rawYamlOrJson,
  format: 'yaml',
});

const mock = await startMockServer({ name: 'Petstore', endpoints, defaultPort: 4040 });
// → POST http://localhost:4040/pets, GET http://localhost:4040/pets/{id}, ...
```

That's the whole API surface for the simple case. Everything below is what
makes the simple case scale.

## What makes it different

- **Four importers, one output shape.** OpenAPI 3.x, Swagger 2.0, Postman
  v2/v2.1, and Insomnia v4 all reduce to the same typed `MockEndpoint[]`.
  Swap your team's spec format and nothing downstream changes.
- **Built on Hono.** A 14 kB router with native support for Node, Bun, Deno,
  Cloudflare Workers, Vercel Edge, Lambda, and more. Run mocks in CI, in a
  desktop app, on a developer's laptop, or behind a tunnel — same code.
- **Per-endpoint overrides.** Inject error responses, custom headers, delays,
  or bespoke bodies on a single endpoint without touching the source spec.
  Perfect for testing error paths and slow networks.
- **Real example bodies.** Postman? Picks the first saved response. OpenAPI?
  Uses the `example` / `examples` / `default` from the spec. No `"string"`
  / `0` placeholder data — what's in the spec is what you get.
- **CORS, on by default.** Browser-friendly out of the box, configurable when
  you need to lock it down.
- **Strict $ref resolution.** OpenAPI parsing flows through
  [`@apidevtools/swagger-parser`](https://www.npmjs.com/package/@apidevtools/swagger-parser)
  for compliant dereferencing — `$ref` chains, recursive schemas, file refs.

## Install

```bash
npm install @apicircle/mock-server-core
# pnpm add @apicircle/mock-server-core
```

Pulls in Hono and the swagger parser; no native modules.

## Quickstart

### 1. Parse a spec

```ts
import { parseSourceToEndpoints } from '@apicircle/mock-server-core';

const { endpoints, warnings } = await parseSourceToEndpoints({
  kind: 'openapi', // 'openapi' | 'postman' | 'insomnia' | 'manual'
  spec: rawYamlOrJson,
  format: 'yaml', // 'yaml' | 'json'
});

warnings.forEach((w) => console.warn(w));
```

### 2. Start the server

```ts
import { startMockServer } from '@apicircle/mock-server-core';

const handle = await startMockServer({
  id: 'm1',
  name: 'Petstore',
  source: { kind: 'openapi', spec: rawYamlOrJson, format: 'yaml' },
  endpoints,
  overrides: {},
  defaultPort: 4040,
  cors: { enabled: true, origins: ['*'] },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

console.log(handle.url); // http://localhost:4040
```

### 3. Override one endpoint

```ts
await startMockServer({
  // ...
  overrides: {
    [endpoints[0].id]: {
      status: 503,
      headers: { 'Retry-After': '30' },
      delayMs: 1200,
    },
  },
});
```

Per-endpoint overrides are how you simulate flaky backends, rate-limiters,
slow regions, and "what does the app do when this call returns 500?".

### 4. Stop it

```ts
await handle.close();
```

## Format support matrix

| Format   | Versions   | What we pull out                                             |
| -------- | ---------- | ------------------------------------------------------------ |
| OpenAPI  | 3.0, 3.1   | Path + method, parameters, request bodies, example responses |
| Swagger  | 2.0        | Same, dereferenced via `@apidevtools/swagger-parser`         |
| Postman  | v2.0, v2.1 | Recursive item walks; first saved response → fallback 200    |
| Insomnia | v4 export  | Filters `_type: 'request'`                                   |
| Manual   | n/a        | Hand-rolled `MockEndpoint[]` you build yourself              |

## Where it runs

Because the engine is just a Hono app builder, anywhere Hono runs, this runs:

- **Node** ≥ 20 — the common case, used by the API Circle Studio desktop app.
- **Bun** — single-binary mocks in CI.
- **Cloudflare Workers / Vercel Edge / Deno Deploy** — public, always-on mocks
  served from the edge.
- **Lambda** — pay-per-request mock servers for short-lived environments.

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
    └── @apicircle/cli         (`apicircle mock ./spec.yaml`)
    └── @apicircle/mcp-server  (mock.start / mock.stop tools)
```

The exact same factory powers the desktop `MockManager`, the
`apicircle mock` CLI command, and the MCP `mock.start` tool. One engine,
three runtimes.

## Learn more

- **Full mock server guide**: <https://github.com/apicircle/studio/blob/main/docs/mock-server.md>
- **Hono docs**: <https://hono.dev>

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
