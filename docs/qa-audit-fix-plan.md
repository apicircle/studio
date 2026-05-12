# Fix Plan — QA Audit 2026-05-12

**Companion to:** [`docs/qa-audit-2026-05-12.md`](./qa-audit-2026-05-12.md)
**Status:** Draft — awaiting approval before execution.
**Pre-launch freedom note:** No installed users, so where the data shape is wrong (e.g. orphan-override cascade, push state machine) we reshape rather than bolt on guards. No migration shims.

---

## Operating principles

1. **One PR per phase**, not per finding. Reviewers see a coherent diff with intent.
2. **Tests in the same PR as the fix.** Every behaviour change extends the closest existing test file; no follow-up "tests TBD" PRs.
3. **Green pipeline gate.** Each PR must keep `pnpm check` + `pnpm test` (currently 1911 tests, 192 files, 98 s) at 100% pass and add tests for the new behaviour.
4. **Reusable primitives over per-call-site logic.** When a finding repeats (e.g. missing `ConfirmDialog`), build/wire the reusable component once.
5. **Plan-mode for two items only** — P0-1 (push-rollback semantics) and P0-3 (refresh ancestry model) need an explicit design call before code; everything else is mechanical or copy/UX.

---

## Phase 0 — Same-day quick wins (≤ 1 day)

Mechanical fixes a single engineer can land in one sitting. Listed first because they unblock the green pipeline and remove the most embarrassing surface gaps.

| #   | Finding                                       | Change                                                                                                                  | Files                                                                                            | Tests                                                                   |
| --- | --------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------- |
| Q-1 | **P0-5** e2e-mock TS error                    | Cast `code` to `ContentfulStatusCode`; same for `:14` 400 case                                                          | `apps/e2e-mock/src/routes/status.ts:14,20`                                                       | Existing route tests; re-run `pnpm check`                               |
| Q-2 | **P1-21** "PR already open" missing URL       | Concatenate `branch.openPrUrl` into the thrown message; UI parses it into an "Open PR" button                           | `packages/ui-components/src/store/workspaceStore.ts:4724`, `panels/workspace/WorkspacePanel.tsx` | Extend `createPullRequest.test.ts`                                      |
| Q-3 | **P1-23** Publish-modal notes wiped on cancel | Move `setNotes('')` from `reset()` into the post-success branch                                                         | `panels/workspace/WorkspacePanel.tsx:275-420`                                                    | New test in `WorkspacePanel.test.tsx`                                   |
| Q-4 | **P2** Mock CORS defaults inconsistent        | Change MCP tool default to `{ enabled: false, origins: [] }`; assert both UI + MCP paths produce identical mock objects | `packages/mcp-server/src/tools/mocks.ts:27`, `packages/shared/src/mock.ts`                       | Extend `mock.test.ts`                                                   |
| Q-5 | **P1-8** Empty URL not a Send blocker         | Add `url.trim().length === 0` to the `sendBlocked` memo                                                                 | `panels/editor/PreSendPanel.tsx`                                                                 | `PreSendPanel.test.tsx`                                                 |
| Q-6 | **P3** Branch-name placeholder                | `placeholder="apicircle/feature-…"`                                                                                     | `panels/workspace/WorkspacePanel.tsx:1823-1824`                                                  | Snapshot test if one exists; otherwise none                             |
| Q-7 | **P0-4** Timeout error opacity                | Add `TimeoutError` subclass in `packages/git/src/github/api.ts` + classify; UI maps it to retry-able copy               | `packages/git/src/github/api.ts`, `panels/workspace/WorkspacePanel.tsx:1136-1144`                | New unit test in `git/test/api.test.ts` (or wherever errors are tested) |
| Q-8 | **P2** Rate-limit timestamp unreadable        | Format `resetAtMs` as `formatDistanceToNow` in the UI handler, not the error class                                      | `panels/workspace/WorkspacePanel.tsx`                                                            | UI snapshot/unit                                                        |

**Verification gate:** `pnpm check && pnpm test` green; manual sniff that Push + PR + rate-limit error paths still render correctly.

---

## Phase 1 — P0 ship blockers (1 sprint, ~3-5 days)

These need design choices written down first. **Open a plan-mode discussion** on each before coding.

### P1-A. Push rollback + ancestry pre-flight (covers P0-1, P0-2)

