# Mock server

API Circle ships a local mock server engine that turns OpenAPI / Swagger / Postman / Insomnia files into a running HTTP server on `localhost`. Definitions are workspace-scoped (push to git so teammates share them); runtime state is per-host.

## Four runtimes, one engine

The same `@apicircle/mock-server-core` Hono app runs in four places:

| Runtime                    | When to use                            | How to start                                  |
| -------------------------- | -------------------------------------- | --------------------------------------------- |
| **Desktop App**            | Day-to-day development                 | Open the _Mocks_ panel → click **Start**      |
| **VS Code extension**      | Editing the workspace alongside code   | Mock view → ▶ Start, or `apicircle.startMock` |
| **CLI** (`@apicircle/cli`) | CI, terminals, headless agents, Docker | `npx @apicircle/cli mock ./openapi.yaml`      |
| **Hosted** (future)        | Sharing mocks with non-developers      | TBD; engine is runtime-agnostic               |

The VS Code extension's `VsCodeMockController` wraps `InProcessMockController`
(the same controller the CLI uses). It runs in the extension host process —
no IPC, no sidecar. Server ids are internally namespaced by workspace id so
multi-root workspaces with shared mock ids stay independent. When VS Code
closes, every running mock dies; same model as the desktop app.

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

The web build of the app shows the same panel but disables the start/stop buttons. A banner explains: _Running mock servers is available in the Desktop App, the VS Code extension, or the CLI._

## VS Code walkthrough (Phase 3 alpha)

1. Open the **Mock view** in the APICircle sidebar.
2. Servers in `synced.mockServers` show alphabetically with `▶ :port` next to running ones and `◦` next to idle ones. Expand to see endpoints.
3. Click a mock → opens its `.mock.yaml` virtual document (editable name/defaultPort/cors; source + endpoints read-only).
4. **▶ Start Mock** above the `name:` line, or the inline ▶ icon in the tree, or the `apicircle.startMock` command.
5. Once running, **■ Stop** and **↻ Restart** lenses appear in the YAML; the **MockStatusBar** at the bottom-left shows `Mocks: N (:port, …)`.
6. When VS Code closes — every running mock dies. Same model as the desktop app.

Running mocks survive workspace switches but reconcile on external deletes — pulling a git branch that removes a mock definition will auto-stop the orphaned server.

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
