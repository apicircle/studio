# Changelog

## Unreleased

A QA-pipeline release. The opt-in `test:e2e:live-github` Playwright project expanded from a single PAT-credential smoke into a real-GitHub end-to-end suite that exercises the workspace lifecycle, CRUD round-trips for every editable surface, branch creation + switching, releases, Link Workspace flows, dependency diff buckets, snapshots, and linked release updates against `api.github.com`. Product API/schema remains unchanged; one internal behavior fix lets public linked workspaces use anonymous GitHub reads when no workspace PAT is active.

### Live GitHub E2E suite

- New `e2e/web/live/*.spec.ts` battery driven by the existing `chromium-live-github` Playwright project, with shared helpers in `e2e/web/live/_helpers.ts` for config gating, branch naming, and `test.afterAll` cleanup.
  - `lifecycle.spec.ts` — connect / branch / push / refresh / commit-author / secrets-metadata-only-on-push.
  - `crud-diff.spec.ts` — Editor (`addRequest` / rename / remove), Environments (add / `setVariables` / remove), Execution Plans (add / `addPlanStep` / remove), Mock Servers (create / remove) round-trip through push and the remote `workspace.json` is fetched back via raw REST for verification.
  - `branch-switching.spec.ts` — branch creation, switch with edits surviving, retired-branch detection without local data loss.
  - `releases.spec.ts` — `publishRelease`, `deprecateRelease`, `yankRelease` (Withdraw) round-trip to the remote release ledger.
  - `link-workspace.spec.ts` — `linkPrivateWorkspace` against the sandbox and `linkPublicWorkspace` against an anon public repo, with the linked content surfacing inside Editor / Environments and `addPlanStep` accepting a linked-workspace request id.
  - `snapshot.spec.ts` — `captureSnapshot` survives a push and `restoreSnapshot` succeeds.
  - `github-dependencies.spec.ts` — private workspace-session links, dedicated per-link PAT links, anonymous public links, markdown release notes, latest/pinned versions, decline/adopt-on-demand, deprecated/yanked visibility, and unlink cleanup.
  - `git-diff-dependencies.spec.ts` — linkedWorkspace / linkedRequestOverride / linkedEnvOverride / releasePerLink buckets, push reset, remote-only and cross-bucket auto-merge, conflict cancellation, and mine/theirs dependency resolutions.
  - `core-surfaces-live-regression.spec.ts` — Editor, Environments, Execution Plans, and Mock Servers mutate under a linked dependency, push cleanly, refresh cleanly, and restore from the automatic pre-push snapshot without leaking local-only state.
- Per-test branch naming (`apicircle/e2e-<workerIndex>-<unix-ms>-<slug>`) + `test.afterAll` cleanup via raw `DELETE /repos/:o/:n/git/refs/heads/...` keep the sandbox repo clean. The default branch is never written to by local sandbox tests. Local sandbox PATs need `repo`; the CI bot PAT also needs `delete_repo` for ephemeral repo teardown.
- **Empty-repo auto-bootstrap.** New `seedRepoIfEmpty` / `ensureWorkspaceJsonOnMain` / `getDefaultBranchHead` helpers in `e2e/web/live/_helpers.ts` automatically seed an empty sandbox repo (initial `README.md` commit on the default branch) and optionally seed `workspace.json` for the Link Workspace test. All helpers are idempotent; called from every spec's `beforeAll`. Operators can now point the suite at a freshly-created empty GitHub repo and have it run end-to-end without any manual UI seeding. New spec `e2e/web/live/repo-seeding.spec.ts` pins the bootstrap behavior in place (`getDefaultBranchHead` resolves the default branch, `seedRepoIfEmpty` creates the first commit and is idempotent, `ensureWorkspaceJsonOnMain` seeds + is idempotent, post-bootstrap connect-and-branch + push succeeds end-to-end).

### Live-GitHub CI pipeline + extended user-story coverage