**Problem.** `pushWorkspace` performs 6 API calls with no orchestration guard and no remote-state pre-flight. Two failure modes:

- Network drop after `createCommit` but before `updateRef` → orphan commit on remote.
- Force-pushed remote → blob/tree/commit all upload "successfully" then `updateRef` 422s, leaving orphans.

**Approach.**

1. Add `client.getRef(token, owner, name, branch.name)` as **step 0**. Compare `remote.sha` to `branch.headSha`. On mismatch, throw a new `BranchDivergedError(remoteSha, localSha)`; UI catches it and surfaces the existing Refresh modal with copy _"Remote moved since your last sync — refresh first."_
2. Wrap steps 1-6 in a single `try/catch`. On catch, leave local store untouched (already the case) and surface a discriminated `PushFailureReason` (`'network' | 'auth' | 'diverged' | 'unknown'`).
3. Track the "uncommitted-but-orphan-on-remote" condition separately: if `createCommit` succeeded but `updateRef` did not, store the orphan SHA in `local.workingBranch.staleOrphanShas` and offer a `recoverOrphanRef()` action that calls `updateRef` again. (Pre-launch freedom: this is a new field, not a migration.)
4. UI surface: replace the generic "GitHub API call failed" with a typed banner pointing at the next action.

**Files.**

- `packages/ui-components/src/store/workspaceStore.ts:3471-3556` — rewrite `pushWorkspace`
- `packages/git/src/github/api.ts` — add `BranchDivergedError`, `PushFailureReason` union
- `packages/shared/src/types.ts` — extend `WorkingBranch` with optional `staleOrphanShas: string[]`
- `panels/workspace/WorkspacePanel.tsx:1136-1175` — typed error rendering, "Recover orphan" CTA

**Tests.**

- `pushWorkspace.test.ts` — add cases for diverged-remote pre-flight, mid-flight network failure with orphan recovery, repeated push after recovery.

**Effort.** 1-1.5 days incl. tests.

---

### P1-B. Refresh ancestry / force-push protection (P0-3)

**Problem.** `refreshWorkspace` builds a 3-way diff against `lastPulledSnapshot` regardless of whether the remote SHA is a descendant of `lastPulledSha`. If the remote was force-pushed to unrelated history, `applyMerge` can silently mix two divergent realities.

**Approach.** Insert a merge-base check between snapshot fetch (currently lines 4640-4650) and diff (line 4653):

```ts
const isDescendant = await client.isAncestor(
  token,
  owner,
  name,
  /* ancestor */ local.sync.lastPulledSha,
  /* descendant */ file.sha,
);
if (!isDescendant) {
  set({ pendingRefresh: { kind: 'rewritten-history', remote, remoteSha: file.sha } });
  return { status: 'history-rewritten', remote, remoteSha: file.sha };
}
```

Add a new pendingRefresh kind discriminator; render a dedicated modal that:

- Shows the diff against the _snapshot_ (what user thinks of as "their state") so it's auditable
- Forces explicit "Adopt remote / Keep local / Cancel" — no auto-merge
- Captures pre-merge snapshot regardless

`client.isAncestor` doesn't exist yet — add it as a thin wrapper around GitHub's `GET /repos/:o/:r/compare/:base...:head` (status `"behind"` or `"identical"` means base is ancestor of head). Cap at 250 commits to bound cost; if the comparison is `"diverged"`, treat as history-rewritten.

**Files.**

- `packages/git/src/github/api.ts` — add `compareCommits` + `isAncestor`
- `packages/ui-components/src/store/workspaceStore.ts:4640-4687`
- `packages/shared/src/types.ts` — extend `PendingRefresh` discriminated union
- New `panels/workspace/HistoryRewrittenModal.tsx`
- `refreshWorkspace.test.ts` — add force-push case + new modal contract

**Effort.** 1-1.5 days. The GitHub API call is one wrapper; the rest is UI + state machine.

---

### P1-C. Unify "destructive action" UX with one reusable confirm + a toast queue (covers P1-5, P2 confirms in Headers/Env/Context, P2 release-yank undo)

**Problem.** Some destructive actions (Withdraw, Yank, Delete branch) have typed-confirm dialogs; others (Clear token, delete header, delete env var, delete context var) silently destroy. Toasts on success don't auto-dismiss anywhere.

**Approach.**

