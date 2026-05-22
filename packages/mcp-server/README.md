<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/mcp-server</h1>

Model Context Protocol server for [API Circle Studio](https://github.com/apicircle/studio). Exposes the workspace as a tool catalog any [MCP-compatible AI client](https://modelcontextprotocol.io) can drive — Claude Desktop, Claude Code, ChatGPT, Codex, GitHub Copilot, Cursor, Continue, Cline, Zed, Windsurf, and any other stdio MCP client.

## Install

```bash
# Globally for use as a stdio binary (the common case)
npm install -g @apicircle/mcp-server

# Or as a dependency for embedding the server programmatically
npm install @apicircle/mcp-server
```

## Quick start

```bash
# Multi-workspace mode — boot against the desktop app's registry root and
# expose every workspace via `workspace.list`. AI clients pass `workspaceId`
# to scope reads; most tools default to the active workspace.
apicircle-mcp

# Single-workspace mode — point at a directory holding workspace.synced.json
# (CI / git-cloned workspace repo). Auto-detected when `<dir>` does NOT
# contain a `registry.json`.
apicircle-mcp --workspace /path/to/checkout-repo
```

The server reads JSON-RPC on stdin and writes responses on stdout; logs go to stderr. Wire it into your AI client per [Connect your AI client](https://github.com/apicircle/studio/blob/main/docs/connect-your-ai-client.md), or paste the snippet generated in the desktop app's **MCP → How to Connect** panel.

## How the server picks a workspace

The directory passed via `--workspace <dir>` (or `APICIRCLE_WORKSPACE`) is auto-detected at boot:

- Contains `registry.json` → **multi-workspace mode**. The server loads the registry, binds the active workspace to `ctx.workspace`, and exposes every other workspace via `workspace.list`. AI clients pass an optional `workspaceId` to scope reads/writes.
- Contains `workspace.synced.json` directly (no `registry.json`) → **single-workspace mode**. Legacy boot for CI / git-cloned repos. `workspace.list` still works — it returns one entry.

If no `--workspace` is passed, the current working directory is used.

## Multi-workspace tools

Two surfaces let AI clients reason about multiple workspaces:

- **`workspace.list`** — returns every workspace + per-workspace counts (requests, folders, environments, mocks, plans) + which is active. The response includes a `hint` string the AI can surface to the user when disambiguating.
- **`workspace.read` ambiguous envelope** — when called with no `workspaceId` and more than one workspace is registered, the response is a structured `{ kind: 'multiple-workspaces', activeWorkspaceId, workspaceCount, workspaces, hint }` so the AI can clarify before drilling in.

```json
{
  "kind": "multiple-workspaces",
  "activeWorkspaceId": "ws-a",
  "workspaceCount": 2,
  "workspaces": [
    {
      "id": "ws-a",
      "name": "Petstore",
      "isActive": true,
      "counts": { "requests": 12, "...": "..." }
    },
    {
      "id": "ws-b",
      "name": "Internal API",
      "isActive": false,
      "counts": { "requests": 47, "...": "..." }
    }
  ],
  "hint": "Found 2 workspaces. Re-call workspace.read with workspaceId set to the desired entry, or call entity-specific tools (which default to the active workspace) when scoping to one workspace is acceptable."
}
```

Entity tools (`request.read`, `environment.create`, `mock.start`, etc.) default to the active workspace and don't require `workspaceId` — multi-workspace handling is opt-in per tool call.

## Use programmatically

Single-workspace (in-memory state or a single on-disk dir):

```ts
import {
  createMcpServer,
  FileBackedWorkspaceProvider,
  InProcessMockController,
} from '@apicircle/mcp-server';

const host = createMcpServer({
  workspace: new FileBackedWorkspaceProvider('/path/to/workspace'),
  mock: new InProcessMockController(),
});
await host.connect();
```

Multi-workspace (registry root):

```ts
import {
  createMcpServer,
  MultiWorkspaceProvider,
  InProcessMockController,
} from '@apicircle/mcp-server';

const workspaces = new MultiWorkspaceProvider('/path/to/workspaces-root');
const registry = await workspaces.init();
console.error(`Booting against ${registry.workspaces.length} workspace(s)`);

const host = createMcpServer({
  workspace: workspaces.activeProvider(),
  workspaces, // the multi-workspace surface — backs `workspace.list`
  mock: new InProcessMockController(),
});
await host.connect();
```

## Tool catalog

See the [MCP tool catalog reference](https://github.com/apicircle/studio/blob/main/docs/mcp-tools-reference.md) for the full list. Highlights:

- **Workspaces**: `workspace.list` (multi-workspace discovery), `workspace.read` / `workspace.write` (bulk + optional `workspaceId`)
- **Entity CRUD**: full read/write surface for requests, folders, environments, plans, assertions
- **Imports**: `import.{curl, openapi, postman, insomnia, har}`
- **Codegen**: `generate.code` (curl, fetch, axios, requests, Go, Rust)
- **Codebase**: `codebase.extract_collection` (Express, FastAPI, NestJS, Spring)
- **Prompt-driven authoring**: LLM-shaped JSON entry points covering request / folder / environment / assertion / plan / mock creation flows
- **Mock CRUD**: `mock.{create_from_openapi, start, stop, delete, …}`
- **History**: `history.{list_runs, get_run, delete_run, purge_by_age}`

## Provider interfaces

The host is decoupled from where state lives:

- `InMemoryWorkspaceProvider` — for tests / programmatic embedding.
- `FileBackedWorkspaceProvider` — for CLI / headless use; advisory-locks the workspace file via `proper-lockfile`.
- `MultiWorkspaceProvider` — registry-root-backed; implements the `Workspaces` interface (`list` / `for` / `activeId` / `setActive`) that backs `workspace.list`.
- `SingleWorkspaceAdapter` — wraps a single `WorkspaceProvider` so legacy single-dir hosts still answer `workspace.list` (returning one entry).
- `InProcessMockController` — runs mocks directly via `@apicircle/mock-server-core`.

The Electron desktop app supplies its own IPC-backed providers so renderer-side state stays consistent.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
