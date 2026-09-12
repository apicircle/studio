# Live-GitHub Bot Setup

This is the one-time setup guide for the live-GitHub E2E suite
(`e2e/web/live-github/`). The suite talks to the real GitHub REST API, creates
and deletes ephemeral repositories, and must run under a dedicated bot account
that owns nothing except E2E repos.

It has no CI workflow. The `e2e-live-github` workflow was retired, so GitHub
Actions never runs this suite; it runs on demand on your machine, through the
local CI runner or `pnpm test:e2e:live-github`.

Do not use a personal or shared team account. The main PAT needs
`delete_repo`, and every repo-mutating helper refuses to operate when the
target owner does not match `APICIRCLE_E2E_BOT_OWNER`.

## Required Configuration

Copy `scripts/ci-local/.test.env.example` to `scripts/ci-local/.test.env` (or
keep the tokens in `scripts/ci-local/.secrets.env`; both are git-ignored) and
set:

- `APICIRCLE_E2E_BOT_OWNER`: bot GitHub login, for example `apicirclebot`.
- `APICIRCLE_E2E_GITHUB_PAT`: classic PAT from the bot account with `repo` and
  `delete_repo`.
- `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`: second classic PAT from the bot
  account with `repo`.
- `APICIRCLE_E2E_LIVE_GITHUB=1`: the master switch the specs check.

No repository secrets or variables are needed. If the repository still holds
`APICIRCLE_E2E_BOT_PAT`, `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED` or
`APICIRCLE_E2E_BOT_OWNER` from the retired workflow, delete them.

## Token Scope Rationale

`APICIRCLE_E2E_GITHUB_PAT` needs:

- `repo`: create private/public repos, push workspace commits, create/merge PRs,
  read/write contents, and read private linked sources.
- `delete_repo`: clean up ephemeral repos after each run and during orphan
  sweeps.

`APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED` needs:

- `repo`: proves that a private linked workspace can use its own per-link
  session after the active workspace GitHub session is disconnected.

Classic tokens are the expected setup. Fine-grained tokens are more fragile for
this suite because the bot creates repos at runtime, so per-repo selection does
not work well.

## Running It

```bash
node scripts/ci-local/run-ci.mjs --only live-github
```

Run shape:

1. Validate the live-GitHub credentials.
2. Install Playwright Chromium.
3. Sweep orphan repos older than 12 hours whose names start with
   `apicircle-e2e-` (skipped on a targeted `--spec` / `--grep` run).
4. Run the `chromium-live-github` project against
   `e2e/web/live-github/**/*.spec.ts`.

Reports land in `scripts/ci-local/results/`. To run one spec file, pass a
substring of its path:

```bash
node scripts/ci-local/run-ci.mjs --only live-github --spec 13-global-assets-live --no-install --no-build
```

The v1 sandbox-style live suite has been retired. The current suite creates its
own private/public source and host repos per test, then cleans them up in test
cleanup. Set `APICIRCLE_E2E_KEEP_REPOS=1` only for local/manual debugging when
you want to inspect generated repos after a failure.

## Without the Runner

PowerShell:

```powershell
$env:APICIRCLE_E2E_LIVE_GITHUB = '1'
$env:APICIRCLE_E2E_GITHUB_PAT = '<classic repo + delete_repo PAT>'
$env:APICIRCLE_E2E_BOT_OWNER = 'apicirclebot'
$env:APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED = '<classic repo PAT>'
pnpm test:e2e:live-github
```

To run one file:

```powershell
pnpm --filter @apicircle/e2e-web exec playwright test --project=chromium-live-github e2e/web/live-github/13-global-assets-live.spec.ts
```

## Recovery

| Symptom                                 | Recovery                                                                                                            |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------- |
| Old E2E repos accumulating              | Run `node scripts/live-github/sweep-orphans.mjs` with `APICIRCLE_E2E_BOT_OWNER` and `APICIRCLE_E2E_GITHUB_PAT` set. |
| PAT expired                             | Mint a new token, update `scripts/ci-local/.test.env` (or `.secrets.env`), and retry.                               |
| Missing credential                      | The runner stops at `Validate live-GitHub credentials`; fill in the value in `.test.env`.                           |
| Need to inspect a failed generated repo | Re-run locally with `APICIRCLE_E2E_KEEP_REPOS=1`, inspect the repo, then delete it manually under the bot account.  |

Do not disable the owner guard or reuse the bot PAT for unrelated work.
