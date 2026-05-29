# Live-GitHub Bot Setup

This is the one-time setup guide for the `e2e-live-github` GitHub Actions
workflow. The pipeline talks to the real GitHub REST API, creates and deletes
ephemeral repositories, and must run under a dedicated bot account that owns
nothing except E2E repos.

Do not use a personal or shared team account. The main PAT needs
`delete_repo`, and every repo-mutating helper refuses to operate when the
target owner does not match `APICIRCLE_E2E_BOT_OWNER`.

## Required GitHub Configuration

Repository settings: **Settings -> Secrets and variables -> Actions**.

Secrets:

- `APICIRCLE_E2E_BOT_PAT`: classic PAT from the bot account with `repo` and
  `delete_repo`.
- `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`: second classic PAT from the bot
  account with `repo`.

Variables:

- `APICIRCLE_E2E_BOT_OWNER`: bot GitHub login, for example `apicirclebot`.

The workflow maps `APICIRCLE_E2E_BOT_PAT` into the runtime
`APICIRCLE_E2E_GITHUB_PAT` env var because the Playwright helpers consume that
name locally and in CI.

## Token Scope Rationale

`APICIRCLE_E2E_BOT_PAT` needs:

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

## Manual Run

After secrets and variables are configured:

```bash
gh workflow run e2e-live-github.yml --repo <your-org-or-user>/<this-repo> --ref main
gh run watch
```

Expected run shape:

1. Checkout, install dependencies, and install Playwright Chromium.
2. Validate required secrets and variables.
3. Sweep orphan repos older than 12 hours whose names start with
   `apicircle-e2e-`.
4. Run `pnpm test:e2e:live-github`, which executes
   `chromium-live-github` against `e2e/web/live-github/**/*.spec.ts`.
5. Upload the Playwright report artifact, including traces/video on failure.

The v1 sandbox-style live suite has been retired. The current suite creates its
own private/public source and host repos per test, then cleans them up in test
cleanup. Set `APICIRCLE_E2E_KEEP_REPOS=1` only for local/manual debugging when
you want to inspect generated repos after a failure.

## Local Debug Run

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

| Symptom                                 | Recovery                                                                                                           |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| Old E2E repos accumulating              | Trigger a manual workflow run or run `node scripts/live-github/sweep-orphans.mjs` locally with the bot env set.    |
| PAT expired                             | Mint a new token, update the affected repository secret, and retry.                                                |
| Missing secret or variable              | The workflow fails during `Validate secrets and variables` with the exact missing name.                            |
| Need to inspect a failed generated repo | Re-run locally with `APICIRCLE_E2E_KEEP_REPOS=1`, inspect the repo, then delete it manually under the bot account. |

Do not disable the owner guard or reuse the bot PAT for unrelated work.
