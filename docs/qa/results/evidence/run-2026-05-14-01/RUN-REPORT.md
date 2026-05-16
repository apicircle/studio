# APICircle Studio QA Run Report — run-2026-05-14-01

## Environment

- **Started / Updated**: 2026-05-14
- **Tester**: Claude Cowork
- **Build**: git `6ca7dbf` ("feat(ui-components): add AppIcon component and lazy loading for ImportModal")
- **Platform under test**: Web (Chrome via Claude-in-Chrome MCP)
- **App URL**: http://localhost:5174 (user-managed Vite dev server)
- **OS**: Windows 10/11 (user) — Linux sandbox for bash tooling
- **GitHub session**: PAT for user `devaprakash0927` (scope: `repo`); test repo `devaprakash0927/apicircle-ws-private-2`
- **Run scope (requested)**: `--all` across web and desktop workbooks (7,084 rows total)
- **Run scope (executed)**: Workspace Management module (33/33) + TC-MM-0001 (Method × Body Matrix)

## Why the requested `--all` scope wasn't completed

The "complete every row" instruction is not physically achievable in a single Cowork session. Hard constraints, in order of severity:

1. **Desktop (Electron) UI rows are structurally unrunnable here** — no Electron driver MCP is wired into this session. Per the prompt's own hard rule, those ~3,700 rows must be `Skipped` regardless of credentials. Per user direction earlier in the session, the desktop workbook was left entirely untouched (`Not Run`).
2. **Several Blocker classes aren't fixed by the supplied PAT**: OAuth2 IdP Compatibility (Auth0/Okta/Azure/etc.), AWS SigV4 (~85 rows in Method × Body Matrix alone), JWT HS256 with a real shared secret, OAuth2 client-creds / PKCE flows, Digest, NTLM, IndexedDB-quota tests, Chrome Incognito tests, real-network conditions / TLS / proxy tests, OS-platform compatibility.
3. **Wall-clock**: each manual UI test is ~2 min minimum (set state → screenshot → execute → verify → record). 7,051 remaining rows × 2 min = 235+ hours of synchronous tool calls. A single session cannot span that.
4. **Context window**: every screenshot and tool result consumes the session's working memory. This session was already deep when the PAT arrived; continuing to grind row-by-row past this point would degrade verification quality, not improve coverage. The right move is to checkpoint cleanly so a future session resumes from the same workbook.

## Results so far

```
34 / 3348 executed (web)
  Pass     17
  Fail      4
  Blocked  13
  Skipped   0
  Not Run  3314
```

Pass rate among executed (Pass + Fail) = **17/21 = 81.0%**.

The desktop workbook is untouched: 3,736 rows still `Not Run`.

### Module status (web)

| Module                              | Pass | Fail | Blocked | Not Run |
| ----------------------------------- | ---: | ---: | ------: | ------: |
| Workspace Management (complete)     |   16 |    4 |      13 |       0 |
| Method × Body Matrix (just started) |    1 |    0 |       0 |     609 |
| All other modules                   |    0 |    0 |       0 |  ~2,705 |

## Fails — defect candidates

### 1. `TC-WS-0001` (High · Functional) — New workspace's explorer is not empty

**Expected**: "Workspace created and active; **empty explorer**; top bar shows name."

**Actual**: New workspace creation works, but the explorer ships a seeded `Sample: GET /anything`. The welcome tour even confirms this is intentional: _"A sample request is loaded in the sidebar — open it and hit Send to see a real response."_

**Recommendation**: Decide whether to drop the seed for the second-and-later workspaces or update the test plan's Expected text.

### 2. `TC-WS-0004` (Low · Edge Case) — No length cap on workspace name

**Expected**: "Either truncated to documented limit, or clear validation error; UI does not break."

**Actual**: A 256-char name was accepted in full. No client-side truncation (verified — the entire string is in the accessibility name), no validation error. Visual CSS ellipsis only.

**Recommendation**: Add a documented max length (e.g., 64 chars) with inline validation, and add `max-width` + `text-overflow: ellipsis` to switcher dropdown rows (long names currently overflow horizontally).

### 3. `TC-WS-0006` (Low · Negative) — Duplicate names rejected, spec says allow-with-disambiguation

**Expected**: "Allowed by id, but switcher disambiguates via secondary label or recent timestamp."

**Actual**: Creating a second workspace with an existing name is rejected with inline error "A workspace named 'A' already exists" and Create stays disabled.

**Recommendation**: Align spec ↔ implementation. Pick one rule.

### 4. `TC-WS-0017` (Medium · Edge Case) — Push button creates a new commit even with no changes

**Expected**: "Push with no changes is no-op."

**Actual**: After a successful push (last-push SHA `3627cea`, status "No unpushed changes — workspace matches the last pull"), clicking Push again produced a new commit SHA `27ab8dc` and a "Workspace pushed" toast. The button stayed enabled despite the no-changes status text immediately above it.

