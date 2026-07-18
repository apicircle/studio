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
3. Pick a mock and select a **Default port** (1024–65535) — or leave blank to let the runtime pick a free port on each Start. The port input is disabled while the mock is running; stop it first to change.
4. Click **Start** to bind that port. The card flips to a green badge with the live port. If the port is already in use, the runtime surfaces `Port <n> on 127.0.0.1 is already in use. Stop the other process or pick a different port.`
5. Click **Stop** to shut down without removing the definition.

The web build of the app shows the same panel — port editing works there too, since it's a synced-doc field. Start/stop buttons are gated on the desktop bridge (with a banner explaining the alternatives).

## VS Code walkthrough (Phase 3 alpha)

1. Open the **Mock view** in the APICircle sidebar.
2. Servers in `synced.mockServers` show alphabetically with `▶ :port` next to running ones and `◦` next to idle ones. Expand to see endpoints.
3. Click a mock → opens its `.mock.yaml` virtual document (editable name/defaultPort/cors; source + endpoints read-only).
4. **Set port without opening YAML:** right-click a mock row → **Set Mock Port…** (`apicircle.setMockPort`). The input pre-fills with the current port and validates against 1024–65535. Leave blank for auto.
5. **▶ Start Mock** above the `name:` line, or the inline ▶ icon in the tree, or the `apicircle.startMock` command.
6. Once running, **■ Stop** and **↻ Restart** lenses appear in the YAML; the **MockStatusBar** at the bottom-left shows `Mocks: N (:port, …)`. Start failures (busy port / invalid port / permission denied) surface as a clear toast naming the port and reason.
7. When VS Code closes — every running mock dies. Same model as the desktop app.

Running mocks survive workspace switches but reconcile on external deletes — pulling a git branch that removes a mock definition will auto-stop the orphaned server.

### Per-endpoint authoring

Each endpoint opens as its own `<endpointId>.endpoint.yaml` (from the Mock sidebar or the `↗ Open endpoint` lens on the mock summary). CodeLens rows scaffold every section without hand-typing YAML:

- **`requestSchema`** — `✚ Path param · ✚ Query param · ✚ Header · ✚ Cookie · ✚ Body example` insert prefilled rows (path params seed from the `{slot}` segments in the pattern; headers offer the curated catalogue), then `◆ Name / ◆ Type / ◆ Required / ◆ Example` refine each row.
- **`requestValidation`** — `🛡 Add validation rule` + `◆ Kind / ◆ Target / ◆ Value`.
- **`responseRules`** — `✚ Add response rule`; a rule's `when` condition is capped at one clause (`MAX_RESPONSE_RULE_CONDITIONS`); its `◆ Value` offers the header value catalogue for `scope: header`; `✚ Add header` lands on the rule's `response.headers:` block; per-header `✓ Enable / ⊘ Disable`.
- **`defaultResponse`** — `◆ Status / ◆ Body type`, `✚ Add header`, `✱ Add multiplier`, and `⟳ Format JSON` to reflow a stringified JSON body.

Saving a YAML whose **structure** was renamed or mistyped (an unknown top-level key, or a section with the wrong type) is **blocked** with a red diagnostic rather than silently dropping the affected section.

### Request schema across surfaces (Web / Desktop / VS Code)

`MockEndpoint.requestSchema` declares the inputs an endpoint expects — `pathParams` / `queryParams` / `headers` / `cookies` (each a `MockParamDef` with `name` / `typeHint` / `required` / `example`) plus an optional `body` doc. It is **documentation-only** (the runtime validation engine is driven by the separate `requestValidation` rules) and feeds the OpenAPI export.

