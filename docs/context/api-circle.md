# API Circle Studio — Project Context

A standalone briefing for any AI agent or contributor picking up this
repo cold. It says what the product is, how the code is shaped, how to
build and test it, what is done, and what is still open — enough to
resume development without prior context

> [`CLAUDE.md`](../../CLAUDE.md) at the repo root is the Claude-Code
> auto-loaded version of this briefing. This file is the tool-agnostic
> equivalent for Cursor, Copilot, ChatGPT, and others. When the two
> disagree, the code wins — both are documentation and can drift.

---

## 1. What it is

**API Circle Studio** is an API workspace tool — think Postman or
Insomnia — with a handful of things that set it apart:

- **Git-backed workspace.** A workspace is a JSON document pushed to a
  GitHub repo on a working branch; teams collaborate via pull requests.
- **On-disk workspace mirror.** Every workspace lives on disk under
  `~/.apicircle/workspace-<id>/` (indexed by
  `~/.apicircle/registry.json`) so the CLI, the MCP server, and
  external tools can read or edit the same source of truth the UI uses.
- **Local mock servers.** Describe an API in OpenAPI / Postman /
  Insomnia and run a Hono-backed mock on `localhost`.
- **An MCP server.** The workspace is exposed as a 97-tool catalog any
  Model Context Protocol client (Claude Desktop, ChatGPT, Cursor,
  GitHub Copilot, Codex, Continue, Cline, Zed, Windsurf) can drive.
- **A CLI** (`apicircle mock | mcp | import | run | workspaces`) for
  headless use.

It ships in three forms: a browser web app (continuously deployed to
GitHub Pages from `main`), an Electron desktop app, and npm packages +
platform binaries.

## 2. Project status

**Pre-launch, public 1.0.x. Zero installed users.** v1.0.0 was the
first public release; 1.0.1 hardened the desktop installer pipeline,
1.0.2 shipped the disk-mirror + multi-workspace addressing 1.0.3
shipped the MCP "connect" flow -> Community section and
1.0.4 ships the Global Assets file library plus the canonical live GitHub
dependency/snapshot/release E2E pipeline.
There is still no production data and no public API contract to
preserve — see §14. Full notes: [`CHANGELOG.md`](../../CHANGELOG.md).

## 3. Repo layout

Turbo + pnpm monorepo. Node ≥ 20, pnpm ≥ 9.

```
studio/
├── apps/
│   ├── web/              Vite + React 18 shell — browser build (dev port 5174)
│   └── desktop/          Electron shell — hosts the web UI, OS-keychain
│                           secrets, mock + MCP IPC bridges (src/main/*)
├── packages/
│   ├── shared/           Types, generateId, validators, encryption, MCP envelopes
│   ├── core/             Request execution, env resolution, auth signing,
│   │                       assertions, imports, git serialize/merge,
│   │                       transforms, applyMutation
│   ├── git/              GitHub REST client + typed error taxonomy
│   ├── ui-components/    ALL React UI + the Zustand store + IndexedDB persistence
│   ├── mock-server-core/ Hono mock engine + OpenAPI/Postman/Insomnia parsers
│   ├── mcp-server/       stdio MCP host + 97-tool catalog + workspace providers
│   └── cli/              `apicircle` binary — mock / mcp / import / run / workspaces
├── examples/             Demo workspaces + a standalone example mock server
├── docs/                 Product + architecture + QA docs (see §16)
├── e2e/                  E2E suites — web/ + desktop/ (Playwright packages),
│                           mock/ (Hono test backend), qa/ (Cowork runner)
├── scripts/              Build (icons, release binaries) + E2E coverage tooling
└── .github/workflows/    CI: ci, codeql, e2e, release, desktop-release, deploy-web
```

**Publishable npm packages** (`@apicircle/*`): `shared`, `core`,
`mock-server-core`, `mcp-server`, `cli`. `git` and `ui-components` are
workspace-private; `apps/*` are private.

## 4. Architecture — the load-bearing ideas

### Two-document workspace model

A workspace is split into two JSON documents:

- **`WorkspaceSynced`** — everything that belongs in Git and is shared
  with the team: the request/folder collection tree, environments,
  mock-server _definitions_, releases, linked workspaces, global assets,
  secret-crypto metadata.
