# QA — API Circle Studio

How quality is verified in this repo, what is covered today, and what is
still pending. This single doc replaces the former `CI.md` plus the three
`E2E-*-PLAN.md` session plans.

QA has three layers:

1. **Automated E2E** — Playwright specs in the `e2e/web/` and
   `e2e/desktop/` packages, plus Mocha + `@vscode/test-electron` specs in
   `e2e/vscode/`. Run on every PR.
2. **Cross-package integration tier** — Vitest suites in
   `apps/vscode/test/integration/` exercise real `executeRequest` against
   real HTTP servers, concurrent `proper-lockfile`-serialized writes, and
   the three-surface compatibility invariant. See the dedicated section
   below.
3. **Manual test-case workbooks** — `docs/qa/test_cases/web-app-test-cases.xlsx`
   and `desktop-app-test-cases.xlsx`. Every row has a `TC-XX-NNNN` id.
   Automated specs are tracked against these rows via `tcMap*` fixtures
   and `scripts/e2e_coverage_*`.

Run outputs (coverage reports, manual-run result workbooks, evidence)
land in `docs/qa/results/`, which is **gitignored** — CI publishes them
as build artifacts instead.

---

## Status

The full automation effort (framework build-out, coverage truthing,
per-module spec writing, scanner tightening, CI integration) is **done**.
The numbers below come from the last `scripts/e2e_coverage_report.py
--strict` run; regenerate it any time for the current figure.