1. Audit current `ConfirmDialog` usage; promote to `packages/ui-components/src/primitives/ConfirmDialog.tsx` if not already global.
2. Wire it at every destructive action site found in the audit — single PR with a checklist:
   - OAuth2 Clear token
   - Header row delete
   - Env var delete
   - Context var delete
   - Linked override reset
3. Add a new `Toast` primitive with auto-dismiss + optional Undo button slot. Wire post-push, post-publish, post-yank, post-merge success messages through it.
4. The yank Undo is a no-op wrapper around the existing `yankRelease(version)` toggle.

**Files.**

- `packages/ui-components/src/primitives/ConfirmDialog.tsx` (verify export path)
- New `packages/ui-components/src/primitives/Toast.tsx` + ToastProvider
- All editor panels (a checklist will be embedded in the PR description)

**Tests.**

- `ConfirmDialog.test.tsx` — already exists, extend coverage
- New `Toast.test.tsx`
- Each newly-wired call site: one test asserting the confirm gates the delete.

**Effort.** 1 day for the primitive + 0.5 day to wire every call site.

---

### P1-D. e2e-mock TS error (P0-5)

Already covered as Q-1 in Phase 0 because it is a single-character fix. Listed here too because it blocks `pnpm check`.

---

## Phase 2 — P1 high-impact (1-2 sprints)

Grouped by theme so each theme is its own PR.

### Theme 2.1 — Auth UI hardening

| #     | Finding | Change                                                         | Files                                                                                                       |
| ----- | ------- | -------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------- |
| 2.1.1 | P1-1    | Auto-reset `OAuth2FlowActions` state to `idle` 5 s after error | `panels/editor/OAuth2FlowActions.tsx`                                                                       |
| 2.1.2 | P1-2    | Basic-auth password → `SecretInput`                            | `panels/editor/auth/BasicAuthEditor.tsx`                                                                    |
| 2.1.3 | P1-3    | Validate `Custom Header` name as RFC 7230 token                | `panels/editor/auth/CustomHeaderEditor.tsx`, `packages/shared/src/validators.ts` (add `validateHeaderName`) |
| 2.1.4 | P1-4    | Wire `validateAwsRegion` into AWS SigV4 region field           | `panels/editor/auth/AwsSigV4Editor.tsx`                                                                     |
| 2.1.5 | P1-6    | OAuth2 IPC `timeoutMs` lower bound                             | `apps/desktop/src/main/main.ts:70-99`                                                                       |
| 2.1.6 | P1-24   | Detect `UnauthorizedError` and offer "Reconnect" CTA           | `panels/workspace/WorkspacePanel.tsx:1136-1144`                                                             |

**Tests.** Extend the existing per-auth-editor tests in `packages/ui-components/test/`; add IPC contract test for `oauth2:startFlow` in `apps/desktop/test/main.test.ts`.

**Effort.** 1 day.

---

### Theme 2.2 — Request editor polish

| #     | Finding | Change                                                | Files                                                                              |
| ----- | ------- | ----------------------------------------------------- | ---------------------------------------------------------------------------------- |
| 2.2.1 | P1-7    | `sendBlocked` recompute on response completion        | `panels/editor/RequestEditor.tsx`                                                  |
| 2.2.2 | P1-9    | Remove roving tabindex from outer request-editor tabs | `panels/editor/RequestEditor.tsx`, `panels/editor/RequestEditor.test.tsx`          |
| 2.2.3 | P1-10   | Body-type radio group: arrow-key nav                  | `panels/editor/BodyTab.tsx`                                                        |
| 2.2.4 | P1-11   | Hard-block >100 MB attachments                        | `panels/editor/body/FormDataEditor.tsx`, `panels/editor/body/BinaryBodyEditor.tsx` |

**Effort.** 0.5 day.

---

### Theme 2.3 — Mock server hardening

| #     | Finding | Change                                                                                                        | Files                                                                                  |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------- |
| 2.3.1 | P1-12   | Parse spec synchronously in `CreateMockServerModal`, surface warnings                                         | `panels/mocks/CreateMockServerModal.tsx`, `packages/mock-server-core/src/parsers/*.ts` |
| 2.3.2 | P1-13   | Render `warnings[]` everywhere parsers are invoked (UI + MCP)                                                 | `panels/mocks/MockServerEditor.tsx`, `packages/mcp-server/src/tools/mocks.ts`          |
| 2.3.3 | P1-14   | Move `(method, path)` uniqueness check into `mockActions.updateMockEndpoint` and `mock.add_endpoint` MCP tool | `store/mockActions.ts`, `packages/mcp-server/src/tools/mocks.ts`                       |
| 2.3.4 | P1-15   | Track 3 consecutive `bridge.list()` failures → "Desktop bridge disconnected" banner                           | `panels/mocks/MockServersPanel.tsx:64-85`                                              |

