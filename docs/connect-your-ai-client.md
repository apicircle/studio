# Connect your AI client

API Circle Studio's MCP server exposes 93 tools (request CRUD, environment authoring, plan creation, assertions, history, mock servers — including **`mock.set_default_port`** to pin a 1024-65535 port that survives across runs — code generation from collections, codebase scanning, imports, **folder export / import as JSON**, **Global File Asset library with provenance state**, **release ledger — publish / deprecate / withdraw the versions linked consumers pin to**, **linked-workspace config — list / pin / scope / unlink the workspaces you consume**, **GitHub network ops — link / refresh / tag-release / set-topics with a `token` or `GITHUB_TOKEN`**, prompt-driven authoring) over stdio. Any AI client that speaks the [Model Context Protocol](https://modelcontextprotocol.io) can drive the workspace.

> **Open standard.** MCP is not Anthropic-locked. Claude Desktop, ChatGPT, GitHub Copilot, Cursor, Continue, Cline, Zed, and Windsurf all support it. Snippets below cover the major clients; if yours isn't listed, the _Generic stdio_ section is the fallback.

## Two ways to wire up MCP

API Circle Studio has a Desktop / Web app **and** a headless MCP binary. You
only need this guide for the **headless path**. If you'd rather skip the
config-file editing, the Desktop app has a one-click flow described below.

### Easiest: use the Desktop / Web app's MCP panel

1. Open the Desktop or Web app — your workspace is created automatically in
   browser storage (IndexedDB). No git repo, no folder, no `--workspace`
   needed.
2. Go to **MCP → Connection**. The top of the tab shows live workspace-mirror
   status — the mirror path the MCP binary reads from, and a **Refresh**
   button that pulls in any CLI / MCP edits made since you last opened the
   app. Below the mirror sits the "Set up your AI client" block — pick your
   AI client from the list (Claude Desktop, Claude Code, Cursor, GitHub
   Copilot, ChatGPT, Continue, Cline, Zed, Windsurf, or generic stdio).
3. Click **Copy snippet**. The snippet is pre-filled with the correct binary
   name, the absolute workspace path, and the right config schema for that
   client.
4. Paste it into the client's config file (the block shows you exactly which
   file to open), restart the client, and you're done.

