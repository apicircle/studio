<p align="center">
  <img src="assets/logo.svg" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">API Circle Studio</h1>

<p align="center">
  <strong>An API workspace you can <code>git diff</code> — and an AI can drive.</strong><br />
  A desktop, web, and CLI client where collections live in your repo<br />
  and a built-in MCP server lets any AI client read, author, and run requests.
</p>

<p align="center">
  <a href="https://github.com/apicircle/studio/actions/workflows/ci.yml"><img src="https://github.com/apicircle/studio/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >=20" />
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-blue" alt="Platforms" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Source--Available-blue" alt="License" /></a>
</p>

---

API Circle Studio is an API client in the spirit of Postman and Insomnia,
rebuilt around two ideas the others miss:

1. **Your workspace is a Git repo.** Collections, environments, and mock
   definitions are plain JSON pushed to your own GitHub repo on a working
   branch. Teams collaborate the way they collaborate on code — branches,
   diffs, pull requests, review.
2. **Your workspace is an AI tool catalog.** A built-in Model Context Protocol
   server exposes **93 tools**, so Claude, ChatGPT, Cursor, Copilot, and any
   other MCP client can read, author, and run requests on your behalf.

No cloud account. No vendor lock-in. Your data stays on your machine and in
your repo.

---

## Why API Circle Studio

- **Own your data.** The workspace is JSON you can read, diff, and back up.
  Secrets are encrypted locally (AES-GCM via WebCrypto, wrapped by the OS
  keychain on desktop). Nothing is uploaded to a third-party server.
- **Collaborate through pull requests.** Auto-create a working branch from
  `main`, push to save, open a PR from inside the app. API collections get the
  same review workflow as the code that calls them.
- **AI-native, not AI-bolted-on.** The MCP server is a first-class surface, not
  a plugin. An assistant can scan a codebase, propose a collection, generate
  runnable client code, or spin up a mock from a spec — all without leaving the
  chat.
- **Runs everywhere you do.** Desktop, browser, CLI, and embeddable npm
  packages — one engine, one workspace format, one mutation API behind all of
  them.
- **Comfortable to tune.** Settings ships **60+ themes** (One Dark Pro is
  the default; dark, light, and high-contrast variants for VS Code, GitHub,
  Kanagawa, Everforest, Nightfox, Tokyo Night, Solarized, and more) and **50+
  fonts** (System Sans by default; full mono and sans families from Google
  Fonts plus a safe macOS system stack). Every theme also recolors the Monaco
  code editor. Click-open Theme and Font Family pickers, one-second hover
  previews with a pending indicator, keyboard previews, and UI text-size
  scaling round it out.
- **Built on open standards.** MCP for AI, Git for sync, OpenAPI / Postman /
  Insomnia / HAR for import. No proprietary formats waiting to trap you.

## Features

### Git-backed workspaces

A workspace is two JSON documents — `workspace.synced.json` (the shared
collection tree, environments, mocks, releases) and `workspace.local.json`
(per-device history, sessions, UI state). The synced document pushes to a
GitHub repo on a working branch; teammates pull, branch, and merge it like any
other file. Per-connection release management supports both private
collections and a public marketplace. Individual folders + environments can
also be exchanged out-of-band as portable `.apicircle.json` exports — see
**Import what you already have** below.

### AI integration via MCP

