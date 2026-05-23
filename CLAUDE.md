# CLAUDE.md — API Circle Studio

Single-source context for anyone (human or AI) picking up this repo cold. Read
this first; it links out to the deeper docs in [`docs/`](docs/).

---

## 1. What this is

**API Circle Studio** — a greenfield API workspace tool. Think Postman/Insomnia,
but with:

- A **Git-backed workspace**: the workspace is a JSON document pushed to a
  GitHub repo on a working branch; teams collaborate via pull requests.
- An **on-disk workspace mirror**: the desktop app keeps a plain-JSON mirror
  per workspace under `userData/workspaces/<id>/` with a sibling
  `registry.json`. The CLI, MCP server, and external tools all read the same
  source of truth the UI uses, no IPC required.
- **Local mock servers**: describe an API in OpenAPI / Postman / Insomnia and
  run a Hono-backed mock on `localhost`.
- An **MCP server**: exposes the workspace as a 72-tool catalog any
  Model Context Protocol client (Claude Desktop, ChatGPT, Cursor, Copilot,
  Continue, Cline, Zed, Windsurf) can drive.
- A **CLI** for headless use
  (`apicircle mock | mcp | import | run | workspaces`).

The web build is continuously deployed to GitHub Pages from `main`
(custom domain via a checked-in `CNAME`).

**Project status: pre-launch 1.0.x, zero installed users.** 1.0.0 was the
first public release; 1.0.1 hardened the desktop installer pipeline, 1.0.2
shipped the disk mirror + multi-workspace addressing, 1.0.3 shipped the MCP
connect flow and the Settings → Community section. There's still no
production data and no public API contract to preserve. Prefer redesigning a
bad shape over patching it — no migration shims, no backwards-compat
branches. See §10. Release notes: [`CHANGELOG.md`](CHANGELOG.md).

---

## 2. Repo skeleton

Turbo + pnpm monorepo. Node ≥ 20, pnpm ≥ 9.

```
studio/
├── apps/
│   ├── web/              Vite + React 18 shell — the browser build (dev port 5174)
│   └── desktop/          Electron shell — hosts the web UI, OS-keychain secrets,
│                           mock + MCP IPC bridges (src/main/*)
├── packages/
│   ├── shared/            Types, generateId, validators, encryption + MCP envelopes
│   ├── core/              Request execution, env resolution, auth signing, assertions,
│   │                       imports, git serialize/merge, transforms, applyMutation
│   ├── git/               GitHub REST client + typed error taxonomy
│   ├── ui-components/      ALL React UI + the Zustand store + IndexedDB persistence
│   ├── mock-server-core/   Hono mock-server engine + OpenAPI/Postman/Insomnia parsers
│   ├── mcp-server/         stdio MCP host + 72-tool catalog + workspace providers
│   └── cli/                `apicircle` binary — mock / mcp / import / run / workspaces
├── examples/              Demo workspaces + a standalone mock-server example
├── docs/                  Product + architecture + QA docs (see §9)
├── e2e/                   E2E suites — web/ + desktop/ (Playwright), mock/ (Hono
│                            test backend), qa/ (Cowork manual-test runner)
├── scripts/               Build (icons, release binaries) + E2E coverage tooling
└── .github/workflows/     CI: ci, codeql, e2e, release, desktop-release, deploy-web
```

**Publishable npm packages** (`@apicircle/*`): `shared`, `core`,
`mock-server-core`, `mcp-server`, `cli`. `git` and `ui-components` are
workspace-private; `apps/*` and `e2e/*` are private.

---

## 3. Architecture — the load-bearing ideas

### Two-document workspace model

A workspace is split into two JSON documents:

- **`WorkspaceSynced`** — everything that belongs in Git and is shared with the
  team: the request/folder collection tree, environments, mock-server
  _definitions_, releases, linked workspaces, global assets, secret-crypto
  metadata.
