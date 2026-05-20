# Mock server

API Circle ships a local mock server engine that turns OpenAPI / Swagger / Postman / Insomnia files into a running HTTP server on `localhost`. Definitions are workspace-scoped (push to git so teammates share them); runtime state is per-host.

## Three runtimes, one engine

The same `@apicircle/mock-server-core` Hono app runs in three places:

| Runtime                    | When to use                            | How to start                             |
| -------------------------- | -------------------------------------- | ---------------------------------------- |
| **Desktop App**            | Day-to-day development                 | Open the _Mocks_ panel → click **Start** |
| **CLI** (`@apicircle/cli`) | CI, terminals, headless agents, Docker | `npx @apicircle/cli mock ./openapi.yaml` |
| **Hosted** (future)        | Sharing mocks with non-developers      | TBD; engine is runtime-agnostic          |

## CLI walkthrough

```bash
# Boot from an OpenAPI 3 YAML on a free port
npx @apicircle/cli mock ./openapi.yaml

# Pin the port (defaults to a free one)
npx @apicircle/cli mock ./openapi.yaml --port 4040

# Postman / Insomnia
npx @apicircle/cli mock ./postman_collection.json --type postman
npx @apicircle/cli mock ./Insomnia_export.json    --type insomnia

# Disable CORS (default: enabled with `*`)
npx @apicircle/cli mock ./openapi.yaml --cors=false
```

The CLI prints `Mock server listening on http://127.0.0.1:<port> with N endpoints (type=openapi). Press Ctrl-C to stop.`

## Desktop walkthrough

1. Open the _Mocks_ panel (sidebar tab).
2. Mock servers in your workspace appear as cards with endpoint counts.
3. Click **Start** to bind a free port. The card flips to a green badge with the live port.
4. Click **Stop** to shut down without removing the definition.

The web build of the app shows the same panel but disables the start/stop buttons. A banner explains: _Running mock servers is available in the Desktop App or CLI._

## How definitions are stored

A `MockServer` is just a JSON object on `WorkspaceSynced.mockServers[id]`:

```jsonc
{
  "id": "ms-abc",
  "name": "Petstore",
  "source": { "kind": "openapi", "spec": "<raw spec>", "format": "yaml" },
  "endpoints": [
    /* parsed endpoint table */
  ],
  "overrides": {
    /* user-supplied per-endpoint status/body/delay */
  },
  "defaultPort": null,
  "cors": { "enabled": true, "origins": ["*"] },
  "createdAt": "...",
  "updatedAt": "...",
}
```

`endpoints` is materialized at parse time so we don't reparse on every start, and so it round-trips through git (teammates pulling the workspace get the same mock without the original spec file). `overrides` is per-endpoint — change a 200 to a 503 to test error paths without rewriting the spec.

## Runtime status

`WorkspaceLocal.mockRuntime.active[id]` carries the live port + start time. It's local-only because every host runs its own ports — pushing it to git would conflict trivially.

## Programmatic use

```ts
import { startMockServer, parseSourceToEndpoints } from '@apicircle/mock-server-core';

const { endpoints } = await parseSourceToEndpoints({
  kind: 'openapi',
  spec: rawSpec,
  format: 'yaml',
});

const handle = await startMockServer({
  id: 'm1',
  name: 'Petstore',
  source: { kind: 'openapi', spec: rawSpec, format: 'yaml' },
  endpoints,
  overrides: {},
  defaultPort: null,
  cors: { enabled: true, origins: ['*'] },
  createdAt: new Date().toISOString(),
  updatedAt: new Date().toISOString(),
});

// later
await handle.close();
```

## Limits

- The OpenAPI parser uses `@apidevtools/swagger-parser` — handles `$ref`, YAML, and Swagger 2.0 specs.
- Postman / Insomnia parsers cover the request shapes you'd encounter day-to-day; exotic features (advanced auth flows, scripted responses) fall back to a default 200/{}.
- No HTTPS support yet — the engine binds plain HTTP on `localhost`. Use a reverse proxy if you need TLS for client tooling.
- WebSocket / SSE not supported. Defer to the real backend for those.