- **`WorkspaceLocal`** — per-device runtime state that never leaves the
  machine: history runs, mock-server _runtime_ state, the GitHub
  session, plain secret material, UI state.

`packages/shared/src/types.ts` is the canonical schema for both.

### `applyMutation` — the single mutation choke point

`applyMutation(state, patch)` in `@apicircle/core` is the contract for
mutating a workspace. The MCP tool handlers and CLI commands all funnel
through it. `WorkspacePatch` is a discriminated union over
`request.* | folder.* | environment.* | assertion.* | mock.* | release.* | linkedWorkspace.* | linkedOverride.* | plan.*`.
Adding an entity type = one union variant + one switch case + one MCP
tool.

> The live UI store (`workspaceStore.ts`) also performs some direct
> `set({ synced, local })` transitions rather than routing every change
> through `applyMutation`. Treat `applyMutation` as the contract for
> headless (MCP / CLI) writers.

### MCP provider abstraction

`@apicircle/mcp-server` tool handlers depend on three interfaces, not
concretes:

- **`WorkspaceProvider`** — `read()` / `apply(patch)` /
  `write({synced?, local?})`. Implementations:
  `InMemoryWorkspaceProvider` and `FileBackedWorkspaceProvider` (disk +
  `proper-lockfile` advisory lock).
- **`Workspaces`** — multi-workspace discovery: `list()` /
  `get(id)` / `setActive(id)`. Implementations:
  `SingleWorkspaceWorkspaces` (one workspace, fixed) and
  `MultiWorkspaceProvider` (registry root on disk, rebuilds the per-id
  `FileBackedWorkspaceProvider` whenever the active id changes).
- **`MockController`** — `start` / `stop` / `list`. Implementation:
  `InProcessMockController` (wraps `mock-server-core` directly).

This is why the MCP server doesn't care whether it runs inline in
Electron, standalone via the CLI, or in a future hosted service.

### Mock server — three runtimes, one engine

`@apicircle/mock-server-core` is a Hono app builder. The same factory
powers the desktop `MockManager`, the CLI `apicircle mock`, and the MCP
`mock.start` tool.

### Disk mirror + workspace registry

Desktop persistence is two-layer: IndexedDB (canonical for the
renderer) plus a plain-JSON mirror on disk under
`~/.apicircle/workspace-<id>/{workspace.json,workspace.local.json}`
with a sibling `~/.apicircle/registry.json` listing every workspace
and its `lastOpenedAt`. The mirror exists so external readers (the
CLI, the MCP server, an editor poking at the JSON, future hosted
services) can operate on the same source of truth the UI uses,
without any IPC.

- `diskMirror` + `diskMirrorMerge` (`packages/ui-components/src/persistence/`)
  debounce writes and do a three-way merge when refreshing from disk.
- `workspaceRegistry` (`packages/core/src/workspace/workspaceRegistry.ts`)
  owns the on-disk registry shape; the IDB-side `WorkspaceRegistry`
  type in `packages/ui-components/src/persistence/db.ts` mirrors it
  exactly.
- `resolveWorkspace` (`packages/cli/src/util/resolveWorkspace.ts`)
  gives every CLI subcommand the same `--workspace-name` /
  `--workspace-path` addressing model the desktop uses.

### Desktop bridge contract

`packages/ui-components/src/desktop/bridge.ts` is the single source of
truth for the `window.apicircleDesktop` IPC surface. Both
`apps/desktop/src/main/preload.ts` and every renderer consumer (the
MCP panel, the Workspace Mirror row, the mock-server controls) import
the typed shapes here — `preload.ts` uses `satisfies DesktopBridge` so
missing or mistyped fields fail `pnpm check`. Add a new bridge surface
here first; never redeclare an ad-hoc interface in the consumer.

Full design record: [`docs/architecture/platform.md`](../architecture/platform.md).

## 5. State, store & persistence

- **Store:** `packages/ui-components/src/store/workspaceStore.ts` — a
  single large Zustand store. Action helpers split into sibling files
  (`editorActions.ts`, `envActions.ts`, `mockActions.ts`,
  `planActions.ts`, `secretActions.ts`, `globalAssetsActions.ts`, …).
