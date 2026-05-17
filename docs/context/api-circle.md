# APICircle Studio — Project Context

A standalone briefing for any AI agent or contributor picking up this
repo cold. It says what the product is, how the code is shaped, how to
build and test it, what is done, and what is still open — enough to
resume development without prior context.

> [`CLAUDE.md`](../../CLAUDE.md) at the repo root is the Claude-Code
> auto-loaded version of this briefing. This file is the tool-agnostic
> equivalent for Cursor, Copilot, ChatGPT, and others. When the two
> disagree, the code wins — both are documentation and can drift.

---

## 1. What it is

**APICircle Studio** is an API workspace tool — think Postman or
Insomnia — with three things that set it apart:

- **Git-backed workspace.** A workspace is a JSON document pushed to a
  GitHub repo on a working branch; teams collaborate via pull requests.
- **Local mock servers.** Describe an API in OpenAPI / Postman /
  Insomnia and run a Hono-backed mock on `localhost`.
- **An MCP server.** The workspace is exposed as a 71-tool catalog any
  Model Context Protocol client (Claude Desktop, ChatGPT, Cursor,
  GitHub Copilot, Continue, Cline, Zed, Windsurf) can drive.
- **A CLI** (`apicircle mock | mcp | import`) for headless use.

It ships in three forms: a browser web app, an Electron desktop app, and
npm packages + platform binaries.

## 2. Project status

**Pre-launch. Zero users.** There is no installed base, no production
data, and no public API contract to preserve. This shapes how to work
here — see §14.

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
│   ├── mcp-server/       stdio MCP host + 71-tool catalog + workspace providers
│   └── cli/              `apicircle` binary — mock / mcp / import subcommands
├── examples/             Demo workspaces + a standalone example mock server
├── docs/                 Product + architecture + QA docs (see §16)
├── e2e/                  E2E suites — web/ + desktop/ (Playwright packages),
│                           mock/ (Hono test backend), qa/ (Cowork runner)
├── scripts/              Build (icons, release binaries) + E2E coverage tooling
└── .github/workflows/    CI: ci, codeql, e2e, release, desktop-release
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
`request.* | folder.* | environment.* | assertion.* | mock.* | plan.*`.
Adding an entity type = one union variant + one switch case + one MCP
tool.

> The live UI store (`workspaceStore.ts`) also performs some direct
> `set({ synced, local })` transitions rather than routing every change
> through `applyMutation`. Treat `applyMutation` as the contract for
> headless (MCP / CLI) writers.

### MCP provider abstraction

`@apicircle/mcp-server` tool handlers depend on two interfaces, not
concretes:

- **`WorkspaceProvider`** — `read()` / `apply(patch)` / `write({synced?,
local?})`. Implementations: `InMemoryWorkspaceProvider`,
  `FileBackedWorkspaceProvider` (disk + `proper-lockfile` advisory lock).
- **`MockController`** — `start` / `stop` / `list`. Implementation:
  `InProcessMockController` (wraps `mock-server-core` directly).

This is why the MCP server doesn't care whether it runs inline in
Electron, standalone via the CLI, or in a future hosted service.

### Mock server — three runtimes, one engine

`@apicircle/mock-server-core` is a Hono app builder. The same factory
powers the desktop `MockManager`, the CLI `apicircle mock`, and the MCP
`mock.start` tool.

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

## 6. Auth

All 17 `RequestAuth` types are end-to-end functional: `none`, `inherit`,
`bearer`, `basic`, `api-key`, `custom-header`, the six OAuth2 grants
(client-credentials, auth-code, PKCE, password/ROPC, implicit, device),
`aws-sigv4`, `digest`, `ntlm`, `hawk`, `jwt-bearer`.

Signing primitives (`digest`, `ntlm`, `hawk`, `awsSigV4`, `jwt`) and the
OAuth2 token client live in `packages/core/src/auth/*` — all
browser-safe. `applyAuth` wires auth into outgoing headers and
auto-refreshes expiring tokens; `executeRequest` drives challenge-
response retries (Digest 401, NTLM 3-way). Full matrix:
[`docs/auth.md`](../auth.md).

## 7. MCP server

`@apicircle/mcp-server` exposes **71 tools** over stdio, namespaced by
capability: imports, code generation, workspace read/write, request /
folder / environment / plan / assertion CRUD, history, codebase
extraction, prompt-driven authoring, and mock-server lifecycle +
endpoint editing. Canonical list: `packages/shared/src/mcp.ts`;
registered in `packages/mcp-server/src/tools/registry.ts`. Per-tool
input shapes: [`docs/mcp-tools-reference.md`](../mcp-tools-reference.md).
Wiring a client: [`docs/connect-your-ai-client.md`](../connect-your-ai-client.md).

## 8. Mock server

`@apicircle/mock-server-core` turns OpenAPI / Swagger / Postman /
Insomnia files (or manual-mode endpoint definitions) into a running HTTP
server on `localhost`. Definitions are workspace-scoped (`synced.
mockServers`, pushed to git); runtime state is per-host (`local.
mockRuntime`). Creation works in both web and desktop; **starting** a
mock runtime needs the desktop bridge or the CLI. Feature guide:
[`docs/mock-server.md`](../mock-server.md).

## 9. CLI

`@apicircle/cli` ships the `apicircle` binary with three subcommands:
`mock` (run a mock server from a spec), `mcp` (run the MCP server over
stdio), and `import`. Distributed as an npm package and as platform
binaries (linux-x64, macos-x64, macos-arm64, win-x64).

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
  smoke + visual baseline), `release.yml` (changesets npm publish),
  `desktop-release.yml` (Electron installers).
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
the 17 auth types, the mock-server engine across all three runtimes, the
71-tool MCP server, and the CLI. Unit tests are green.

Open work is concentrated in **E2E test depth**: a large share of the
"covered" test-case rows are workbook-iteration placeholders rather than
executing assertions, so converting those into real assertions
module-by-module is the main outstanding effort. Some test-case rows are
genuinely manual (cross-OS installer signing, real-IdP live tier,
perception perf) and a few wait on product features not yet shipped
(code-generation web UI, pre-request script sandbox, telemetry panel,
web-UI HAR/OpenAPI import). The authoritative status, numbers, and
pending list are in [`docs/qa/README.md`](../qa/README.md).

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
| [`docs/architecture/platform.md`](../architecture/platform.md)   | MCP / mock engine / CLI / desktop design record |
| [`docs/auth.md`](../auth.md)                                     | The 17-auth-type matrix                         |
| [`docs/mock-server.md`](../mock-server.md)                       | Mock server feature guide                       |
| [`docs/mcp-tools-reference.md`](../mcp-tools-reference.md)       | MCP tool catalog reference (71 tools)           |
| [`docs/connect-your-ai-client.md`](../connect-your-ai-client.md) | Wiring an MCP client                            |
| [`docs/installing.md`](../installing.md)                         | Install instructions                            |
| [`docs/qa/README.md`](../qa/README.md)                           | QA status, E2E CI reference, coverage tooling   |