**Tests.** Add a test for each parser warning surface and one for the bridge-disconnect detection in `MockServersPanel.test.tsx`.

**Effort.** 1.5 days.

---

### Theme 2.4 — MCP error contract

| #     | Finding | Change                                                                                                        | Files                                                                   |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------- |
| 2.4.1 | P1-16   | Standardise all MCP tool responses to `{ ok: boolean; error?: string; data?: T }`; reserve throws for crashes | `packages/mcp-server/src/tools/*.ts`                                    |
| 2.4.2 | P1-17   | Validate `resolvePaths().workspace` exists; generate `MCP_TOOL_NAMES` from registry at startup                | `apps/desktop/src/main/mcp/mcpManager.ts`, `packages/shared/src/mcp.ts` |

**Tests.** Extend `packages/mcp-server/test/tools/*.test.ts` to assert the response shape contract; add a test that catalog length equals registered tool count.

**Effort.** 0.5 day.

---

### Theme 2.5 — Linked-workspace orphan hygiene

| #     | Finding | Change                                                                                                        | Files                                                                                           |
| ----- | ------- | ------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------- |
| 2.5.1 | P1-18   | Add scope-clarification banner to `LinkedRequestEditor`                                                       | `panels/link-workspace/LinkedRequestEditor.tsx`                                                 |
| 2.5.2 | P1-19   | After applying a linked update, prune `linkedOverrides.{requests,folders,envs}` whose source no longer exists | `store/linkedWorkspaces.ts` (apply-update path), `panels/link-workspace/UpdatePreviewModal.tsx` |
| 2.5.3 | P1-20   | Inline "Refresh link" button next to "not in snapshot" warnings                                               | `panels/execution/PlanStepEditor.tsx` (and any other consumers)                                 |

**Pre-launch freedom call:** if the `linkedOverrides` shape itself is awkward (separate maps per entity type, easy to forget when pruning), consider collapsing it into a single `Map<{ kind, sourceId }, OverridePatch>`. Decide in plan-mode before coding.

**Tests.** Extend `linkedLifecycle.test.ts` and `linkedRequestOverride.test.ts` for the cascade.

**Effort.** 1 day.

---

### Theme 2.6 — Release UX

| #     | Finding | Change                                                             | Files                                                 |
| ----- | ------- | ------------------------------------------------------------------ | ----------------------------------------------------- |
| 2.6.1 | P1-22   | Re-probe branch state every refresh; un-retire if PR was re-opened | `store/branchRetirement.ts`                           |
| 2.6.2 | P2      | Tag-override inline-retry UI instead of toggle-then-retry          | `panels/workspace/ReleaseAndTopicsModal.tsx:95-102`   |
| 2.6.3 | P2      | Show "v1.0.0: abc → def" diff in successful override tag           | `store/tagReleaseVersion.ts` (already tested) + modal |

**Effort.** 0.5 day.

---

### Theme 2.7 — Auto-update wiring (P1-25)

**Problem.** `electron-builder.yml` has no `publish:` block; `main.ts` never imports `electron-updater`. Every installed copy is frozen at install time.

**Approach.**

1. Add to `electron-builder.yml`:
   ```yaml
   publish:
     provider: github
     owner: <org>
     repo: studio
   artifactName: ${productName}-${version}-${os}-${arch}.${ext}
   ```
2. Add `electron-updater` dependency; wire in `apps/desktop/src/main/main.ts`:
   ```ts
   import { autoUpdater } from 'electron-updater';
   autoUpdater.on('update-downloaded', (info) => {
     mainWindow?.webContents.send('apicircle:update:available', { version: info.version });
   });
   app.whenReady().then(() => autoUpdater.checkForUpdatesAndNotify());
   ```
3. Renderer: subscribe via preload bridge, show a `UpdateAvailableBanner` with "Restart to update" CTA.
4. CI: ensure `pnpm release:installers` uploads artifacts to GitHub Releases on tag push.
5. Document the manual fallback (download the new installer) in the banner copy for now.

