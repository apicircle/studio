<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/mock-server-core</h1>

Hono-based mock-server engine for [API Circle Studio](https://github.com/apicircle/studio). Parses OpenAPI / Swagger / Postman / Insomnia files into a `MockEndpoint[]`, then serves them on Node, Bun, or any edge runtime that runs Hono.

## Install

```bash
npm install @apicircle/mock-server-core
```

## Quickstart

```ts
import { startMockServer, parseSourceToEndpoints } from '@apicircle/mock-server-core';

const { endpoints, warnings } = await parseSourceToEndpoints({
  kind: 'openapi',
  spec: rawYamlOrJson,
  format: 'yaml',
});

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

// later
await handle.close();
```

## What it parses

- **OpenAPI 3.x and Swagger 2.0** — JSON or YAML, including `$ref` deref via `@apidevtools/swagger-parser`.
- **Postman v2 / v2.1 collections** — recursive item walks, picks first saved response, falls back to a 200 default.
- **Insomnia v4 exports** — filters resources of `_type: 'request'`.
- **Manual** — pre-built `MockEndpoint[]` you supply yourself.

## Per-endpoint overrides

`MockServer.overrides[endpointId]` lets you change status, headers, body, or delay for a single endpoint without touching the source spec — perfect for testing error paths.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
