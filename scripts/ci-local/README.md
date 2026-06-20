# Local CI runner

Reproduce the **full GitHub Actions validation matrix** on your machine before
pushing. One orchestrator (`run-ci.mjs`) runs each CI workflow as a "stage",
in the same order and with the same commands CI uses.

| Stage         | Mirrors workflow      | File                                    | What it runs                                                                                                         |
| ------------- | --------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `setup`       | (pre-steps)           | —                                       | `pnpm install --frozen-lockfile`, `pnpm build`                                                                       |
| `ci`          | **CI**                | `.github/workflows/ci.yml`              | typecheck (`pnpm -r check`), lint, `format:check`, unit+integration tests w/ coverage, build, web gzip bundle budget |
| `vscode`      | **VS Code extension** | `.github/workflows/vscode.yml`          | typecheck (vscode + e2e-vscode), lint, unit tests, build, bundle-size budget, knip [+ opt-in cross-host E2E]         |
| `e2e`         | **E2E**               | `.github/workflows/e2e.yml`             | Playwright chromium suite, strict coverage report, cross-browser smoke (Firefox/WebKit), desktop Electron suite      |
| `codeql`      | **CodeQL**            | `.github/workflows/codeql.yml`          | CodeQL static analysis (opt-in; needs the `codeql` CLI)                                                              |
| `live-github` | **e2e-live-github**   | `.github/workflows/e2e-live-github.yml` | live GitHub suite (opt-in; ⚠️ creates/deletes real repos)                                                            |

Default run (`node scripts/ci-local/run-ci.mjs` with no flags) executes
**setup + ci + vscode + e2e**. The heavy/destructive/external suites
(`codeql`, `live-github`, VS Code cross-host E2E, visual baselines) are
**opt-in**.

## Quick start

```bash
# 1. Create your env file from the template and fill it in
cp scripts/ci-local/.test.env.example scripts/ci-local/.test.env

# 2. See the resolved plan (no execution)
node scripts/ci-local/run-ci.mjs --list

# 3. Run the default matrix
node scripts/ci-local/run-ci.mjs
```

On Windows you can use the wrapper:

```powershell
./scripts/ci-local/run-ci.ps1 --list
```

On macOS / Linux:

```bash
./scripts/ci-local/run-ci.sh --list
```

Or via the package.json script (note the `--` before flags):

```bash
pnpm ci:local -- --only ci,vscode
```

## Environment (`.test.env`)

The runner auto-loads these files if present (later files override earlier;
shell variables already set win unless you pass `--force-env`):

1. `scripts/ci-local/.test.env`
2. `scripts/ci-local/.secrets.env` ← good place for tokens
3. `<repo>/.test.env`
4. `<repo>/.secrets.env`

Plus any `--env-file <path>` you pass (repeatable).

All variables are documented in
[`.test.env.example`](./.test.env.example). The important ones:

- **`CI_PLATFORM=windows|mac|ubuntu`** — declare the host you are running on.
  This is the platform switch you asked for: on **ubuntu/linux** the desktop
  (Electron) and VS Code cross-host E2E suites are wrapped in `xvfb-run` and
  Playwright installs OS libs with `--with-deps`; on **windows/mac** those
  suites run natively. If omitted it is auto-detected. If the declared value
  disagrees with the real OS, the runner warns — those native suites always
  run on the actual host OS.
- **Toggles** — `RUN_LIVE_GITHUB`, `RUN_CODEQL`, `RUN_VSCODE_E2E`,
  `RUN_VISUAL` (default off); `RUN_DESKTOP_E2E`, `RUN_CROSS_BROWSER`
  (default on).
- **Live-GitHub creds** — `APICIRCLE_E2E_BOT_OWNER`,
  `APICIRCLE_E2E_GITHUB_PAT` (repo + delete_repo),
  `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED` (repo). Required when
  `RUN_LIVE_GITHUB=1`. See `docs/qa/live-github-bot-setup.md`.

> 🔒 `.test.env` and `.secrets.env` are git-ignored. Never commit real tokens.

## Common invocations