**Files.**

- `apps/desktop/package.json` — add `electron-updater` dep
- `apps/desktop/electron-builder.yml`
- `apps/desktop/src/main/main.ts` — wire updater + IPC channel
- `apps/desktop/src/main/preload.ts` — expose `onUpdateAvailable`
- New `packages/ui-components/src/primitives/UpdateAvailableBanner.tsx`
- `apps/desktop/scripts/build-smoke.mjs` — assert updater wiring present
- New CI workflow step or `scripts/release/buildDesktopInstallers.mjs` extension

**Tests.** Hard to unit-test the autoUpdater itself; assert the IPC contract + renderer banner render. Manual QA: cut a `v0.1.1-rc.1` tag, install `v0.1.0`, confirm update flows.

**Effort.** 1 day code + manual verification day.

---

### Theme 2.8 — Cross-platform key custody clarity (P1-26)

**Problem.** OS-keychain-wrapped master key is device-local; users cloning a workspace expect secrets to roam, but cannot decrypt them on a different machine or in web.

**Approach.** Documentation + UX only for this phase (a real solution is Phase 4 in the v1 plan — team-shared passphrase model).

1. Add an explicit "🔒 Keys are device-local" panel to the Secrets vault landing.
2. In onboarding, surface the same notice when the user first creates a secret.
3. When a user imports a workspace whose secrets were created on another device, display a "These secrets were encrypted on another device — re-import or rotate" notice in the affected env panels.

**Files.**

- `packages/ui-components/src/onboarding/SecretsKeyNotice.tsx`
- `packages/ui-components/src/panels/env/EnvironmentsPanel.tsx`

**Effort.** 0.5 day. Defer the architectural fix.

---

## Phase 3 — P2 hardening (1 sprint)

Grouped by theme; each is one PR.

### Theme 3.1 — Validation wiring pass

Single sweep that wires `shared/validators.ts` helpers everywhere they're bypassed today. The audit identified these fields as currently lenient:

- Plan name length cap (≤80 chars)
- Negative timeouts in request + plan
- Duplicate env names, header names, context var names — warn or block
- Assertion `matches` regex must compile at edit time
- Multiplier `min ≤ max`
- Validation-rule regex / JSON-Path compile-time check
- CORS: reject empty-origins-with-enabled state

**Approach.** Audit `validateEnvVarName`, `validateAwsRegion`, etc., in `packages/shared/src/validators.ts`. Add the missing ones (`validateHeaderName`, `validateRegex`, `validateJsonPath`, `validatePositiveDuration`, `validatePortNumber`). Then a single sweep PR wires them into every input that needs them; ESLint rule (optional) to flag raw `<Input type="number" />` without a validator.

**Tests.** Extend `validators.test.ts`; each newly-validated form gets at least one negative-input test.

**Effort.** 1-1.5 days. Mechanical but wide.

---

### Theme 3.2 — Empty/loading/error state pass

Audit-driven sweep. Build/verify two reusable primitives first, then wire:

- `EmptyState` primitive — title, description, optional CTA
- `ErrorBanner` primitive (typed errors, action slot)

**Call sites to update** (full list in the audit; highlights):

- Response viewer empty body → render `EmptyState` instead of `"(empty body)"` Monaco string
- MCP panel on web → "(desktop required)" `EmptyState`
- Attachment sync failed-blob list → `ErrorBanner` with retry
- Conflict-resolver: sort/group by bucket
- Push success → `Toast` (covered in P1-C)
- "Up to date with the remote" wording when local has unsaved edits

**Effort.** 1-1.5 days.

---

### Theme 3.3 — Copy & a11y consistency pass

Single designer-led review:

- Standardise "Add row" / "Add header" / "Add step" verbiage — pick one pattern.
- "Withdraw" vs "Yank" — pick one.
- "Pull first" banner button styling — primary/secondary swap.
- Rate-limit timestamp humanised (covered in Q-8).
- `placeholder` on the create-branch input (Q-6).
- `aria-label` "row N" vs direct naming — standardise.
- Method dropdown raw `rgb(var(--x))` colours.

**Effort.** 0.5 day for the review + 0.5 day to apply changes.

---

### Theme 3.4 — Race / lifecycle hardening

