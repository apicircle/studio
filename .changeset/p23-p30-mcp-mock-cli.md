---
'@apicircle/shared': minor
'@apicircle/core': minor
'@apicircle/mock-server-core': minor
'@apicircle/mcp-server': minor
'@apicircle/cli': minor
---

Phase 2: bundle the Model Context Protocol surface (open standard — works with Claude Desktop, ChatGPT, Cursor, GitHub Copilot, Continue, Cline, Zed, Windsurf, and any other MCP-compatible client) and a local mock-server engine.

- **`@apicircle/shared`** — extends `WorkspaceSynced` with a `mockServers` map and `WorkspaceLocal` with a `mockRuntime` map. Adds the `McpToolName` catalog and `MockServer` / `MockRuntime` types used by the new packages. Adds `mocks` and `mcp` to `PanelId`.
- **`@apicircle/core`** — new `applyMutation(state, patch)` orchestrator + `WorkspacePatch` discriminated union; new `loadFromFile / saveToFile / withWorkspace` helpers under `@apicircle/core/workspace/file-backed` (used by CLI and headless MCP, with `proper-lockfile` advisory locking).
- **`@apicircle/mock-server-core`** — Hono-based engine; parses OpenAPI / Postman / Insomnia and serves them on Node. Reusable from Desktop, CLI, and future hosted runtimes.
- **`@apicircle/mcp-server`** — stdio MCP host exposing a 40-tool catalog: imports (curl / OpenAPI / Postman / Insomnia / HAR), code generation (curl / fetch / Axios / requests / Go / Rust), entity CRUD, codebase scanning (Express / FastAPI / NestJS / Spring), prompt-driven authoring, and full mock CRUD + lifecycle. Ships with three pluggable providers (in-memory / file-backed / Electron-IPC) so the same handlers work in every host.
- **`@apicircle/cli`** — `apicircle mock`, `apicircle mcp`, and `apicircle import` subcommands so users can drive the same surface area from any terminal without the desktop app.