- **`WorkspaceLocal`** — per-device runtime state that never leaves the
  machine: history runs, mock-server _runtime_ state, the GitHub session, plain
  secret material, UI state.

`packages/shared/src/types.ts` is the canonical schema for both.

### `applyMutation` — the single mutation choke point

`applyMutation(state, patch)` in `@apicircle/core` is the **only** function that
mutates a workspace. The UI store, MCP tool handlers, and CLI commands all
funnel through it. `WorkspacePatch` is a discriminated union over
`request.* | folder.* | environment.* | assertion.* | mock.* | plan.*`. Adding
an entity type = one union variant + one switch case + one MCP tool.

> Note: the live UI store (`workspaceStore.ts`) also performs some direct
> `set({ synced, local })` transitions rather than routing every change through
> `applyMutation`. Treat `applyMutation` as the contract for headless
> (MCP/CLI) writers.

### MCP provider abstraction

`@apicircle/mcp-server` tool handlers depend on three interfaces, not
concretes:

- **`WorkspaceProvider`** — `read()` / `apply(patch)` / `write({synced?,local?})`.
  Implementations: `InMemoryWorkspaceProvider`, `FileBackedWorkspaceProvider`
  (disk + `proper-lockfile` advisory lock).
- **`Workspaces`** — multi-workspace discovery: `list()` / `get(id)` /
  `setActive(id)`. Implementations: `SingleWorkspaceWorkspaces` and
  `MultiWorkspaceProvider` (registry root on disk; rebuilds the per-id
  `FileBackedWorkspaceProvider` whenever the active id changes).
- **`MockController`** — `start` / `stop` / `list`. Implementation:
  `InProcessMockController` (wraps `mock-server-core` directly).

### Mock server — three runtimes, one engine

`@apicircle/mock-server-core` is a Hono app builder. The same factory powers the
desktop `MockManager`, the CLI `apicircle mock`, and the MCP `mock.start` tool.

### Disk mirror + workspace registry

Desktop persistence is two-layer: IndexedDB (canonical for the renderer) plus
a plain-JSON mirror on disk so external readers (CLI / MCP / a text editor)
can operate on the same source of truth.

- `diskMirror` + `diskMirrorMerge` in
  `packages/ui-components/src/persistence/` debounce writes and three-way
  merge on refresh.
- `workspaceRegistry` in `packages/core/src/workspace/workspaceRegistry.ts`
  owns the on-disk registry shape. The IDB-side `WorkspaceRegistry` type in
  `packages/ui-components/src/persistence/db.ts` mirrors it exactly.
- `resolveWorkspace` in `packages/cli/src/util/resolveWorkspace.ts` gives
  every CLI subcommand the same `--workspace-name` / `--workspace-path`
  addressing model the desktop uses.

### Desktop bridge contract

`packages/ui-components/src/desktop/bridge.ts` is the single source of truth
for the `window.apicircleDesktop` IPC surface. `apps/desktop/src/main/preload.ts`
writes its bridge with `satisfies DesktopBridge` so missing or mistyped fields
fail `pnpm check`. Add a new bridge surface here first; never redeclare an
ad-hoc interface in the consumer.

---

## 4. State, store & persistence

- **Store:** `packages/ui-components/src/store/workspaceStore.ts` — a single
  large Zustand store (~6.7k lines). Action helpers split into sibling files
  (`editorActions.ts`, `envActions.ts`, `mockActions.ts`, `planActions.ts`,
  `secretActions.ts`, `globalAssetsActions.ts`, …).
- **Persistence:** `packages/ui-components/src/persistence/` — workspace docs
  live in **IndexedDB**; debounced writes; attachments stored as blobs; secrets
  encrypted (AES-GCM, WebCrypto). On desktop the master key is wrapped via the
  OS keychain; on web a workspace passphrase model is used instead.
- **UI:** `packages/ui-components/src/` — `App.tsx` + 9 panels
  (`layout/panels.ts`): Workspace, Link Workspace, Editor, Environments,
  Execution, History, Mocks, MCP, Help Center. Editors are Monaco-based.