```bash
node scripts/ci-local/run-ci.mjs                       # default matrix
node scripts/ci-local/run-ci.mjs --only ci             # just the CI quality gates
node scripts/ci-local/run-ci.mjs --only vscode         # just the VS Code extension checks
node scripts/ci-local/run-ci.mjs --skip e2e            # everything except the E2E suites
node scripts/ci-local/run-ci.mjs --no-install --no-build   # reuse an existing install/build
node scripts/ci-local/run-ci.mjs --dry-run             # print every command, run nothing
node scripts/ci-local/run-ci.mjs --bail                # stop at the first failure

# Opt-in heavy / external suites
node scripts/ci-local/run-ci.mjs --include-codeql
node scripts/ci-local/run-ci.mjs --include-vscode-e2e
node scripts/ci-local/run-ci.mjs --only live-github    # ⚠ creates/deletes real repos
```

## Run a specific test file

`--spec <pattern>` and `--grep <title>` filter the Playwright suites (`e2e` +
`live-github`) the same way `playwright test <pattern>` / `-g <title>` do — but
the runner still loads `.test.env` first, so the live-GitHub credentials come
along automatically (no re-exporting four env vars into your shell).

```bash
# one live-github spec, reusing .test.env creds (path is matched as a substring)
node scripts/ci-local/run-ci.mjs --only live-github --spec 06-release-update-flow --no-install --no-build

# one web spec / one test title
node scripts/ci-local/run-ci.mjs --only e2e --spec auth.spec.ts --no-install --no-build
node scripts/ci-local/run-ci.mjs --only e2e --grep "Bearer token" --no-install --no-build
```

When a filter is active the `e2e` stage runs the **chromium suite only** —
cross-browser, visual, desktop, and the coverage gate are skipped (they'd error
with "no tests found" for a chromium-scoped file), and the live-github stage
skips the orphan sweep. For a **desktop** or **unit** single file, use the
direct command instead:

```bash
pnpm --filter @apicircle/e2e-desktop exec playwright test mock-response-matrix.spec.ts
pnpm --filter @apicircle/core test src/auth/jwt.test.ts
```

## Options

Run `node scripts/ci-local/run-ci.mjs --help` for the full list. Highlights:

| Flag                                                                                       | Effect                                                                    |
| ------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------- |
| `--only a,b` / `--skip a,b`                                                                | restrict / exclude stages (`--only` forces opt-in stages on)              |
| `--dry-run`                                                                                | print every command without executing                                     |
| `--bail`                                                                                   | stop at the first hard failure (default: run all, report at end)          |
| `--no-install` / `--no-build` / `--no-frozen`                                              | control the pre-steps                                                     |
| `--no-desktop` / `--no-cross-browser`                                                      | drop those e2e sub-suites                                                 |
| `--include-visual` / `--include-codeql` / `--include-live-github` / `--include-vscode-e2e` | enable opt-in suites                                                      |
| `--strict-coverage`                                                                        | make the E2E coverage gate a hard failure (default: warn)                 |
| `--spec <pattern>` / `--grep <title>`                                                      | run only matching Playwright spec files / test titles (e2e + live-github) |
| `--env-file <path>`                                                                        | load an extra env file (repeatable)                                       |

## Behavior notes

- **Run-all-then-report.** By default every stage runs even if an earlier one
  fails; the run ends with a pass/fail/warn/skip summary and a non-zero exit
  code if anything hard-failed. Use `--bail` to stop early. Within a stage, a
  failed step skips that stage's remaining steps (same as a failed CI job).
- **Soft steps** (the E2E coverage report, the orphan sweep, the visual
  baseline) record a **WARN** instead of failing the run — they're tooling /
  attribution, not test gates. `--strict-coverage` promotes the coverage gate
  to a hard failure.
- **The chromium E2E suite runs with `CI=1`** so Playwright emits
  `e2e/web/test-results.json`, which the coverage report consumes (exactly as
  CI does). Don't have `pnpm dev:web` running on port 5174 at the same time —
  the suite starts its own dev + mock servers.
- **CodeQL** is best-effort: if the `codeql` CLI isn't on PATH the stage is
  skipped with a pointer to the install page. When present it builds a database
  scoped to `apps/packages/scripts/e2e` (matching `codeql.yml`) and runs the
  `security-and-quality` suite.
- **Reports** are written to `scripts/ci-local/results/last-run.{json,md}`
  (git-ignored).
