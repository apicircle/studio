# Unpushed-Changes — Manual Test Cases & Known Gaps

> Audit of the "+N added · ~M modified · -K removed" strip on the working-branch card.
> Covers the data flow from store mutation → `synced` → diff vs `lastPulledSnapshot` →
> UI render. Walk each scenario from a clean app state.
>
> **Status: 3 bugs found, all 3 fixed in this pass** (2026-05-14). Test cases retain
> the "Current" column for historical reference, but each formerly-failing row now
> shows ✅ — see "What changed in the fix" section below for the exact diffs.

## How the calculation works (mental model)

The unpushed-changes strip is computed by **one** function:

```
summarizeUnpushedChanges(base, current)
   ├── base    = local.sync.lastPulledSnapshot   (the last thing we know was on the remote)
   └── current = synced                          (your live in-memory edits)
```

`lastPulledSnapshot` is set in **three** places:

| When                                          | Set to   | File / line                                                   |
| --------------------------------------------- | -------- | ------------------------------------------------------------- |
| After a successful **push**                   | `synced` | `workspaceStore.ts:3804` (`pushWorkspace`)                    |
| After **refresh** (no changes / `up-to-date`) | `remote` | `workspaceStore.ts:4973` (`refreshWorkspace`)                 |
| After **refresh** (merge — auto or conflict)  | `remote` | `workspaceStore.ts:5550` (`persistMerged`) — fixed 2026-05-14 |

The diff engine only knows about a fixed set of "buckets" — anything not in
that set is **invisible** to the strip even though it gets pushed to git
(serializeWorkspaceForGit dumps the whole synced doc).

### Buckets covered by the diff engine (post-fix)

All 17 git-tracked fields on `WorkspaceSynced` now participate in the diff:

| Bucket                  | Field on `WorkspaceSynced`        |
| ----------------------- | --------------------------------- |
| `request`               | `collections.requests`            |
| `folder`                | `collections.folders`             |
| `environment`           | `environments.items`              |
| `linkedWorkspace`       | `linkedWorkspaces`                |
| `mockServer`            | `mockServers`                     |
| `executionPlan`         | `executionPlans`                  |
| `secretKey`             | `secretKeys`                      |
| `globalSchema`          | `globalAssets.schemas`            |
| `globalGraphql`         | `globalAssets.graphql`            |
| `linkedRequestOverride` | `linkedOverrides.requests`        |
| `linkedEnvOverride`     | `linkedOverrides.environmentVars` |
| `releasePerLink`        | `releases.perLink`                |
| `tree`                  | `collections.tree`                |
| `environmentsActive`    | `environments.activeName`         |
| `environmentsPriority`  | `environments.priorityOrder`      |
| `releaseSelf`           | `releases.self`                   |
| `secretCrypto`          | `secretCrypto`                    |

Every mutation to any of these surfaces in the unpushed-changes strip and is
resolvable in the conflict modal. The "push without badge" silent class is
gone.

---

## Known bugs (now fixed)

### ✅ Bug #1 — Pulling made your local edits vanish from the strip (fixed)

**Symptom:** You edit something (e.g. an Execution Plan), then pull from the
working branch. The strip showed "No unpushed changes — workspace matches the
last pull." But you had NOT pushed your edit yet — pressing Push anyway went
through with your changes.

**Root cause:** `persistMerged` set `lastPulledSnapshot = merged`. The merged
doc combined your local edits with remote, so synced == merged == lastPulledSnapshot,
and the diff returned zero changes. The remote branch actually still held the
pre-merge content; local-only edits were silently unpushed.

**Fix:** `persistMerged` now takes a `remote` argument and sets
`lastPulledSnapshot = remote`. The snapshot tracks what's on the remote branch,
not what's in your local doc. Both call sites (`refreshWorkspace`'s auto-merge
path and `commitRefresh`'s conflict-resolved path) pass `remote` explicitly.
Pinned by [`refreshWorkspace.test.ts`](../packages/ui-components/src/store/refreshWorkspace.test.ts)
regression tests for both paths.

### ✅ Bug #2 — Same as Bug #1, also fixed

Same root cause as Bug #1; same fix covers it. The "Pull first" path from
the first-pull banner now correctly surfaces your pre-existing local edits
as unpushed against the freshly-pulled main.

### ✅ Bug #3 — Seven entity types silently missed the strip (fixed)

Any change to `secretKeys`, `globalAssets.schemas`, `globalAssets.graphql`,
`linkedOverrides.requests`, `linkedOverrides.environmentVars`,
`releases.perLink`, or `secretCrypto` did not appear in the unpushed-changes
strip — but DID get pushed when the user clicked Push.