- Mock port-collision pre-flight check removed (`MockServersPanel.tsx:94-106`) — rely on runtime rejection.
- `portFinder.getFreePort` race — accept as documented limitation for v1 desktop; add a comment + test that 2 quick calls don't both return the same port in CI sometimes (best-effort).
- `process.on('uncaughtException')` handler in `apps/desktop/src/main/main.ts`.

**Effort.** 0.5 day.

---

### Theme 3.5 — Window state persistence

Save window bounds to `userData/window.json` on close; restore on launch. Single small PR.

**Files.** `apps/desktop/src/main/main.ts:26-41`, new `apps/desktop/src/main/windowState.ts`.

**Tests.** Integration test that creates a stub `userData` dir, writes bounds, asserts restore.

**Effort.** 0.5 day.

---

## Phase 4 — P3 polish (deferred backlog)

These are not blockers and should be batched into the next "polish" sprint. Not enumerated here — see audit §5. Examples:

- Keyboard shortcut for Push/Refresh
- Copy-version-string button on release rows
- Commit-message placeholder shortening
- "running" vs "Running" casing
- Tooltips on `RightDockRail` keyboard hints

---

## Cross-cutting deliverables

1. **`ConfirmDialog` audit** — list of every `onClick` that mutates or deletes; verify each is wrapped. Put the list in the P1-C PR description as a checklist.
2. **`Toast` provider** — new primitive in P1-C; replaces the dozen static success messages found in the audit.
3. **`shared/validators.ts` audit** — add missing validators (Theme 3.1) and lint-rule any form input that bypasses them.
4. **MCP error-contract test** — one new test file that imports every tool and asserts its response shape conforms to `{ ok, error?, data? }`.
5. **MEMORY.md updates** — already corrected the 1338→1911 count. Add an entry once the push/refresh state machine is reshaped (so future sessions know the contract).

---

## Test strategy

- **Existing 1911-test suite** stays green at every PR boundary. Each fix extends the closest existing test file in the same package.
- **New behaviour** gets at least one positive + one negative test.
- **Type-level fixes** verified by `pnpm check` (must be green again after P0-5 lands).
- **Manual QA pass** at the end of Phase 1: walk the editors, mock create→start→hit, MCP config copy, push/pull/PR happy path, force-push protection (script the divergence using `gh`).
- **No new flaky tests.** If a test is flaky after a fix, root-cause before merge.

---

## Sequencing & timeline (single-engineer estimate)

| Phase                  | Duration   | Outcome                                                                                            |
| ---------------------- | ---------- | -------------------------------------------------------------------------------------------------- |
| Phase 0 (quick wins)   | Day 1      | Green pipeline; 8 small fixes shipped                                                              |
| Phase 1 (P0 blockers)  | Days 2-6   | All ship-blockers cleared; push/pull state machine reshaped; ConfirmDialog + Toast primitives live |
| Phase 2 (P1 themes)    | Days 7-12  | All 8 themes shipped; auto-update wired                                                            |
| Phase 3 (P2 hardening) | Days 13-17 | Validation + empty-states + copy passes done; race conditions tidied                               |
| Phase 4 (P3 polish)    | Backlog    | Next sprint                                                                                        |

**Total to GA-ready:** ~12 working days for one engineer, ~6-7 days with two engineers running themes in parallel.

---

## Risks & open questions

1. **P1-A staleOrphanShas field** — adds state to `WorkingBranch`. Is anyone else (CLI, mock-server-core) touching this type? Need to check before defining the discriminator. (Pre-launch freedom rule says we can reshape, but check first.)
2. **P1-B compareCommits** — GitHub API rate limit is 5000/hr for authenticated requests; refresh polls aren't free. Cap to one comparison per explicit refresh; do not poll.
3. **P1-19 linkedOverrides reshape** — if we collapse the three maps into one, every consumer needs touching. Worth it pre-launch, but scope it carefully.
4. **Auto-update repo identity** — `electron-builder.yml` needs the canonical `owner/repo` value. Confirm before wiring.
5. **Master-key roaming** — Phase 2.8 is documentation only; the actual team-shared-passphrase implementation is a multi-week piece (Phase 4 in the v1 plan). Confirm this is acceptable for v0.1 GA.

---

_Plan drafted 2026-05-12 against audit report of same date. Approve, then I will execute starting with Phase 0._
