<p align="center">
  <img src="https://raw.githubusercontent.com/apicircle/studio/main/assets/logo.png" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">@apicircle/cli</h1>

<p align="center">
  <strong>API Circle Studio, without the UI.</strong><br />
  Mock servers, MCP, spec imports, headless plan runs, and multi-workspace management — every Studio feature your team needs in CI, scripts, and SSH sessions.
</p>

<p align="center">
  <a href="https://www.npmjs.com/package/@apicircle/cli"><img src="https://img.shields.io/npm/v/@apicircle/cli?color=cb3837&logo=npm" alt="npm version" /></a>
  <img src="https://img.shields.io/badge/subcommands-9-blue" alt="9 subcommands" />
  <img src="https://img.shields.io/badge/runs-CI%20%C2%B7%20Docker%20%C2%B7%20SSH%20%C2%B7%20local-success" alt="Runs everywhere" />
  <img src="https://img.shields.io/badge/node-%E2%89%A5%2020-brightgreen" alt="Node ≥ 20" />
</p>

---

## Why a CLI?

The Studio desktop app is great for authoring. But the moment you want to
**ship**, **schedule**, or **automate**, you need a binary. `@apicircle/cli`
is exactly that — every workflow the desktop app supports, accessible from
any terminal, container, or pipeline. No Electron, no GUI dependency, no
mouse required.

```bash
# Spin up a mock from an OpenAPI spec — in one command
apicircle mock ./openapi.yaml --port 4040

# Run your saved smoke tests in CI, fail the build if they fail
apicircle run "Smoke Tests" --reporter junit

# Boot an MCP server so an AI assistant can drive your workspace
apicircle mcp
```

## Install

```bash
npm install -g @apicircle/cli
# or run without installing
npx @apicircle/cli --help
```

Single command, single binary: `apicircle`. Top-level `--version` /
`-v` / `-V` and `--help` / `-h` are handled by the binary itself, so
`apicircle --version` prints the package version without booting a
subcommand.

## What you can do with it

| You need to…                                      | Command                                                             |
| ------------------------------------------------- | ------------------------------------------------------------------- |
| List, create, switch between workspaces           | `apicircle workspaces <list \| create \| use \| path>`              |
| Run a local mock server from a spec file          | `apicircle mock <spec> [--port] [--type] [--cors]`                  |
| Import a spec into a workspace                    | `apicircle import <openapi \| postman \| insomnia \| curl> <input>` |
| Execute a saved plan headlessly                   | `apicircle run <plan>`                                              |
| Expose your workspace to an AI assistant over MCP | `apicircle mcp [--workspace-name \| --workspace-path]`              |

## Workspaces, in one minute

API Circle Studio is **multi-workspace by default**. A workspace is a
`{ synced, local }` pair of JSON documents — your collections, environments,
mock-server definitions, plans, history. You can have many on a single
machine; each is its own GitHub repo, environment set, etc.

There are two ways the CLI finds a workspace:

| Use case                                                           | How to point the CLI at it                                                                                   |
| ------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------ |
| Workspaces created in the desktop app on this machine              | `--workspace-name <name-or-id>` — registry lookup                                                            |
| A workspace directory not registered locally (CI, git-cloned repo) | `--workspace-path <dir>` — literal filesystem path                                                           |
| Whatever's currently active                                        | omit both — CLI picks the active workspace from the registry, or the current directory if no registry exists |

The flags are **mutually exclusive** — passing both is an error.

The registry root defaults to `~/.apicircle/` (user home directory on every OS).

Override with `APICIRCLE_WORKSPACES_ROOT` for CI / tests.

## Subcommands

### `apicircle workspaces` — manage the registry

```bash
apicircle workspaces list                          # every registered workspace + which is active
apicircle workspaces list --json                   # JSON for scripts
apicircle workspaces create "Petstore"             # seed a new workspace + add to the registry
apicircle workspaces create "Sandbox" --sample     # seed with one sample request
apicircle workspaces use Petstore                  # set the active workspace by name (or id)
apicircle workspaces path Petstore                 # print the on-disk path for one workspace
apicircle workspaces path                          # print the workspaces root
```

`workspaces use` resolves the same way as `--workspace-name`: case-insensitive
name match, falling back to id.

### `apicircle mcp` — boot the MCP stdio server

```bash
# Multi-workspace mode (recommended) — expose every workspace via `workspace.list`
apicircle mcp

# Scope to one workspace
apicircle mcp --workspace-name Petstore

# Point at a workspace directory that isn't in the registry (CI / git-cloned)
apicircle mcp --workspace-path ./checkout-repo
```

With no workspace flag, the server boots against the desktop app's registry
root and exposes **all** workspaces. AI clients see them through the
`workspace.list` tool; entity tools default to the active workspace and accept
an optional `workspaceId` to scope.

