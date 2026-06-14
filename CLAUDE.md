# CLAUDE.md — API Circle Studio

Single-source context for anyone (human or AI) picking up this repo cold. Read
this first; it links out to the deeper docs in [`docs/`](docs/).

---

## 1. What this is

**API Circle Studio** — a greenfield API workspace tool. Think Postman/Insomnia,
but with:

- A **Git-backed workspace**: the workspace is a JSON document pushed to a
  GitHub repo on a working branch; teams collaborate via pull requests.
- An **on-disk workspace mirror**: every workspace lives under
  `~/.apicircle/workspaces/<id>/` with a sibling
  `~/.apicircle/registry.json`. The CLI, MCP server, and external tools all
  read the same source of truth the UI uses, no IPC required.
- **Local mock servers**: describe an API in OpenAPI / Postman / Insomnia and
  run a Hono-backed mock on `localhost`.
- An **MCP server**: exposes the workspace as a 94-tool catalog any
  Model Context Protocol client (Claude Desktop, ChatGPT, Cursor, Copilot,
  Codex, Continue, Cline, Zed, Windsurf) can drive.
- A **CLI** for headless use
  (`apicircle mock | mocks | mcp | import | export | run | workspaces | linked |
release | folder`).

The web build is continuously deployed to GitHub Pages from `main`
(custom domain via a checked-in `CNAME`).

**Project status: pre-launch 1.0.x, zero installed users.** 1.0.0 was the
first public release; 1.0.1 hardened the desktop installer pipeline, 1.0.2
shipped the disk mirror + multi-workspace addressing, 1.0.3 shipped the MCP
connect flow and the Settings → Community section; 1.0.4 promoted the
Global Assets Files library + the live-GitHub test suite; 1.0.5 doubled the
theme + font catalog and added Monaco-matched themes; 1.0.7 shipped the
portable folder + environment exchange envelope (`.apicircle.json` /
encrypted-row v2), the Secret Vault "Set passphrase" / decrypt-failure
recovery surfaces, and reverted the default appearance to **One Dark Pro**

- **System Sans**. 1.0.9 relocates the Git-tracked workspace document from
  the repo root into `.apicircle/workspace.json` (alongside the
  already-nested `.apicircle/attachments/<slotId>`) as a hard cutover — no
  backwards-compat read of a root `workspace.json`. There's still no
  production data and no public API contract to preserve. Prefer redesigning
  a bad shape over patching it — no migration shims, no backwards-compat
  branches. See §10. Release notes: [`CHANGELOG.md`](CHANGELOG.md).

---

## 2. Repo skeleton

Turbo + pnpm monorepo. Node ≥ 20, pnpm ≥ 9.