The bundled `@apicircle/mcp-server` speaks the open
[Model Context Protocol](https://modelcontextprotocol.io) over stdio, so it
works with **Claude Desktop, Claude Code, ChatGPT, GitHub Copilot, Cursor,
Continue, Cline, Zed, and Windsurf** — or anything else that talks MCP. The
93-tool catalog covers request and folder CRUD, environment authoring,
assertions, execution plans, history, mock-server lifecycle, the release
ledger (publish / deprecate / withdraw), linked-workspace config (list / pin /
scope / unlink), codebase scanning, imports, code generation, and
natural-language authoring.

The desktop app watches `workspace.synced.json` for external writes, so
anything the MCP server (or the `apicircle` CLI) writes shows up in the
editor automatically — no manual refresh needed. The desktop's own
mirror writes are suppressed via a stat-snapshot check, so the loop
can't trigger itself.

### Local mock servers

Point API Circle at an OpenAPI, Swagger, Postman, or Insomnia file and get a
running HTTP mock on `localhost` in seconds. The Hono-based engine handles
`$ref` dereferencing, per-endpoint overrides (flip a `200` to a `503` to
exercise error paths), conditional response rules, request validation, and
response multipliers. Mock _definitions_ live in the synced workspace so
teammates share them; _runtime_ state stays on the local machine.

### A complete request toolkit

- **17 authentication schemes**, all end-to-end functional — Bearer, Basic,
  API key, custom header, the full OAuth2 grant set (client credentials, auth
  code, PKCE, password, implicit, device flow, with auto-refresh), AWS SigV4,
  Digest, NTLM, Hawk, and JWT. Signing primitives are verified against the
  relevant RFC and NIST reference vectors.
- **Import what you already have** — cURL commands, OpenAPI/Swagger, Postman
  collections + environments, Insomnia exports, HAR files, and API Circle
  folder + environment exports (`.apicircle.json` produced by the folder kebab
  → **Export as JSON**, with embedded JSON Schema + GraphQL dependencies; the
  Environments sidebar's **Export as JSON** round-trips env vars including
  encrypted rows — the importer either matches an existing vault slot by label
  or pops a **"Provide secret values"** second step to bind them, skippable
  so the env is usable either way).
- **Generate client code** from any saved request — cURL, fetch, Node (axios),
  Python (requests), Go, and Rust.
- **Environments** with priority ordering and cross-workspace variable sources.
- **Global Assets** for reusable JSON Schemas, GraphQL definitions, and file
  assets. Request uploads, linked workspace downloads, execution plans, and
  mock binary responses can all point at the same tracked asset metadata while
  file bytes travel as Git blobs alongside the synced doc, both under
  `.apicircle/` in the repo (`.apicircle/workspace.json` plus
  `.apicircle/attachments/<slotId>`).
- **Assertions** and multi-step **execution plans** that chain requests.
- **Request history** with full headers, body previews, and assertion results.

### Pick your surface

| Surface               | Best for                                                               |
| --------------------- | ---------------------------------------------------------------------- |
| **Desktop app**       | Day-to-day development (Windows / macOS / Linux)                       |
| **Web app**           | Quick access, zero install                                             |
| **VS Code extension** | Editing the same `.apicircle/workspace.json` from your IDE — see below |
| **CLI**               | CI pipelines, terminals, headless agents                               |
| **npm packages**      | Embedding the engine in your own tooling                               |

### VS Code extension (`apps/vscode/`)

The same workspace document the desktop and web apps drive can be edited
in place from VS Code — no embedded webview, no separate sync. The
extension contributes:

- **Eight sidebar TreeViews**: Editor (folder/request tree), Environment
  (with active marker, encrypted-variable mask, hover with mask-warnings
  - secret-slot binding), Execution Plans, Mock servers, History (recent
    request + plan runs), **Snapshots** (storage meter + restore/delete
    inline, capture + cap commands from the title bar), MCP, Marketplace.
- **`.req.yaml` / `.env.yaml` / `.run.yaml` virtual documents** under
  the `apicircle:` URI scheme — full Monaco editing with JSON Schema
  validation, completion for the 17 auth types + body types +
  assertion kinds, ▶ Send / Set Active / Delete CodeLenses, and live
  pre-send diagnostics in the Problems panel.
- **Three-surface byte-identical state** with Desktop and Web — same
  `applyMutation` chokepoint, same workspace shape, byte-for-byte
  identical commits. One repo, three surfaces.
- **Auto-refresh** on external writes — file watchers on both the
  synced and device-local files so MCP / CLI / hand-edits propagate
  without manual refresh.
- **Mock servers** (Phase 3) — the same `InProcessMockController` the
  CLI uses runs in the extension host. Spin up local HTTP mocks from
  OpenAPI / Postman / Insomnia specs, hit them with the request editor,
  see request counts in the status bar.
- **Secret vault** (Phase 4) — passphrase-unlocked, in-memory AES-GCM
  key, auto-lock by inactivity, clipboard auto-clear on copy, reveal
  encrypted environment variables in place, consolidated `APICircle
Runs` OutputChannel.
- **MCP host integration** (Phase 5) — built-in MCP view generates
  per-AI-client config snippets (Claude Desktop, Claude Code, Cursor,
  Continue, Cline, Zed, Windsurf, GitHub Copilot, ChatGPT, generic
  stdio) pointing at the active workspace's `.apicircle/` directory.
  Snippet bytes are byte-identical to what the desktop app emits.
- **Copilot Chat one-click install** (Phase 6) — the GitHub Copilot
  row in the MCP view writes `.vscode/mcp.json` idempotently with a
  single click. VS Code 1.86+ Copilot Chat (and any MCP client that
  reads the workspace-level config) picks it up automatically.
  Path-traversal guard rejects malicious `apicircle.mcp.workspaceConfigPath`
  values committed in `.vscode/settings.json` from a teammate.
- **Wired settings** for execution timeout, Remote-SSH host hint,
  history retention, secret vault auto-lock + clipboard-clear, MCP
  binary path, MCP workspace config path.

Phase 12 alpha is current — bundle externalised the heavy MCP SDK +
Hono runtime (−470 KB to **1.69 MB** with 325 KB headroom under the
restored 2.0 MB ceiling). E2E coverage now spans **all 11 feature
phases** (19 specs in `e2e/vscode/src/test/`). The 12-phase deferred-
list roadmap is empty. See [`docs/vscode-extension.md`](docs/vscode-extension.md).

## Two ways to use it

API Circle Studio runs in two modes. **The workspace lives in different places
in each.** Pick the one that matches what you're doing.

### Mode A — Local workspace (Desktop or Web app)

Open the app and a workspace is created automatically in browser storage
(IndexedDB). No folder to manage, no flags to remember.

Everything works from inside the app:

- The **Mocks panel** starts and stops local mock servers from your OpenAPI,
  Postman, or Insomnia specs. The VS Code extension's Mock view ships
  the same lifecycle — start mocks from your IDE without switching apps.
- The **MCP panel** generates a ready-to-paste config snippet for every AI
  client (Claude Desktop, Cursor, Copilot, ChatGPT, …). Copy it, drop it into
  your client's config, restart — the client now drives your workspace.

This is the easiest way to get started. You don't need a workspace folder, a
git repo, or a `--workspace` flag.

### Mode B — Git-backed workspace (teams, CI, headless tooling)

When you want to collaborate via PRs, run the CLI in CI, or point an external
AI client at the workspace as JSON-on-disk, use the app's **Link to Git**
feature to bridge your local workspace to a GitHub repo. The repo becomes
your portable workspace.

Teammates get a usable workspace by cloning it:

```bash
git clone https://github.com/<you>/<your-workspace-repo>
```

**The cloned directory _is_ the workspace folder.** It contains:

- `workspace.synced.json` — collections, environments, mock definitions
  (shared with the team)
- `workspace.local.json` — per-device history, sessions, runtime state
  (kept out of git)

Pass that folder to the CLI or MCP server with `--workspace`:

```bash
apicircle-mcp --workspace ./<your-workspace-repo>
```

> Wherever the docs or a CLI flag say _"workspace folder,"_ they mean a
> directory shaped like a clone of an API Circle workspace repo. If you don't
> have one yet, start in mode **A** — that's how you create the workspace.
> "Link to Git" then turns it into a repo.

## Quick start

### Desktop app (mode A)

Grab the installer for your OS from the
[latest release](https://github.com/apicircle/studio/releases/latest), then
follow the one-time setup step in [`docs/installing.md`](docs/installing.md).

### CLI (mode B)

```bash
# Spin up a mock server from an OpenAPI spec — no workspace needed
npx @apicircle/cli mock ./openapi.yaml

# Start the MCP server. With no workspace flag, it boots against the desktop's
# multi-workspace registry and exposes every workspace via workspace.list.
npx @apicircle/cli mcp

# Pick a registered workspace (matches by name or id, case-insensitive)
npx @apicircle/cli mcp --workspace-name Petstore
npx @apicircle/cli import openapi ./postman_collection.json --workspace-name Petstore
npx @apicircle/cli run "Smoke Tests" --workspace-name Petstore --reporter junit

# Or point at a workspace directory directly (CI / git-cloned, skips the registry)
npx @apicircle/cli run "Smoke Tests" --workspace-path ./checkout-repo --reporter junit

# Export a folder as a portable .apicircle.json envelope, then re-import it
# elsewhere — credentials are redacted by default
npx @apicircle/cli export folder "Payments" --out payments.apicircle.json --list-credentials
npx @apicircle/cli import apicircle ./payments.apicircle.json --workspace-name Petstore

# Manage the workspace registry from the terminal
npx @apicircle/cli workspaces list
npx @apicircle/cli workspaces create "Internal API"
npx @apicircle/cli workspaces use Petstore
```

Two mutually-exclusive flags pick the workspace:

- `--workspace-name <name-or-id>` — registry lookup. Names are case-insensitive;
  ids survive renames (handy for CI).
- `--workspace-path <dir>` — literal filesystem directory containing
  `workspace.synced.json`. Skips the registry; ideal for git-cloned workspace
  repos.

When neither is passed, the CLI uses the registry's active workspace (or the
current directory when no registry exists yet).

### Run from source

Requires Node ≥ 20 and pnpm ≥ 9.

```bash
pnpm install
pnpm dev:web            # web app → http://localhost:5174
```

## Connect your AI client

**The easy path:** open the Desktop app, head to **MCP → Connection**. The
top of the tab shows the live workspace-mirror path and a Refresh button.
Below that, follow the four steps under **Set up your AI client** — install
the binary, pick your AI client, paste the snippet, restart. **MCP →
Prompts** ships a curated catalog of starter prompts.

**Multi-workspace by default:** `apicircle-mcp` boots against the desktop's
multi-workspace registry. AI clients see every workspace via the
`workspace.list` tool. When the AI asks for data without naming a workspace
and more than one is registered, the server returns a structured "found
multiple workspaces" envelope so the AI can disambiguate or call entity-
specific tools (which default to the active workspace).

**Headless or repo-cloned path:**

```bash
npm install -g @apicircle/mcp-server
```

```jsonc
// e.g. Claude Desktop's claude_desktop_config.json
{
  "mcpServers": {
    "apicircle": {
      "command": "apicircle-mcp",
      // Omit --workspace to boot in multi-workspace mode against the desktop's
      // registry. Pass a directory to pin to a single workspace (CI / repo-
      // cloned flows).
      "args": [],
    },
  },
}
```

Full per-client instructions (Cursor, Copilot, ChatGPT, Codex, Continue, Cline,
Zed, Windsurf, generic stdio) live in
**[Connect your AI client](docs/connect-your-ai-client.md)**.

## How it works

Every write to a workspace — from the UI, the CLI, or an AI tool call — funnels
through a single mutation API (`applyMutation`) in `@apicircle/core`. That
means an AI agent can never produce workspace state the UI couldn't have
produced, and vice versa. The same parsers, the same Hono mock engine, and
the same workspace format back all four surfaces. See
[`docs/architecture/platform.md`](docs/architecture/platform.md) for the full
design record.

## Project status — Early Access

API Circle Studio is **pre-launch and self-funded.** Expect rough edges and
occasional breaking changes before v1.0. The desktop builds are currently
**unsigned** (code-signing certificates are not yet funded), so the first
launch triggers a one-time OS security prompt —
[`docs/installing.md`](docs/installing.md) walks through it. Builds are
produced in the open by this repo's GitHub Actions. Issues and feedback are
very welcome: [github.com/apicircle/studio/issues](https://github.com/apicircle/studio/issues).

## Documentation

- [Connect your AI client](docs/connect-your-ai-client.md)
- [Mock server guide](docs/mock-server.md)
- [MCP tool catalog reference](docs/mcp-tools-reference.md)
- [Authentication — the 17-scheme matrix](docs/auth.md)
- [Platform architecture (MCP, mock engine, CLI, desktop)](docs/architecture/platform.md)
- [Installing the desktop app](docs/installing.md)
- [QA — coverage status and E2E CI](docs/qa/README.md)

## Repository layout

```
apps/
  web/                  Vite + React shell — the browser build
  desktop/              Electron shell — mock + MCP bridges, OS-keychain secrets
packages/
  ui-components/        React UI + Zustand store + IndexedDB persistence
  core/                 Request execution, auth signing, assertions, mutation API
  shared/               Types, generateId, validators, encryption helpers
  git/                  GitHub API client + sync logic
  mock-server-core/     Hono mock-server engine + OpenAPI/Postman/Insomnia parsers
  mcp-server/           stdio MCP host with the 93-tool catalog
  cli/                  `apicircle` binary — mock / mocks / mcp / import / export / run / workspaces
```

`@apicircle/{shared,core,mock-server-core,mcp-server,cli}` are published to
npm; `apps/*` and the `git` and `ui-components` packages are workspace-private.

## Develop

```bash
pnpm install            # install workspace deps
pnpm dev:web            # web dev server → http://localhost:5174
pnpm dev                # turbo dev (all apps)
pnpm build              # turbo build
pnpm check              # typecheck (tsc --noEmit per package)
pnpm lint               # eslint
pnpm test               # vitest unit tests
pnpm test:e2e           # Playwright E2E (web)
pnpm test:e2e:live-github # live api.github.com suite; requires bot PAT env
```

Desktop: `pnpm --filter @apicircle/desktop build`, then `… start`.

## License

API Circle Studio is released under a **custom source-available license** —
the source is open to read, study, and contribute to, but this is _not_ an
OSI-approved open-source license. It is free for personal, educational, and
non-commercial use (plus a 30-day commercial evaluation period); ongoing
commercial use requires a separate license. See [`LICENSE`](LICENSE) for the
full terms, or contact **apicircle365@gmail.com** for commercial licensing.
