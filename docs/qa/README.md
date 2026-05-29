# QA — API Circle Studio

How quality is verified in this repo, what is covered today, and what is
still pending. This single doc replaces the former `CI.md` plus the three
`E2E-*-PLAN.md` session plans.

QA has two layers:

1. **Automated E2E** — Playwright specs in the `e2e/web/` and
   `e2e/desktop/` packages, run on every PR.
2. **Manual test-case workbooks** — `docs/qa/test_cases/web-app-test-cases.xlsx`
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
- Cross-browser smoke (`firefox` + `webkit`) and a visual baseline
  project.
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

## E2E CI

The E2E suite runs on every PR and every push to `main`
([`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml)). Three
jobs:

1. **`playwright`** — full chromium run + strict coverage report. Gates
   the build on a coverage floor and a regression delta vs main.
2. **`cross-browser-smoke`** — `@smoke`-tagged subset run against Firefox
   - WebKit. Informational; does not gate the build.
3. **`visual-baseline`** — pixel-diff baseline of every primary panel.
   Fails the build if a screenshot diverges from the committed baseline.

### What the build gates on

| Gate                  | Threshold               | Implementation                           |
| --------------------- | ----------------------- | ---------------------------------------- |
| Coverage floor        | strict-live ≥ 20%       | `e2e_coverage_report.py --fail-under 20` |
| Coverage regression   | delta ≥ −2.0 pp vs main | `scripts/e2e_coverage_delta.mjs`         |
| Playwright assertions | 0 failures              | `pnpm test:e2e` exit code                |
| Visual baseline       | 0 unmasked diffs        | `--project=visual-baseline` exit code    |

The two cross-engine smoke projects (firefox + webkit) are surfaced as
artifacts but are _not_ a gate — engine-only drift is informational.

### Artifacts every build publishes

- `playwright-report-${run_id}` — HTML report of the chromium run.
- `e2e-coverage-${run_id}` — strict coverage `.md`, `.json`, and the
  Playwright JSON results (used by the PR delta script).
- `smoke-report-${run_id}` — HTML report from the firefox + webkit run.
- `playwright-traces-${run_id}` — traces from failed tests (failure only).
- `visual-diffs-${run_id}` — diff PNGs when the visual project fails.

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
3. **`visual-baseline` failed** — download `visual-diffs-${run_id}`. If
   the change is intentional, run
   `pnpm --filter @apicircle/e2e-web exec playwright test --project=visual-baseline --update-snapshots`,
   commit the updated `__screenshots__/` files, and push.
4. **Coverage gate failed** — most often a `test()` got converted to
   `test.fixme()` or deleted. The strict JSON's `gap` array lists every
   TC-ID that lost coverage; cross-reference with the diff.

---

## Live GitHub end-to-end suite

The default E2E suite uses the local GitHub mock. Real GitHub credentials
are opt-in and must be supplied only as runtime environment variables.
**Never** commit a PAT, put it in a package script, or paste it into a
test file.

The `chromium-live-github` Playwright project picks up:

- [`e2e/web/live-github.spec.ts`](../../e2e/web/live-github.spec.ts) — the
  one-test PAT credential smoke.
- [`e2e/web/live/*.spec.ts`](../../e2e/web/live/) — the full-flow suite:
  workspace lifecycle (connect / branch / push / refresh / secrets
  metadata-only), CRUD round-trips for Editor / Environments / Execution
  Plans / Mock Servers, branch creation + switching + retired-branch
  no-data-loss, release publish / deprecate / withdraw on a real repo,
  Link Workspace (private workspace-session, private dedicated-session,
  and public anon), dependency diff buckets, snapshots, release notes,
  and on-demand linked release updates.

Every spec creates a uniquely named working branch
(`apicircle/e2e-<workerIndex>-<unix-ms>-<slug>`) on the sandbox repo and
deletes it via raw GitHub REST in `test.afterAll`. The default branch
(`main`) is never written to during local sandbox runs. The CI pipeline
uses bot-owned ephemeral repos and tears them down, so the main bot PAT
needs `repo` + `delete_repo`.

| Env var                                 | Required? | Purpose                                                                                                                 |
| --------------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------- |
| `APICIRCLE_E2E_LIVE_GITHUB`             | yes       | Master opt-in. Set to `1` to enable.                                                                                    |
| `APICIRCLE_E2E_GITHUB_PAT`              | yes       | Main GitHub PAT. Local sandbox runs need `repo`; CI bot runs need classic `repo` + `delete_repo`. Read only at runtime. |
| `APICIRCLE_E2E_GITHUB_REPO`             | yes       | `owner/repo` for the writable sandbox. Every test creates + deletes a fresh working branch on this repo.                |
| `APICIRCLE_E2E_BOT_OWNER`               | CI yes    | Bot owner guard for ephemeral repo create/delete tests.                                                                 |
| `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`  | CI yes    | Dedicated per-link PAT with `repo` access for private dependency session coverage.                                      |
| `APICIRCLE_E2E_GITHUB_LINK_PUBLIC_REPO` | optional  | `owner/repo[@branch]` fallback for local anon-link tests. CI provisions public repos per run.                           |

```powershell
$env:APICIRCLE_E2E_LIVE_GITHUB = '1'
$env:APICIRCLE_E2E_GITHUB_PAT  = '<your GitHub PAT>'
$env:APICIRCLE_E2E_GITHUB_REPO = 'owner/sandbox-repo'
$env:APICIRCLE_E2E_BOT_OWNER = 'dedicated-bot-login'                   # required for ephemeral-source specs
$env:APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED = '<dedicated link PAT>'     # required for dedicated-link specs
$env:APICIRCLE_E2E_GITHUB_LINK_PUBLIC_REPO = 'owner/public-repo@main'  # optional
pnpm test:e2e:live-github
```

The project disables trace, screenshots, and video so the PAT cannot leak
into local artifacts; it runs single-worker (`workers: 1`) to stay inside
GitHub's API rate limits.

**Empty-repo bootstrap is automatic.** The `live/_helpers.ts` module
exports `seedRepoIfEmpty(cfg, { workspaceJson? })`, called from every
spec's `beforeAll`. On a brand-new empty sandbox, the helper creates an
initial `README.md` commit on the default branch via `PUT /contents/...`
so `createWorkingBranch` always has a base SHA. The Link Workspace spec
additionally calls it with `workspaceJson: true` to seed a minimal
`workspace.json` on the default branch — that's the precondition for
`linkPrivateWorkspace`. Both seeds are idempotent; subsequent runs are
no-ops. The explicit-coverage spec at
[`e2e/web/live/repo-seeding.spec.ts`](../../e2e/web/live/repo-seeding.spec.ts)
pins this bootstrap behavior in place.

### Live-GitHub CI pipeline

The [`.github/workflows/e2e-live-github.yml`](../../.github/workflows/e2e-live-github.yml)
workflow runs the full live-github suite nightly (and on
`workflow_dispatch`) and on pushes to `main` against ephemeral repos that
the pipeline itself creates and deletes. Operator runbook:
[`docs/qa/live-github-bot-setup.md`](./live-github-bot-setup.md).

The flow per run:

1. **Sweep** — `scripts/live-github/sweep-orphans.mjs` deletes any
   bot-owned repos prefixed `apicircle-e2e-` older than 12h.
2. **Provision** — `scripts/live-github/provision-repos.mjs` creates one
   private + one public repo with run-scoped unique names and writes
   their `owner/name` slugs into `$GITHUB_ENV`.
3. **Run** — `pnpm test:e2e:live-github` consumes the env vars; specs
   in `e2e/web/live/` exercise the full user narrative (create branch
   → first push → second workspace pulls same branch → PR → merge →
   third workspace branches from main → release → cross-repo link).
4. **Teardown** — `scripts/live-github/teardown-repos.mjs` deletes both
   repos (runs `if: always()`). The orphan sweep on the next run
   catches anything teardown missed.

The bot account safety guard (`assertBotOwner` in
[`e2e/web/live/_helpers.ts`](../../e2e/web/live/_helpers.ts)) refuses any
repo-mutating call whose owner doesn't match
`APICIRCLE_E2E_BOT_OWNER`. The bot PAT scopes (`repo` +
`delete_repo`) and the bot account itself are detailed in the operator
runbook — read it before configuring secrets.

The live specs that ship today, all serial under
`chromium-live-github`:

| Spec                                          | Covers                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| --------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `live-github.spec.ts`                         | One-test PAT credential smoke                                                                                                                                                                                                                                                                                                                                                                                                                                                                                |
| `live/pipeline-managed-repos.spec.ts`         | Pipeline env-var contract handshake                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| `live/repo-seeding.spec.ts`                   | Empty-repo bootstrap idempotency                                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `live/lifecycle.spec.ts`                      | Connect / branch / push / refresh / secrets metadata-only                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| `live/crud-diff.spec.ts`                      | Editor / Env / Plans / Mocks CRUD round-trips through push                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| `live/branch-switching.spec.ts`               | Branch create / switch / retired-branch no-data-loss                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| `live/repo-cycle.spec.ts`                     | 9-step narrative (parametric over private + public): branch → first push → 2nd workspace → PR → merge → 3rd workspace from main → release                                                                                                                                                                                                                                                                                                                                                                    |
| `live/pr-edge-cases.spec.ts`                  | PR-against-no-commits, merge → retire, merge+delete → retire, push-after-retire, concurrent push, force-push detection                                                                                                                                                                                                                                                                                                                                                                                       |
| `live/release-tagging.spec.ts`                | `tagReleaseVersion` against main; `setRepoTopics`/`listRepoTopics` round-trip on the public repo                                                                                                                                                                                                                                                                                                                                                                                                             |
| `live/cross-repo-linking.spec.ts`             | Runtime-created third repo links both private+public; `setLinkedRequestOverride` + `setLinkedEnvVarOverride`                                                                                                                                                                                                                                                                                                                                                                                                 |
| `live/mocks-and-plans-against-linked.spec.ts` | Consumer workspace assembles plan + mock referencing linked sources; round-trip through push                                                                                                                                                                                                                                                                                                                                                                                                                 |
| `live/github-dependencies.spec.ts`            | Private/public dependency linking, dedicated per-link PAT, marketplace discovery, markdown release notes, latest/pinned versions, decline/adopt-on-demand, deprecated/yanked visibility, unlink cleanup                                                                                                                                                                                                                                                                                                      |
| `live/git-diff-dependencies.spec.ts`          | Dependency diff buckets (`linkedWorkspace`, request/env overrides, `releasePerLink`), push reset, auto-merge, conflict cancellation, mine/theirs resolution                                                                                                                                                                                                                                                                                                                                                  |
| `live/core-surfaces-live-regression.spec.ts`  | Editor, Environments, Execution Plans, and Mock Servers mutate under linked dependencies, push/refresh cleanly, and restore from pre-push snapshots without secret/local-only leakage                                                                                                                                                                                                                                                                                                                        |
| `live/data-loss-invariants.spec.ts`           | **100% data-loss coverage** — 20 invariants: workspace switch / createNewWorkspace / deleteWorkspaceById / disconnectRepo / disconnectGitHubSession / connectRepo-reconnect / dismissRetiredBranch / createWorkingBranch / push / refresh / commitRefresh / cancelRefresh / unlinkWorkspace / removeSecret / removeRequest-referenced-by-plan / removeEnvironment-of-active / captureSnapshot / restoreSnapshot / page reload IDB rehydration / new-context IDB privacy boundary / push-failure preservation |
| `live/marketplace.spec.ts`                    | `searchMarketplace` returns array w/ topic:apicircle (TC-SE-0001), empty-results path (TC-SE-0003), `linkPublicWorkspace` from marketplace result (TC-SE-0002)                                                                                                                                                                                                                                                                                                                                               |
| `live/pr-merge-methods.spec.ts`               | PR merge via squash, rebase, draft PR push, branch-protected push rejection                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `live/repo-mutation-edges.spec.ts`            | Repo deleted-after-link, renamed, archived, forked; transferred (fixme: needs 2nd bot)                                                                                                                                                                                                                                                                                                                                                                                                                       |
| `live/linked-version-transitions.spec.ts`     | Source publishes new version, adopt, decline, breaking change, renamed entity, multiple links with conflicts, source unpublished, compare versions, chain source setup                                                                                                                                                                                                                                                                                                                                       |
| `live/session-edges.spec.ts`                  | Rate-limit budget probe (always runs); per-link dedicated session; OAuth scope downgrade (TC-GT-0023) — real `api.github.com` 403 + `X-Accepted-OAuth-Scopes` from a scope-restricted endpoint the bot PAT lacks; OAuth token revoked (TC-GT-0035) — real `api.github.com` 401 `Bad credentials` from a syntactically-valid but unrecognized token. Both also pinned at unit tier in `packages/git/src/github/api.test.ts`.                                                                                  |

### Optional env vars for extended coverage

| Env var                             | Purpose                                    | Effect when unset                   |
| ----------------------------------- | ------------------------------------------ | ----------------------------------- |
| `APICIRCLE_E2E_BOT_ORG`             | Bot-org login for org-repo user stories    | Org tests skip with directed reason |
| `APICIRCLE_E2E_BOT_OWNER_SECONDARY` | Second bot account for repo-transfer tests | Transfer test stays in fixme        |

---

## Manual test-case workbooks

The two workbooks under `docs/qa/test_cases/` are the source of truth for
the manual test matrix. The Cowork manual-test runner
([`e2e/qa/runner/`](../../e2e/qa/runner/)) executes them interactively and
writes result workbooks + evidence into `docs/qa/results/` (gitignored).