```
studio/
├── apps/
│   ├── web/              Vite + React 18 shell — the browser build (dev port 5174)
│   ├── desktop/          Electron shell — hosts the web UI, OS-keychain secrets,
│   │                       mock + MCP IPC bridges (src/main/*)
│   └── vscode/           VS Code extension ("API Circle Studio" —
│                           displayName, viewsContainers.title, configuration.title
│                           all now use the spaced brand) — Activity Bar icon
│                           (monochrome brand silhouette), 9 sidebar
│                           TreeViews (Workspace, Editor, Environment, Execution,
│                           Mock, History, Snapshots, MCP, Link Workspaces — the
│                           last replaced the dormant Marketplace stub and
│                           hosts TWO groups: (1) the workspace-self
│                           **Releases** group — publish / deprecate /
│                           withdraw the versions linked consumers pin to,
│                           via a read-only `releases/releases.yaml` CodeLens
│                           surface (`releaseActions.ts` +
│                           `releasesCodeLens.ts`, routed through the
│                           `release.*` patches) + `▶ Tag release on GitHub`
│                           / `Edit repo topics` (`repoActions.ts`, owner/name
│                           derived from the folder's `origin` remote, auth via
│                           VS Code's built-in GitHub session); and (2) the
│                           **Linked workspaces** group — link a private repo
│                           or a marketplace result, then edit every link
│                           field via `<name>.link.yaml` (◆ pin version /
│                           scope / session mode / required keys + ⟳ Refresh
│                           ledger · ⤓ Review update · 📓 Changelog · ⊗ Unlink),
│                           a three-way `previewLinkedUpdate` / `applyLinkedUpdate`
│                           review (streamlined bulk accept-source / keep-mine
│                           — no webview), all in `linkActions.ts` +
│                           `linkCodeLens.ts` + `linkYaml.ts`, routed through
│                           the `linkedWorkspace.*` patches; GitHub networking
│                           uses `@apicircle/git`'s `GitHubClient` + the pure
│                           `parseLinkedWorkspaceJson` / `buildLinkedSnapshot`
│                           core helpers)),
│                           `apicircle:`
│                           virtual FS for requests/**folders**/envs/plans/mocks/
│                           responses/history runs — URI shape is
│                           `apicircle://<ws>/<kind>/<folderSlug…>/<nameSlug>.<ext>?id=<id>`
│                           so tab labels are the human-readable name, the
│                           folder breadcrumb surfaces in the tab tooltip,
│                           and identity (`?id=`) survives rename + folder
│                           moves; siblings that slugify identically are
│                           disambiguated with `~<shortId>`; saving a
│                           renamed entity reopens the new URI in the
│                           same column and closes the stale tab.
│                           **Folder-wise auth** — clicking a folder in the
│                           Editor TreeView opens
│                           `apicircle://<ws>/folders/<…>.folder.yaml?id=<folderId>`
│                           (serializer / parser in `folderYaml.ts`,
│                           dispatch via the new `folder.update`
│                           WorkspacePatch + matching MCP tool). The
│                           projection edits `name` + folder-level `auth`;
│                           identity (`id` / `parentId`) stays out of the
│                           document — moves use the TreeView. The folder
│                           description carries `auth: <type>` when set,
│                           and the contextValue swaps between `folder` /
│                           `folder-with-auth` so the inline 🔑 button
│                           lights up only when relevant. Request YAML
│                           gets a `◆ Inherits from <Folder> (<type>)`
│                           CodeLens above `auth:` whenever the request's
│                           auth resolves via `inherit` — click jumps to
│                           the source folder YAML; reads `◆ Inherits →
│                           none` when no ancestor sets explicit auth.
│                           Language services — request YAML CodeLens
│                           row is ▶ Send · ✚ Add section… · ⤵ New from template…
│                           by default, swaps to ⏳ Sending… · ✖ Cancel
│                           while a send is in flight (driven by
│                           `InFlightSendTracker` + `apicircle.cancelOneSend`;
│                           the send itself runs inside
│                           `withProgress({ location: Window })` so the
│                           status-bar spinner shows for palette /
│                           Ctrl+Enter sends too);
│                           `apicircle.newRequestFromTemplate` ships six starter
│                           shapes (Simple GET, JSON POST, Bearer GET, Paginated
│                           GET, GraphQL query, REST CRUD folder); env/plan/mock
│                           YAMLs keep Completion + Hover,
│                           pre-send diagnostics; per-endpoint
│                           `*.endpoint.yaml` mock-validation rules author
│                           in-editor — `🛡 Add validation rule` inserts a
│                           prefilled rule (no prompts), then kind-aware
│                           `◆ Kind · ◆ Target · ◆ Value` field CodeLenses
│                           reshape the rule and pick from the endpoint's
│                           declared params + the curated `HTTP_HEADERS_MAP`
│                           catalogue (shared logic in
│                           `apps/vscode/src/lang/mockValidationKinds.ts`);
│                           the `*.endpoint.yaml` editor also carries
│                           line-addressed `◆` field-editor lenses on every
│                           editable scalar — method, every `status:`, header
│                           key/value (header-aware), body `type:` (which also
│                           reconciles the config's Content-Type), response-rule
│                           when-clause scope/op/target/value (+ `✚ Add
│                           condition`), and each response multiplier's source
│                           kind/key + `◆ Path` + count/min/max/name — all in
│                           `apps/vscode/src/commands/mockFieldEdits.ts`
│                           (indent always derived from the document; covered by
│                           `mockFieldEdits.integration.test.ts`); the `*.mock.yaml`
│                           summary gives each endpoint an `↗ Open endpoint`
│                           lens. Note: `MockResponseConfig.multipliers` is an
│                           array soft-capped at `MAX_RESPONSE_MULTIPLIERS`
│                           (=1 today) by the authoring surfaces; the engine
│                           applies all entries, so bumping the constant is the
│                           only change to allow N (no migration).
│                           `MockResponseRule.when` is likewise soft-capped at
│                           `MAX_RESPONSE_RULE_CONDITIONS` (=1) by the lenses +
│                           the desktop/web rule editor (engine AND-combines all).
│                           A rule with ZERO `when` clauses is rejected by the
│                           endpoint parser (`parseEndpointFromYaml`) + the MCP
│                           `set_response_rules` tools (zod `.min(1)`) as a
│                           save-blocking error — the runtime engine skips a
│                           clause-less rule (`evaluateResponseRules`: "a
│                           clause-less rule never fires"), so it's dead.
│                           Authoring overhaul (latest): `↗ Open endpoint` +
│                           lifecycle lenses now read the mock id from the `?id=`
│                           query (path basename is a name slug); response-rule
│                           clause `◆ Value` offers the header value catalogue
│                           (`setMockClauseValueField`) and hides for present/
│                           absent ops; `✚ Add header` anchors on the rule's
│                           `response.headers:` block; per-header `✓ Enable /
│                           ⊘ Disable` (`toggleMockHeaderEnabled`); `requestSchema`
│                           authoring lenses — each `✚ Path/Query/Header/Cookie
│                           param` anchors ON its own subsection line
│                           (`pathParams:` / … ) and `✚ Body example` on `body:`;
│                           `◆ Name/Type/Example/Description` field editors (the
│                           boolean `required:` row has NO lens — edited directly
│                           in YAML),
│                           `apps/vscode/src/commands/mockRequestSchemaEdits.ts`);
│                           `⟳ Format JSON` (`apps/vscode/src/commands/formatJson.ts`,
│                           now any JSON-bearing key — body content, graphql
│                           `variables`, auth `payload`/`jwtHeaders` — object/
│                           array-only guard); collection-request `◆` field
│                           editors (`apps/vscode/src/commands/requestFieldEdits.ts`
│                           — method only on the top-level row; header/query/
│                           cookie/path-param, assertion kind/op, extraction
│                           source; `url:` has NO field-editor lens — the URL
│                           is edited inline and `parseRequestFromYaml` syncs
│                           any typed `?key=val` + `{name}`/`:name` placeholders
│                           into the `query:` / `pathParams:` blocks on save
│                           (URL wins for enabled query rows; disabled rows
│                           pass through; new path placeholders get an empty-
│                           string slot, existing values preserved); auth scalar
│                           fields have NO field editor — edited directly in YAML,
│                           only `⟳ Format JSON` on `payload`/`jwtHeaders`
│                           survives); form-data `✚ Add text/file row` anchors on
│                           the `formRows:` line (switching is per-row only).
│                           `APICircle: New Request` is a single folder pick
│                           (existing / top level / new folder inline) + direct
│                           GET-scaffold file creation — no step-wise wizard.
│                           On activation the extension also adopts the workspace
│                           backing any already-open `apicircle://` editor (or raw
│                           `.apicircle/workspace.json`) as active. An `apicircle`
│                           DiagnosticCollection
│                           (`apps/vscode/src/lang/diagnostics.ts`) blocks saving a
│                           renamed/mistyped key — top-level OR nested entry —
│                           or wrong-typed section across endpoint/mock/request
│                           YAML (structural guards in
│                           `apps/vscode/src/fs/yamlStructure.ts`). The mock
│                           endpoint's `requestSchema` is now editable on ALL
│                           surfaces — VS Code YAML, the Web/Desktop endpoint
│                           editor (Endpoint node → `MockRequestSchemaEditor.tsx`),
│                           and via MCP (`mock.set_request_schema` /
│                           `prompt.set_endpoint_request_schema`) — closing the
│                           cross-surface gap.
│                           in-process mock-server
│                           lifecycle (Phase 3 — wraps `InProcessMockController`),
│                           **secret vault (Phase 4) — passphrase unlock,
│                           in-memory AES-GCM key, auto-lock by inactivity,
│                           clipboard auto-clear, encrypted env-variable
│                           reveal via `apicircle.openVaultEntry`,
│                           consolidated `APICircle Runs` OutputChannel**,
│                           **MCP host integration (Phase 5) — per-AI-client
│                           config snippets via `apicircle.copyMcpConfig`
│                           pointing at active workspace's .apicircle/ dir,
│                           shared snippet builder in `@apicircle/mcp-server`,
│                           McpView with 10 supported clients + connect
│                           guide, `apicircle.mcp.binaryPath` setting**,
│                           **Copilot Chat MCP install (Phase 6) —
│                           `apicircle.installCopilotMcpConfig` writes
│                           `.vscode/mcp.json` idempotently for VS Code
│                           1.86+ Copilot Chat / any workspace-config MCP
│                           client, GitHub Copilot row shows install state
│                           (absent/installed/stale), preserves foreign
│                           mcpServers entries**,
│                           **bundle code-splitting (Phase 7) — esbuild
│                           tree-shaking via `"sideEffects": false` on
│                           all `@apicircle/*` workspace packages drops
│                           the extension bundle 1.91 MB → 1.46 MB
│                           (−454 KB / 23.7%); two-tier budget gate
│                           (`scripts/check-vscode-bundle.mjs` — soft
│                           warn 1.8 MB / hard fail 2.0 MB) + matching
│                           regression test
│                           (`apps/vscode/test/integration/bundleSize
│                           .test.ts`) wired into the VS Code workflow**,
│                           three-surface compat with Desktop + Web (12 patch
│                           kinds covered incl. `mock.delete` +
│                           `secret.crypto.set` / `secret.crypto.clear`),
│                           wired settings (execution timeout / Remote-SSH
│                           host hint / history retention / **secrets.auto
│                           LockMinutes / secrets.clipboardClearSeconds**).
│                           All-native (no webview) by default; opt-in
│                           visual editors land in Phase 6.
├── packages/
│   ├── shared/            Types, generateId, validators, encryption + MCP envelopes
│   ├── core/              Request execution, env resolution, auth signing, assertions,
│   │                       imports, git serialize/merge, transforms, applyMutation
│   ├── git/               GitHub REST client + typed error taxonomy
│   ├── ui-components/      ALL React UI + the Zustand store + IndexedDB persistence
│   ├── mock-server-core/   Hono mock-server engine + OpenAPI/Postman/Insomnia parsers
│   ├── mcp-server/         stdio MCP host + 94-tool catalog + workspace providers
│   └── cli/                `apicircle` binary — mock / mcp / import / export / run / workspaces
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
  metadata. Lives in the repo as `.apicircle/workspace.json` (alongside the
  binary attachments under `.apicircle/attachments/<slotId>`). Path
  constants in `packages/core/src/git/repoPaths.ts`.
- **`WorkspaceLocal`** — per-device runtime state that never leaves the
  machine: history runs, mock-server _runtime_ state, the GitHub session, plain
  secret material, UI state.

`packages/shared/src/types.ts` is the canonical schema for both.

### `applyMutation` — the single mutation choke point

`applyMutation(state, patch)` in `@apicircle/core` is the **only** function that
mutates a workspace. The UI store, MCP tool handlers, and CLI commands all
funnel through it. `WorkspacePatch` is a discriminated union over
`request.* | folder.* | folder.import_apicircle | environment.* |
secretKey.upsert | assertion.* | mock.* | release.* | linkedWorkspace.* |
linkedOverride.* | plan.*`. Adding an entity type = one union variant + one
switch case + one MCP tool. (`release.publish` carries a pre-built `ReleaseVersion` — the async
SHA-256 snapshot is computed by `buildReleaseEntry` so the reducer stays pure;
`release.deprecate` / `.yank` flip the soft / hard signal flags.
`linkedWorkspace.upsert` carries the link record + the OPTIONAL cached ledger +
collections/environments snapshot produced by the GitHub fetch in the host;
`.remove` cascades across `releases.perLink` + `linkedOverrides` +
`local.linkedCollections` + the per-link session; `.applyUpdate` is the atomic
result of a three-way `previewLinkedUpdate` / `applyLinkedUpdate`.)

> Note: the live UI store (`workspaceStore.ts`) also performs some direct
> `set({ synced, local })` transitions rather than routing every change through
> `applyMutation`. Treat `applyMutation` as the contract for headless
> (MCP/CLI) writers.

### MCP provider abstraction

`@apicircle/mcp-server` tool handlers depend on three interfaces, not
concretes:

- **`WorkspaceProvider`** — `read()` / `apply(patch)` / `write({synced?,local?})`.
  Implementations: `InMemoryWorkspaceProvider`, `FileBackedWorkspaceProvider`
  (disk + `proper-lockfile` advisory lock), `GitBackedWorkspaceProvider`
  (reads `workspace.json` from a Git-backed `.apicircle/` directory —
  delegates to core `loadFromFile`/`saveToFile` with
  `syncedFilename: 'workspace.json'`).
- **`Workspaces`** — multi-workspace discovery: `list()` / `get(id)` /
  `setActive(id)`. Implementations: `SingleWorkspaceWorkspaces` and
  `MultiWorkspaceProvider`. `MultiWorkspaceProvider.activeProvider()`
  returns a **lazy wrapper that re-reads `registry.json` on every
  `read` / `apply` / `write`** so a workspace switch in the desktop
  reaches a running MCP process without restart. Do NOT cache the
  per-id provider in tool handlers — always go through
  `ctx.workspace`.
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
- **Boot-time disk-vs-IDB resolution is timestamp-driven.** `hydrate()`
  reads both halves at boot and adopts whichever has the newer
  `meta.updatedAt`. External writers (MCP / CLI) bumping `updatedAt`
  inside `applyMutation` is what makes their writes survive the next
  desktop launch. When changing `hydrate`, the IDB→disk write at the
  end MUST stay gated behind "memory wins" — unconditional re-write
  silently overwrites external changes.
- **External-write auto-refresh.** The file watcher in
  `apps/desktop/src/main/workspaceFile/workspaceWatcher.ts` emits
  `apicircle:workspaceFile:externalChange` IPC events whenever
  `<root>/registry.json` or a per-id `workspace.json` changes.
  `App.tsx`'s `useExternalDiskRefresh` hook subscribes and auto-calls
  `refreshFromDisk()` so MCP / CLI writes appear without the user
  clicking Refresh. `WorkspaceFileManager.markSelfWrite` suppresses
  the desktop's own mirror writes so the loop can't self-trigger.

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
  - `e2e.yml` — Playwright + cross-browser smoke. The visual-baseline
    job is manual-dispatch only (baselines not yet committed).
  - `release.yml` — changesets-driven npm publish of `@apicircle/*` packages.
  - `desktop-release.yml` — Electron installers + `electron-updater` indexes.
  - `deploy-web.yml` — builds `apps/web` and publishes to GitHub Pages on
    every push to `main`.

---

## 9. Where the docs live

| Doc                                                                                    | Purpose                                                               |
| -------------------------------------------------------------------------------------- | --------------------------------------------------------------------- |
| [`docs/architecture/platform.md`](docs/architecture/platform.md)                       | Platform surfaces design record (MCP, mock engine, CLI, desktop)      |
| [`docs/vscode-extension.md`](docs/vscode-extension.md)                                 | VS Code extension user + developer guide                              |
| [`docs/vscode-extension-install-publish.md`](docs/vscode-extension-install-publish.md) | Local install (dev host, .vsix) + Marketplace + Open VSX publish plan |
| [`docs/auth.md`](docs/auth.md)                                                         | The 17-auth-type matrix                                               |
| [`docs/mock-server.md`](docs/mock-server.md)                                           | Mock server feature guide                                             |
| [`docs/mcp-tools-reference.md`](docs/mcp-tools-reference.md)                           | MCP tool catalog reference                                            |
| [`docs/connect-your-ai-client.md`](docs/connect-your-ai-client.md)                     | Wiring an MCP client                                                  |
| [`docs/installing.md`](docs/installing.md)                                             | Install instructions                                                  |
| [`docs/qa/README.md`](docs/qa/README.md)                                               | QA status, E2E CI reference, coverage tooling                         |
| [`docs/context/api-circle.md`](docs/context/api-circle.md)                             | Tool-agnostic cold-start brief (for Cursor / Copilot / etc.)          |
| [`CHANGELOG.md`](CHANGELOG.md)                                                         | Release-by-release feature notes (1.0.0 → now)                        |
| [`e2e/qa/runner/`](e2e/qa/runner/)                                                     | Cowork manual-test runner — fixtures, seed script, runner prompt      |

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
- **VS Code extension bundle budget contract.** `apps/vscode/dist/extension.mjs`
  is gated by `scripts/check-vscode-bundle.mjs` and the matching
  `apps/vscode/test/integration/bundleSize.test.ts`. Thresholds live in
  `scripts/vscode-bundle-budget.mjs` (single source of truth):
  **min 500 KB sanity floor / soft warn 3.0 MB / hard fail 5.0 MB**
  (raised post-1.0 for peer-extension parity — Thunder Client ~5 MB,
  GitLens ~5–8 MB, ESLint ~6 MB). The actual UX gate is
  `apps/vscode/test/integration/activationPerf.test.ts` (<500 ms on
  100 requests, <1000 ms on 500 requests) — bundle size is the
  early-warning proxy. Every phase that lands code in `apps/vscode/`
  (or anything bundled into it via the `@apicircle/*` graph) SHOULD:
  (1) run `node scripts/check-vscode-bundle.mjs` and report the new
  size in the CHANGELOG entry; (2) if the change crosses the soft
  warn, justify it and either propose a counter-trim or bump the
  soft warn explicitly (in `scripts/vscode-bundle-budget.mjs`) with
  rationale; (3) never bump the hard fail to silence a regression —
  the hard fail only moves on a deliberate policy change with
  CHANGELOG rationale. Phase 7 baseline was 1.46 MB; current is
  ~2.44 MB. See `docs/vscode-extension.md §14` for the full
  contract.

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
