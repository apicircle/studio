<p align="center">
  <img src="assets/logo.svg" alt="API Circle" width="120" height="120" />
</p>

<h1 align="center">API Circle</h1>

<p align="center">
  <strong>An API workspace you can <code>git diff</code>.</strong><br />
  This repository (<code>studio</code>) is the free, source-available API workspace — the open core of API Circle.<br />
  Desktop, web, and VS Code, with collections that live in your repo.
</p>

<p align="center">
  <a href="https://github.com/apicircle/studio/actions/workflows/ci.yml"><img src="https://github.com/apicircle/studio/actions/workflows/ci.yml/badge.svg" alt="CI" /></a>
  <img src="https://img.shields.io/badge/node-%3E%3D20-brightgreen" alt="Node >=20" />
  <img src="https://img.shields.io/badge/platforms-Windows%20%7C%20macOS%20%7C%20Linux%20%7C%20Web-blue" alt="Platforms" />
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-Source--Available-blue" alt="License" /></a>
</p>

---

API Circle is an API client in the spirit of Postman and Insomnia, rebuilt
around two ideas the others miss:

1. **Your workspace is a Git repo.** Collections, environments, mock and
   execution-plan definitions are plain JSON pushed to your own GitHub repo on
   a working branch. Teams collaborate the way they collaborate on code —
   branches, diffs, pull requests, review.