- **Persistence:** `packages/ui-components/src/persistence/` — workspace
  docs live in **IndexedDB**; debounced writes; attachments stored as
  blobs; secrets encrypted (AES-GCM, WebCrypto). On desktop the master
  key is wrapped via the OS keychain; on web a workspace passphrase
  model is used instead.
- **UI:** `packages/ui-components/src/` — `App.tsx` + 9 panels
  (`layout/panels.ts`): Workspace, Link Workspace, Editor, Environments,
  Execution, History, Mocks, MCP, Help Center. Editors are Monaco-based.
- **Settings popover** (`layout/SettingsPicker.tsx`) hangs off the top
  bar — behavioral toggles, theme + font pickers, and the
  **Community section** (`community/CommunitySection.tsx`) that
  fetches live GitHub stats with a 6h IndexedDB cache.
- **Per-panel error boundary** (`primitives/PanelErrorBoundary`) catches
  render errors per panel without taking down the shell.

## 6. Auth

All 17 `RequestAuth` types are end-to-end functional: `none`, `inherit`,
`bearer`, `basic`, `api-key`, `custom-header`, the six OAuth2 grants
(client-credentials, auth-code, PKCE, password/ROPC, implicit, device),
`aws-sigv4`, `digest`, `ntlm`, `hawk`, `jwt-bearer`.

Signing primitives (`digest`, `ntlm`, `hawk`, `awsSigV4`, `jwt`) and the
OAuth2 token client live in `packages/core/src/auth/*` — all
browser-safe. `applyAuth` wires auth into outgoing headers and
auto-refreshes expiring tokens; `executeRequest` drives challenge-
response retries (Digest 401, NTLM 3-way).

**Folder-level auth** — `Folder.auth?: RequestAuth` lets a folder
set an auth block that descendant requests with `auth.type === 'inherit'`
pick up automatically via `resolveInheritedAuth`, which walks up the
folder chain and returns the first explicit (non-`inherit`, non-`none`)
auth. Editable on every host: web/desktop modal, VS Code's
`apicircle://<ws>/folders/<…>.folder.yaml` projection, and the MCP
`folder.update` tool (`{ id, name?, auth?, clearAuth?, parentId? }`).
Mutations route through the `folder.update` WorkspacePatch.

Full matrix: [`docs/auth.md`](../auth.md).

## 7. MCP server

`@apicircle/mcp-server` exposes **97 tools** over stdio, namespaced by
capability: imports, code generation, multi-workspace discovery
(`workspace.list`), workspace read/write, request / folder /
environment / plan / assertion CRUD, **folder export / import as JSON**
(`apicircle.folder/v1` envelope — credentials redacted by default),
history, codebase extraction, prompt-driven authoring, and mock-server
lifecycle + endpoint editing.
Canonical list: `packages/shared/src/mcp.ts`; registered in
`packages/mcp-server/src/tools/registry.ts`. Per-tool input shapes:
[`docs/mcp-tools-reference.md`](../mcp-tools-reference.md).

The in-product **MCP panel** (`panels/mcp/`) has two sections driven
by `mcpPanelTypes`: **Connection** (the four-step `HowToConnect` setup
flow that emits a per-client config snippet via the desktop bridge,
plus the workspace mirror status and refresh) and **Prompts** (the
curated `mcpPrompts` catalog). Setup snippets handle Windows path
encoding via the `ConfigSnippetVariants` `{forwardSlash, escaped,
identical}` shape — the UI lets the user pick which JSON-escape form
to paste. Wiring a client end-to-end:
[`docs/connect-your-ai-client.md`](../connect-your-ai-client.md).

## 8. Mock server

`@apicircle/mock-server-core` turns OpenAPI / Swagger / Postman /
Insomnia files (or manual-mode endpoint definitions) into a running HTTP
server on `localhost`. Definitions are workspace-scoped (`synced.
mockServers`, pushed to git); runtime state is per-host (`local.
mockRuntime`). Creation works in both web and desktop; **starting** a
mock runtime needs the desktop bridge or the CLI. Feature guide:
[`docs/mock-server.md`](../mock-server.md).