- New `.github/workflows/e2e-live-github.yml` — `main` push + nightly + `workflow_dispatch` CI pipeline that provisions ephemeral bot-owned repos, runs the live suite, and tears them down with `if: always()`. Single-worker, 60-minute timeout, orphan sweep at the start of every run. Pipeline scripts: `scripts/live-github/sweep-orphans.mjs`, `scripts/live-github/provision-repos.mjs`, `scripts/live-github/teardown-repos.mjs`.
- New operator runbook `docs/qa/live-github-bot-setup.md` covering bot-account creation, required PAT scopes (`APICIRCLE_E2E_BOT_PAT` with `repo` + `delete_repo`, `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED` with `repo`), secret/variable configuration, and the bot-owner safety guard that refuses repo-mutating calls against any non-bot owner.
- New helpers in `e2e/web/live/_helpers.ts`: `createRepo`, `deleteRepo`, `createPullRequest`, `mergePullRequest`, `forceUpdateRef`, `inNewWorkspace`, `deleteAndCreateWorkspace`, `sweepOrphans`, `getPipelineRepoConfig`, plus the `assertBotOwner` guard.
- New specs covering the 12-step user narrative against `api.github.com`:
  - `e2e/web/live/pipeline-managed-repos.spec.ts` — env-var contract handshake between pipeline and tests.
  - `e2e/web/live/repo-cycle.spec.ts` — parametric over private + public, exercises the full nine steps (branch → first push → 2nd workspace pulls same branch → PR → REST-merge → 3rd workspace branches from main → release publish).
  - `e2e/web/live/pr-edge-cases.spec.ts` — PR against no commits, merge → retire, merge+delete → retire, push-after-retire, concurrent push from two workspaces, force-push detection (`history-rewritten`).
  - `e2e/web/live/release-tagging.spec.ts` — `tagReleaseVersion` against main HEAD + GitHub Release creation; `setRepoTopics`/`listRepoTopics` round-trip on the public repo (marketplace discovery surface).
  - `e2e/web/live/cross-repo-linking.spec.ts` — runtime-created third repo links both sources via `linkPrivateWorkspace` + `linkPublicWorkspace`; `setLinkedRequestOverride` + `setLinkedEnvVarOverride` exercise local-override surfaces.
  - `e2e/web/live/mocks-and-plans-against-linked.spec.ts` — consumer workspace assembles an execution plan that combines linked-private + linked-public + local-mock steps; round-trip through push asserts plan/mock/link round-trip on the remote workspace.json.

### Live-GitHub data-loss + GitHub-event edge-case coverage

