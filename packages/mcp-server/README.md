# @apicircle/mcp-server

Model Context Protocol server for [APICircle Studio](https://github.com/apicircle/studio-v2). Exposes the workspace as a 40-tool catalog any [MCP-compatible AI client](https://modelcontextprotocol.io) can drive — Claude Desktop, ChatGPT, GitHub Copilot, Cursor, Continue, Cline, Zed, Windsurf, and more.

## Install

```bash
# Globally for use as a stdio binary
npm install -g @apicircle/mcp-server

# Or as a dependency
npm install @apicircle/mcp-server
```

## Run as a binary

```bash
apicircle-mcp --workspace /path/to/your/workspace
# or
APICIRCLE_WORKSPACE=/path/to/workspace apicircle-mcp
```

The server reads JSON-RPC on stdin and writes responses on stdout. Logs go to stderr. Wire it into your AI client per [`docs/connect-your-ai-client.md`](../../docs/connect-your-ai-client.md).

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

40 tools across 8 namespaces — see [`docs/mcp-tools-reference.md`](../../docs/mcp-tools-reference.md). Highlights:

- **Imports**: `import.{curl,openapi,postman,insomnia,har}`
- **Codegen**: `generate.code` (curl, fetch, axios, requests, Go, Rust)
- **Codebase**: `codebase.extract_collection` (Express, FastAPI, NestJS, Spring)
- **Prompt-driven**: `prompt.{create_environment,create_assertion,create_plan}`
- **Mock CRUD**: `mock.{create_from_openapi,start,stop,delete,...}`
- **Entity CRUD**: full read/write surface for requests, folders, environments, plans, assertions

## Provider interfaces

The host is decoupled from where state lives. Three providers ship:

- `InMemoryWorkspaceProvider` — for tests / programmatic embedding.
- `FileBackedWorkspaceProvider` — for CLI / headless use; advisory-locks the workspace file via `proper-lockfile`.
- `InProcessMockController` — runs mocks directly via `@apicircle/mock-server-core`.

The Electron desktop app supplies its own IPC-backed providers so renderer-side state stays consistent.

## License

MIT.
