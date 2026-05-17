# Connect your AI client

APICircle Studio's MCP server exposes 71 tools (request CRUD, environment authoring, plan creation, assertions, history, mock servers, code generation from collections, codebase scanning, imports, prompt-driven authoring) over stdio. Any AI client that speaks the [Model Context Protocol](https://modelcontextprotocol.io) can drive the workspace.

> **Open standard.** MCP is not Anthropic-locked. Claude Desktop, ChatGPT, GitHub Copilot, Cursor, Continue, Cline, Zed, and Windsurf all support it. Snippets below cover the major clients; if yours isn't listed, the _Generic stdio_ section is the fallback.

## Prereqs

You need the `apicircle-mcp` binary on your `PATH`. Two ways to get it:

```bash
# Option 1: globally via npm
npm install -g @apicircle/mcp-server

# Option 2: ad-hoc with the CLI (no install needed)
npx @apicircle/cli mcp --workspace ./my-workspace
```

You also need a workspace folder. Pick any directory; the MCP server creates `workspace.synced.json` + `workspace.local.json` on first run.

## Claude Desktop

Edit `~/Library/Application Support/Claude/claude_desktop_config.json` (macOS) or `%APPDATA%\Claude\claude_desktop_config.json` (Windows):

```json
{
  "mcpServers": {
    "apicircle": {
      "command": "apicircle-mcp",
      "args": ["--workspace", "/absolute/path/to/your/workspace"],
      "env": {
        "APICIRCLE_WORKSPACE": "/absolute/path/to/your/workspace"
      }
    }
  }
}
```

Restart Claude Desktop. New conversations will see the apicircle tools in the tools picker.

## Claude Code

```json
{
  "mcpServers": {
    "apicircle": {
      "command": "apicircle-mcp",
      "args": ["--workspace", "${workspaceFolder}"]
    }
  }
}
```

Add it to `.claude/mcp.json` at the root of your project. Claude Code auto-discovers it.

## Cursor

Edit `~/.cursor/mcp.json`:

```json
{
  "mcpServers": {
    "apicircle": {
      "command": "apicircle-mcp",
      "args": ["--workspace", "/absolute/path/to/your/workspace"]
    }
  }
}
```

Restart Cursor. The tools surface in `@`-mention completions.

## GitHub Copilot

Add to your VS Code settings:

```jsonc
{
  "github.copilot.advanced.mcp.servers": {
    "apicircle": {
      "command": "apicircle-mcp",
      "args": ["--workspace", "${workspaceFolder}"],
    },
  },
}
```

## ChatGPT (Custom Connectors)

ChatGPT's Connectors UI accepts MCP stdio configs. Use:

- **Command:** `apicircle-mcp`
- **Args:** `--workspace`, `<your workspace path>`
- **Env:** `APICIRCLE_WORKSPACE=<your workspace path>`

## Continue, Cline, Zed, Windsurf

All four read MCP configs in the same shape as Claude Desktop. Drop the `mcpServers.apicircle` block above into:

- Continue: `~/.continue/config.json`
- Cline: `~/.cline/mcp.json`
- Zed: `~/.config/zed/settings.json` (under `assistant.mcpServers`)
- Windsurf: workspace `.windsurf/mcp.json`

## Generic stdio

If your client supports MCP stdio but isn't listed, point it at:

- **Command:** `apicircle-mcp`
- **Args:** `--workspace <path>`
- **Env:** `APICIRCLE_WORKSPACE=<path>`

The server reads JSON-RPC on stdin and responds on stdout. Logs go to stderr.

## Troubleshooting

- **"command not found: apicircle-mcp"** — install globally (`npm i -g @apicircle/mcp-server`) or use `npx @apicircle/cli mcp` instead.
- **"No workspace found at <path>"** — run `apicircle-mcp` once with the path to auto-create `workspace.synced.json`.
- **Tool calls return `Validation failed: ...`** — the AI client is calling the tool with arguments that don't match its Zod schema. Check `docs/mcp-tools-reference.md` for the expected shape.
- **Tools work in Claude Desktop but not Cursor** — check that the binary path in Cursor's config is absolute. Cursor doesn't expand `~`.