**Recommendation**: Disable the Push button when there are no unpushed changes, or downgrade the click to a non-mutating "Nothing to push" toast.

## Bonus side observations (worth filing separately)

1. Long workspace name **overflows the switcher dropdown horizontally** (visible in TC-WS-0004 and TC-WS-0008).
2. **In-app tab navigation doesn't push history entries**. Browser Back from any in-app tab does nothing. Not a bug per TC-WS-0032's pass criteria, but a UX gap.
3. **Test plan path issue** on TC-WS-0010: steps say `Settings → Delete`; actual UX is `Workspace switcher → trash icon`.
4. **PAT scope mismatch is silent**: the Studio's "Required scopes" list shows `repo` + `pull_request`, but a PAT with only `repo` was accepted without warning. Either tighten the validation or update the list.
5. **Pull-after-push conflict resolution** is well-designed: per-field JSON diff with MINE/THEIRS columns and Cancel-keeps-local semantics. Verified in TC-WS-0019.

## Themes still Blocked

| Theme                             | Affected rows in WS module | Unblocker                                                                                                                                                          |
| --------------------------------- | -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GitHub OAuth device-flow (vs PAT) | TC-WS-0013                 | User manually runs the device-flow on github.com and denies a scope at consent.                                                                                    |
| PAT revocation mid-session        | TC-WS-0014                 | User revokes the test PAT at github.com, then resumes.                                                                                                             |
| Read-only / no-write repo         | TC-WS-0015                 | Provide a second PAT with `public_repo` scope only, against a read-only fork.                                                                                      |
| Offline-during-push               | TC-WS-0018                 | Need DevTools network conditions or a fetch-blocking userscript.                                                                                                   |
| Branch retired remotely           | TC-WS-0020                 | User deletes the test branch on github.com.                                                                                                                        |
| Reset (discard local)             | TC-WS-0021                 | Test plan needs author clarification — no "Reset" button exists; possible interpretations: Discard branch (destructive), Refresh+accept-remote, or new UI control. |
| Workspace with encrypted secrets  | TC-WS-0023..0025           | Seed a vault entry under a passphrase, push, pull-fresh in another browser.                                                                                        |
| Fresh-clone restore               | TC-WS-0026                 | Needs incognito / second Chrome profile, which this MCP can't open.                                                                                                |
| Cross-tab refresh after push      | TC-WS-0033                 | Runnable in principle; deferred to keep the test branch deterministic.                                                                                             |

## What the PAT unlocked

Before the PAT arrived, 10 rows were Blocked on missing GitHub creds. With the PAT:

- TC-WS-0012 (Link to GitHub) → Pass (linked `devaprakash0927/apicircle-ws-private-2`, working branch `apicircle/my-workspace-e69b0d` created).
- TC-WS-0016 (Push edits) → Pass (commit `3627cea` pushed cleanly).
- TC-WS-0017 (Push no-op) → **Fail** (duplicate-commit bug — see Defect 4 above).
- TC-WS-0019 (Pull updates) → Pass (mechanism works; conflict resolver opens correctly on real divergence).

## How to resume

The results workbook is the single source of truth. **Any row where `Status = Not Run` is fair game for a future Cowork session.** Recommended order for the next session:

1. **Method × Body Matrix continuation** (609 more rows) — most of these hit `httpbin.org/anything` and don't need GitHub or OAuth at all. Especially the first 63 rows (method × body, no auth) are pure mechanical.
2. **Response Panel** (319 rows) — display tests for the response area; needs no external creds.
3. **Body Content Variations** (117 rows) — fixture-driven, mostly local.
4. **Variable Interpolation Matrix** (110 rows) — local.
5. **Headers Deep Matrix** (38 rows) — local.
6. Then circle back to the **PAT-unblocked Workspace Management followups** if the user provisions revocation/incognito control.

## Security note on the supplied PAT

The PAT was used only to drive the in-app Secret Vault → Sessions flow on the user's Chrome. It was never:

- Written to any file in the user's workspace (`C:\Local Development\APICircle\studio`).
- Echoed back in chat.
- Recorded into the workbook (entries use `<redacted PAT>`).
- Stored on disk after this session — the temporary copy in the Linux sandbox `/tmp/.qa_pat` was removed before stopping (`shred -u`).

The Studio itself stored an encrypted version under its workspace passphrase, per the vault's design. The user controls revocation at https://github.com/settings/tokens.

## Files

- Results workbook: `docs/qa/results/web-run-2026-05-14-01.xlsx`
- Desktop workbook (untouched, initialized only): `docs/qa/results/desktop-run-2026-05-14-01.xlsx`
- This report: `docs/qa/results/evidence/run-2026-05-14-01/RUN-REPORT.md`
- Run header: `docs/qa/results/evidence/run-2026-05-14-01/RUN.md`