- **`e2e/web/live/data-loss-invariants.spec.ts`** — 14 tests pinning the no-data-loss contract across every potentially-destructive transition: workspace switch / create / delete, disconnect repo / session, working-branch transition, push, refresh, commitRefresh, cancelRefresh, unlinkWorkspace, captureSnapshot, restoreSnapshot, page reload, push-failure preservation.
- **`e2e/web/live/pr-merge-methods.spec.ts`** — squash, rebase, draft PR push, branch-protection rejection (TC-GT-0027/0028/0029/0030).
- **`e2e/web/live/repo-mutation-edges.spec.ts`** — repo deleted-after-link, renamed, archived, forked, transferred (fixme'd, needs 2nd bot) (TC-GT-0021/0022/0024/0025/0026).
- **`e2e/web/live/linked-version-transitions.spec.ts`** — source-publishes-new-version banner, adopt, decline, breaking change, renamed entity, conflicting var names across two links, source unpublished, compare diff between versions, chain-link source setup (TC-LV-0003/0004/0005/0006/0007/0008/0011/0013/0015).
- **`e2e/web/live/session-edges.spec.ts`** — rate-limit budget probe (gates the whole suite); per-link dedicated session (`addLinkSession`/`setLinkSessionMode`, backed by the required `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`); OAuth scope downgrade + token revoke (fixme'd, classic PAT can't simulate) (TC-GT-0023/0035).
- New `_helpers.ts` exports: `archiveRepo`, `renameRepo`, `forkRepo`, `setBranchProtection`/`removeBranchProtection`, `publishReleaseOnSource` (writes via the Contents API to simulate "source published new version"), `getRateLimit`, `getBotOrg`, `getDedicatedLinkToken`.
- New optional env vars documented in `docs/qa/live-github-bot-setup.md`: `APICIRCLE_E2E_BOT_ORG`, `APICIRCLE_E2E_BOT_OWNER_SECONDARY`. The dedicated link PAT is now required for the live-github pipeline.

### 100% coverage closure

- **Data-loss invariants — 100%.** Six additional tests in `e2e/web/live/data-loss-invariants.spec.ts`: D6 (reconnect doesn't mutate synced), D8 (`dismissRetiredBranch` preserves synced), D23 (`removeSecret` leaves referencing entities intact), D24 (`removeRequest` referenced by a plan step leaves plan intact), D25 (`removeEnvironment` of the active env preserves other envs' variables), D27 (new browser context = new IndexedDB origin — privacy boundary).
- **tcMapGT — 100%.** Two new directed unit tests in `packages/git/src/github/api.test.ts` (`TC-GT-0023 scope-downgrade-after-linking`, `TC-GT-0035 token-revoked-mid-session`) AND two real-runtime live tests in `e2e/web/live/session-edges.spec.ts` that exercise the same error-classification contract against real `api.github.com`: scope-downgrade probes a sequence of scope-restricted endpoints (`/user/blocks`, `/user/gpg_keys`, `/user/keys`, `/notifications`, `/user/migrations`) and asserts on the first 403 with `X-Accepted-OAuth-Scopes`; token-revoked sends a syntactically-valid but unrecognized PAT and asserts the 401 `Bad credentials` shape. No skips — both run end-to-end on every live-github pipeline tick.
- **tcMapLV — 100%.** New `addLinkedWorkspaceOnSource` helper in `_helpers.ts` writes a `linkedWorkspaces` entry into a source's `workspace.json` via the Contents API. The previously-fixme'd `TC-LV-0015 chain link` test in `e2e/web/live/linked-version-transitions.spec.ts` is now a real-body test that creates `leaf → middle → top → consumer` and asserts the consumer can link and cache the top workspace snapshot.
- **tcMapSE — 100%.** New `e2e/web/live/marketplace.spec.ts` covers all three Marketplace cells against real `api.github.com`: `searchMarketplace('apicircle')` returns an array (TC-SE-0001), no-match query returns empty array (TC-SE-0003), `linkPublicWorkspace` from a marketplace-style result lands in `synced.linkedWorkspaces` (TC-SE-0002). Strict shape is also pinned by the existing unit tests for `GitHubClient.searchMarketplaceRepos` in `packages/git/src/github/api.test.ts`.
- Total chromium-live-github project: **102 tests across 20 files** (up from 93/19). Total `@apicircle/git` unit tests: **66 passing** (up from 64).
- New optional env var `APICIRCLE_E2E_GITHUB_LINK_PUBLIC_REPO=owner/repo[@branch]` selects the public source for the anon-link test; tests skip with directed reasons when unset.
- `playwright.config.ts`: `chromium-live-github.testMatch` extended to include `live/**.spec.ts`; the project pins `workers: 1` to stay inside GitHub's REST rate limits. The default `chromium`, `firefox-smoke`, and `webkit-smoke` projects exclude `live/` so non-live runs stay credential-free.
- `docs/qa/README.md` — refreshed the "Live GitHub" section with the full env-var table, branch-isolation contract, and the one-time `main`-seed instruction for the Link Workspace test.

## 1.0.3

A connect-and-share release. The MCP setup flow, AI-client onboarding, and community surfacing all got first-class treatment, and the web app now ships to GitHub Pages on every push.

### MCP connect flow

- New `HowToConnect` component drives per-client setup instructions in the MCP panel — Claude Desktop, ChatGPT, Cursor, Copilot, Continue, Cline, Zed, and Windsurf each get a tailored snippet.
- Centralized desktop-bridge contract (`@apicircle/ui-components/desktop`) so MCP config snippets, disk-mirror paths, and IPC handshakes share one typed entry point.
- MCP config snippets now expose path variants (binary vs npx vs absolute) and the right shape for each client's config file.
- README, `docs/connect-your-ai-client.md`, and the onboarding tour now agree on a single set of setup steps and call out the workspace disk mirror explicitly.

### Community section (Settings)

- New **Settings → Community** surface fetches live community stats (downloads, contributors, GitHub activity) with debounced caching in IndexedDB.
- `fetchCommunityStats`, `communityStorage`, and `externalLinks` helpers ship behind the section; desktop builds get a native download CTA via the new `desktopDownload` primitive.

### Web app deployment

- New `.github/workflows/deploy-web.yml` builds `apps/web` and deploys it to GitHub Pages on every push to `main` — the hosted web build is now continuously available.

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`, `@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`, `@apicircle/mcp-server`, `@apicircle/mock-server-core`, `@apicircle/shared`, plus the e2e and example workspaces — all at `1.0.3`.

## 1.0.2

The disk-mirror release. Workspaces can now live as plain JSON on disk alongside the IndexedDB store, and the MCP panel grew first-class connect / prompts / how-to surfaces.

### Disk-mirror workspaces

- New desktop `workspaceFileManager` + `workspaceFileBridge` IPC: persist a workspace to a directory on disk and round-trip it back into the store.
- `diskMirror` + `diskMirrorMerge` in `@apicircle/ui-components/persistence` keep the on-disk JSON in sync with IndexedDB, with debounced writes and three-way merge on refresh.
- `workspaceRegistry` in `@apicircle/core` and `resolveWorkspace` in `@apicircle/cli` give headless tools the same multi-workspace addressing model the UI uses.
- New CLI `apicircle workspaces` command — list, inspect, and resolve registered workspaces.
- `@apicircle/mcp-server` gained a `MultiWorkspaceProvider`, a `workspace.list` tool, and a `Workspaces` host abstraction so MCP clients can target a specific workspace.

### MCP panel refresh

- `McpServerPanel` split into focused sections: `ConnectionSection`, `HowToConnectSection`, `PromptsSection`, with typed panel state in `mcpPanelTypes` and a curated `mcpPrompts` catalog.
- New `McpSidebar` navigation and richer Help Center content for MCP setup.

### Stability & UX

- Mock-server shutdown now reports progress and surfaces a `CloseConfirmModal` for unsaved work on app exit.
- New `PanelErrorBoundary` primitive catches per-panel render errors without taking down the shell.
- Monaco editor base hardening + validator tightening in `@apicircle/shared`.

### Release & CI

- New `.github/workflows/release.yml` automates `@apicircle/*` package publishing to npm via changesets.
- Vite `base` set to relative so the built `index.html` references assets correctly when served from a sub-path.
- All GitHub Actions workflows bumped to current action versions.

## 1.0.1

A release-tooling patch. No app-facing behavior changes — focus was getting the desktop installers and CI pipeline ready for the public release.

### Desktop release pipeline

- Hardened `.github/workflows/desktop-release.yml`: installs deb tooling, guards mac code-signing on empty env vars, and enforces a tag guard so the workflow only fires on release tags.
- Added Debian metadata (`maintainer`, `synopsis`, `description`) to `apps/desktop/package.json` so the `.deb` artifact passes lintian.
- Switched the desktop main-process build to `tsup` (`apps/desktop/tsup.config.ts`) for faster, more predictable bundling.

### CI fixes

- `scripts/render-icons.mjs` now degrades gracefully when Playwright's browser dependency isn't installed, so the icon-render step no longer blocks the build.
- CodeQL workflow updates to align with the public-release branch protections.

## 1.0.0

First public release of API Circle Studio — a Git-native, AI-native API workspace.

### Workspace & Git sync

- Two-document workspace model (synced + local) with stable JSON serialization for clean Git diffs.
- GitHub sync: PAT connect with scope guidance, auto-branch, push (including attachments), PR creation, on-demand refresh, and 3-way conflict resolution.
- Link Workspace + releases: private and public links, marketplace search, cached collections, version pinning, and a changelog viewer.

### Requests & execution

- 17 authentication schemes, all end-to-end functional — Bearer, Basic, API key, custom header, the full OAuth2 grant set, AWS SigV4, Digest, NTLM, Hawk, and JWT.
- Imports: cURL, OpenAPI / Swagger, Postman, Insomnia, and HAR.
- Environments with priority ordering, assertions, and multi-step execution plans.

### Platform surfaces

- **Local mock servers** — a Hono-based engine that serves OpenAPI / Postman / Insomnia specs on localhost.
- **MCP server** — exposes the workspace as a tool catalog any Model Context Protocol client can drive.
- **CLI** — `apicircle mock | mcp | import | run` for headless and CI use.
- **Desktop app** (Electron) with OS-keychain secret storage, plus the web app and embeddable npm packages.

### Published packages

`@apicircle/shared`, `@apicircle/core`, `@apicircle/mock-server-core`, `@apicircle/mcp-server`, and `@apicircle/cli` — all at `1.0.0`.
