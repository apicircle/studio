<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/cli</h1>

Command-line companion to [API Circle Studio](https://github.com/apicircle/studio). Run mock servers, drive the MCP server, import OpenAPI / Postman / Insomnia / curl into a workspace, execute saved plans, and manage multiple workspaces — all from any terminal, no Electron required.

## Install

```bash
npm install -g @apicircle/cli
# or use without installing
npx @apicircle/cli --help
```

## Workspaces, in one minute

API Circle Studio is **multi-workspace by default**. A workspace is a `{ synced, local }` pair of JSON documents — your collections, environments, mock-server definitions, plans, history. You can have many on a single machine; each is its own GitHub repo, environment set, etc.

There are two ways the CLI finds a workspace:

| Use case                                                           | How to point the CLI at it                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Workspaces created in the desktop app on this machine              | `--workspace-name <name-or-id>` — registry lookup                                                            |
| A workspace directory not registered locally (CI, git-cloned repo) | `--workspace-path <dir>` — literal filesystem path                                                           |
| Whatever's currently active                                        | omit both — CLI picks the active workspace from the registry, or the current directory if no registry exists |

The flags are **mutually exclusive** — passing both is an error.

The registry root defaults to the desktop app's userData (`%APPDATA%\@apicircle\desktop\workspaces\` on Windows; `~/Library/Application Support/@apicircle/desktop/workspaces/` on macOS; `~/.config/@apicircle/desktop/workspaces/` on Linux). Override with `APICIRCLE_WORKSPACES_ROOT` for CI / tests.

## Subcommands

### `apicircle workspaces` — manage the registry

```bash
apicircle workspaces list                 # every registered workspace + which is active
apicircle workspaces list --json          # JSON for scripts
apicircle workspaces create "Petstore"    # seed a new workspace and add it to the registry
apicircle workspaces create "Sandbox" --sample   # seed with one sample request
apicircle workspaces use Petstore         # set the active workspace by name (or id)
apicircle workspaces path Petstore        # print the on-disk path for one workspace
apicircle workspaces path                 # print the workspaces root
```

`workspaces use` accepts the same name-or-id resolution as `--workspace-name`. Case-insensitive name match; falls back to id.

### `apicircle mcp` — boot the MCP stdio server

```bash
# Multi-workspace mode (recommended) — expose every workspace via `workspace.list`
apicircle mcp

# Scope to one workspace
apicircle mcp --workspace-name Petstore

# Point at a workspace directory that isn't in the registry (CI / git-cloned)
apicircle mcp --workspace-path ./checkout-repo
```

With no workspace flag, the server boots against the desktop app's registry root and exposes **all** workspaces. AI clients see them via the new `workspace.list` tool; entity-specific tools default to the active workspace and accept an optional `workspaceId` to scope.

Wire this into Claude Desktop / Cursor / Codex / etc — see [Connect your AI client](https://github.com/apicircle/studio/blob/main/docs/connect-your-ai-client.md).

### `apicircle mock <spec>` — local mock server

```bash
apicircle mock ./openapi.yaml --port 4040
apicircle mock ./postman_collection.json --type postman
apicircle mock ./insomnia_export.json --type insomnia --cors=false
```

The CLI binds to a free port unless `--port` is set, prints the URL, and runs until you `Ctrl-C`. This subcommand operates on a spec file directly; it does **not** consult the workspace registry.

### `apicircle import <type> <input>` — import a spec

```bash
# Active workspace (or current directory when no registry exists)
apicircle import openapi ./spec.yaml --format yaml

# Named registered workspace
apicircle import postman ./col.json --workspace-name Petstore
apicircle import insomnia ./exp.json --workspace-name Petstore

# Workspace dir not in the registry
apicircle import openapi ./spec.yaml --workspace-path ./checkout-repo

# Read from stdin
apicircle import openapi - --workspace-name Petstore < ./spec.yaml
```

`<type>` is `curl`, `openapi`, `postman`, or `insomnia`. Each import appends one request per operation / item.

### `apicircle run <plan>` — execute a saved plan headlessly

```bash
apicircle run "Smoke Tests" --reporter junit
apicircle run plan_a1b2c3 --env staging --bail --workspace-name Petstore
apicircle run "Nightly" --secrets ./secrets.json --no-save
```

Resolves a plan by name or id, runs each step through the real request engine, evaluates assertions, and carries extracted context forward.

Flags:

- `--reporter text|json|junit`
- `--bail` — stop at the first failed step
- `--env <name>` — layer an environment onto the run
- `--secrets <file>` or `APICIRCLE_SECRET_*` env vars — encrypted variables
- `--no-save` — don't write the run to history
- `--no-assertions` — execute requests but skip assertions
- `--as <actor>` — override the recorded runner identity

Exit codes: `0` every step passed, `1` a step failed (or the run was aborted), `2` usage error, `3` the run was denied by the authorization gate. CI gates on it directly.

## Examples — common workflows

**Set up a new workspace from scratch**

```bash
apicircle workspaces create "Internal API"
apicircle import openapi ./internal-api.yaml --workspace-name "Internal API"
apicircle mcp --workspace-name "Internal API"
```

**CI gate against a git-cloned workspace repo**

```bash
git clone github.com/me/checkout-workspace.git
cd checkout-workspace
apicircle run "Smoke Tests" --reporter junit
```

(No `--workspace-path` needed when running inside the workspace directory — the CLI's cwd fallback picks it up automatically.)

**Switch the active workspace and verify**

```bash
apicircle workspaces use Sandbox
apicircle workspaces list
# Sandbox now shows ● next to it.
```

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