**Fix:** Added 6 new dict buckets (`secretKey`, `globalSchema`, `globalGraphql`,
`linkedRequestOverride`, `linkedEnvOverride`, `releasePerLink`) and 1 new
singleton (`secretCrypto`) to the diff engine. Mirrored in
`summarizeAllAsAdded` (first-push path), `BUCKET_ORDER`, and the
`applyMerge` switch so conflict resolution can write each back. The
`CONFLICT_BUCKET_ORDER` map in `WorkspacePanel` was extended with the new
bucket names. Each bucket has a regression test in
[`threeWayDiff.test.ts`](../packages/core/src/git/threeWayDiff.test.ts).

### ✅ Bug #4 — "Connect via Secret Vault → Sessions" landed on Vault sub-tab (fixed)

The button on the Workspace panel ("Connect via Secret Vault → Sessions" and
"Manage session") opened the right-dock to the Vault tab — but the sub-tab
inside always defaulted to Vault, contradicting the button copy.

**Fix:** Lifted the sub-tab to store state (`rightDock.vaultSubtab`). Extended
`openRightDockTab(tab, opts?)` to accept `{ vaultSubtab }`. Both buttons now
pass `'sessions'`. The `SecretVaultDockPanel` reads/writes the sub-tab through
the store instead of local React state. Pinned by tests in
[`WorkspacePanel.test.tsx`](../packages/ui-components/src/panels/workspace/WorkspacePanel.test.tsx).

---

## What changed in the fix

### Files modified

- **`packages/core/src/git/threeWayDiff.ts`** — Added `EntityBucket` variants:
  `secretKey`, `globalSchema`, `globalGraphql`, `linkedRequestOverride`,
  `linkedEnvOverride`, `releasePerLink`, `secretCrypto`. Added 6 dict-bucket
  specs + 1 singleton spec. Added 7 `applyEntry` switch cases.
- **`packages/core/src/git/summarizeUnpushedChanges.ts`** — Added all 7 new
  buckets to `BUCKET_ORDER`. Extended `summarizeAllAsAdded` to surface them
  on first push.
- **`packages/ui-components/src/store/workspaceStore.ts`** —
  - Changed `persistMerged` signature to `(set, get, merged, remote, remoteSha)`
    and writes `lastPulledSnapshot: remote`.
  - Added `VaultSubtab` type and `rightDock.vaultSubtab` field (default `'vault'`).
  - Extended `openRightDockTab` to accept `{ vaultSubtab }`.
  - Added `setVaultSubtab` action.
- **`packages/ui-components/src/layout/dock/SecretVaultDockPanel.tsx`** —
  Sub-tab now reads from `rightDock.vaultSubtab` via the store.
- **`packages/ui-components/src/panels/workspace/WorkspacePanel.tsx`** —
  Both buttons pass `{ vaultSubtab: 'sessions' }`. `CONFLICT_BUCKET_ORDER`
  extended with the 7 new bucket names.

### Tests added (11 new, all green; 2131 total)

- 2 regression tests in `refreshWorkspace.test.ts` (auto-merge and
  conflict-resolved-as-mine paths both keep local edits visible on the strip).
- 8 bucket tests in `threeWayDiff.test.ts` (one per new bucket, plus
  applyMerge round-trip for `secretKey` and `linkedRequestOverride`).
- 1 sub-tab assertion added to each of the existing `WorkspacePanel.test.tsx`
  tests for "Connect via Secret Vault" and "Manage session".

---

## Test cases

Each test starts from a known state. Set up the **Setup** column, run the
**Action**, then verify the **Expected** column. If the **Current** column
differs, that's a bug.

> **Reset between tests:** Open DevTools → Application → IndexedDB → delete
> the `apicircle-workspace` database, then hard-reload. This nukes all local
> state. Most tests start from a fresh workspace.

### A. Clean-slate sanity

| #   | Setup                                                 | Action                                             | Expected                                                                         | Current                               |
| --- | ----------------------------------------------------- | -------------------------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------- |
| A.1 | Reset IDB. Connect GitHub session. No repo connected. | Open Workspace panel.                              | No working-branch card. No strip shown.                                          | ✅ correct                            |
| A.2 | Reset. New workspace seeds one sample request.        | Connect repo, do **not** push yet. Note the strip. | Card is not shown (no working branch yet).                                       | ✅ correct                            |
| A.3 | A.2 + create a working branch on an empty repo.       | View the BranchCard strip.                         | "+1 added" (the seeded sample request) — because `lastPulledSnapshot` is `null`. | ✅ correct (summarizeAllAsAdded path) |

### B. Edit → push → re-edit (the happy path)

