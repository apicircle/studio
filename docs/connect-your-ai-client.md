# Connect your AI client

API Circle Studio's MCP server exposes 71 tools (request CRUD, environment authoring, plan creation, assertions, history, mock servers, code generation from collections, codebase scanning, imports, prompt-driven authoring) over stdio. Any AI client that speaks the [Model Context Protocol](https://modelcontextprotocol.io) can drive the workspace.

> **Open standard.** MCP is not Anthropic-locked. Claude Desktop, ChatGPT, GitHub Copilot, Cursor, Continue, Cline, Zed, and Windsurf all support it. Snippets below cover the major clients; if yours isn't listed, the _Generic stdio_ section is the fallback.

## Two ways to wire up MCP

API Circle Studio has a Desktop / Web app **and** a headless MCP binary. You
only need this guide for the **headless path**. If you'd rather skip the
config-file editing, the Desktop app has a one-click flow described below.

### Easiest: use the Desktop / Web app's MCP panel

1. Open the Desktop or Web app — your workspace is created automatically in
   browser storage (IndexedDB). No git repo, no folder, no `--workspace`
   needed.
2. Go to **MCP → Connection**. The top of the tab is a "Set up your AI client"
   block — pick your AI client from the list (Claude Desktop, Claude Code,
   Cursor, GitHub Copilot, ChatGPT, Continue, Cline, Zed, Windsurf, or
   generic stdio).
3. Click **Copy snippet**. The snippet is pre-filled with the correct binary
   name, the absolute workspace path, and the right config schema for that
   client.
4. Paste it into the client's config file (the block shows you exactly which
   file to open), restart the client, and you're done.

Below the setup steps the same tab shows live workspace-mirror status — the
mirror path the MCP binary reads from, and a **Refresh** button that pulls in
any CLI / MCP edits made since you last opened the app. Handshake state itself
lives inside each AI client (Claude Desktop's connector menu, Cursor's MCP
indicator, etc.) — the desktop app can't observe child processes spawned by
other clients, so rely on your client's own indicator for "is it connected".

### Headless: hand-edit configs (the rest of this doc)

Use this path when:

- you don't want to install the Desktop app,
- you're driving the workspace from CI / a server / a container,
- or you've moved your workspace into a GitHub repo and want it to live there.

## Prereqs

You need the `apicircle-mcp` binary on your `PATH`. Two ways to get it:

```bash
# Option 1: globally via npm
npm install -g @apicircle/mcp-server

# Option 2: ad-hoc with the CLI (no install needed)
npx @apicircle/cli mcp --workspace ./my-workspace-repo
```

### Workspace folder

A _workspace folder_ is a directory containing two JSON files:

- `workspace.synced.json` — collections, environments, mock definitions
  (the team-shared part)
- `workspace.local.json` — per-device runtime state, history, sessions
  (kept out of git)

**You get one by cloning a GitHub repo** that was created via the Desktop app's
**Link to Git** feature:

```bash
git clone https://github.com/<you>/<your-workspace-repo>
# the cloned directory IS the workspace folder
```

If you don't have a workspace repo yet, the headless path won't help — you
need to first create the workspace somewhere. Two options:

1. **Recommended:** open the Desktop or Web app, build your collections /
   environments / mocks there, then click **Link to Git** to push it to a
   GitHub repo. Clone the repo back to wherever the MCP server will run.
2. **From scratch in CI:** point `apicircle-mcp` at any empty directory and
   it auto-creates `workspace.synced.json` + `workspace.local.json` on first
   run. The workspace will be empty; populate it via MCP tool calls or by
   importing a spec (`apicircle import …`).

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
- **"No workspace found at <path>"** — the directory you pointed at doesn't contain `workspace.synced.json`. Either `git clone` your workspace repo there first, or point at an empty dir and `apicircle-mcp` will initialize an empty workspace on first run. (If you have no workspace repo yet, see the "Two ways to wire up MCP" section above — the Desktop app is the easiest way to create one.)
- **Tool calls return `Validation failed: ...`** — the AI client is calling the tool with arguments that don't match its Zod schema. Check `docs/mcp-tools-reference.md` for the expected shape.
- **Tools work in Claude Desktop but not Cursor** — check that the binary path in Cursor's config is absolute. Cursor doesn't expand `~`.
