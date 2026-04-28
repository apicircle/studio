# API Circle Studio v2

Greenfield rebuild of API Circle Studio with:

- Two-document Workspace JSON schema (`workspace.synced.json` + `workspace.local.json`) in IndexedDB
- Tailwind CSS styling (no inline styles, no third-party UI lib)
- Working-branch Git flow: auto-create branch from main, push to save, create PR directly from app
- Per-connection release management for API Connections (private + public marketplace)
- **Phase 2:** Local mock servers, an MCP server exposing the workspace as a 40-tool catalog any AI client can drive, and a CLI for headless use

## Connect your AI client

The MCP server (`@apicircle/mcp-server`) is an open Model Context Protocol implementation — it works with Claude Desktop, ChatGPT, GitHub Copilot, Cursor, Continue, Cline, Zed, Windsurf, and any other MCP-compatible client.

→ **[Connect your AI client](docs/connect-your-ai-client.md)**

## Layout

```
apps/
  web/                  Vite + React shell
  desktop/              Electron shell (mock + MCP managers, IPC bridges)
packages/
  ui-components/        All React UI
  core/                 Request execution, env resolution, assertions, mutation API
  shared/               Types, generateId, encryption helpers
  git/                  GitHub API client + sync logic
  mock-server-core/     Hono mock-server engine (npm)
  mcp-server/           stdio MCP host with 40-tool catalog (npm)
  cli/                  `apicircle mock | mcp | import` (npm + binaries)
```

## Develop

```bash
pnpm install
pnpm dev:web            # http://localhost:5174
```

## Documentation

- [Connect your AI client](docs/connect-your-ai-client.md)
- [Mock server](docs/mock-server.md)
- [MCP tool catalog reference](docs/mcp-tools-reference.md)
- [Phase 2 architecture (P22–P30)](docs/architecture/p22-p30.md)
