# Platform surfaces — MCP, mock engine, CLI, desktop

Design record for the surfaces beyond the React UI: the MCP tool catalog,
the local mock-server engine, the CLI, and the desktop integrations that
wire them together. All of these share the same workspace mutation API,
the same parsers, and the same persistence layer — the only thing that
changes is the host environment.

## Why these surfaces exist

The UI is one way into the workspace; it is not the only one. Two more
were added deliberately:

1. **AI integration via the Model Context Protocol** (open spec — Claude
   Desktop, ChatGPT, Cursor, GitHub Copilot, Continue, Cline, Zed,
   Windsurf all consume it). The workspace becomes a tool catalog any
   compliant client can drive.
2. **Local mock server.** Users describe APIs in OpenAPI / Postman /
   Insomnia and run a Hono-backed mock on `localhost`. Definitions are
   workspace-scoped (push to git so teams share); runtime is per-host.

## Locked-in decisions

| Decision                          | Choice                                                                                     | Why                                                      |
| --------------------------------- | ------------------------------------------------------------------------------------------ | -------------------------------------------------------- |
| npm scope                         | `@apicircle/*`                                                                             | Clean public branding                                    |
| MCP transport                     | stdio (HTTP/SSE deferred)                                                                  | Zero-config; matches every MCP client's default          |
| MCP SDK                           | `@modelcontextprotocol/sdk` (Anthropic, official)                                          | Open spec — works with every MCP client                  |
| Mock framework                    | Hono                                                                                       | Same code in Node, Bun, Workers/edge                     |
| OpenAPI parser                    | `@apidevtools/swagger-parser`                                                              | Battle-tested `$ref` deref + YAML                        |
| Mock storage                      | `WorkspaceSynced.mockServers` (defs, push) + `WorkspaceLocal.mockRuntime` (runtime, local) | Teams share definitions; runtime is per-host             |
| Distribution                      | npm + Electron + platform binaries                                                         | All three audiences (devs, GUI users, CI) covered        |
| Build tool for shippable packages | tsup                                                                                       | Dual ESM/CJS + .d.ts, one command                        |
| CLI binary name                   | `apicircle`                                                                                | Single word; subcommands `apicircle mock / mcp / import` |

## Mutation API as a single choke point

`applyMutation(state, patch)` in `@apicircle/core` is the only function in
the codebase that mutates a workspace. UI store, MCP tool handlers, CLI
commands all funnel through it. As a result:

- The desktop UI can't produce workspace shapes the MCP server couldn't
  produce, and vice-versa.
- Every entity gets an `updatedAt` bump for free; we never forget.
- File-backed persistence (`@apicircle/core/workspace/file-backed`)
  acquires a `proper-lockfile` advisory lock around `load → mutate →
save`, so two concurrent CLI / MCP writers can't interleave.

`WorkspacePatch` is a discriminated union over `request.* | folder.* |
environment.* | assertion.* | mock.* | plan.*`. Adding a new entity type
is one variant + one switch case + one MCP tool definition.

## MCP server — provider abstraction

`@apicircle/mcp-server` doesn't know whether it's running:

- inline in the Electron main process,
- standalone via the CLI on a developer's laptop, or
- in some future hosted service.

Tool handlers depend on two interfaces:

- **`WorkspaceProvider`** — `read()` / `apply(patch)` / `write({ synced?, local? })`.
- **`MockController`** — `start(server)` / `stop(serverId)` / `list()`.

Three implementations ship with the package:

| Provider                        | Backed by                                      | Used by                            |
| ------------------------------- | ---------------------------------------------- | ---------------------------------- |
| `InMemoryWorkspaceProvider`     | object in memory                               | unit tests, programmatic embedders |
| `FileBackedWorkspaceProvider`   | disk + `proper-lockfile`                       | CLI, headless MCP, CI              |
| (Future) `IpcWorkspaceProvider` | Electron IPC into the renderer's Zustand store | Desktop                            |
| `InProcessMockController`       | `@apicircle/mock-server-core` direct           | CLI, embedders                     |
| (Future) `IpcMockController`    | IPC into desktop main's `MockManager`          | Desktop                            |

The desktop today does not host an MCP server itself — it surfaces a
config snippet so each AI client spawns `apicircle-mcp` as its own child.
That keeps process lifecycle scoped to the AI client's session and avoids
a long-lived stdio child of Electron.

## Mock server — three runtimes, one engine

`@apicircle/mock-server-core` is a Hono app builder. The same factory
powers:

- The desktop `MockManager` (in-process Hono on the Electron main).
- The CLI (`apicircle mock <spec>`).
- The MCP `mock.start` tool (in-process via `InProcessMockController`).

OpenAPI / Postman / Insomnia parsers live in this package; the MCP
`import.*` tools reuse them so spec parsing is exactly identical between
the "import requests" and "create mock from spec" flows.

## Distribution

Released as five npm packages (one changeset bumps them together for
now):

- `@apicircle/shared`
- `@apicircle/core`
- `@apicircle/mock-server-core`
- `@apicircle/mcp-server`
- `@apicircle/cli`

Plus three artifact streams driven by the release workflow:

- **CLI binaries** (`@yao-pkg/pkg`): linux-x64, macos-x64, macos-arm64, win-x64.
- **Desktop installers** (`electron-builder`): `.dmg`, `.exe` (NSIS), `.AppImage` + `.deb`.
- **GitHub Release** auto-generated, with all of the above attached.

`apps/web` and `apps/desktop` stay private. Only the publishable
`packages/*` go to npm.

## What this enables

An AI agent on any MCP client can:

- Walk a Git repo's source files and propose a request collection
  (`codebase.extract_collection` → user confirms → `request.create` × N).
- Generate runnable code from a stored request (`generate.code` → user
  pastes into a project).
- Import a Swagger spec and immediately spin up a local mock against it
  (`mock.create_from_openapi` → `mock.start`).
- Author a multi-step execution plan from a natural-language prompt
  (`prompt.create_plan` validates every step id exists before
  persisting).

All without leaving the AI client's chat surface.