- **Settings popover** (`layout/SettingsPicker.tsx`) hangs off the top bar —
  behavioral toggles, theme + font pickers, and the **Community section**
  (`community/CommunitySection.tsx`) that fetches live GitHub stats with a
  6h IndexedDB cache. Desktop builds get a native download CTA via the
  `desktopDownload` primitive.
- **MCP panel** (`panels/mcp/`) is two sections (`mcpPanelTypes`):
  **Connection** — the four-step `HowToConnect` setup flow that emits a
  per-client config snippet via the desktop bridge (Windows path encoding
  handled via `ConfigSnippetVariants`), plus the workspace mirror status —
  and **Prompts** — the curated `mcpPrompts` catalog.
- **Per-panel error boundary** (`primitives/PanelErrorBoundary`) catches
  render errors per panel without taking down the shell.

---

## 5. Auth (complete)

All 17 `RequestAuth` types are end-to-end functional. Signing primitives
(`digest`, `ntlm`, `hawk`, `awsSigV4`, `jwt`) and the OAuth2 token client
(per-grant runners, PKCE, device flow, refresh) live in
`packages/core/src/auth/*`. Full matrix: [`docs/auth.md`](docs/auth.md).

---

## 6. Conventions

- **TypeScript strict**, type-checked ESLint (`recommendedTypeChecked`).
  No `any` to silence the checker — model the type. `no-floating-promises`,
  `consistent-type-imports`, `prefer-const`, `eqeqeq` are all errors.
- **Styling:** Tailwind CSS utility classes composed via the `cn()` helper
  (`packages/ui-components/src/primitives/cn.ts`). `var(--purple)` is the
  accent (with the `text-accent` / `bg-accent` / `border-accent` tokens).
- **Icons:** `lucide-react`.
- **IDs:** `generateId()` from `@apicircle/shared` — never hand-roll IDs.
- **Tests are co-located:** `foo.ts` ↔ `foo.test.ts` (Vitest). Accessibility is
  covered by axe assertions in the Playwright suite — keep them green.
- **Commits:** Conventional Commits, enforced by commitlint + Husky hooks.

---

## 7. Commands

```bash
pnpm install              # install workspace deps
pnpm dev:web              # web dev server → http://localhost:5174
pnpm dev                  # turbo dev (all apps)
pnpm build                # turbo build
pnpm check                # turbo typecheck (tsc --noEmit per package)
pnpm lint                 # eslint .
pnpm test                 # vitest run (unit, all packages)
pnpm test:e2e             # Playwright E2E (web, chromium)
npx knip                  # dead-code / unused-dependency scan (config: knip.json)
```

Desktop: `pnpm --filter @apicircle/desktop build` then `… start`.

---

## 8. Testing & CI

- **Unit:** Vitest, co-located `*.test.ts(x)`. Per-package coverage thresholds.
- **E2E:** Playwright. The `@apicircle/e2e-web` (`e2e/web/`) and
  `@apicircle/e2e-desktop` (`e2e/desktop/`) packages hold the specs. The web
  suite drives the app against `@apicircle/e2e-mock` (`e2e/mock/`). Test-case
  coverage is tracked against workbooks via `tcMap*` fixtures +
  `scripts/e2e_coverage_*`.
- **CI workflows** (`.github/workflows/`):
  - `ci.yml` — lint / typecheck / unit tests (quality gates).
  - `codeql.yml` — security analysis.
  - `e2e.yml` — Playwright + cross-browser smoke + visual baseline.
  - `release.yml` — changesets-driven npm publish of `@apicircle/*` packages.
  - `desktop-release.yml` — Electron installers + `electron-updater` indexes.
  - `deploy-web.yml` — builds `apps/web` and publishes to GitHub Pages on
    every push to `main`.

---

## 9. Where the docs live