## 9. CLI

`@apicircle/cli` ships the `apicircle` binary with five subcommands:
`mock` (run a mock server from a spec), `mcp` (run the MCP server over
stdio), `import` (load a spec into a workspace), `run` (execute a
saved execution plan and report pass/fail — for CI gates), and
`workspaces` (`list | create | use | path` — manage the on-disk
multi-workspace registry the desktop app shares with the CLI and AI
clients). Every command resolves `--workspace-name` /
`--workspace-path` against that registry via `resolveWorkspace`.
Distributed as an npm package and as platform binaries (linux-x64,
macos-x64, macos-arm64, win-x64).

## 10. Build & test commands

```bash
pnpm install              # install workspace deps
pnpm dev:web              # web dev server → http://localhost:5174
pnpm dev                  # turbo dev (all apps)
pnpm build                # turbo build
pnpm check                # turbo typecheck (tsc --noEmit per package)
pnpm lint                 # eslint .
pnpm test                 # vitest run (unit, all packages)
pnpm test:e2e             # Playwright E2E (web, chromium)
npx knip                  # dead-code / unused-dependency scan
```

Desktop: `pnpm --filter @apicircle/desktop build` then `… start`.

## 11. Testing & CI

- **Unit:** Vitest, co-located `*.test.ts(x)`. Per-package coverage
  thresholds.
- **E2E:** Playwright. The `e2e/web/` (`@apicircle/e2e-web`) and
  `e2e/desktop/` (`@apicircle/e2e-desktop`) packages hold the specs; the
  web suite drives the app against the `e2e/mock/` Hono backend. Coverage
  is tracked against the manual test-case workbooks in
  `docs/qa/test_cases/` via `tcMap*` fixtures + `scripts/e2e_coverage_*`.
- **CI workflows** (`.github/workflows/`): `ci.yml` (lint / typecheck /
  unit), `codeql.yml` (security), `e2e.yml` (Playwright + cross-browser
  smoke + visual baseline), `release.yml` (changesets-driven npm
  publish of `@apicircle/*`), `desktop-release.yml` (Electron
  installers + `electron-updater` indexes), and `deploy-web.yml`
  (builds `apps/web` and deploys it to GitHub Pages on every push to
  `main` — the hosted web build is continuously available; custom
  domain wired via a checked-in `CNAME`).
- QA status, coverage modes, and the E2E CI reference live in
  [`docs/qa/README.md`](../qa/README.md).

## 12. Conventions

- **TypeScript strict**, type-checked ESLint (`recommendedTypeChecked`).
  No `any` to silence the checker — model the type. `no-floating-
promises`, `consistent-type-imports`, `prefer-const`, `eqeqeq` are all
  errors.
- **Styling:** Tailwind CSS utility classes composed via the `cn()`
  helper (`packages/ui-components/src/primitives/cn.ts`). `var(--purple)`
  is the accent (with `text-accent` / `bg-accent` / `border-accent`
  tokens).
- **Icons:** `lucide-react`.
- **IDs:** `generateId()` from `@apicircle/shared` — never hand-roll.
- **Tests are co-located:** `foo.ts` ↔ `foo.test.ts` (Vitest).
- **Commits:** Conventional Commits, enforced by commitlint + Husky.

## 13. Current status & what's pending

The product surfaces are built and functional: the web + desktop apps,
the 17 auth types, the mock-server engine across all three runtimes,
the 97-tool MCP server, the CLI with multi-workspace addressing, the
disk-mirror persistence layer, the MCP **Connection / Prompts** panel
sections, the Settings → Community surface, and the GitHub Pages web
deploy. Unit tests are green.

Open work is concentrated in **E2E test depth**: a large share of the
"covered" test-case rows are workbook-iteration placeholders rather
than executing assertions, so converting those into real assertions
module-by-module is the main outstanding effort. Some test-case rows
are genuinely manual (cross-OS installer signing, real-IdP live tier,
perception perf) and a few wait on product features not yet shipped
(code-generation web UI, pre-request script sandbox, telemetry panel,
web-UI HAR/OpenAPI import). The authoritative status, numbers, and
pending list are in [`docs/qa/README.md`](../qa/README.md).