Because it lives on `WorkspaceSynced.mockServers[id].endpoints[]`, it round-trips through the per-workspace `workspace.json` (under `.apicircle/workspace-<id>/`) and is **identical on every surface**. It is editable in the **VS Code** YAML (above), in the **Desktop / Web** app (the mock endpoint editor's Endpoint node → **Request schema** section, with a "Derive from path" affordance), and is populated automatically by an OpenAPI / Postman / Insomnia import. Switching surfaces never loses or rewrites it.

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

## Parsing a spec — two entry points

Endpoints are **materialized at import time**, not at start time: whenever a
mock is created from a spec (the Desktop / Web "Create mock server" modal, the
VS Code wizard, the CLI, or an MCP `mock.create_from_*` tool), the source is
parsed immediately and the resulting `MockEndpoint[]` is stored on
`MockServer.endpoints`. The runtime router serves that array verbatim and never
re-parses `source`, so a mock created with zero endpoints stays empty.

### Spec sources: paste, or a spec asset (serve live / import)

A spec-backed mock's `source` is either a **verbatim inline spec**
(`{ kind: 'openapi', spec, format }`, from the paste-spec flow) or a reference to
an uploaded **spec asset** (`{ kind: 'openapi-asset', assetId, format, mode }` —
upload the OpenAPI/Swagger file under Global Assets → Files). Asset-backed mocks
come in two modes, each with its own entry point in the Mocks header:

- **`linked` (Serve OpenAPI contract)** — endpoints derive from the asset and
  stay in sync: re-uploading the spec asset auto-refreshes every linked mock, and
  the endpoints are read-only (edits are rejected on every surface). The dedicated
  **Serve OpenAPI contract** flow picks a contract, name, and port and stands up a
  live, read-only server; the mock panel shows a "Served directly from contract"
  callout. Best for "just run my contract." A live contract mock can be
  **converted to an editable mock** in place (`convertMockToEditable`) — this
  flips the source to `materialized`, unlocking the endpoints while keeping the
  spec link so "Re-import from spec" still works. When the contract itself
  changes, **Update spec…** (`reuploadMockSpec`) re-uploads the revised file,
  replacing the backing asset's bytes and live-refreshing the linked endpoints.
- **`materialized` (New Mock Server → From spec asset)** — the spec is parsed
  once into editable endpoints you can modify; an explicit refresh
  (`refreshMockServer` / the `mock.refresh` MCP tool) re-imports from the asset.

The parser ships as two entry points that differ only in how OpenAPI `$ref`s
are dereferenced:

| Import                                | `$ref` resolution                                                                         | Used by                                                                          |
| ------------------------------------- | ----------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------- |
| `@apicircle/mock-server-core` (root)  | swagger-parser — in-document **and** external file / remote refs                          | Node surfaces: CLI, MCP server, Desktop main process, VS Code extension host     |
| `@apicircle/mock-server-core/parsing` | in-document (`#/…`) refs only; external refs are left unresolved and reported as warnings | Browser / renderer code — the web app has no filesystem to resolve external refs |

The Desktop app runs its parse in the Node main process (via the
`apicircle:mock:parse` IPC bridge), so it gets full external-`$ref` resolution;
the pure-web build uses the in-document parser and surfaces a warning naming any
external reference it couldn't follow.

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

## Port binding errors

`startMockServer` (and the Desktop / VS Code / CLI wrappers around it) throws
a `MockServerStartError` when the OS refuses the bind. The error carries a
`code`, `port`, and `host` so callers can render an actionable message
without parsing Node's raw `listen EADDRINUSE …` line:

| `code`          | Meaning                                                    |
| --------------- | ---------------------------------------------------------- |
| `EADDRINUSE`    | Another process already owns the port.                     |
| `EACCES`        | Usually a port below 1024 without elevated privileges.     |
| `EADDRNOTAVAIL` | Host string doesn't resolve to a local interface.          |
| `INVALID_PORT`  | Caller passed a non-integer / out-of-range port (1–65535). |

Defaults: `host = 127.0.0.1` (loopback only); `port` either the
`MockServer.defaultPort` field, the `--port` flag, or a free OS-picked
port when both are absent.

## Limits

- The OpenAPI parser uses `@apidevtools/swagger-parser` — handles `$ref`, YAML, and Swagger 2.0 specs.
- Postman / Insomnia parsers cover the request shapes you'd encounter day-to-day; exotic features (advanced auth flows, scripted responses) fall back to a default 200/{}.
- No HTTPS support yet — the engine binds plain HTTP on `localhost`. Use a reverse proxy if you need TLS for client tooling.
- WebSocket / SSE not supported. Defer to the real backend for those.