| Doc                                                                | Purpose                                                          |
| ------------------------------------------------------------------ | ---------------------------------------------------------------- |
| [`docs/architecture/platform.md`](docs/architecture/platform.md)   | Platform surfaces design record (MCP, mock engine, CLI, desktop) |
| [`docs/auth.md`](docs/auth.md)                                     | The 17-auth-type matrix                                          |
| [`docs/mock-server.md`](docs/mock-server.md)                       | Mock server feature guide                                        |
| [`docs/mcp-tools-reference.md`](docs/mcp-tools-reference.md)       | MCP tool catalog reference                                       |
| [`docs/connect-your-ai-client.md`](docs/connect-your-ai-client.md) | Wiring an MCP client                                             |
| [`docs/installing.md`](docs/installing.md)                         | Install instructions                                             |
| [`docs/qa/README.md`](docs/qa/README.md)                           | QA status, E2E CI reference, coverage tooling                    |
| [`docs/context/api-circle.md`](docs/context/api-circle.md)         | Tool-agnostic cold-start brief (for Cursor / Copilot / etc.)     |
| [`CHANGELOG.md`](CHANGELOG.md)                                     | Release-by-release feature notes (1.0.0 → now)                   |
| [`e2e/qa/runner/`](e2e/qa/runner/)                                 | Cowork manual-test runner — fixtures, seed script, runner prompt |

---

## 10. Working in this repo (notes for AI agents)

- **Pre-launch freedom.** Zero users — no legacy to protect. When a type, the
  store shape, or persisted JSON is awkward, _reshape it_ rather than bolting on
  fields. No migration shims, dual-write paths, or `// legacy` branches.
- **Update every layer in one pass.** A change usually touches UI ↔ store ↔
  persistence ↔ shared types ↔ core/CLI/MCP. Name the consequences; don't leave
  fixtures or tests in a stale shape.
- **Tests are part of the change**, not a follow-up.
- **Plan before non-trivial work.** Problem → approach → files → verification.
- **Delete aggressively.** Dead code and unused exports — remove them.
  `npx knip` (configured by `knip.json`) is the source of truth for what's
  unused; it has accurate entry-point config for the Electron, Playwright, and
  script entry points.
- **Don't reach for `any`** or `as unknown as X`. Fix the type.

---

## 11. Planned next — Networking & Social Activity

The next product thread extends the Settings → Community section (currently
read-only: GitHub stars / contributors / latest release with a 6h IndexedDB
cache) into a first-class **community** surface inside the app.

In flight / under design:

- **Networking** — user-to-user surfaces beyond the Git/PR loop: profiles,
  follow / follower lists, mutual connections, and follow-based filtering
  of the Link Workspace marketplace.
- **Social Media Activity** — an activity feed of community signals (new
  releases on linked workspaces, follow-graph posts, stars/forks/comments
  on public workspaces) plus outbound "share to X / Mastodon / LinkedIn"
  hooks on public Link Workspace pages.

Architectural anchors when this work starts:

- **Schema lives in `WorkspaceSynced`** — add a new `social` and/or
  `network` slice in `packages/shared/src/types.ts`. Pre-launch freedom
  still applies: reshape existing types if a clean social schema demands
  it. No migration shims.
- **Mutations route through `applyMutation`** — new `WorkspacePatch`
  variants (`social.*`, `network.*`) plus matching MCP tools, so AI
  clients drive the same surfaces the UI does.
- **Feed data is per-device** — remote-feed fetches live in
  `WorkspaceLocal`, not Git-synced. Reuse the TTL + IndexedDB caching
  pattern from `community/communityStorage.ts`.
- **UI lands in two places first** — a new sub-section inside the existing
  Settings → Community popover for self/network management, and feed
  surfaces inside the Link Workspace panel. Don't add a 10th top-nav
  panel until the feature set actually warrants it.
- **External shares are share-link snippets first** — open the network's
  compose URL in the browser; don't take on OAuth-to-post integrations
  until usage justifies them.

Replace this section with the concrete plan record (or link out to one
under `docs/architecture/`) once the work begins.