## 13a. Planned next — Networking & Social Activity

The next product thread builds on the Settings → Community section
(which today is read-only: GitHub stars / contributors / latest
release with a 6h IndexedDB cache). The intent is to grow that
beachhead into a first-class **community** surface inside the app.

In flight / under design:

- **Networking** — user-to-user surfaces beyond the Git/PR loop:
  profiles, follow / follower lists, mutual connections, and
  follow-based filtering of the Link Workspace marketplace. The Link
  Workspace panel already hosts public workspaces, marketplace search,
  and version pinning — these are the natural attach points.
- **Social Media Activity** — an activity feed of community signals:
  what your followed creators just published, new releases on workspaces
  you've linked, stars / forks / comments on public workspaces, and
  outbound "share to Twitter / Mastodon / LinkedIn" hooks on a public
  Link Workspace page.

Architectural anchors when this work starts:

- **Schema lives in `WorkspaceSynced`** — a new `social` and/or
  `network` slice in `packages/shared/src/types.ts`. Pre-launch
  freedom (§14) still applies: reshape the existing types if a clean
  social schema demands it. No migration shims.
- **Mutations route through `applyMutation`** — add the relevant
  `WorkspacePatch` variants and matching MCP tools (`social.follow`,
  `social.activity_feed`, etc.) so AI clients can drive the same
  social surfaces the UI does.
- **Feed data is per-device** — anything fetched from a remote feed
  endpoint lives in `WorkspaceLocal`, not Git-synced. The same TTL +
  IndexedDB caching pattern `community/communityStorage.ts` already
  uses is the template.
- **UI lands in two places** — a new sub-section inside the existing
  Settings → Community popover for self/network management, and feed
  surfaces inside the Link Workspace panel. A dedicated top-nav panel
  is a later call; keep the surface count to 9 until the social
  feature set is meaningful enough to warrant one.
- **External shares are share-link generation, not OAuth** — first
  cut is opening the network's compose URL in the browser rather than
  full OAuth-to-post integrations; OAuth comes later only if usage
  justifies it.

When this work begins, replace this section with the concrete plan
record (or link out to one under `docs/architecture/`).

## 14. How to work in this repo

Because the product is pre-launch with zero users:

- **Pre-launch freedom.** No legacy to protect. When a type, the store
  shape, or persisted JSON is awkward, _reshape it_ — don't bolt on
  fields. No migration shims, dual-write paths, or `// legacy` branches.
- **Update every layer in one pass.** A change usually touches UI ↔
  store ↔ persistence ↔ shared types ↔ core/CLI/MCP. Name the
  consequences; don't leave fixtures or tests in a stale shape.
- **Tests are part of the change**, not a follow-up.
- **Plan before non-trivial work.** Problem → approach → files →
  verification.
- **Delete aggressively.** Dead code and unused exports — remove them.
  `npx knip` is the source of truth for what's unused.
- **Don't reach for `any`** or `as unknown as X`. Fix the type.

## 15. Where to find more

| Doc                                                              | Purpose                                         |
| ---------------------------------------------------------------- | ----------------------------------------------- |
| [`CLAUDE.md`](../../CLAUDE.md)                                   | Repo-root cold-start briefing                   |
| [`CHANGELOG.md`](../../CHANGELOG.md)                             | Release-by-release feature notes (1.0.0 → now)  |
| [`docs/architecture/platform.md`](../architecture/platform.md)   | MCP / mock engine / CLI / desktop design record |
| [`docs/auth.md`](../auth.md)                                     | The 17-auth-type matrix                         |
| [`docs/mock-server.md`](../mock-server.md)                       | Mock server feature guide                       |
| [`docs/mcp-tools-reference.md`](../mcp-tools-reference.md)       | MCP tool catalog reference (97 tools)           |
| [`docs/connect-your-ai-client.md`](../connect-your-ai-client.md) | Wiring an MCP client                            |
| [`docs/installing.md`](../installing.md)                         | Install instructions                            |
| [`docs/qa/README.md`](../qa/README.md)                           | QA status, E2E CI reference, coverage tooling   |
