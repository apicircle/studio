<p align="center">
  <img src="assets/logo.svg" alt="API Circle Studio" width="120" height="120" />
</p>

<h1 align="center">API Circle Studio</h1>

<p align="center">
  <strong>A Git-native, AI-native API workspace.</strong><br />
  Build, test, mock, and ship APIs — collaborate through pull requests,<br />
  and let any AI client drive your workspace.
</p>

<p align="center">
  <a href="https://github.com/apicircle/studio/actions/workflows/ci.yml"><img src="https://github.com/apicircle/studio/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >=20" />
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-blue" alt="Platforms" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Source--Available-blue" alt="License" /></a>
</p>

---

API Circle Studio is an API client in the spirit of Postman and Insomnia —
rebuilt around two ideas the others miss:

1. **Your workspace is a Git repo.** Collections, environments, and mock
   definitions are plain JSON, pushed to your own GitHub repo on a working
   branch. Teams collaborate the way they collaborate on code: branches, diffs,
   pull requests, review.
2. **Your workspace is an AI tool catalog.** A built-in Model Context Protocol
   (MCP) server exposes **71 tools**, so Claude, ChatGPT, Cursor, Copilot, and
   any other MCP client can read, author, and run requests for you.

No cloud account. No vendor lock-in. Your data stays on your machine and in
your repo.

---

## Why API Circle Studio

- **Own your data.** The workspace is JSON you can read, diff, and back up.
  Secrets are encrypted locally (AES-GCM via WebCrypto; wrapped by the OS
  keychain on desktop). Nothing is uploaded to a third-party server.
- **Collaborate through pull requests.** Auto-create a working branch from
  `main`, push to save, and open a PR straight from the app. API collections
  get the same review workflow as your code.
- **AI-native, not AI-bolted-on.** The MCP server is a first-class surface, not
  a plugin. An assistant can scan a codebase, propose a request collection,
  generate runnable client code, spin up a mock from a spec — all without
  leaving the chat.
- **Runs everywhere you do.** Desktop app, browser, CLI, and embeddable npm
  packages — all sharing one engine, one workspace format, one mutation API.
- **Built on open standards.** Model Context Protocol for AI, Git for sync,
  OpenAPI / Postman / Insomnia / HAR for import. No proprietary formats to get
  trapped in.

## Features

### Git-backed workspaces

A workspace is two JSON documents — `workspace.synced.json` (the shared
collection tree, environments, mocks, releases) and `workspace.local.json`
(per-device runtime: history, sessions, UI state). The synced document is
pushed to a GitHub repo on a working branch; teammates pull, branch, and merge
it like any other file. Per-connection release management supports both
private collections and a public marketplace.

### AI integration via MCP