Wire this into Claude Desktop / Cursor / Codex / etc — see
[Connect your AI client](https://github.com/apicircle/studio/blob/main/docs/connect-your-ai-client.md).

### `apicircle mock <spec>` — local mock server

```bash
apicircle mock ./openapi.yaml --port 4040
apicircle mock ./postman_collection.json --type postman
apicircle mock ./insomnia_export.json --type insomnia --cors=false
```

The CLI binds to a free port unless `--port` is set, prints the URL, and runs
until you `Ctrl-C`. This subcommand operates on a spec file directly — it does
**not** consult the workspace registry.

Under the hood: `@apicircle/mock-server-core`, the same Hono engine the
desktop app uses.

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

`<type>` is `curl`, `openapi`, `postman`, or `insomnia`. Each import appends
one request per operation / item — your existing folder structure stays intact.

### `apicircle run <plan>` — execute a saved plan headlessly

```bash
apicircle run "Smoke Tests" --reporter junit
apicircle run plan_a1b2c3 --env staging --bail --workspace-name Petstore
apicircle run "Nightly" --secrets ./secrets.json --no-save
```

Resolves a plan by name or id, runs each step through the **real** request
engine (same auth, same retries, same assertions as the desktop app),
evaluates assertions, and carries extracted context forward between steps.
If a request or linked-workspace step needs Global Assets file bytes that are
missing on this machine, the CLI downloads the attachment blobs from GitHub,
verifies their checksums, and only then starts the request. A checksum mismatch
fails closed instead of sending a partial upload.

**Flags:**

- `--reporter text|json|junit` — output format; `junit` is ready for CI test reporters.
- `--bail` — stop at the first failed step.
- `--env <name>` — layer an environment onto the run.
- `--secrets <file>` or `APICIRCLE_SECRET_*` env vars — supply encrypted variables.
- `--no-save` — don't write the run to history.
- `--no-assertions` — execute requests but skip assertions.
- `--as <actor>` — override the recorded runner identity.

**Exit codes:** `0` every step passed, `1` a step failed (or the run was
aborted), `2` usage error, `3` denied by the authorization gate. Pipelines
gate on it directly.

### `apicircle linked` — manage linked workspaces

```bash
# List linked workspaces in the active workspace
apicircle linked list

# Link a private source repo at a specific version
apicircle linked link octo-org/payments --branch main --pinned-version 1.2.0 \
  --token $GITHUB_TOKEN

# Re-pull the cached release ledger (+ snapshot if missing)
apicircle linked refresh <linkedWorkspaceId>

# Unlink (drops cached ledger + overrides + snapshot)
apicircle linked unlink <linkedWorkspaceId>
```

Tokens come from `--token` or `GITHUB_TOKEN`. Public links can fetch
anonymously; private links require a token.

### `apicircle release` — tag releases / edit topics

```bash
# Tag v1.2.0 on the repo's default-branch HEAD (optionally create a GitHub Release)
apicircle release tag octo-org/payments 1.2.0 --release --notes "Hotfix for /charges"

# Replace an existing tag of the same name
apicircle release tag octo-org/payments 1.2.0 --override

# List topics (the `apicircle` topic drives marketplace discovery)
apicircle release topics octo-org/payments

# Replace topics (always keeps `apicircle`)
apicircle release topics octo-org/payments --set "payments,billing"
```

## Common workflows

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

(No `--workspace-path` needed when running inside the workspace directory —
the CLI's cwd fallback picks it up automatically.)

**Mock a third-party API for the duration of your test suite**

```bash
apicircle mock ./stripe-openapi.yaml --port 4242 &
MOCK_PID=$!

npm test
RESULT=$?

kill $MOCK_PID
exit $RESULT
```

**Switch the active workspace and verify**

```bash
apicircle workspaces use Sandbox
apicircle workspaces list
# Sandbox now shows ● next to it.
```

## Use cases

- **CI / CD gates** — run smoke tests, contract tests, or full regression
  plans against staging before promoting to prod.
- **Mock-driven local dev** — `apicircle mock` in a side terminal, your
  frontend pointed at it, your backend team unblocked.
- **Headless onboarding** — `apicircle import openapi <url>` turns a public
  spec into a typed, runnable workspace in seconds.
- **AI-assistant wiring on servers** — boot `apicircle mcp` in a remote
  session so a headless agent can drive the workspace.
- **Workspace migration & backup** — `workspaces path` + `tar` = a clean
  on-disk archive any other machine can pick up.

## Where it fits

```
@apicircle/shared              (types + utilities)
@apicircle/core                (request engine + auth + imports + workspace I/O)
@apicircle/mock-server-core    (mock-server engine)
@apicircle/mcp-server          (MCP host + tool catalog)
└── @apicircle/cli             ◀── you are here
```

Every subcommand is a thin wrapper around one of the sister packages — same
behaviour as the desktop app, same on-disk format. An edit made by the CLI
is visible to the desktop app on the next read, and vice versa.

## Stability

Each subcommand is exercised by both unit tests and Playwright-driven E2E
suites; the same engine runs in **1,900+ tests** across the wider Studio
codebase. Exit codes and JSON output shapes are part of the contract — gates
that pass today will keep passing as long as the major version doesn't change.

## License

Released under the **API Circle Studio License** — a custom source-available license, not an OSI-approved open-source license. Free for personal, educational, and non-commercial use, plus a 30-day commercial evaluation period; ongoing commercial use requires a separate license. See [LICENSE](./LICENSE) for the full terms, or contact **apicircle365@gmail.com** for commercial licensing.