| #   | Setup                                                    | Action                                   | Expected                                                             | Current    |
| --- | -------------------------------------------------------- | ---------------------------------------- | -------------------------------------------------------------------- | ---------- |
| B.1 | Working branch on an empty repo, strip shows "+1 added". | Click Push.                              | After push: "No unpushed changes — workspace matches the last pull." | ✅ correct |
| B.2 | After B.1, rename the sample request.                    | Strip recomputes on each store mutation. | "~1 modified" with the request name as the label.                    | ✅ correct |
| B.3 | After B.2, add a new request via the Editor panel.       | View strip.                              | "+1 added · ~1 modified" with both rows in the preview.              | ✅ correct |
| B.4 | After B.3, delete the renamed request.                   | View strip.                              | "+1 added · -1 removed" (modified vs base then removed).             | ✅ correct |

### C. Execution plan — the bug repro

| #   | Setup                                                                           | Action                                               | Expected                                                                                                                                                                                   | Current                                                                                                   |
| --- | ------------------------------------------------------------------------------- | ---------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------- |
| C.1 | B.1 baseline (one pushed request, strip empty). Open Execution panel.           | Create a new plan with the sample request as a step. | "+1 added" (the new plan).                                                                                                                                                                 | ✅ correct                                                                                                |
| C.2 | C.1.                                                                            | Push.                                                | After push: empty strip.                                                                                                                                                                   | ✅ correct                                                                                                |
| C.3 | C.2 + edit the plan (add a step, rename it, toggle a flag — any plan mutation). | View strip.                                          | "~1 modified" — the plan.                                                                                                                                                                  | ✅ correct                                                                                                |
| C.4 | C.3.                                                                            | Click Refresh.                                       | Remote == lastPulledSnapshot (no conflict on the remote side), local has the plan edit → auto-merge → strip should still show "~1 modified" because the local plan edit is still unpushed. | ✅ fixed — `persistMerged` writes `remote` as the snapshot baseline so the local-only edit stays visible. |
| C.5 | C.4 ("~1 modified" state).                                                      | Click Push.                                          | Push lands the plan edit; strip flips to empty.                                                                                                                                            | ✅ correct                                                                                                |

### D. Working branch from main after a prior PR merge — the user-reported repro

| #   | Setup                                                                                                     | Action                                                                             | Expected                                                                                                                                                         | Current                                                                      |
| --- | --------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------- |
| D.1 | A workspace that has pushed and merged a PR to main. Working branch is retired (PR-merge banner showing). | Edit an execution plan.                                                            | Strip is hidden (no working branch yet) — Identity/branch UI shows retired banner only.                                                                          | ✅ correct                                                                   |
| D.2 | D.1.                                                                                                      | Click "Create new working branch from main".                                       | New branch created. First-pull prompt fires (main has workspace.json from the merged PR).                                                                        | ✅ correct                                                                   |
| D.3 | D.2.                                                                                                      | Click **Pull first** on the banner.                                                | refresh runs; main's workspace.json equals lastPulledSnapshot (the merged PR's content); local has the plan edit → auto-merge → strip should show "~1 modified". | ✅ fixed — both "Pull first" and "Skip" now surface local edits identically. |
| D.4 | D.3.                                                                                                      | Click **Skip — I'll push my local first** instead of "Pull first" on D.2's banner. | Strip should show "~1 modified" because the local edit hasn't been pulled-against-merged.                                                                        | ✅ correct                                                                   |

### E. Conflict resolution (mine / theirs)

| #   | Setup                                                                     | Action                                           | Expected                                                                                   | Current    |
| --- | ------------------------------------------------------------------------- | ------------------------------------------------ | ------------------------------------------------------------------------------------------ | ---------- |
| E.1 | Local renames request R1 to "Mine". Remote also renames R1 — to "Theirs". | Refresh. Conflict resolver opens with R1 listed. | Resolver shows mine="Mine", theirs="Theirs".                                               | ✅ correct |
| E.2 | E.1, pick **theirs**, click Apply.                                        | After merge, view strip.                         | Strip empty. R1 now reads "Theirs" everywhere. (Synced matches remote → nothing unpushed.) | ✅ correct |
| E.3 | E.1, pick **mine**, click Apply.                                          | After merge, view strip.                         | "~1 modified" — your "Mine" name is unpushed, the remote still has "Theirs".               | ✅ fixed   |
| E.4 | E.3.                                                                      | Click Push.                                      | Push lands "Mine" on remote; strip flips to empty.                                         | ✅ correct |

### F. Previously silent entity types (fixed)

All 7 fields are now tracked. Push still works, plus the strip correctly
shows the row.

