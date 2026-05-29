# Live-GitHub bot setup — operator runbook

This page is the one-time setup guide for the `e2e-live-github` GitHub
Actions workflow. The pipeline talks to the real GitHub REST API, so it
must run under a **dedicated bot account** that owns nothing else. Never
configure it to use a personal or team-shared account — the bot's PAT
needs `delete_repo` scope, and the workflow's safety guard refuses to
operate on any repo whose owner doesn't match the configured bot owner.

## What you'll do, in order

1. Create the bot account.
2. Mint the required PATs.
3. Add a repo secret + variable in this project.
4. Run the workflow manually once to confirm everything works.
5. Let `main` pushes and the nightly schedule take over.

## 1. Create the bot account

- Sign up at `https://github.com/signup` with a new email (or a `+bot`
  alias of yours, e.g. `you+apicircle-bot@example.com`).
- Suggested login: `apicircle-ci-bot` (or any short, recognizable name —
  the value will live in a workflow variable, so pick something that's
  unambiguous when it appears in a sweep log).
- Enable 2FA on the bot account.
- The bot does NOT need to own anything else. Make sure it isn't a
  collaborator on any private repos beyond the ones it will create.

## 2. Mint the PATs

Classic PAT (simplest):

- Sign in as the bot → `https://github.com/settings/tokens` → **Generate
  new token (classic)**. Create two tokens:
  - `APICIRCLE_E2E_BOT_PAT`
  - `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`
- Scopes for `APICIRCLE_E2E_BOT_PAT`:
  - `repo` (Full control of private repositories) ← required for creating
    repos, pushing commits, creating PRs, merging PRs.
  - `delete_repo` ← required for cleanup.
- Scopes for `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`:
  - `repo` ← required to prove a linked private workspace can use its own
    per-link session after the main workspace session is disconnected.
- Set expiration to 90 days (rotate quarterly).
- Copy both tokens. You will NEVER see them again.

Fine-grained PAT (alternative, more locked-down):

- Same flow, but **Fine-grained tokens**.
- Resource owner: the bot account.
- Repository access: **All repositories** for the main PAT (the bot creates them at
  runtime, so per-repo selection isn't workable).
- Permissions (Repository): `Administration: read & write` (covers
  create + delete), `Contents: read & write`, `Pull requests: read &
write`, `Metadata: read-only`.
- For the dedicated-link PAT, `Contents: read` plus `Metadata: read-only`
  is the minimum for read-only linked-source fetches when using a
  fine-grained token. Classic `repo` is simpler and is what CI expects.
- Permissions (Account): none required.

Either token type works with the pipeline. Classic is one fewer setting
to get wrong; fine-grained scopes more narrowly.

## 3. Configure secrets + variables on this repo

Project repo → **Settings → Secrets and variables → Actions**:

- **Secrets** tab → **New repository secret**:
  - Name: `APICIRCLE_E2E_BOT_PAT`
  - Value: the main PAT you just minted
  - Name: `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`
  - Value: the dedicated-link PAT you just minted

- **Variables** tab → **New repository variable**:
  - Name: `APICIRCLE_E2E_BOT_OWNER`
  - Value: the bot's GitHub login (e.g. `apicircle-ci-bot`)

### Optional variables for extended coverage

These extend the test surface; the pipeline still runs without them.

| Name                                | Type     | Purpose                                                                                                 |
| ----------------------------------- | -------- | ------------------------------------------------------------------------------------------------------- |
| `APICIRCLE_E2E_BOT_ORG`             | Variable | A GitHub org the bot belongs to. Unlocks org-repo user-story tests (member/non-member, public/private). |
| `APICIRCLE_E2E_BOT_OWNER_SECONDARY` | Variable | A second bot account login. Unlocks the repo-transfer edge case (`live/repo-mutation-edges.spec.ts`).   |

The workflow refuses to start if the required owner variable or either
required PAT secret is missing — see the
`Validate secrets + variables` step in
[`.github/workflows/e2e-live-github.yml`](../../.github/workflows/e2e-live-github.yml).

## 4. First manual run

Don't wait for the nightly schedule the first time. Trigger it manually
so you can watch the run:

```bash
gh workflow run e2e-live-github.yml --repo <your-org-or-user>/<this-repo>
gh run watch
```

Expected lifecycle (visible in the run log):

1. **Sweep orphan repos** — first run finds nothing; logs `deleted 0, skipped 0`.
2. **Provision ephemeral repos** — logs the two new slugs and writes
   them to `$GITHUB_ENV`. Two repos with names like
   `apicircle-e2e-private-<run-id>-1` and `apicircle-e2e-public-<run-id>-1`
   appear under the bot account.
3. **Run live-github E2E suite** — Playwright project
   `chromium-live-github` runs all live specs. Single worker, ≤60 minutes.
4. **Teardown ephemeral repos** — deletes both repos. Runs even on
   failure (`if: always()`).
5. **Upload Playwright report** — published as the `live-github-report-*`
   artifact, retained for 14 days.

If the suite passes, you're done. If a test fails, download the artifact
and open `index.html` for the trace.

## 5. Day-to-day operation

- The workflow runs on pushes to `main`, on manual dispatch.
- Failures are surfaced in the Actions tab; consider wiring an Actions
  failure notification via your usual channel (Slack / email).
- The orphan sweep at the start of each run cleans up anything left
  behind by a failed teardown (older than 12h).
- Rotate the PAT before its expiration (the workflow will fail with a
  401 once it lapses).

## Recovering from a stuck state

| Symptom                                                                | Recovery                                                                                                                                                                                                         |
| ---------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Old repos accumulating under the bot account                           | Trigger a dispatch run — the sweep step at the top of the workflow deletes anything matching `apicircle-e2e-*` older than 12h. Or run `node scripts/live-github/sweep-orphans.mjs` locally with the bot env set. |
| PAT expired (`401 Bad credentials`)                                    | Mint a new PAT, update `APICIRCLE_E2E_BOT_PAT` and/or `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`, retry.                                                                                                             |
| Teardown failed mid-run (orphan repos visible immediately after a run) | They'll be swept on the next scheduled run (or `gh workflow run e2e-live-github.yml`). Or delete manually under the bot account → Settings → Danger Zone.                                                        |
| Suite passes locally but fails in CI                                   | Check rate-limit headers in the failure trace — the test logs `X-RateLimit-Remaining` on each request. If it's near zero, space out runs further.                                                                |

## Why the safety guard exists

`scripts/live-github/teardown-repos.mjs` and the in-spec `deleteRepo`
helper both call `assertBotOwner(owner)` before any DELETE. The guard
compares the target owner against `APICIRCLE_E2E_BOT_OWNER` and refuses
on mismatch. That's the load-bearing safety net: a typo that points the
suite at a non-bot owner cannot destroy anything.

Don't disable this guard. Don't reuse the bot PAT for anything else.
Treat the bot account as **production credentials with destructive
authority** — even though all it owns is ephemeral test data.