| Tier                            | Count | Share | Meaning                                                   |
| ------------------------------- | ----: | ----: | --------------------------------------------------------- |
| Total manual cases (web+desk)   |  3769 |       | union of both workbooks                                   |
| Live (spec exists, credited)    | ~2.9k |  ~78% | a spec references the row                                 |
| Scaffold (`test.fixme`)         |  ~100 |   ~3% | spec stub exists, assertion body pending                  |
| Manual-residue (won't automate) |  ~720 |  ~19% | cross-OS / installer signing / real-IdP / perception perf |
| Gap (no spec at all)            |     0 |    0% | —                                                         |

### Done

- E2E framework: `idbSeed` synthetic-workspace seeder, `e2e/mock`
  test backend (auth challenges, compression/caching/streaming, GitHub
  REST mock), `_electron` desktop harness, two-tab / two-context
  fixtures, perf-budget + axe a11y fixtures.
- Strict vs lenient coverage scanner with a manual-residue tier
  (`scripts/e2e_coverage_report.py`).
- CI integration: `e2e.yml` with a coverage floor + per-PR regression
  delta (see [E2E CI](#e2e-ci) below).
- Cross-browser smoke (`firefox` + `webkit`) on main runs. The visual
  baseline project exists but is manual-dispatch only — see [E2E CI](#e2e-ci).
- Per-module specs across every workbook module.

### Pending

- **Real assertion bodies for the long tail.** A large share of the
  "live" count is workbook-iteration `test.skip` placeholders with a
  rationale, not yet executing assertions. Honest running-`test()` body
  count is tracked by `scripts/e2e_real_body_count.py`. Converting the
  remaining placeholders into real assertions is the bulk of remaining
  work — do it module-by-module; never delete the iteration loops.
- **Process tasks needing a real browser install** — refreshing visual
  baselines, the `FULL_MM_SWEEP=1` run, cross-browser smoke validation,
  and a multi-run flake hunt. These can't run in a headless CI-only
  environment.
- **Feature-blocked residue.** Some residue rows become testable only
  when the underlying product surface ships: code-generation web UI,
  pre-request script sandbox, telemetry/privacy panel, HAR/OpenAPI
  import in the web UI, vendor-shape OAuth2 IdP mocks, linked-workspace
  fixtures. Lift them out of `e2e/web/manual-residue.ts` when the
  feature lands.

---

## VS Code E2E tier (Phase 1)

A separate E2E surface lives at [`e2e/vscode/`](../../e2e/vscode/) and
exercises the VS Code extension at [`apps/vscode/`](../../apps/vscode/).
Unlike the web and desktop suites which use Playwright, the VS Code suite
uses **Mocha driven by `@vscode/test-electron`** — the standard tool for
extension end-to-end testing. It downloads a deterministic VS Code build,
launches it with the extension installed in a hermetic user-data dir, and
runs the Mocha specs inside the actual extension host.

### What's covered (Phase 1 + Phase 2 rounds 1–5 + Phase 3 rounds 1–2 + Phase 4)

| Tier                                      | Coverage                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         | Location                                                                                                                                                                                                                                                 |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Unit**                                  | **59 suites · ~640 tests** · views (Editor, Environment **with P4 vault-header — 3-state getTreeItem coverage**, Execution, History, Snapshots, Mock, **P5 McpView with header + per-client rows + connect-guide footer**), FS provider, YAML projections (request + env + plan + mock **with secret-redacted source projection**), bridge + **VsCodeMockController** + **VsCodeVaultManager** + **RunsChannel** + **VsCodeMcpManager** (13 tests covering snippet emission + workspace resolution + config-path lookup + display labels), language services (request + env completion + env CodeLens, EnvironmentHover, PlanCodeLens, PlanCompletion, PlanHover, MockCodeLens, MockCompletion, MockHover), workspaceWatcher, diagnostics, status bar + MockStatusBar, abort registry, all commands (request, env, env priority, snapshots, plans, history, variables **with P4 vault redirect**, folder, mock, **vault actions**, **mcp actions**, extractions) | `apps/vscode/src/**/*.test.ts`                                                                                                                                                                                                                           |
| **Integration (cross-package)**           | **15 suites · ~66 tests** — activation pipeline (asserts the full **46-command-id** registration set, async `deactivate()` awaited), three-surface compat (**14 patches**), activation perf benchmark, `requestSendRoundTrip`, `applyMutationFromVscode`, `environmentRoundTrip`, `historyRoundTrip`, `snapshotRoundTrip`, `planRunIntegration`, `planRoundTrip`, `mockRoundTrip`, `externalWriteRefresh`, **`vaultUnlock` (P4)**, **`secretCryptoCompat` (P4)**, **`mcpRoundTrip` (P5) — proves VS Code's snippet bytes match the shared builder for every supported AI client + workspace-switch re-targeting + Create-config-file path**                                                                                                                                                                                                                                                                                                                      | `apps/vscode/test/integration/`                                                                                                                                                                                                                          |
| **E2E (Mocha + `@vscode/test-electron`)** | 12 named specs (`1-mvp`, `1-new-request`, `1-create-workspace`, `1-cancel`, `1-validation`, `1-multi-root`, `3-mock-view`, `3-mock-yaml`, `3-mock-lifecycle`, `4-vault`, `4-runs-channel`, **`5-mcp` (P5)**).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    | `e2e/vscode/src/test/*.test.ts`                                                                                                                                                                                                                          |
| **Live-GitHub (opt-in)**                  | Real-PAT integration. Gated by `APICIRCLE_E2E_LIVE_GITHUB=1` env. Nightly cron against a dedicated test org.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     | `e2e/vscode/src/test/live-github.test.ts`                                                                                                                                                                                                                |
| **Three-surface compat (invariant gate)** | `request.create`, `folder.create`, `environment.upsert`, `mock.upsert`, `mock.delete`, `plan.upsert`, `snapshot.capture`, `snapshot.delete`, `snapshot.restore`, `snapshot.set_max_bytes`, **`secret.crypto.set` (P4)**, **`secret.crypto.clear` (P4)** — byte-identical state from Desktop's `FileBackedWorkspaceProvider` and VS Code's `GitWorkspaceProvider` modulo apply-time timestamps. The applyMutation-determinism smoke check canonicalizes before comparing (was flaky against `Date.now()` drift).                                                                                                                                                                                                                                                                                                                                                                                                                                                  | `apps/vscode/test/integration/threeSurfaceCompat.test.ts` + **`secretCryptoCompat.test.ts`**                                                                                                                                                             |
| **Wired-settings tests**                  | `apicircle.execution.timeoutMs` (propagates to `executeRequest`), `apicircle.execution.host` (Remote-SSH warning gate), `apicircle.history.retentionDays` (prunes request + plan run buckets before max-entries cap), **`apicircle.secrets.autoLockMinutes`** (timer arms/cancels/re-arms), **`apicircle.secrets.clipboardClearSeconds`** (clipboard wipes only if value still matches)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          | `apps/vscode/src/execute/sendRequest.test.ts`, `apps/vscode/src/commands/planActions.test.ts`, `apps/vscode/src/execute/persistHistory.test.ts`, **`apps/vscode/src/host/vaultManager.test.ts`**, **`apps/vscode/test/integration/vaultUnlock.test.ts`** |

**Cross-package monorepo gate** (`pnpm -w test`): **3613 tests across 327 files** as of Phase 12 closure (bundle externalize + E2E coverage closeout). All packages green: `shared` (130), `git` (66), `core` (925), `mock-server-core` (117), `mcp-server` (195), `ui-components` (1096), `cli` (85), `web` (12), `desktop` (81), `vscode` (**856**), `examples/mock-server` (13), `e2e/mock` (36).

**VS Code E2E specs** (`e2e/vscode/src/test/`): **19 files** as of Phase 12, covering Phases 1 through 11. Run via `@vscode/test-electron` against real VS Code stable + insiders in CI (`.github/workflows/vscode.yml` `cross-host-smoke` job, main pushes only). Phase 12 added 5 specs: `2-environments-plans`, `8-autoconfigure-vault-device`, `9-notebooks-tests`, `10-embedded-mcp`, `11-continue-mock-editor`.

**VS Code bundle-size gate** (`scripts/check-vscode-bundle.mjs`): three thresholds enforced — min 500 KB sanity floor (catches corrupt-empty builds), soft warn at **3.0 MB**, hard fail at **5.0 MB** — on `apps/vscode/dist/extension.mjs`. Constants live in `scripts/vscode-bundle-budget.mjs` (single source of truth shared with `apps/vscode/test/integration/bundleSize.test.ts`). The ceiling was raised post-1.0 for peer-extension parity (Thunder Client ~5 MB, GitLens ~5–8 MB, ESLint ~6 MB); the real UX gate is `apps/vscode/test/integration/activationPerf.test.ts` (<500 ms on 100 requests, <1000 ms on 500). Bump the ceiling deliberately per phase — never to silence a regression. Rationale comments live alongside the constants in `scripts/vscode-bundle-budget.mjs`.

### CI

[`.github/workflows/vscode.yml`](../../.github/workflows/vscode.yml) runs
on every PR touching `apps/vscode/`, `e2e/vscode/`, or any of the core
packages the extension depends on (`@apicircle/core`, `@apicircle/shared`,
`@apicircle/mcp-server`). The `quality` job runs:

1. Typecheck both packages.
2. Lint `apps/vscode`.
3. Run the unit + integration suite (`pnpm --filter @apicircle/vscode test`).
4. Build the bundle (`tsup`).
5. Bundle-size gate: extension.js < 2 MB.
6. Knip dead-code scan scoped to `apps/vscode` and `e2e/vscode`.

The `cross-host-smoke` job (push-to-main only) runs the
`@vscode/test-electron` E2E suite against `stable` and `insiders` VS Code
under `xvfb`.

### Running locally

```bash
pnpm --filter @apicircle/vscode test         # unit + integration
pnpm --filter @apicircle/vscode check        # typecheck
pnpm --filter @apicircle/vscode lint         # lint
pnpm --filter @apicircle/vscode build        # bundle via tsup
pnpm --filter @apicircle/vscode package      # produce .vsix
pnpm --filter @apicircle/e2e-vscode test:e2e # full E2E (downloads VS Code)
APICIRCLE_E2E_LIVE_GITHUB=1 \
  APICIRCLE_E2E_GITHUB_PAT=<repo-scoped PAT> \
  APICIRCLE_E2E_GITHUB_REPO=apicircle/e2e-test-repo \
  pnpm --filter @apicircle/e2e-vscode test:e2e:live-github
```

The first E2E run downloads ~100 MB of VS Code into `.vscode-test/`;
subsequent runs reuse the cache.

### Cross-host matrix (deferred to Phase 10)

Quarterly cron against `{Cursor, VSCodium, Windsurf}` via Open VSX builds
lands when the marketplace publication step does (Phase 10). Phase 1
ships VS Code stable + Insiders coverage; the broader fork coverage is a
Phase 10 release-gate item.

---

## Web E2E CI

The web E2E suite runs on every PR and every push to `main`
([`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml)):

1. **`playwright`** — full chromium run + strict coverage report. Gates
   the build on a coverage floor and a regression delta vs main.
2. **`cross-browser-smoke`** — `@smoke`-tagged subset run against Firefox
   - WebKit. Informational; does not gate the build.
3. **`visual-baseline`** _(manual dispatch only)_ — pixel-diff baseline of
   every primary panel. Off by default because the Linux baselines aren't
   committed yet. Trigger from the Actions tab → "Run workflow" when you
   want to (re)generate baselines; download the
   `visual-baseline-snapshots-<run_id>` artifact and commit the PNGs under
   `e2e/web/visual-baseline.spec.ts-snapshots/` to seed the gate.

### What the build gates on

| Gate                  | Threshold               | Implementation                           |
| --------------------- | ----------------------- | ---------------------------------------- |
| Coverage floor        | strict-live ≥ 20%       | `e2e_coverage_report.py --fail-under 20` |
| Coverage regression   | delta ≥ −2.0 pp vs main | `scripts/e2e_coverage_delta.mjs`         |
| Playwright assertions | 0 failures              | `pnpm test:e2e` exit code                |

The visual-baseline project is not a build gate — it's manual-dispatch
only and currently a baseline-bootstrap surface.

The two cross-engine smoke projects (firefox + webkit) are surfaced as
artifacts but are _not_ a gate — engine-only drift is informational.

### Artifacts every build publishes

- `playwright-report-${run_id}` — HTML report of the chromium run.
- `e2e-coverage-${run_id}` — strict coverage `.md`, `.json`, and the
  Playwright JSON results (used by the PR delta script).
- `smoke-report-${run_id}` — HTML report from the firefox + webkit run.
- `playwright-traces-${run_id}` — traces from failed tests (failure only).
- `visual-baseline-snapshots-${run_id}` / `visual-baseline-diffs-${run_id}` —
  baseline PNGs and diff PNGs from manual-dispatch visual-baseline runs.

### PR coverage delta

`scripts/e2e_coverage_delta.mjs` runs as the last step of the
`playwright` job on every PR. It reads the PR build's strict coverage
JSON, fetches the most-recent successful main run's coverage artifact via
the GitHub Actions API, posts (or updates) a sticky PR comment with a
delta table, and fails the build (exit 2) if live coverage regressed by
more than 2pp. If no main run with the artifact exists yet, the baseline
is treated as 0% and the regression gate is skipped.

### Updating the coverage floor

The floor lives in [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml)
as `--fail-under`. Keep it ~5pp below the running strict-live so a single
bad merge fails the delta gate (≥2pp) before the floor gate. Bump it as
genuine per-cell assertions land.

---

## Coverage modes (strict vs lenient)

Coverage is computed two ways. **Strict** is the honest number CI gates
on; **lenient** is shown alongside for module-level wiring visibility.

- **Strict** credits a TC-ID only when a spec source carries real
  evidence the row is exercised:
  1. `tc('TC-XX-NNNN', ...)` / `tcCovered('TC-XX-NNNN')` — inline literal.
  2. `tc(['TC-XX-NNNN', ...], ...)` — inline array.
  3. `tcRange('TC-XX', from, to, ...)` — expanded range.
  4. `for (const ... of [Object.entries(]tcMapXX[)])` — real iteration
     generating a `test()` per cell. Credits the whole map.
  5. `tcMapXX['<literal-key>']` — literal-key indexing. Credits that key.
  6. `helperName('<key>')` where `helperName` is a locally-defined
     function that dereferences `tcMapXX[<param>]` — resolves to the
     TC-ID at that key.

  A bare `void Object.keys(tcMapXX);` is a no-op and credits nothing.

- **Lenient** also credits every TC-ID inside any imported `tcMap*.ts`.
  Inflates the headline; useful only for tracking which modules are
  _wired_ to automation.

Run locally:

```bash
python scripts/e2e_coverage_report.py --strict           # honest count
python scripts/e2e_coverage_report.py --strict --json    # CI input
python scripts/e2e_coverage_report.py                    # lenient (legacy)
python scripts/e2e_real_body_count.py                    # running test() bodies
```

The report writes `e2e-coverage.md` / `.json` into `docs/qa/results/`
(gitignored).

---

## Manual-residue tier

Cases deliberately excluded from automation — cross-OS installer signing,
browser-chrome surfaces, real-IdP live tier, perception perf — are
enumerated in [`e2e/web/manual-residue.ts`](../../e2e/web/manual-residue.ts)
with a per-ID rationale.

The coverage script treats residue as authoritative — even if a spec
accidentally credits a residue ID via map-usage, it stays classified as
residue. Add or remove entries in that file when the line moves; do not
scatter residue rationales across specs.

---

## Failure debug recipe

1. **`playwright` failed** — open `playwright-report-${run_id}`; the HTML
   report links every failed test to its trace. Download
   `playwright-traces-${run_id}` and open with
   `pnpm exec playwright show-trace <trace.zip>`.
2. **`cross-browser-smoke` failed** — same recipe via
   `smoke-report-${run_id}`. Most engine-only failures trace back to
   Chromium-specific timing assumptions in the spec.
3. **`visual-baseline` failed** _(manual dispatch only)_ — download
   `visual-baseline-diffs-${run_id}`. If the change is intentional, run
   `pnpm --filter @apicircle/e2e-web exec playwright test --project=visual-baseline --update-snapshots`,
   commit the updated `visual-baseline.spec.ts-snapshots/` files, and push.
4. **Coverage gate failed** — most often a `test()` got converted to
   `test.fixme()` or deleted. The strict JSON's `gap` array lists every
   TC-ID that lost coverage; cross-reference with the diff.

---

## Live GitHub end-to-end suite

The default E2E suite uses the local GitHub mock. Real GitHub credentials are opt-in and must be supplied only as runtime environment variables. **Never** commit a PAT, put it in a package script, or paste it into a test file.

`pnpm test:e2e:live-github` now runs the canonical `chromium-live-github` Playwright project. It only picks up specs under [`e2e/web/live-github/`](../../e2e/web/live-github/); the older sandbox suite has been removed so there is one live GitHub contract to maintain.

Each spec creates bot-owned ephemeral private/public repos as needed, seeds deterministic `.apicircle/` workspace data, and deletes repos/branches in test cleanup. The main bot PAT needs `repo` + `delete_repo`; the dedicated-link PAT needs `repo` so private linked workspaces can refresh after the active workspace GitHub session is disconnected.

| Env var                                | Required? | Purpose                                                                              |
| -------------------------------------- | --------- | ------------------------------------------------------------------------------------ |
| `APICIRCLE_E2E_LIVE_GITHUB`            | yes       | Master opt-in. Set to `1` to enable live calls.                                      |
| `APICIRCLE_E2E_GITHUB_PAT`             | yes       | Main bot PAT. Classic token with `repo` + `delete_repo`.                             |
| `APICIRCLE_E2E_BOT_OWNER`              | yes       | Bot account/org login. All repo create/delete helpers refuse non-bot owners.         |
| `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED` | yes       | Dedicated per-link PAT. Classic token with `repo`.                                   |
| `APICIRCLE_E2E_KEEP_REPOS`             | optional  | Set to `1` when manually debugging to keep ephemeral repos instead of deleting them. |

```powershell
$env:APICIRCLE_E2E_LIVE_GITHUB = '1'
$env:APICIRCLE_E2E_GITHUB_PAT = '<classic repo + delete_repo PAT>'
$env:APICIRCLE_E2E_BOT_OWNER = 'apicirclebot'
$env:APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED = '<classic repo PAT>'
pnpm test:e2e:live-github
```

### Live-GitHub CI pipeline

The [`.github/workflows/e2e-live-github.yml`](../../.github/workflows/e2e-live-github.yml) workflow runs **nightly and on manual dispatch only** — it does **not** run on PRs/pushes and does **not** gate merges, because it hits real `api.github.com` (slow, rate-limited, and subject to Contents-API eventual consistency). It validates the required secret/variable set, sweeps orphaned bot repos older than 12 hours, and then runs `pnpm test:e2e:live-github` single worker with Playwright traces/video retained only on failure. Run it locally before risky GitHub-sync changes with `node scripts/ci-local/run-ci.mjs --only live-github`.

Configure GitHub Actions like this:

- Repository variable: `APICIRCLE_E2E_BOT_OWNER`
- Repository secrets: `APICIRCLE_E2E_BOT_PAT`, `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`

The workflow maps `APICIRCLE_E2E_BOT_PAT` into the runtime `APICIRCLE_E2E_GITHUB_PAT` env var because that is what the Playwright helpers consume.

### Eventual-consistency handling (read before chasing a flake)

These specs hit the real Contents / git-data APIs, which are **eventually
consistent**: a `?ref=<branch>` read can keep serving the pre-write snapshot for
several seconds after a push/PUT returns, and the `git/refs` read replica can
lag a just-completed `updateRef`. The Node-side helpers in
[`_github-rest.ts`](../../e2e/web/live-github/_github-rest.ts) absorb this so
specs stay deterministic — reach for one of these before adding a bare sleep:

- **Writes retry transient failures.** `fetchWithSecondaryRateLimit` retries
  secondary-rate-limit 403/429 **and** transient 5xx (opt-out via
  `retryServerErrors: false` for the non-idempotent `createRepo` POST). Every
  `PUT /contents` writer (`writeRegistryJson`, `writeWorkspaceJson`,
  `writeWorkspaceJsonById`) re-probes its blob sha and retries 409/422 SHA
  conflicts.
- **Reads prefer the immutable commit SHA.** After a store push, read the remote
  with `fetchWorkspaceJson(cfg, branch, { expectedCommitSha })` rather than by
  branch ref — `?ref=<sha>` bypasses the branch-ref propagation window. Don't add
  a second back-to-back store push just to fetch; when a second push is genuinely
  needed (e.g. to persist post-push `workingBranchRef` provenance), gate it with
  `waitForBranchHeadV2(cfg, branch, firstPushSha)` so its divergence pre-flight
  doesn't race the `git/refs` replica into a spurious `BranchDivergedError`.
- **Read-modify-write across a push is barriered.** `updateWorkspaceJson` /
  `updateWorkspaceJsonById` block (read-back) until the branch ref serves the doc
  they just wrote, and `waitForRemoteWorkspace` / `waitForRemoteWorkspaceById`
  block until a pushed change is visible before a downstream RMW or product read
  depends on it — including an RMW that follows an app push (otherwise the RMW
  reads a pre-push snapshot and clobbers it).
- **Blob reads tolerate branch-ref lag too.** `fetchRepoFileBytesV2` retries
  transient `404`/`429`/`5xx` (a just-pushed attachment can 404 for a beat on the
  branch-ref tree), and `waitForRepoFileAbsentV2(cfg, branch, path)` polls until a
  path reports `404` for post-delete absence assertions.

### Current live specs

| Spec                                      | Covers                                                                                                                                       |
| ----------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| `00-preflight.spec.ts`                    | PAT validity, bot owner guard, private/public repo create/delete, dedicated PAT private-read access.                                         |
| `01-connect-branch-push.spec.ts`          | Connect private repo, create exact branch, push minimal workspace, fetch remote `.apicircle/` workspace data, assert branch/commit exist.    |
| `02-private-link-workspace.spec.ts`       | Two-repo private linking: source workspace provides requests/env/release notes, host links and materializes them.                            |
| `03-private-dedicated-pat.spec.ts`        | Private source link bound to a dedicated PAT still refreshes after workspace GitHub session disconnect.                                      |
| `04-public-link-workspace.spec.ts`        | Public source link materializes without an active workspace GitHub session.                                                                  |
| `05-public-marketplace.spec.ts`           | Public repo with `apicircle` topic appears in marketplace search and links from discovery.                                                   |
| `06-release-update-flow.spec.ts`          | Latest/pinned release links, markdown notes, v1.1/v1.2 on-demand adopt/decline, deprecated/yanked visibility.                                |
| `07-core-surfaces-under-link.spec.ts`     | Editor, Environments, Execution Plans, and Mock Servers mutate under a linked source, diff, push, refresh, and remain secret-safe.           |
| `08-dependency-diff.spec.ts`              | `linkedWorkspace`, request/env overrides, and `releasePerLink` added/modified/removed diffs clear after push.                                |
| `09-refresh-conflict-resolution.spec.ts`  | Remote-only dependency changes, unrelated remote core changes, same-key conflicts, cancel, mine, and theirs resolution.                      |
| `10-snapshot-data-loss.spec.ts`           | Pre-push/pre-merge snapshots restore core/link/override/release state; failure paths keep synced byte-identical.                             |
| `11-core-field-matrix.spec.ts`            | Broad field-level diff/push coverage across Editor, Environment, Execution, and Mock definitions.                                            |
| `12-branch-workspace-transitions.spec.ts` | Multiple working branches, merge-to-main transitions, multi-workspace switching, and restore without data loss.                              |
| `13-global-assets-live.spec.ts`           | JSON Schema, GraphQL, reusable file assets, request mappings, deletion tracking, and mock binary response reuse through GitHub sync/linking. |
| `14-attachments-live.spec.ts`             | Current-workspace and linked private/public attachment blob transmission, on-demand download metadata, and checksum fail-closed behavior.    |
| `15-execution-with-linked-assets.spec.ts` | Send/plan execution downloads required linked/global file assets before execution, including public-link and local-global-file flows.        |

---

## Manual test-case workbooks

The two workbooks under `docs/qa/test_cases/` are the source of truth for
the manual test matrix. The Cowork manual-test runner
([`e2e/qa/runner/`](../../e2e/qa/runner/)) executes them interactively and
writes result workbooks + evidence into `docs/qa/results/` (gitignored).