Handshake state itself lives inside each AI client (Claude Desktop's connector
menu, Cursor's MCP indicator, etc.) — the desktop app can't observe child
processes spawned by other clients, so rely on your client's own indicator
for "is it connected".

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

**One-click install (Phase 6 — recommended)**: open the **MCP** view in
the APICircle sidebar, click the **GitHub Copilot** row, then restart
Copilot Chat. The extension writes the apicircle entry into
`<workspace>/.vscode/mcp.json` (which Copilot Chat auto-reads on VS
Code 1.86+). The install is idempotent and preserves any other MCP
server entries you've configured.

If you prefer to edit `.vscode/mcp.json` by hand or commit a specific
form to Git, the snippet is:

```jsonc
{
  "mcpServers": {
    "apicircle": {
      "command": "apicircle-mcp",
      "args": ["--workspace", "${workspaceFolder}/.apicircle"],
    },
  },
}
```

The legacy `github.copilot.advanced.mcp.servers` settings path is not
used by current Copilot builds.

## ChatGPT (Custom Connectors)

ChatGPT's Connectors UI accepts MCP stdio configs. Use:

- **Command:** `apicircle-mcp`
- **Args:** `--workspace`, `<your workspace path>`
- **Env:** `APICIRCLE_WORKSPACE=<your workspace path>`

## Using the VS Code extension (recommended)

The [`@apicircle/vscode`](../apps/vscode/) extension surfaces a built-in
MCP view that generates per-client config snippets pointing at the
currently-open workspace's `.apicircle/` directory.

1. Open the **APICircle** activity bar icon → **MCP** view.
2. The view lists every supported AI client (Claude Desktop, Claude
   Code, Cursor, Continue, Cline, Zed, Windsurf, GitHub Copilot,
   ChatGPT, generic stdio).
3. Click any client row → the JSON snippet is copied to clipboard. For
   clients with a known config path (Claude Desktop, Claude Code,
   Cursor, Continue, Zed, Windsurf) the success toast offers **Open
   Config File**, which seeds an empty `{ "mcpServers": {} }` file if
   none exists and opens it for editing.
4. **Override the binary path** via the
   `apicircle.mcp.binaryPath` setting if `apicircle-mcp` isn't on your
   `PATH` (defaults to the global pnpm/npm install of
   `@apicircle/mcp-server`).
5. Run **APICircle: Show MCP Binary Info** from the command palette to
   verify the resolved binary + workspace + tool count at any point.

The view's per-client rows also expose **Copy MCP Config Snippet** + **Open
AI Client MCP Config File** via the context menu. The header row's
**Show MCP Binary Info** action surfaces the resolved paths the
snippets reference.

Snippet bytes are byte-identical to what the desktop app emits for the
same `(binary, workspace, client)` tuple — proven by the
`mcpRoundTrip.test.ts` integration suite.

### One-click install per client (Phase 8)

The MCP view's rows for Claude Desktop, Claude Code, Cursor, Windsurf,
and Zed go beyond "copy the snippet" — each row detects whether the
apicircle entry is already present in that client's user-level config
file and renders one of three states:

| Row state           | Meaning                                                                              | Click action                                                                                                      |
| ------------------- | ------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------------------------------------- |
| 🚀 click to install | Config file missing the apicircle entry.                                             | `apicircle.installMcpForClient` — idempotently writes the entry, preserving any foreign servers in the same file. |
| ⚠ out of date       | Entry present but `binary` or `workspace` path drifted (e.g. you moved the project). | Re-install with current paths.                                                                                    |
| ✓ installed         | Entry matches what the snippet would emit.                                           | Falls back to **Copy Config** (in case you want the snippet for a second surface).                                |

**Bulk install:** the view-title toolbar action **Install MCP for All
Configured Clients** writes to every client listed in the
`apicircle.mcp.autoConfigureClients` setting in one pass:

```jsonc
// .vscode/settings.json
{
  "apicircle.mcp.autoConfigureClients": ["claude-desktop", "cursor", "zed"],
}
```

Default is `[]` — without a configured list, the bulk command opens a
multi-pick so you can choose interactively (and saves the picks back
to the setting if you confirm).

**Schema-variant aware:** Zed uses `context_servers` (not `mcpServers`)
in `~/.config/zed/settings.json`; the installer emits the right
envelope per client.

**Security:** the per-client path is fixed by client ID (resolved via
`resolveAiClientConfigPath`), not user-configurable — a malicious
workspace setting cannot redirect the write. A symlink-traversal
guard rejects targets whose realpath escapes the user's home
directory.

**Uninstall:** the same row's context menu surfaces **Remove APICircle
MCP from AI Client**, which strips just the `apicircle` key + leaves
foreign servers intact. Empty schema blocks (`mcpServers: {}` after
removal) are dropped so the file stays tidy.

**Cline + Continue** are intentionally not in the supported list —
Cline reads workspace-local config (use **Install for Copilot Chat /
VS Code MCP** instead — it writes `.vscode/mcp.json` which Cline also
picks up); Continue uses YAML rather than JSON and ships a dedicated
writer in a later phase.

### Remember vault on this device (Phase 8)

If your workspace uses the **secret vault** (encrypted environment
variables) and you don't want to re-enter the passphrase each session,
turn on `apicircle.secrets.rememberOnDevice`. The extension stores the
passphrase via VS Code's `SecretStorage` (OS keychain on each
platform — Keychain on macOS, Credential Manager on Windows, libsecret
on Linux) after the first successful unlock; the next session
silent-unlocks automatically.

To wipe a stored entry: **APICircle: Forget Vault Credentials on This
Device** from the command palette. With no active workspace open the
command offers a "forget all known workspaces" path.

**Security tradeoff:** anyone with access to your OS keychain can read
the passphrase. Only enable on a trusted, encrypted-at-rest device.
Off by default. Auto-lock + clipboard-clear timers still apply — they
operate on the in-memory key, not the stored entry. To get full
lock-out, either disable the setting or run the Forget command.

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
- **My AI client says it created a collection but the Desktop app doesn't show it** — since 1.0.8 the desktop watches `workspace.synced.json` for external writes and auto-refreshes when an MCP / CLI write lands. If the editor still looks stale, click **Refresh** in the MCP panel — the toast now reports the on-disk request / folder / environment counts so a mismatch with what the AI client claimed is visible immediately. If the counts already match what your AI client reports, the data is there — try the workspace switcher (the editor may be focused on a different workspace inside the registry).
