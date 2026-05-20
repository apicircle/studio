<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/mcp-server</h1>

Model Context Protocol server for [API Circle Studio](https://github.com/apicircle/studio). Exposes the workspace as a 71-tool catalog any [MCP-compatible AI client](https://modelcontextprotocol.io) can drive — Claude Desktop, Claude Code, ChatGPT, GitHub Copilot, Cursor, Continue, Cline, Zed, Windsurf, and more.

## Install

```bash
# Globally for use as a stdio binary
npm install -g @apicircle/mcp-server

# Or as a dependency
npm install @apicircle/mcp-server
```

## What's a "workspace folder"?

`--workspace <dir>` points the server at a directory containing
`workspace.synced.json` + `workspace.local.json`. **That directory is a
git-cloned API Circle workspace repo** — created by the Desktop app's
_Link to Git_ feature, then cloned with `git clone`:

```bash
git clone https://github.com/<you>/<your-workspace-repo>
apicircle-mcp --workspace ./<your-workspace-repo>
```

**Don't have a workspace repo yet?** Use the **Desktop or Web app** instead.
Its workspace lives in browser storage (no folder needed), and the in-app
**MCP panel** generates a ready-to-paste config snippet for every supported
AI client — Claude Desktop, Cursor, Copilot, ChatGPT, and the rest — wired to
the app's workspace directly. This binary is the headless equivalent for
when you've outgrown the in-app flow.

## Run as a binary

```bash
apicircle-mcp --workspace /path/to/your/cloned/workspace/repo
# or
APICIRCLE_WORKSPACE=/path/to/cloned/workspace/repo apicircle-mcp
```

The server reads JSON-RPC on stdin and writes responses on stdout. Logs go to stderr. Wire it into your AI client per [Connect your AI client](https://github.com/apicircle/studio/blob/main/docs/connect-your-ai-client.md).

## Use programmatically

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
await host.connect(); // stdio by default
```

## Tool catalog

71 tools — see the [MCP tool catalog reference](https://github.com/apicircle/studio/blob/main/docs/mcp-tools-reference.md). Highlights:

- **Imports**: `import.{curl,openapi,postman,insomnia,har}`
- **Codegen**: `generate.code` (curl, fetch, axios, requests, Go, Rust)
- **Codebase**: `codebase.extract_collection` (Express, FastAPI, NestJS, Spring)
- **Prompt-driven**: LLM-shaped JSON entry points covering every authoring workflow — `prompt.create_request` / `update_request`, `prompt.create_folder_tree`, `prompt.create_environment`, `prompt.create_assertion`, `prompt.create_plan` / `add_plan_steps` / `set_plan_variables`, `prompt.create_mock_server` / `add_mock_endpoint` / `set_endpoint_{validation,response}_rules` / `set_endpoint_multipliers`
- **Mock CRUD**: `mock.{create_from_openapi,start,stop,delete,...}`
- **Entity CRUD**: full read/write surface for requests, folders, environments, plans, assertions

## Provider interfaces

The host is decoupled from where state lives. Three providers ship:

- `InMemoryWorkspaceProvider` — for tests / programmatic embedding.
- `FileBackedWorkspaceProvider` — for CLI / headless use; advisory-locks the workspace file via `proper-lockfile`.
- `InProcessMockController` — runs mocks directly via `@apicircle/mock-server-core`.

The Electron desktop app supplies its own IPC-backed providers so renderer-side state stays consistent.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