2. **Your workspace stays portable.** Everything lives in `.apicircle/`
   workspace files. The paid [Lens features of API Circle](https://apicircle.dev/lens)
   — MCP and the CLI among them — work on the same files.

No cloud account. No vendor lock-in. Your data stays on your machine and in
your repo.

---

## Why API Circle

- **Own your data.** The workspace is JSON you can read, diff, and back up.
  Secrets are encrypted locally (AES-GCM via WebCrypto, wrapped by the OS
  keychain on desktop). Nothing is uploaded to a third-party server.
- **Secrets stay out of Git and History.** A push scans what it is about to
  write and asks before pushing a value that looks like a credential. History
  replaces credential values with `[hidden]` before a run is saved. A token an
  extractor captures from a response is held in memory only, never written to
  disk. A Secret Vault slot that encrypts variables is never sent as
  `{{LABEL}}`, and deleting it asks first.
- **Collaborate through pull requests.** Auto-create a working branch from the
  repo's default branch — starting from your own workspace, or importing one
  that already lives on the base branch — push to save, and open a PR from
  inside the app. API collections get the same review workflow as the code
  that calls them.
- **Automation-ready.** The workspace format is clean, Git-backed JSON. MCP and
  headless CLI automation over the same files are paid Lens features of API
  Circle.
- **Runs where you work.** Desktop, browser, VS Code, and embeddable npm
  packages share one engine and one workspace format.
- **Comfortable to tune.** Settings ships **60 themes** (One Dark Pro is the
  default; dark, light, and high-contrast variants for VS Code, GitHub,
  Kanagawa, Everforest, Nightfox, Tokyo Night, Solarized, and more) and **50
  fonts** (System Sans by default; full mono and sans families from Google
  Fonts plus a safe macOS system stack). Every theme also recolors the Monaco
  code editor. Click-open Theme and Font Family pickers, one-second hover
  previews with a pending indicator, keyboard previews, and UI text-size
  scaling round it out.
- **Built on open standards.** Git for sync; OpenAPI / Swagger, Postman,
  Insomnia and cURL for import. No proprietary formats waiting to trap you.

## Features

### Git-backed workspaces

A workspace is two JSON documents — `workspace.json` (the shared
collection tree, environments, mocks) and `workspace.local.json`
(per-device history, sessions, UI state). The synced document pushes to a
GitHub repo on a working branch; teammates pull, branch, and merge it like any
other file. Connect with a classic (`repo` scope) or fine-grained (Contents and
Pull requests, read and write) GitHub token; **Test connection** checks the
token, its scopes, and whether it can reach the repo, push, list branches and
open pull requests. Disconnecting a repository asks first. Individual folders +
environments can also be exchanged out-of-band as portable `.apicircle.json`
exports — see **Import what you already have** below.

The web and desktop apps keep one workspace open; any others are locked, never
deleted ([plans with more workspaces](https://apicircle.dev/pricing)).

### MCP and CLI automation (paid, in API Circle)

This repository ships no MCP server and no CLI. Both are
[Lens features of API Circle](https://apicircle.dev/lens) and work on the same
`.apicircle` workspace: `apicircle-lens mcp --repo <dir>` serves MCP to an AI
client, and `apicircle-lens run` runs saved execution plans.

### Local mock servers

Point API Circle at an OpenAPI, Swagger, Postman, or Insomnia file and get a
running HTTP mock on `localhost` in seconds — in the desktop app or the VS Code
extension (the web app edits mock definitions but cannot run them: a browser
tab can't listen on a port). The Hono-based engine resolves in-document
`$ref`s; a spec split across files is read in full from the files you supply,
and nothing is fetched or read from disk on its own. It also handles
per-endpoint responses (flip a `200` to a `503` to exercise error paths),
conditional response rules, request validation, and response multipliers. Mock
_definitions_ live in the synced workspace so teammates share them; _runtime_
state stays on the local machine.

### A complete request toolkit

- **15 authentication schemes (plus No Auth and Inherit)**, all end-to-end
  functional — Bearer, Basic, API key, custom header, the full OAuth2 grant
  set (client credentials, auth code, PKCE, password, implicit, device flow,
  with auto-refresh), AWS SigV4, Digest, NTLM, Hawk, and JWT. Signing primitives are verified against the
  relevant RFC and NIST reference vectors. **Folder-level auth** is editable
  on every surface: set an `auth:` block on a folder and any descendant
  request with `auth: { type: inherit }` picks it up automatically. In VS
  Code, click a folder to open its YAML; a `◆ Inherits from <Folder>`
  CodeLens on each `inherit` request links straight to the source.
- **Import what you already have** — cURL commands, OpenAPI/Swagger, Postman
  collections + environments, Insomnia exports, and API Circle
  folder + environment exports (`.apicircle.json` produced by the folder kebab
  → **Export as JSON**, with embedded JSON Schema + GraphQL dependencies; the
  Environments sidebar's **Export as JSON** round-trips env vars including
  encrypted rows — the importer either matches an existing vault slot by label
  or pops a **"Provide secret values"** second step to bind them, skippable
  so the env is usable either way).
- **Environments** with priority ordering.
- **Global Assets** for reusable JSON Schemas, GraphQL definitions, and file
  assets. Request uploads, execution plans, and
  mock binary responses can all point at the same tracked asset metadata while
  file bytes travel as Git blobs alongside the synced doc, both under
  `.apicircle/` in the repo (`.apicircle/workspace-<id>/workspace.json` plus
  `.apicircle/workspace-<id>/attachments/<slotId>`).
- **Split OpenAPI specs** — a spec whose `$ref`s point at other files lists
  them in Assets → Files. Supply them one at a time, several by name, or a
  whole folder, and every reader (mocks, **Import to collection**) uses the
  whole spec. **Download one file** / **Save as new spec** produce one
  self-contained spec.
- **Assertions** (status, header, JSON path, duration, JSON Schema) and
  multi-step **execution plans** that chain requests.
- **Responses** can be copied, saved to a file, or shown raw; **Move to…**
  moves a request or folder.
- **Request history** with full headers, body previews, and assertion results —
  with secrets hidden before a run is saved.

### Pick your surface

| Surface               | Best for                                                                                                                          |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| **Desktop app**       | Day-to-day development and running mocks (Windows / macOS / Linux) — the [API Circle desktop app](https://apicircle.dev/download) |
| **Web app**           | Zero install at [studio.apicircle.dev](https://studio.apicircle.dev); edits mocks but can't run them                              |
| **VS Code extension** | Editing the same `.apicircle/` workspace from your IDE — see below                                                                |
| **npm packages**      | Embedding the engine in your own tooling                                                                                          |

### VS Code extension (`apps/vscode/`)

**Install:** [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=apicircle.apicircle-vscode)
· [Open VSX](https://open-vsx.org/extension/apicircle/apicircle-vscode) — or
search **API Circle Studio** in the Extensions view (`Ctrl`/`Cmd`+`Shift`+`X`).

The same workspace document the desktop and web apps drive can be edited
in place from VS Code — no embedded webview, no separate sync. The
extension contributes:

- **Seven sidebar TreeViews**: Workspace, Editor, Environment, Execution, Mock, History, and Snapshots.
- **YAML virtual documents** under the `apicircle:` URI scheme (each request,
  folder, environment, plan, mock, endpoint, response and history run opens as
  `<name>.yaml`) — completion for the 15 auth schemes (plus `none` and
  `inherit`), body types and assertion kinds, ▶ Send / Set Active / Delete
  CodeLenses, structural checks that block saving a mistyped key, and live
  pre-send diagnostics in the Problems panel.
- **Execution-plan editing** — the plan YAML carries `▶ Run with assertions` /
  `▶ Run` (the app's two run modes; a running plan swaps to
  `⏳ Running… · ✖ Cancel`), `◆ Plan environments…`, and `✚ Add step…` (a
  multi-select picker that hides already-added requests and offers "Select
  all"). Each step row is annotated with a `# <name> · <METHOD> · <folder>`
  comment, and the per-step actions — **Open / Enable-Disable / Change /
  Remove** — live on the Execution sidebar (single-click opens the request;
  inline buttons + the right-click menu). A plan run in History expands each
  step with full request + assertion detail.
- **Three-surface byte-identical state** with Desktop and Web — same
  `applyMutation` chokepoint, same workspace shape, byte-for-byte
  identical commits. One repo, three surfaces.
- **Auto-refresh** on external writes — file watchers on both the
  synced and device-local files, so changes written by other tools (the
  `apicircle-lens` CLI or MCP server, a text editor) appear without a manual
  refresh.
- **Mock servers** — spin up local HTTP mocks from OpenAPI / Postman /
  Insomnia specs, hit them with the request editor, and see request counts in
  the status bar.
- **Secret vault** — passphrase-unlocked, in-memory AES-GCM key, auto-lock by
  inactivity, clipboard auto-clear on copy, reveal encrypted environment
  variables in place, consolidated `API Circle Runs` output channel.
- **Wired settings** for execution timeout, Remote-SSH host hint,
  history retention, and secret vault auto-lock + clipboard-clear.

**Now 2.0.0**, in lockstep with the rest of the monorepo. The bundle is held to
the soft 3.0 MB / hard 5.0 MB budget in
[`scripts/vscode-bundle-budget.mjs`](scripts/vscode-bundle-budget.mjs),
enforced by [`scripts/check-vscode-bundle.mjs`](scripts/check-vscode-bundle.mjs)
and [`apps/vscode/test/integration/bundleSize.test.ts`](apps/vscode/test/integration/bundleSize.test.ts).
E2E coverage in [`e2e/vscode/src/test/`](e2e/vscode/src/test/).

## Two ways to use it

The free API workspace runs in two modes. **The workspace lives in different
places in each.** Pick the one that matches what you're doing.

### Mode A — Local workspace (Desktop or Web app)

Open the app and a workspace is created automatically in browser storage
(IndexedDB); the desktop app also mirrors it to `~/.apicircle/`. No folder to
manage, no flags to remember.

- The **Mocks panel** creates and edits mock servers from your OpenAPI,
  Postman, or Insomnia specs. Starting one needs the desktop app or the VS Code
  extension (whose Mock view has the same lifecycle); the web app can't open a
  listening port.
- This repository provides no MCP setup. MCP is a paid
  [Lens feature of API Circle](https://apicircle.dev/lens) that works on the
  same `.apicircle` workspace.

This is the easiest way to get started. You don't need a workspace folder or a
git repo.

### Mode B — Git-backed workspace (teams, CI, headless tooling)

When you want to collaborate via PRs, connect the workspace to a GitHub repo
from the **Workspace** panel: add a token under **Git source**, then
**Connect repo**. The app pushes to a working branch it creates from the repo's
default branch, and opens PRs from the app. Teammates connect the same repo and
import the workspace from its base branch.

In the repo the workspace lives under `.apicircle/` (see
[Workspace storage layout](#workspace-storage-layout)):

- `.apicircle/registry.json` — the workspace index
- `.apicircle/workspace-<id>/workspace.json` — collections, environments,
  mock and plan definitions (shared with the team)
- `.apicircle/workspace-<id>/attachments/` — file attachments

Device-local state (history, sessions, secrets, UI state) stays in each
machine's `workspace.local.json` and is never pushed.

To run MCP or CLI automation against a clone, use the paid Lens features of API
Circle:

```bash
apicircle-lens mcp --repo ./<your-workspace-repo>
```

## Quick start

### Desktop app

Get the API Circle desktop app from
[apicircle.dev/download](https://apicircle.dev/download) — Windows through the
Microsoft Store, macOS and Linux from GitHub releases. It contains this
workspace; the paid Lens features beside it are optional.

### Web app

Open [studio.apicircle.dev](https://studio.apicircle.dev) — nothing to install.
A browser tab can't open a port, so the web app edits mock servers but can't
run them, and it stores secrets only after you set a workspace passphrase.

### MCP and the CLI

This repository publishes no CLI or MCP server (the old `@apicircle/cli` and
`@apicircle/mcp-server` packages are retired). Both are paid
[Lens features of API Circle](https://apicircle.dev/lens):

```bash
apicircle-lens mcp --repo ./your-workspace-repo
apicircle-lens run "Smoke Tests" --workspace-path ./your-workspace-repo/.apicircle/workspace-<id>
```

### Run from source

Requires Node ≥ 20 and pnpm ≥ 9.

```bash
pnpm install
pnpm dev:web            # web app → http://localhost:5174
```

## Connect your AI client

MCP is a paid [Lens feature of API Circle](https://apicircle.dev/lens). This
repository ships, publishes, and configures no MCP server; references to
`apicircle-mcp`, `@apicircle/mcp-server`, or `apicircle mcp` are retired.
Point your AI client at the same `.apicircle` workspace with:

```bash
apicircle-lens mcp --repo ./your-workspace-repo
```

## How it works

`applyMutation` in `@apicircle/core` is the single mutation API for headless
writers and most UI changes. The `apicircle-lens` CLI and MCP server compose the
same core package boundary, so workspaces stay compatible without this
repository shipping those headless surfaces. See
[`docs/architecture/platform.md`](docs/architecture/platform.md) for the current platform notes.

## Project status

API Circle is **self-funded**, and this repository is **actively developed in
the open.** Expect occasional rough edges as the 2.x line matures. Builds of the
standalone desktop shell produced by this repository's GitHub Actions are
**unsigned**, so their first launch triggers a one-time OS security prompt —
[`docs/installing.md`](docs/installing.md) walks through it. For day-to-day use,
get the [API Circle desktop app](https://apicircle.dev/download). Issues and
feedback are very welcome:
[github.com/apicircle/studio/issues](https://github.com/apicircle/studio/issues).

## Workspace storage layout

Every Git-backed workspace lives under a single `.apicircle/` hidden
directory. Since **1.1.0**, each workspace gets its own per-id subdirectory,
indexed by a `registry.json`:

```
your-repo/
└── .apicircle/
    ├── registry.json                      # workspace index
    └── workspace-<id>/
        ├── workspace.json                 # the synced workspace document
        └── attachments/<slotId>           # binary file attachments
```

Other tools may keep their own files inside `workspace-<id>/`; every writer
preserves files it doesn't own.

This layout has gone through two hard cutovers:

- **1.0.9** moved `workspace.json` from the repo root into `.apicircle/`.
- **1.1.0** moved it again into per-id subdirectories
  (`.apicircle/workspace-<id>/workspace.json`) and added `registry.json`.

Neither old layout is read by current versions. If you have a repo on an
older layout, the easiest fix is to re-push from the desktop app — it writes
the current layout automatically. For manual migration steps or an
export → re-import workflow, see [`docs/migration.md`](docs/migration.md).

## Documentation

- [Mock server guide](docs/mock-server.md)
- [Authentication — the 15-scheme matrix](docs/auth.md)
- [Platform surfaces — mock engine, desktop, and what the Lens features build on](docs/architecture/platform.md)
- [Open core and editions — extension seams](docs/architecture/open-core-and-editions.md)
- [Design system](docs/architecture/design-system.md)
- [Installing the standalone desktop build](docs/installing.md)
- [Migration guide — workspace storage relocation](docs/migration.md)
- [QA — coverage status and E2E CI](docs/qa/README.md)
- MCP (a paid Lens feature): [connect your AI client](docs/connect-your-ai-client.md) · [tool catalog](docs/mcp-tools-reference.md)

## Repository layout

```
apps/
  web/                  Vite + React shell — the browser build (studio.apicircle.dev)
  desktop/              Electron app — window, CSP, branding, auto-update
  vscode/               VS Code extension
packages/
  ui-components/        React UI + Zustand store + IndexedDB persistence
  core/                 Request execution, auth signing, secret crypto, assertions, imports, mutation API
  shared/               Types, generateId, field validators, legacy MCP names
  git/                  Git provider seam + GitHub REST client
  mock-server-core/     Hono mock-server engine + OpenAPI/Postman/Insomnia parsers + spec bundling
  desktop-shell/        Electron main-process building blocks (keychain secrets, mocks, OAuth2 callback, workspace mirror)
e2e/                    Playwright web + desktop suites, VS Code suite, QA runner
examples/               Demo workspaces + a standalone mock-server example
```

`@apicircle/{shared,core,mock-server-core}` are published to npm, and the VS
Code extension to the Marketplace and Open VSX. npm publishing does not run
from this repository (it has no npm workflow); the packages are released from a
pinned snapshot of it. MCP and the CLI ship with API Circle. `apps/web`,
`apps/desktop`, `git`, `ui-components` and `desktop-shell` are never published
to npm.

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

This repository is released under the **API Circle Studio License** — a custom
source-available license. The source is open to read, study, and contribute
to, but this is _not_ an OSI-approved open-source license. It is free for
personal, educational, and non-commercial use (plus a 30-day commercial
evaluation period); ongoing commercial use requires a separate license. See
[`LICENSE`](LICENSE) for the full terms, or contact **apicircle365@gmail.com**
for commercial licensing.