| #   | Field                             | Setup                                   | Action                                                                                             | Expected                                                                           | Current  |
| --- | --------------------------------- | --------------------------------------- | -------------------------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------- | -------- |
| F.1 | `secretKeys`                      | Clean state, working branch pushed.     | Open Secret Vault, add a new slot label (e.g. `DB_TOKEN` → "Database token").                      | "+1 added" with row label "Database token".                                        | ✅ fixed |
| F.2 | `globalAssets.schemas`            | Clean state, pushed.                    | Open Global Assets, create a new JSON schema.                                                      | "+1 added" with row label = schema name.                                           | ✅ fixed |
| F.3 | `globalAssets.graphql`            | Clean state, pushed.                    | Open Global Assets → GraphQL tab, add a GraphQL doc.                                               | "+1 added" with row label = doc name.                                              | ✅ fixed |
| F.4 | `linkedOverrides.requests`        | Linked workspace exists.                | Edit one of the linked workspace's requests (e.g. override its URL).                               | "+1 added" or "~1 modified" with row label `linked request override (lw:r)`.       | ✅ fixed |
| F.5 | `linkedOverrides.environmentVars` | Linked workspace exists with env vars.  | Override one of the linked workspace's env var values.                                             | "+1 added" or "~1 modified" with row label `linked env var override (lw:env:KEY)`. | ✅ fixed |
| F.6 | `releases.perLink`                | Linked workspace exists.                | Click "Refresh ledger" on a link card; cached ledger updates from the source's published versions. | "~1 modified" with row label `linked release ledger (lw)`.                         | ✅ fixed |
| F.7 | `secretCrypto`                    | Clean state, pushed, no passphrase set. | Open Secret Vault, set a workspace passphrase.                                                     | "+1 added" with row label "Workspace passphrase".                                  | ✅ fixed |

### G. Edge cases

| #   | Setup                                                                           | Action                        | Expected                                                                                                                                                                                                                                                                    | Current                                   |
| --- | ------------------------------------------------------------------------------- | ----------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------- |
| G.1 | After a push, then a force-push from another machine that rewrote history.      | Click Refresh.                | Detected as `history-rewritten` → resolver opens with `historyRewritten: true` flag.                                                                                                                                                                                        | ✅ correct                                |
| G.2 | After PR merge to main, branch deletion detected on next refresh.               | Strip on retired-branch card. | Card is hidden (no working branch); banner reads "branch was merged/deleted".                                                                                                                                                                                               | ✅ correct                                |
| G.3 | Disconnect repo while there are unpushed changes.                               | Click Disconnect.             | Working branch cleared; strip hidden until a new branch is created.                                                                                                                                                                                                         | ✅ correct                                |
| G.4 | Two pulls in a row with no local edits in between.                              | Pull, then Pull again.        | Second pull is `up-to-date`, snapshot stays in sync.                                                                                                                                                                                                                        | ✅ correct                                |
| G.5 | Edit something AFTER pushing, then click Refresh (no remote change in between). | Refresh.                      | `up-to-date` path runs (remote == lastPulledSnapshot, local has divergence is local-only — but the diff engine returns 0 entries when local==remote because base==local? actually the diff is computed against `lastPulledSnapshot`). Verify whether strip is correct here. | ⚠️ ambiguous — re-verify when fixing bugs |

---

---

## Walkthrough script (one sitting, ~15 min)

Use this to repro the bug-zone live in the preview browser:

1. **Reset.** DevTools → Application → IndexedDB → delete `apicircle-workspace`. Reload.
2. **Connect.** Open Secret Vault → Sessions → paste a PAT with `repo` + `pull_request`.
3. **Repo.** Workspace panel → Connect a repo (pick any clean test repo, or use a fresh one).
4. **Seed.** If the repo is empty, click "Seed initial commit". Otherwise skip.
5. **Branch.** Click "Create working branch". Strip should read **"+1 added"** (the seeded sample request).
6. **Push.** Click Push. Strip should read **"No unpushed changes"**.
7. **Edit plan.** Open Execution panel → "+ New plan" → name it "Smoke", add the sample request as the only step. Strip should read **"+1 added"**.
8. **Push.** Strip empty.
9. **Edit again.** Rename the plan "Smoke" → "Smoke v2". Strip should read **"~1 modified"**.
10. **Refresh.** Click Refresh on the working-branch card.
    - **Expected (and now actual):** Strip stays at **"~1 modified"** because your rename isn't on the remote yet.
11. **Push.** Strip flips to empty after the push lands. Refresh again — still empty (correct).

Repeat steps 9–11 with `secretKeys`, `globalAssets.schemas`, `globalAssets.graphql`,
or any linked-workspace override path — each mutation now correctly surfaces as a
row in the strip.