The bundled `@apicircle/mcp-server` speaks the open
[Model Context Protocol](https://modelcontextprotocol.io) over stdio, so it
works with **Claude Desktop, Claude Code, ChatGPT, GitHub Copilot, Cursor,
Continue, Cline, Zed, Windsurf**, and anything else that supports MCP. Its
71-tool catalog covers request/folder CRUD, environment authoring, assertions,
execution plans, history, mock-server lifecycle, codebase scanning, imports,
code generation, and prompt-driven (natural-language) authoring.

### Local mock servers

Point API Circle at an OpenAPI / Swagger / Postman / Insomnia file and get a
running HTTP mock on `localhost` in seconds. The Hono-based engine handles
`$ref` dereferencing, per-endpoint overrides (flip a `200` to a `503` to test
error paths), conditional response rules, request validation, and response
multipliers. Mock _definitions_ live in the synced workspace so teammates share
them; _runtime_ state stays local.

### A complete request toolkit

- **17 authentication schemes**, all end-to-end functional — Bearer, Basic,
  API key, custom header, the full OAuth2 grant set (client credentials, auth
  code, PKCE, password, implicit, device flow, with auto-refresh), AWS SigV4,
  Digest, NTLM, Hawk, and JWT. Signing primitives are verified against the
  relevant RFC / NIST reference vectors.
- **Import what you already have** — cURL commands, OpenAPI/Swagger, Postman
  collections, Insomnia exports, and HAR files.
- **Generate client code** from any saved request — cURL, fetch, Node (axios),
  Python (requests), Go, and Rust.
- **Environments** with priority ordering and cross-workspace variable sources.
- **Assertions** and multi-step **execution plans** to chain requests.
- **Request history** with full headers, body previews, and assertion results.

### Use it your way

| Surface          | Best for                                     |
| ---------------- | -------------------------------------------- |
| **Desktop app**  | Day-to-day development (Windows/macOS/Linux) |
| **Web app**      | Quick access, zero install                   |
| **CLI**          | CI pipelines, terminals, headless agents     |
| **npm packages** | Embedding the engine in your own tooling     |

## Two ways to use it

API Circle Studio has two modes, and **the workspace lives in different places
in each**. Pick the one that matches what you're doing.

### A. Local workspace — Desktop / Web app

Open the **Desktop app** (or the Web app) and a workspace is created
automatically in browser storage (IndexedDB). Nothing on disk to manage.

Everything works from inside the app:

- The **Mocks panel** starts and stops local mock servers from your OpenAPI /
  Postman / Insomnia specs.
- The **MCP panel** generates a ready-to-paste config snippet for every AI
  client (Claude Desktop, Cursor, Copilot, ChatGPT, …). Copy it, drop it into
  your client's config, restart — the client now drives your workspace.

**You don't need a workspace folder, a git repo, or a `--workspace` flag for
this mode.** It's the easiest way to get started.

### B. Git-backed workspace — for teams, CI, headless tooling

When you want to collaborate with teammates via PRs, run the CLI in CI, or
point an external AI client at the workspace as JSON-on-disk, you bridge your
local workspace to a GitHub repo via the app's **Link to Git** feature. The
repo becomes your portable workspace.

Anyone on your team gets a usable workspace folder by cloning:

```bash
git clone https://github.com/<you>/<your-workspace-repo>
```

**The cloned directory _is_ the workspace folder.** It contains:

- `workspace.synced.json` — collections, environments, mock definitions
  (shared with the team)
- `workspace.local.json` — per-device runtime state, history, sessions
  (kept out of git)

Pass this folder to the CLI or MCP server with `--workspace`:

```bash
apicircle-mcp --workspace ./<your-workspace-repo>
```

> Whenever the docs or a CLI flag say _"workspace folder"_, they mean a
> directory shaped like a clone of an API Circle workspace repo. If you don't
> have one yet, use mode **A** (the Desktop app) — that's how you create the
> workspace in the first place, then "Link to Git" turns it into a repo.

## Quick start

### Desktop app (mode A)

Download the installer for your OS from the
[latest release](https://github.com/apicircle/studio/releases/latest), then see
[`docs/installing.md`](docs/installing.md) for the one-time setup step.

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

# Point at a workspace directory directly (CI / git-cloned, skips the registry)
npx @apicircle/cli run "Smoke Tests" --workspace-path ./checkout-repo --reporter junit

# Manage the workspace registry from the terminal
npx @apicircle/cli workspaces list
npx @apicircle/cli workspaces create "Internal API"
npx @apicircle/cli workspaces use Petstore
```

Two mutually-exclusive flags pick the workspace:

- `--workspace-name <name-or-id>` — registry lookup. Names are case-insensitive;
  ids survive renames (good for CI).
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

**Easiest path:** open the Desktop app, go to the **MCP panel**, follow the
four steps in **How to Connect** — install the binary, pick your AI client,
paste the snippet, restart. The panel also surfaces live mirror status
(**Connection**) and a curated catalog of starter prompts (**Prompts**).

**Multi-workspace by default:** `apicircle-mcp` boots against the desktop's
multi-workspace registry. AI clients see every workspace via the new
`workspace.list` tool. When the AI asks for data without naming a workspace
and more than one is registered, the server returns a structured "found
multiple workspaces" envelope so the AI can disambiguate or call entity-
specific tools (which default to the active workspace).

**Headless / repo-cloned path:**

```bash
npm install -g @apicircle/mcp-server
```

```jsonc
// e.g. Claude Desktop's claude_desktop_config.json
{
  "mcpServers": {
    "apicircle": {
      "command": "apicircle-mcp",
      // Omit --workspace to boot in multi-workspace mode against the
      // desktop's registry. Pass a directory to pin to a single workspace
      // (CI / repo-cloned flows).
      "args": [],
    },
  },
}
```

Full per-client instructions (Cursor, Copilot, ChatGPT, Codex, Continue, Cline,
Zed, Windsurf, generic stdio) are in
**[Connect your AI client](docs/connect-your-ai-client.md)**.

## How it works

Every write to a workspace — from the UI, the CLI, or an AI tool call — funnels
through a single mutation API (`applyMutation`) in `@apicircle/core`. That means
an AI agent can never produce workspace state the UI couldn't have produced, and
vice versa. The same parsers, the same Hono mock engine, and the same workspace
format back all four surfaces. See
[`docs/architecture/platform.md`](docs/architecture/platform.md) for the full
design record.

## Project status — Early Access

API Circle Studio is **pre-launch and self-funded**. Expect rough edges and
occasional breaking changes before v1.0. The desktop builds are currently
**unsigned** (code-signing certificates are not yet funded), so the first
launch triggers a one-time OS security prompt — [`docs/installing.md`](docs/installing.md)
walks through it. Builds are produced in the open by this repo's GitHub Actions.
Issues and feedback are very welcome:
[github.com/apicircle/studio/issues](https://github.com/apicircle/studio/issues).

## Documentation

- [Connect your AI client](docs/connect-your-ai-client.md)
- [Mock server guide](docs/mock-server.md)
- [MCP tool catalog reference](docs/mcp-tools-reference.md)
- [Authentication — the 17-scheme matrix](docs/auth.md)
- [Platform architecture (MCP, mock engine, CLI, desktop)](docs/architecture/platform.md)
- [Installing the desktop app](docs/installing.md)
- [QA — coverage status & E2E CI](docs/qa/README.md)

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
  mcp-server/           stdio MCP host with the 71-tool catalog
  cli/                  `apicircle` binary — mock / mcp / import / run subcommands
```

`@apicircle/{shared,core,mock-server-core,mcp-server,cli}` are published to npm;
`apps/*` and the `git` / `ui-components` packages are workspace-private.

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
```

Desktop: `pnpm --filter @apicircle/desktop build`, then `… start`.

## License

API Circle Studio is released under a **custom source-available license** — the
source is open to read, study, and contribute to, but this is _not_ an
OSI-approved open-source license. It is free for personal, educational, and
non-commercial use (plus a 30-day commercial evaluation period); ongoing
commercial use requires a separate license. See [`LICENSE`](LICENSE) for the
full terms, or contact **apicircle365@gmail.com** for commercial licensing.
