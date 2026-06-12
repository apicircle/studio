# API Circle Studio — VS Code Extension

> **Status: 1.1.0 — first public release** (lockstep with the rest of the monorepo).

This is the user + developer guide to the VS Code extension that lives at
[`apps/vscode/`](../apps/vscode/). It complements the [Desktop App](../README.md)
and the [Web App](../apps/web/README.md) as a third peer client of the same
canonical `.apicircle/workspace.json`.

---

## 1. The three-surface principle

The Web App, Desktop App, and VS Code extension are **peer clients of the same
Git-backed canonical format**. The file lives at:

```
<your-repo>/.apicircle/workspace.json
```

Edit in any surface → commit → push → pull elsewhere → continue. No
translation, no dialect, no fork. The four-tier test discipline (unit ·
integration · E2E · **three-surface compatibility**) guarantees byte-identical
output across surfaces for the same logical mutation.

Device-local data (history, secrets, sessions, mock runtime state) stays
per-machine in each surface's managed storage:

| Surface           | Local storage path                                             |
| ----------------- | -------------------------------------------------------------- |
| Web App           | Browser IndexedDB                                              |
| Desktop App       | `<userData>/workspaces/<workspaceId>/workspace.local.json`     |
| VS Code extension | `<vscode.globalStorageUri>/<workspaceId>/workspace.local.json` |

The VS Code local path is **not user-configurable** (locked decision) — the
deterministic `globalStorageUri` location keeps cross-machine isolation
automatic and matches typical VS Code extension conventions.

---

## 2. First-run flow

The extension activates when:

- VS Code opens a folder that contains `.apicircle/workspace.json`
  (`workspaceContains:**/.apicircle/workspace.json`), OR
- The user clicks the **APICircle** icon in the Activity Bar
  (`onView:apicircle.editor`), OR
- The user runs `APICircle: Create New Workspace` (`onCommand`).

If a canonical `.apicircle/workspace.json` exists in any open folder, the
extension auto-registers it with the bridge and restores the previously-active
workspace from `globalState`. Otherwise the Editor view renders a
`viewsWelcome` card pointing at:

- **Create New Workspace** — scaffolds a fresh `.apicircle/workspace.json` +
  `attachments/` folder + `README.md`, and appends defensive entries to the
  repo's `.gitignore` (`workspace.local.json`, `.apicircle/.local/`,
  `.apicircle/.lock`).
- **Open Folder…** — invokes VS Code's native folder picker.

The Editor view's `viewsWelcome` is gated by the
`apicircle.hasActiveWorkspace` context key, which the extension sets
every time `discoverWorkspaces` runs (activate, refresh, the
`.apicircle/workspace.json` file watcher, and
`onDidChangeWorkspaceFolders`):

- **When false** (no workspace registered) — the no-workspace card with
  the **Create New Workspace** / **Open Folder…** actions.
- **When true** (workspace registered, tree may still be empty) — a
  workspace-present card with an **Open `workspace.json`** link and a
  **New Request** action. Stops users with an empty-but-detected
  workspace from thinking the extension didn't recognise their
  `.apicircle/` folder.

The Editor view's title bar exposes two icon actions:
**$(add) New Request** (left, `apicircle.newRequest`, `ctrl+n` when the
view is focused) and **$(refresh) Refresh** (right, `apicircle.refresh`,
`ctrl+shift+r`). Refresh re-runs `discoverWorkspaces` first, so a
`.apicircle/workspace.json` created after activation (via the CLI, a
sibling `git pull`, or hand-mkdir) is picked up without a window reload.

---

## 3. Sidebar layout

The Activity Bar icon opens a view container with eight views:

| View                | Phase wired                 | Contents                                                                                                                                                                                                                                                                   |
| ------------------- | --------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Editor**          | Phase 1                     | Folder / request tree from `synced.collections.tree`.                                                                                                                                                                                                                      |
| **Environment**     | Phase 2                     | Environments + variables + active env marker.                                                                                                                                                                                                                              |
| **Execution**       | Phase 2                     | Plans + inline `▶ Run` actions.                                                                                                                                                                                                                                            |
| **Mock**            | Phase 3                     | Mock servers + endpoints + status decorations.                                                                                                                                                                                                                             |
| **History**         | Phase 2                     | Recent request and plan runs.                                                                                                                                                                                                                                              |
| **Snapshots**       | Phase 2                     | Workspace snapshot ledger + restore.                                                                                                                                                                                                                                       |
| **MCP**             | Phase 5                     | Per-AI-client config snippets pointing at the active workspace's `.apicircle/` dir (10 supported clients).                                                                                                                                                                 |
| **Link Workspaces** | Release lifecycle + linking | Two groups: **Releases** (publish / deprecate / withdraw + tag on GitHub + edit topics) and **Linked workspaces** (link a repo / marketplace result, pin / scope / session / required-keys config, review-update, refresh, unlink). Replaces the dormant Marketplace stub. |

Each view is independently collapsible. The Phase 1 day-1 PR ships every view
with an empty stub; subsequent phase commits wire them to live data.

---

## 4. Commands (Phase 1 day-1)

| Command                           | Status                       |
| --------------------------------- | ---------------------------- |
| `APICircle: Create New Workspace` | ✅ Implemented               |
| `APICircle: Open Workspace File`  | ✅ Implemented               |
| `APICircle: Refresh`              | ✅ Implemented               |
| `APICircle: New Request`          | 🚧 Placeholder — Phase 1 MVP |
| `APICircle: Send Request`         | 🚧 Placeholder — Phase 1 MVP |
| `APICircle: Cancel Active Send`   | 🚧 Placeholder — Phase 1 MVP |

---

## 5. Settings reference

All settings live under `apicircle.*` in VS Code's settings UI
(`Cmd+,` → search "APICircle"). The Phase 1 day-1 PR contributes the full
schema (twelve settings); the runtime behavior of most of them lands in
subsequent phases.

See [`apps/vscode/package.json`](../apps/vscode/package.json) `contributes.configuration`
for the canonical list.

---

## 6. Architecture

```
┌──────────────────────────────────────────────────────────────────┐
│  VS Code Window                                                  │
│                                                                  │
│  ┌─────────────────────┐    ┌─────────────────────────────────┐  │
│  │  Sidebar (native)   │    │  Editor area                    │  │
│  │  • Editor TreeView  │    │  • request.req.yaml             │  │
│  │  • Environment TV   │    │    (virtual document, Phase 1)  │  │
│  │  • Execution TV     │    │  • response.run.yaml            │  │
│  │  • Mock TV          │    │    (response viewer, Phase 1)   │  │
│  │  • History TV       │    │  • plan.apicircle-notebook      │  │
│  │  • MCP TV           │    │    (Notebook controller, Phase 2)│ │
│  └─────────────────────┘    └─────────────────────────────────┘  │
│                                                                  │
│  ┌─────────────────────────────────────────────────────────────┐ │
│  │  Extension Host (Node.js)                                   │ │
│  │  • VsCodeBridge — workspace + mocks + vault + MCP surface   │ │
│  │  • FileBackedWorkspaceProvider — disk-backed under          │ │
│  │    .apicircle/workspace.json with proper-lockfile           │ │
│  │  • apicircle: FileSystemProvider — virtual YAML views       │ │
│  │  • InProcessMockController (Phase 3)                        │ │
│  │  • VsCodeVaultManager (Phase 4) — in-memory AES-GCM key     │ │
│  │  • VsCodeMcpManager (Phase 5) — per-client snippets;        │ │
│  │    embedded MCP host over HTTP/SSE is Phase 6+              │ │
│  └─────────────────────────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
                              │
                              ▼
                  <repo>/.apicircle/workspace.json
                  (Git-tracked, three-surface canonical)
```

---

## 7. Development

```bash
pnpm install
pnpm --filter apicircle-vscode build       # build extension bundle (tsup)
pnpm --filter apicircle-vscode test        # unit + integration tests
pnpm --filter apicircle-vscode check       # typecheck
pnpm --filter apicircle-vscode lint        # lint
cd apps/vscode && pnpm exec vsce package --no-dependencies   # produce .vsix
pnpm --filter @apicircle/e2e-vscode test:e2e   # E2E (real VS Code via @vscode/test-electron)
```

Sideload the built extension into your VS Code:

1. `Cmd+Shift+P` → `Extensions: Install from VSIX…`
2. Pick `apps/vscode/apicircle-vscode-1.1.0.vsix`
3. Reload window

---

## 8. Phased delivery

Full roadmap, test discipline, and gates: see the consolidated execution plan
in the project root. The TL;DR:

| Phase | Ships as    | Headline                                                       |
| ----- | ----------- | -------------------------------------------------------------- |
| 1     | v0.1 alpha  | Click a request → edit YAML → send to localhost → see response |
| 2     | v0.2 alpha  | Environments, plans as Notebooks, history, Testing tab         |
| 3     | v0.3 alpha  | Mocks, body editors, Global Assets, GraphQL                    |
| 4     | v0.4 beta   | All 17 auth types, OAuth2 callbacks, vault, MCP integration    |
| 5     | v0.5 beta   | Language services pass — F2 rename, Cmd+T, Quick Fixes         |
| 6     | v0.6 beta   | Opt-in visual editor (Cmd+Shift+V), Help, Onboarding           |
| 7     | v0.7 beta   | Multi-workspace, release ledger, code gen                      |
| 8     | v0.8 beta   | Linked workspaces (GitHub)                                     |
| 9     | v0.9 RC     | Full import / export coverage                                  |
| 10    | **v1.0 GA** | Marketplace launch on VS Code + Open VSX                       |

---

## 9. Phase 2 — Environments, Plans, History, Snapshots (v0.2 alpha)

Phase 2 round 1 + 26 gaps (13 closed in Round 1 follow-up, 13 closed
in Round 2 adversarial re-audit) shipped these surfaces. The sidebar
now hosts **eight** TreeViews (Editor, Environment, Execution, Mock,
History, Snapshots, MCP, Link Workspaces).

### Send → eager response tab (post-launch round 7)

The response tab opens **before** `executeRequest` is even called — the
moment the user clicks ▶ Send the FS provider stashes a "Sending…"
placeholder under the runId and `showTextDocument` opens it
`ViewColumn.Beside` with `preserveFocus: true`. When the executor
resolves, the same store entry is rewritten in place and
`fireChangedExternal` fires a Changed event on the response URI — the
already-open tab re-reads the doc and the placeholder swaps for the
real response in a single frame. Cancel and error paths swap in
dedicated "Cancelled" / "Failed" notices (see `responseDocument.ts`
formatters) so the tab is never stranded on "Sending…".

The CodeLens row also swaps to `⏳ Sending… (1.2s) · ✖ Cancel` for the
duration; the cancel lens fires `apicircle.cancelOneSend`, which calls
`AbortRegistry.cancel(runId)`. Cancellation from any surface (the
status-bar spinner X, Esc, or the lens) drives the same single code
path so the tab content stays consistent with what actually happened.

### `apicircle:` URI shape (post-launch round 6)

Every entity opens as a virtual `apicircle:` URI. The shape encodes the
human-readable name in the path so VS Code's tab label is readable, with
the stable identifier riding in the `?id=` query so renames don't break
identity:

| Entity      | URI                                                                                                  |
| ----------- | ---------------------------------------------------------------------------------------------------- |
| Request     | `apicircle://<wsAuth>/requests/<folderSlug…>/<nameSlug>.req.yaml?id=<requestId>`                     |
| Plan        | `apicircle://<wsAuth>/plans/<nameSlug>.plan.yaml?id=<planId>`                                        |
| Mock        | `apicircle://<wsAuth>/mocks/<nameSlug>.mock.yaml?id=<mockId>`                                        |
| Endpoint    | `apicircle://<wsAuth>/mocks/<mockSlug>/<endpointSlug>.endpoint.yaml?mockId=<mockId>&id=<endpointId>` |
| Response    | `apicircle://<wsAuth>/responses/<nameSlug>.run.yaml?runId=<runId>`                                   |
| History run | `apicircle://<wsAuth>/history/<labelSlug>.run.yaml?runId=<runId>`                                    |
| Environment | `apicircle://<wsAuth>/environments/<envName>.env.yaml`                                               |

Properties:

- **Tab label = `<nameSlug>.<ext>`** — readable across multiple open tabs.
- **Folder breadcrumb in the tab tooltip** — VS Code shows the full URI
  path on hover, so two `Login.req.yaml` tabs in different folders are
  immediately distinguishable.
- **Quick Open (`Ctrl+P`) searches by basename** — the name lookup
  finally works.
- **Identity survives renames + folder moves** — the FS provider parser
  reads `?id=` (or `?runId=`) from the query, never the slug. The
  in-path slug is display-only.
- **Sibling collisions disambiguate with `~<shortId>`** — when two
  requests in the same folder slugify to the same string (e.g. both
  named `Login`), the one whose URI is being built gets `~<8-char id
prefix>` appended so URIs stay unique without the full id leaking
  into the tab title.
- **Save on a renamed entity follows the URI rename** — the
  `writeFile` path detects when the post-save URI differs from the
  pre-save URI, calls `showTextDocument(newUri)` in the same column
  with the prior `editor.selection`, and closes the stale tab via the
  Tabs API. The user sees their tab flip from `Login.req.yaml` to
  `SignIn.req.yaml` on a single Ctrl+S, cursor preserved.

The `id` field is **not** present in the projected YAML body (see
`requestYaml.ts:25-26`), so it can't be edited by accident, and now
it isn't visible in the tab label either.

### Environments

- **EnvironmentView** in the sidebar — envs as roots (active marked with ✓), variables as children (encrypted masked).
- **`.env.yaml` virtual documents** opened via the `apicircle:` FileSystemProvider.
- **`apicircle-environment` language** registered with JSON Schema validation, completion (`encrypted:`, `secretKeyId:`), and CodeLens (`▶ Set Active`, `✕ Delete`).
- **HoverProvider** on `.env.yaml` — hovering on a variable shows: env name, plaintext value (or encrypted slot id + bound `SecretKeyMeta` label), mask warnings when a higher-priority env defines the same key, and "not in priority order" notes when the env is inert.
- **Commands**: `New Environment`, `Set Active Environment`, `Delete Environment`, `Set Environment Priority Order…`.
- **Context Globals** sub-node at the bottom of the env tree — shows live `WorkspaceLocal.globalContext` (extracted variables, device-local).

### Execution Plans

- **ExecutionView** — plans as roots, steps as children with order numbers + request method, disabled steps dimmed.
- **`apicircle.runPlan` command** with `AbortSignal` threaded through cancellation, optional env overlay choice, retention-cap honored (`apicircle.history.retentionDays` prunes by age before `apicircle.history.maxEntriesPerWorkspace` caps the size).
- **`apicircle.newPlan` wizard** — multi-step QuickPick: name → request multi-select → step ordering → `stopOnAssertionFailure`.

### History

- **HistoryView** — Recent Requests + Recent Plans buckets, verdict glyphs (✓/✗/◦), newest-first ordering.
- **Run detail viewer** — virtual `apicircle://*/history/<runId>.run.yaml` opens formatted YAML (lazy-populated from `WorkspaceLocal.history`, so MRU navigation works).
- **Toolbar**: `Clear All History`, `Purge Older Than…`.
- **Per-run context menu**: `Delete Run` with confirmation.

### Snapshots

- **SnapshotsView** sidebar (`apicircle.snapshots`) — top row is a storage meter (`X.X KB / Y.Y KB (Z%)` with `database` icon); children are entries newest-first with trigger-themed icons (`save` for manual, `warning` for pre-yank, `archive` for pre-deprecate, `cloud-download` for pre-linked-update, `history` for pre-restore).
- **Commands**: `Capture Snapshot` (InputBox note), `Restore Snapshot…` (auto-captured safety snapshot before the restore), `Delete Snapshot…`, `Set Snapshot Max Bytes…` (InputBox in MB, validates `> 0` and `≤ 2048 MB`).
- **Context-menu inline actions** on each entry: Restore + Delete skip the QuickPick when invoked from the tree.
- **View-title navigation**: Capture button + Set Cap action.

### Variable inline edit

- **EnvironmentView right-click** on a plaintext variable → `Edit Value` (InputBox), `Delete Variable` (confirmation).
- Encrypted variables route through `apicircle.openVaultEntry` (Phase 4 wired) — one-click reveal via Copy to Clipboard or Show in Notification.

### Extractions

- **`apicircle.addExtraction` command** — opens a JsonPathPicker over the most-recent response body and saves the chosen path as a per-request `ContextExtraction`.

### Auto-refresh

- **`workspaceWatcher`** registers `FileSystemWatcher`s on BOTH `.apicircle/workspace.json` (synced) and `workspace.local.json` (device-local). Plan-create, history-append, snapshot-capture and env-var-rename writes (which only touch the local file) now auto-refresh every sidebar view.

### Wired settings

- `apicircle.execution.timeoutMs` — passed through to `executeRequest` (default 30000 ms).
- `apicircle.execution.host` — when `"local"` without a `vscode.env.remoteName`, surfaces a Remote-SSH / Codespaces warning so the choice isn't silently a no-op. The port-forwarding plumbing itself lands in Phase 7.
- `apicircle.history.retentionDays` — prunes runs older than the window from both `persistRequestRun` and `runPlanCommand` before applying the max-entries cap. `0` or negative = "no time cap".

### Persistence on send

- Every `▶ Send` now writes a `RequestRun` to `WorkspaceLocal.history.requestRuns` with truncated body previews per `RUN_BODY_PREVIEW_LIMIT` and capped per `apicircle.history.maxEntriesPerWorkspace`.

### Plan run on send

- `apicircle.runPlan` writes a `PlanRun` + per-step `RequestRun`s.

---

## 10. Phase 3 — Mock servers

The Mock view spins up local HTTP mock servers from OpenAPI / Postman /
Insomnia specs (or a manual endpoint list), powered by the same
`InProcessMockController` (and Hono engine) the CLI uses. No sidecar, no
IPC — Hono runs inside the extension host. When VS Code closes, every
running mock dies; that's the same model as the desktop app.

### MockView

- Servers in `synced.mockServers` shown alphabetically; expand to see endpoints.
- Running servers display `▶ :port`, idle servers `◦`.
- Click → opens the `.mock.yaml` virtual document.
- Inline ▶ Start / ■ Stop / ↻ Restart per server (context menu).
- View-title `+ New Mock…` button + `New Mock…` welcome card when empty.

### Mock YAML projection

- `apicircle://<workspaceId>/mocks/<nameSlug>.mock.yaml?id=<mockId>` is
  editable for `name` / `defaultPort` / `cors`. `source` + `endpoints`
  are read-only. (See the URI shape note in §2 — name renames
  re-anchor the tab to the new URI in the same column.)
- ▶ Start Mock / ■ Stop Mock / ↻ Restart CodeLens above the `name:` line.
- HoverProvider on `name:` (status), `defaultPort:` (bind target),
  and endpoint `pathPattern:` (method + default status + rule count).
- CompletionProvider for root fields + `enabled:` boolean + cors block.
- JSON Schema validation via `apicircle-mock.schema.json`.

### Lifecycle commands

- **`apicircle.newMock`** — 4-step wizard (source kind → spec content →
  name → default port). Pre-parses the source via
  `parseSourceToEndpoints` so a bad spec fails the wizard, not Start.
- **`apicircle.startMock`** — invokes `VsCodeMockController.start(server)`,
  which delegates to `InProcessMockController` and writes the resulting
  `MockRuntimeEntry` to `WorkspaceLocal.mockRuntime.active[id]`.
- **`apicircle.stopMock`** / **`apicircle.restartMock`** — symmetric.
- **`apicircle.setMockPort`** — one-click port setter. Right-click a mock row
  → **Set Mock Port…**, or invoke from the palette. Pre-fills with the
  current `defaultPort`; validates 1024–65535 (blank = `null` = "pick a
  free port at start"). Persists via `mock.upsert` — no runtime side
  effect. Bind errors at the next Start (busy port / invalid port /
  permission denied) surface as `MockServerStartError` toasts from
  `@apicircle/mock-server-core`.
- **`apicircle.deleteMock`** — auto-stops if running, then fires
  `mock.delete`.
- **`apicircle.focusMockView`** — focuses the Mock view (status bar click).
- All commands accept an optional `{kind, id}` node arg from the tree menus
  to skip the QuickPick.

### MockStatusBar

- Left-side `$(server) Mocks: N (:port, …)` when ≥1 server is running.
- Compact `+N` form past 3. Click → focuses Mock view.
- Polls `local.mockRuntime.active` every 1s (cheap read).

### Deferred from Phase 3

- Plans as `vscode.NotebookController` (per-cell ▶ Run, persisted outputs)
  — still deferred (Phase 8+).
- `vscode.tests.createTestController` integration (Testing tab) — still
  deferred (Phase 8+).
- Per-endpoint mock editing in a visual editor — still deferred (Phase 8+);
  YAML editing is the supported path today.
- ~~Embedded in-extension `McpHost` over HTTP/SSE~~ — still deferred
  (Phase 8+). Phase 6 shipped the install-into-`.vscode/mcp.json` path
  which covers Copilot Chat without needing the embedded host.
- ~~Bundle code-splitting~~ — **shipped in Phase 7** (see §14). Bundle
  dropped 1.91 MB → 1.46 MB via esbuild tree-shaking; the 2 MB CI gate
  now has ~540 KB headroom.

## 11. Phase 4 — Secret Vault + APICircle Runs OutputChannel

Phase 4 turns the two pre-declared "(Phase 4 — not yet implemented)"
settings into live functionality and wires the workspace-passphrase
secret vault into the Environment view.

### Vault model

A workspace's `synced.secretCrypto` blob (PBKDF2-SHA-256 v1, 16-byte salt,
1.2M iterations, AES-GCM verifier) lives in `.apicircle/workspace.json`
and travels with Git. Any teammate who knows the passphrase can decrypt
the encrypted env-variable values; lose the passphrase, lose the
secrets — there is no recovery path.

The derived AES-GCM key lives only in process memory (`VsCodeVaultManager`).
It is **never** persisted to `vscode.SecretStorage` or any other on-disk
store — the explicit design choice that matches the web build. An
opt-in "remember on this device via OS keychain" toggle is a planned
Phase 5 follow-up.

### Vault commands

| Command id                        | What it does                                                                                               |
| --------------------------------- | ---------------------------------------------------------------------------------------------------------- |
| `apicircle.setupVaultPassphrase`  | First-time setup — prompt + confirm, mint `SecretCryptoMeta`, persist via `secret.crypto.set` patch        |
| `apicircle.unlockVault`           | Passphrase prompt + verifier check + cache the derived key                                                 |
| `apicircle.lockVault`             | Manual lock; with no active workspace locks every vault                                                    |
| `apicircle.changeVaultPassphrase` | Rotate the passphrase — re-encrypt every encrypted env variable under the new key, atomically              |
| `apicircle.openVaultEntry`        | Reveal one encrypted variable — unlock if needed, decrypt, offer Copy to Clipboard or Show in Notification |
| `apicircle.showRunsChannel`       | Reveal the APICircle Runs OutputChannel                                                                    |

### Environment view changes

The Environment view gains a **Secret Vault** header row at the top.
Three states:

- **🛠 not configured** — no `secretCrypto` blob yet. Click → setup flow.
- **🔒 locked** — blob exists, no cached key. Click → unlock prompt.
- **🔓 unlocked** — cached key in memory. Click → lock.

Encrypted variable rows render with a `lock` icon and a one-click
"Open Vault Entry" command — the menu hunt is gone. The displayed value
is masked to `••••<last4>` even when unlocked; the plaintext only ever
surfaces via Copy to Clipboard or the 15-second notification toast.

### Settings

Both Phase-4 settings are now live:

- `apicircle.secrets.autoLockMinutes` (default 30) — auto-lock the vault
  after N minutes of inactivity. `0` disables auto-lock. Changes take
  effect immediately for already-unlocked vaults; the timer re-arms
  with the new value mid-flight.
- `apicircle.secrets.clipboardClearSeconds` (default 30) — clear
  clipboard N seconds after a secret is copied, **only if the clipboard
  still holds the value we wrote**. If the user pasted something else
  in the interim, the auto-clear is skipped. `0` disables auto-clear.

Inactivity is reset by any vault op (`encryptValue` / `decryptValue` /
explicit `touch()`). Idle counters only — VS Code activity (typing,
focus changes) does NOT reset the timer.

### APICircle Runs OutputChannel

Phase 3 carried a dedicated `APICircle Mock` OutputChannel for the
mock-controller's cross-workspace fallback diagnostics. Phase 4
consolidates into a single **APICircle Runs** channel with category
prefixes:

```
[mock] 2026-06-08T12:34:56.789Z [server-id] runtime sync OK
[vault] 2026-06-08T12:35:01.123Z auto-locked workspace abc after 30m of inactivity
```

The channel is lazy — never shown in the picker until the first
`log()` call. Categories so far: `mock`, `vault`. Future phases route
plan + send execution through here too.

### Patches added

Two new `WorkspacePatch` kinds:

- `{ kind: 'secret.crypto.set', crypto: SecretCryptoMeta }` — install a
  passphrase blob. Defensively validates `kdf === 'pbkdf2-sha256-v1'`,
  non-empty `salt` + `verifier`, and `iterations >= 1` — a malformed
  payload is rejected with `changedIds === []`.
- `{ kind: 'secret.crypto.clear' }` — wipe the passphrase blob. A no-op
  if `secretCrypto` is already null (keeps `updatedAt` stable). Callers
  MUST re-encrypt or drop encrypted env variables in a sibling patch;
  this kind only mutates the blob.

Both are exercised by `applyMutation.test.ts` (7 cases) and by the
three-surface compat suite (`secretCryptoCompat.test.ts`, 5 cases)
against `FileBackedWorkspaceProvider` (desktop / MCP) and
`GitWorkspaceProvider` (VS Code).

### Test counts (Phase 4 close, post-audit)

- **apps/vscode** — 628 tests across 70 files (up from 555 across
  65; Phase 4 baseline shipped at 602 across 69; R1–R5 audit rounds
  bumped to 628). See CHANGELOG for the audit-round trail.
- **Monorepo** — 3370 tests across 310 files (up from 3288 across 305).

### Deferred from Phase 4

- ~~VS Code Copilot Chat integration~~ — **shipped in Phase 6** via
  `apicircle.installCopilotMcpConfig` writing `.vscode/mcp.json`. The
  alternative `vscode.lm.registerMcpServerDefinitionProvider` proposed
  API remains deferred (Phase 8+) — the install path covers today's
  Copilot Chat without needing a proposed-API gate.
- In-extension `McpHost` exposed over HTTP/SSE so VS Code can be both
  host AND client — still deferred (Phase 8+).
- Plan Notebooks + Testing tab — still deferred (Phase 8+).
- ~~Bundle code-splitting via ESM~~ — **shipped in Phase 7** (see §14).
- OS-keychain "remember on this device" toggle for the cached vault key
  (currently in-memory-only) — still deferred (Phase 8+).

## 12. Phase 5 — MCP Host Integration

Phase 5 fills out the **MCP view** + ships per-AI-client config-snippet
generation. External AI clients (Claude Desktop, Cursor, Continue, Cline,
Zed, Windsurf, GitHub Copilot, ChatGPT, generic stdio) launch
`apicircle-mcp` themselves as a stdio child process — VS Code's role
is to surface the exact JSON snippet the user pastes into each client's
config, with the `--workspace` arg pointing at the active workspace's
`.apicircle/` directory.

### Architecture

The snippet builder + per-OS config-path resolver moved to
`@apicircle/mcp-server/src/config/snippets.ts`. Both Desktop and VS Code
consume the same exports:

```ts
import {
  buildSnippetVariants,
  resolveAiClientConfigPath,
  AI_CLIENTS,
  type AiClient,
  type ConfigSnippetVariants,
} from '@apicircle/mcp-server';
```

The three-surface invariant: for any `(binary, workspace, client)`
tuple, Desktop's `McpManager.getConfigSnippet(client)` and VS Code's
`VsCodeMcpManager.getConfigSnippet(client)` produce byte-identical
output. The `mcpRoundTrip.test.ts` integration suite proves this.

### MCP view layout

```
▸ MCP Server            85 tools · binary: apicircle-mcp
▾ Connect an AI client
   Claude Desktop       config file detected
   Claude Code          paste manually
   Cursor               config file detected
   Continue             config file detected
   Cline                paste manually
   Zed                  config file detected
   Windsurf             paste manually
   GitHub Copilot       paste manually
   ChatGPT              paste manually
   Other (Generic)      paste manually
▸ Open Connect Guide
```

Click any client row → fires `apicircle.copyMcpConfig`. Context-menu
exposes "Copy" + "Open Config File" (only for clients with a known
config path).

### Commands

| Command id                      | What it does                                                                                                                                                                                                     |
| ------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `apicircle.copyMcpConfig`       | Write the snippet for a client to clipboard. Prompts via QuickPick if invoked without a node arg. Surfaces a Windows path-style picker (forward-slash vs escaped) when the snippet has divergent variants.       |
| `apicircle.openMcpConfigFile`   | Open the AI client's MCP config file in VS Code. Offers to seed an empty `{"mcpServers": {}}` file if it doesn't exist yet. Clients without a fixed path get an info toast pointing at the client's settings UI. |
| `apicircle.openMcpConnectGuide` | Open `docs/connect-your-ai-client.md` on GitHub in the user's browser.                                                                                                                                           |
| `apicircle.revealMcpBinaryInfo` | Info toast with binary path + workspace path + tool count. Reachable from the view-title button.                                                                                                                 |

### Settings

- `apicircle.mcp.binaryPath` (default `apicircle-mcp`) — path to the
  binary external AI clients launch. The default assumes
  `apicircle-mcp` is on `PATH` (e.g. installed via
  `pnpm install -g @apicircle/mcp-server`). Set to an absolute path
  for non-standard install locations. Manager re-reads on every call
  so changes take effect without reactivation.

### Test counts (Phase 5 close, post-cross-phase audit)

- **apps/vscode** — 685 tests across 74 files. Phase 5 baseline
  landed at 676; the cross-phase R1–R3 audit rounds (which
  touched MCP-adjacent surfaces — viewsWelcome, status-bar vault
  wiring, regression assertions) bumped it to 685.
- **`@apicircle/mcp-server`** — 195 tests across 20 files (up from
  Phase 4's 181; +14 snippet + path-resolver tests counting R1
  cross-platform additions).
- **Monorepo** — 3441 tests across 315 files (up from 3370 at
  Phase 4 close).

### Deferred from Phase 5

- ~~**VS Code Copilot Chat MCP integration.**~~ **Shipped in Phase 6** —
  but via `.vscode/mcp.json` install rather than the proposed
  `vscode.lm.registerMcpServerDefinitionProvider` API (which remains
  deferred for an embedded-host future). The install command writes
  Copilot Chat's expected workspace-config file idempotently and
  Copilot Chat picks it up automatically.
- **In-extension `McpHost` over HTTP/SSE.** Today's snippet + install
  model hands the user a binary path + workspace dir; the AI client
  launches its own stdio child. Still deferred (Phase 8+) — the
  embedded surface needs the security-model work the
  `apicircle.mcp.allowDecrypt` setting is gating.
- ~~**Bundle code-splitting via ESM.**~~ **Shipped in Phase 7** (see §14)
  via esbuild tree-shaking — ESM migration itself remains deferred
  (Phase 8+) but is no longer load-bearing.

## 13. Phase 6 — Copilot Chat MCP Install

Phase 6 ships one-click install of the APICircle MCP entry into the
workspace's `.vscode/mcp.json`. VS Code 1.86+ Copilot Chat reads this
file automatically — a single click in the MCP view's GitHub Copilot
row connects the workspace to Copilot Chat (and any other MCP client
following the VS Code workspace-config convention) without leaving
the editor.

### The install flow

```
1. Open APICircle → MCP view
2. The GitHub Copilot row shows one of three states:
   • 🚀 "click to install" → click runs the install command
   • ✓ "installed"         → entry is current; click copies snippet
                              for other surfaces
   • ⚠ "out of date"       → binary or workspace path changed; click
                              re-installs with current values
3. After install, restart Copilot Chat (or your AI client of choice)
```

The install is idempotent — running it twice is a no-op when nothing
changed. Foreign `mcpServers.*` entries (other AI servers, e.g. an
existing `shopify-mcp` entry) are preserved verbatim; only the
`apicircle` key is touched.

### Setting

- `apicircle.mcp.workspaceConfigPath` (default `.vscode/mcp.json`) —
  relative path inside the workspace folder where the install command
  writes the config. Override only if your project uses a non-standard
  location.

### Multi-root awareness

If you have multiple workspace folders open, the install picks the
folder that **owns** the active APICircle workspace's `apicircleDir` and
writes to that folder's `.vscode/mcp.json`. Files in other roots
are left alone.

### Idempotence + cross-platform notes

- The writer always emits forward-slash paths even on Windows —
  `.vscode/mcp.json` is Git-committed, so backslash-escaped paths
  would leak Windows layout into teammates' macOS / Linux clones.
- Malformed JSON on disk → treated as "create fresh" rather than
  destroying user content.
- Top-level keys outside `mcpServers` (like `$schema`, third-party
  annotations) are preserved verbatim.

### Test counts (Phase 6 close, post-R4 staff-engineer audit)

- **apps/vscode** — 736 tests across 77 files (up from Phase 5's
  685 / 74; +51 tests / +3 files).
- **Monorepo** — 3492 tests across 318 files.

### Deferred from Phase 6

- ~~**Bundle code-splitting via ESM**~~ — **shipped in Phase 7** (see
  §14). Bundle dropped 1.91 MB → 1.46 MB via esbuild tree-shaking;
  Phase 10 bumped the ceiling to 2.5 MB for the embedded host.
- ~~**In-extension `McpHost` over HTTP/SSE**~~ — **shipped in Phase 10**
  (see §17). Loopback-bound, token-authed, DNS-rebind-protected.
- ~~**Plan Notebooks** (`vscode.NotebookController`)~~ — **shipped in
  Phase 9** (see §16.1).
- ~~**Testing tab** (`vscode.tests.createTestController`)~~ — **shipped
  in Phase 9** (see §16.2).
- ~~**`apicircle.mcp.autoConfigureClients`**~~ — **shipped in Phase 8**
  (see §15.1) for 5 of 7 supported AI clients (Claude Desktop, Claude
  Code, Cursor, Windsurf, Zed). Continue + Cline still deferred.

## 14. Phase 7 — Bundle code-splitting + size budget

Phase 7 closes Phase 6's load-bearing follow-up: the extension bundle
was sitting at **1.91 MB**, only ~91 KB under the 2.0 MB hard
ceiling, and would have crossed it within one or two phases of
feature growth. Phase 7 drops it to **1.46 MB** (a **−454 KB /
23.7% reduction**) and locks the savings in with a two-tier budget
gate.

### The lever — tree-shaking via `"sideEffects": false`

`tsup` is configured with `noExternal: ['@apicircle/core',
'@apicircle/mcp-server', '@apicircle/mock-server-core',
'@apicircle/shared', 'yaml']` so the entire workspace `@apicircle/*`
graph inlines into `dist/extension.js`. Without a `sideEffects`
declaration, esbuild can't prove any module is pure and conservatively
keeps every export — even the OAuth2 grant runners the extension shell
never reaches, the parsers the FS provider doesn't bind, the request
execution paths only the desktop hits, etc.

Phase 7 adds `"sideEffects": false` to all four workspace packages:

- `packages/shared/package.json`
- `packages/core/package.json`
- `packages/mcp-server/package.json`
- `packages/mock-server-core/package.json`

Each is a pure module (types, helpers, `applyMutation`, request
execution, the Hono mock engine, the MCP catalog) — verified by
re-running the full per-package test suite. With this flag esbuild
drops every transitively-unreachable export from the bundle.

### The gate — `scripts/check-vscode-bundle.mjs`

Three-tier budget. Bump the ceiling deliberately per phase; never to
silence a regression. Constants are imported from
`scripts/vscode-bundle-budget.mjs` (single source of truth shared
with the regression test below).

| Tier             | Bytes                | Behavior                                                                                                                      |
| ---------------- | -------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| **Sanity floor** | 500_000 (~0.48 MB)   | `::error::` annotation in CI; exit 1. Catches the corrupt-empty / partial-write build that would otherwise pass both budgets. |
| **Soft warn**    | 1_800_000 (~1.72 MB) | `::warning::` annotation in CI; exit 0.                                                                                       |
| **Hard fail**    | 2_097_152 (2.00 MB)  | `::error::` annotation in CI; exit 1.                                                                                         |

Run locally:

```
pnpm --filter apicircle-vscode build
node scripts/check-vscode-bundle.mjs
```

CI wires the same script into `.github/workflows/vscode.yml`'s
**Bundle-size budget** step, so the same numbers fail PRs that the
local check would. The previous inline bash gate is gone.

### The regression test —

`apps/vscode/test/integration/bundleSize.test.ts`

Three assertions plus a self-skip branch:

- **Hard-budget assert** — fails the suite when
  `dist/extension.js > 5.0 MB` (current ceiling — see "Bundle budget
  contract" below for history).
- **Sanity-floor assert** — fails the suite when
  `dist/extension.js < 500 KB`. Guards against the
  corrupt-empty-build case where a 0-byte output would otherwise
  silently pass both budget tiers.
- **Soft-budget warn** — emits `console.warn` (suite still passes)
  when `3.0 MB < bundle ≤ 5.0 MB`. Surfaces the threshold crossing
  in PR test output even when CI happens to be green.
- **Self-skip** — if `dist/extension.js` doesn't exist (fresh
  checkout, no build run), the test logs the "run pnpm build
  first" hint instead of silently passing. CI always builds before
  testing, so this branch only fires locally.

### Test counts (Phase 7 close)

- **apps/vscode** — 739 tests across 78 files (up from Phase 6's
  736 / 77; +3 tests / +1 file). The +3 comes from
  `bundleSize.test.ts` (4 cases — hard-budget assert, sanity-floor
  assert, soft-warn surfacer, build-first hint; one self-skips per
  run depending on whether `dist/extension.js` is present).
- **Monorepo** — 3495 tests across 319 files.

### Bundle budget contract

The bundle is a tracked contract, the same way the test floor and
the strict-coverage tier are. Every phase that lands here SHOULD:

1. Run `node scripts/check-vscode-bundle.mjs` and report the new size
   in the CHANGELOG entry.
2. If the change crosses the soft warn, justify why and either
   (a) propose a counter-trim in the same PR, or (b) bump the soft
   warn explicitly in `scripts/vscode-bundle-budget.mjs` (the single
   source of truth — `bundleSize.test.ts` and
   `check-vscode-bundle.mjs` import from there) with rationale in the
   CHANGELOG.
3. Never bump the hard fail to silence a regression. The hard fail
   only moves when a deliberate policy change adds room for our
   product surface (and the activationPerf budget — `<500ms` on a
   100-request workspace — must continue to hold).

**Current ceilings** (`scripts/vscode-bundle-budget.mjs`):

| Tier         | Threshold | Behaviour                  |
| ------------ | --------- | -------------------------- |
| Sanity floor | 500 KB    | Fail — corrupt/empty build |
| Soft warn    | 3.0 MB    | Pass with `console.warn`   |
| Hard fail    | 5.0 MB    | Fail the suite             |

The 5 MB ceiling was set post-1.0 for peer-extension parity (Thunder
Client ~5 MB, GitLens ~5–8 MB, ESLint ~6 MB) once the product surface
grew to include MCP host + Git workspace + 17 auth schemes +
embedded mock server. Bundle size is now an early-warning _proxy_;
the actual UX gate is
[`apps/vscode/test/integration/activationPerf.test.ts`](../apps/vscode/test/integration/activationPerf.test.ts),
which asserts `activate()` completes in `<500ms` on a 100-request
workspace and `<1000ms` on a 500-request workspace.

### Deferred from Phase 7

- **Lazy-load `InProcessMockController`** — currently a static import
  in `host/vscodeMockController.ts`. Phase 7's tree-shaking made this
  unnecessary; revisit only if the bundle climbs back toward 1.8 MB.
- **Tsup CJS → ESM** — VS Code 1.94+ supports ESM extension entries.
  Worth ~5–10% more tree-shaking if Phase 7's headroom shrinks.
- ~~**`apicircle.mcp.autoConfigureClients`**~~ — **shipped in Phase 8**
  for 5 of 7 supported AI clients (see §15). Cline + Continue still
  deferred — Cline reads workspace MCP config (use P6's
  `.vscode/mcp.json` path) and Continue uses YAML rather than JSON.

## 15. Phase 8 — Convenience + Security UX

Phase 8 ships **two of the nine items deferred from Phases 3-7** and
addresses the "this should be easier" rough edges from Phases 5 + 6.

### 15.1 Multi-AI-client MCP install (`apicircle.mcp.autoConfigureClients`)

Phase 6 shipped one-click install of `.vscode/mcp.json` (the
workspace-local config Copilot Chat picks up automatically). Phase 8
extends that model to the **user-level** config files each external
AI client expects, in one bulk-install pass:

| Client         | Config file                                                                                                           | Schema variant                 |
| -------------- | --------------------------------------------------------------------------------------------------------------------- | ------------------------------ |
| Claude Desktop | `~/Library/.../Claude/claude_desktop_config.json` (mac), `%APPDATA%/Claude/...` (win), `~/.config/Claude/...` (linux) | standard `mcpServers`          |
| Claude Code    | `~/.claude/mcp.json`                                                                                                  | standard `mcpServers`          |
| Cursor         | `~/.cursor/mcp.json`                                                                                                  | standard `mcpServers`          |
| Windsurf       | `~/.codeium/windsurf/mcp_config.json`                                                                                 | standard `mcpServers`          |
| Zed            | `~/.config/zed/settings.json`                                                                                         | Zed-specific `context_servers` |

**Commands:**

- `apicircle.installMcpForClient(client?)` — install (or update) the
  entry for one client. Click action on the per-row install state in
  the McpView; multi-pick fallback when invoked from the palette
  without a client arg.
- `apicircle.installMcpForAllClients` — runs across the configured
  `autoConfigureClients` setting; falls back to a multi-pick when
  the list is empty. Surfaced as a view-title toolbar action.
- `apicircle.uninstallMcpForClient(client)` — schema-aware key
  removal; preserves foreign entries; empties the block + drops
  the schema key when no foreign servers remain.

**Setting:** `apicircle.mcp.autoConfigureClients: string[]` —
enum-validated list of client IDs. Default `[]` (opt-in). Cline +
Continue intentionally not listed (Cline uses the P6 workspace path;
Continue uses YAML).

**Security model:**

- Config paths come from `resolveAiClientConfigPath()` in
  `@apicircle/mcp-server`. Hard-coded per client, NOT user-overridable
  per setting — a malicious workspace cannot redirect writes
  elsewhere.
- Symlink-traversal guard (`UnsafeClientConfigPathError`) rejects
  any target whose realpath escapes the user's homedir, defending
  against `~/.cursor/mcp.json → /etc/sudoers` attacks.
- The setting only chooses **which** clients to write to; **where**
  per client is fixed by the resolver.

**Per-client UI in the MCP view:** each of the 5 InstallableClients
gets a three-state row (absent / installed-current / installed-stale)
mirroring P6's Copilot row. Inline install button (✗→install,
⚠→update); ✓ falls back to the existing copy-snippet flow.

**Tests:** 28 unit tests in `mcpClientInstall.test.ts` covering every
client × every install state, plus the per-client schema variants
and the symlink security guard.

### 15.2 "Remember vault on this device" (`apicircle.secrets.rememberOnDevice`)

Closes the deferred-from-Phase-4 item. Opt-in persistence of the
vault passphrase via VS Code's `context.secrets` (which on each
platform delegates to the OS keychain — Keychain on macOS, Credential
Manager on Windows, libsecret on Linux).

**Flow:**

- After a successful unlock, if `apicircle.secrets.rememberOnDevice`
  is true, the passphrase is stored via
  `rememberPassphrase(secrets, workspaceId, passphrase)`.
- On extension activation, `silentUnlockFromDevice(deps, workspaceId)`
  fires for every registered workspace. If a stored passphrase exists
  and decrypts the vault, the user starts in an unlocked state.
- If silent-unlock fails (passphrase rotated externally), the stored
  entry is wiped and the regular prompt flow surfaces.

**Commands:**

- `apicircle.forgetVaultOnDevice` — explicit wipe. Two-step modal
  confirmation. With no active workspace, offers a "forget across
  all known workspaces" path.

**Security threat model:**

- "OS keychain compromise" — attacker reads SecretStorage. They
  obtain the passphrase and can decrypt the vault (this session and
  any future rotations). Unavoidable cost of any "remember" UX.
- "Passphrase reuse" — storing the actual passphrase (vs a wrapped
  key) means a compromised keychain leaks what the user may reuse
  elsewhere. Documented in the setting description.
- "Stale stored key after rotation" — vault rotation invalidates the
  verifier; silent-unlock fails; stored entry is wiped.
- "Auto-lock interaction" — auto-lock only clears the in-memory key.
  Stored entry persists, so the NEXT activation silent-unlocks again.

**Defaults:** OFF. Setting opt-in. Documented as "only enable on a
trusted, encrypted-at-rest device."

**Tests:** 8 unit tests in `vaultDeviceMemory.test.ts`.

### Test counts (Phase 8 close)

- **apps/vscode** — 779 tests across 80 files (up from Phase 7's
  738 / 78; +41 tests / +2 files: `mcpClientInstall.test.ts`,
  `vaultDeviceMemory.test.ts`, plus manifest + activation regression
  expansions).
- **Monorepo** — 3536 tests across 321 files.

### Bundle size

1.49 MB (+30 KB over Phase 7's 1.46 MB, still 530 KB headroom under
the 2.0 MB hard budget).

### Deferred from Phase 8

- **In-extension `McpHost` over HTTP/SSE** — VS Code as BOTH host AND
  client of its own MCP catalog. Same security-model dependency as
  Phase 6+.
- **`vscode.lm.registerMcpServerDefinitionProvider` proposed API** —
  alternative to today's `.vscode/mcp.json` install path.
- ~~**Plan Notebooks**~~ — **shipped in Phase 9** (see §16).
- ~~**Testing tab**~~ — **shipped in Phase 9** (see §16).
- **Per-endpoint mock visual editor** — YAML editing is the
  supported path today.
- **Continue + Cline auto-install** — Continue needs a YAML writer;
  Cline uses the workspace MCP path (P6 covers it).
- **Lazy-load `InProcessMockController`** (still not load-bearing
  per Phase 7).
- **Tsup CJS → ESM** (still not load-bearing).

## 16. Phase 9 — Native VS Code UX (Plan Notebooks + Test Controller)

Phase 9 closes 2 of the 6 Phase 9+ deferred items from Phase 8. Both
surfaces are first-class VS Code API integrations — execution plans
open as native notebooks; assertions live in the Testing tab.

### 16.1 Plan Notebooks

**Files:**

- `apps/vscode/src/notebook/planNotebookSerializer.ts` — schema-v1
  serializer between `.apicircle-plan.json` bytes and `NotebookData`.
- `apps/vscode/src/notebook/planNotebookController.ts` — per-cell
  executor wired through `executeRequest`.
- `apps/vscode/src/commands/openPlanAsNotebook.ts` —
  `apicircle.openPlanAsNotebook` command.

**File shape (`*.apicircle-plan.json`):**

```jsonc
{
  "schemaVersion": 1,
  "planId": "<id>",
  "workspaceId": "<id>",
  "steps": [
    { "requestId": "<id>" },
    { "requestId": "<id>", "enabled": false },
    { "requestId": "<id>", "linkedWorkspaceId": "<id>" },
  ],
  "envPriorityOrder": [],
  "variables": [],
  "stopOnAssertionFailure": false,
}
```

**Cell source format:** each step renders as a code cell whose first
line is a directive the serializer rebuilds on save:

```
# apicircle-plan-step: req_abc123 # [linked=ws-xyz]
GET https://api.example.com/users/me
# Get current user
```

User edits to the directive line (e.g. changing `req_abc123` →
`req_xyz789`) survive round-trip — the serializer prefers the
directive over stale cell metadata.

**Run UX:** click ▶ on any cell to send the referenced request.
Output shows status / duration / per-assertion ✓/✗ at the top, with
the parsed JSON body (or raw text) beneath. Run All steps through
the plan in order; per-cell cancel forwards to the AbortSignal.
History persistence is **intentionally skipped** — notebooks are a
scratchpad surface. Use **Run Plan** from the ExecutionView for
recorded runs.

**Open command:** **APICircle: Open Plan as Notebook** (also
accessible via the ExecutionView plan context menu). Writes
`<plan-slug>.apicircle-plan.json` adjacent to the workspace's
`.apicircle/` directory; rename freely (the serializer reads
`planId` from the JSON, not the filename).

### 16.2 Assertion Test Controller

**File:** `apps/vscode/src/testing/assertionTestController.ts`.

**What's surfaced:** every request whose `assertions` array is
non-empty appears under VS Code's Testing tab. Hierarchy:

```
APICircle/
  └─ <workspace label>
      └─ <folder name>           (when the request lives in a folder)
          └─ POST <request name>
              ├─ ✓ status equals 200
              ├─ ✓ duration lt 500
              └─ ✗ json-path $.id matches /^u_/
```

Requests with empty assertions arrays are **not** surfaced — the
Testing tab stays clean.

**Run handler:** sends the request via the same `executeRequest`
path the editor uses, evaluates each assertion via
`runAssertions`, emits per-assertion pass/fail with the diff text
as the failure message. Cancellation forwards to the AbortSignal.
Per-request failure means at least one assertion failed.

**Refresh:** debounced 100ms on every `onDidChangeActiveWorkspace`
event from the bridge. External writes (Git pull, MCP write, hand
edit) all funnel through that event.

### 16.3 Test counts (Phase 9 close)

- **apps/vscode** — 803 tests across 82 files (up from Phase 8's
  779 / 80; +24 / +2: `planNotebookSerializer.test.ts` +
  `assertionTestController.test.ts`, plus manifest + activation
  regression updates).
- **Monorepo** — 3560 tests across 323 files.

### 16.4 Bundle size

1.51 MB (+22 KB over Phase 8's 1.49 MB, still 518 KB headroom under
the 2.0 MB hard budget).

### Deferred from Phase 9

- ~~**In-extension `McpHost` over HTTP/SSE**~~ — **shipped in Phase 10**
  (see §17).
- ~~**`vscode.lm.registerMcpServerDefinitionProvider` proposed API**~~ —
  **shipped in Phase 10** as a best-effort gated registration.
- **Per-endpoint mock visual editor** — Phase 11 candidate.
- **Continue auto-install** (YAML writer).
- **Lazy-load `InProcessMockController`** (not load-bearing).
- **Tsup CJS → ESM** (not load-bearing).

## 17. Phase 10 — Embedded MCP host over Streamable HTTP

Phase 10 closes 2 of the 4 deferred items from Phase 9 by integrating
two related MCP architecture pieces: an in-extension MCP server and the
`vscode.lm` proposed-API registration that lets Copilot Chat consume it
natively.

### 17.1 Embedded MCP host

**Files:**

- `apps/vscode/src/host/embeddedMcpHost.ts` — host + `BridgeWorkspaceProvider`.
- `apps/vscode/src/commands/embeddedMcpActions.ts` — start/stop/restart/copy commands.

**Connection URL** (the thing users paste into their AI client):

```
http://127.0.0.1:<port>/mcp?token=<base64url-256bit>
```

The token also accepts the `Authorization: Bearer <token>` header for
clients that don't let you set query parameters.

**Security guards — every request goes through three gates:**

| #   | Guard                   | What it stops                                                                                                                                                                                                                                                                                   |
| --- | ----------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 1   | **Loopback-only bind**  | `apicircle.mcp.embeddedHost.bindHost` validated by `assertLoopbackBindHost`. `127.0.0.1` / `localhost` / `::1` / any `127.x.y.z` accepted; everything else (incl. `0.0.0.0`, RFC1918 private, public IPs) rejected at startup with a modal toast. The most dangerous misconfiguration possible. |
| 2   | **Bearer-token auth**   | 256-bit random token generated per session, compared in constant time. Missing → 401. Wrong → 401. Token rotates on every **Restart**.                                                                                                                                                          |
| 3   | **DNS-rebinding guard** | Host header validated against the loopback set. A page in the user's browser cannot forge `Host: evil.com` and have us serve it as if it were localhost — 403.                                                                                                                                  |

**Threat model:**

- "Malicious local process" — same threat model as any localhost-bound
  service. A process running as the user can connect with the token if
  it can read your VS Code state. Mitigation: token rotates on restart;
  `apicircle.mcp.allowDecrypt` still gates secret decryption.
- "Browser-based attack via WebSocket / DNS rebinding" — defeated by
  Guard 3 (Host header check) + token requirement.
- "Token leak via process listing" — token isn't on argv; it lives in
  process memory only. URL is logged at info level but the embedded
  host's RunsChannel writes go to the user's APICircle Runs output
  channel, not stdout.

**Settings:**

- `apicircle.mcp.embeddedHost.enabled` — boolean, default `false`.
  Auto-start on activation if true.
- `apicircle.mcp.embeddedHost.port` — number, default `0` (OS auto-pick).
- `apicircle.mcp.embeddedHost.bindHost` — string, default `127.0.0.1`,
  loopback-validated.

**Commands:**

- `apicircle.startEmbeddedMcp` — bind socket, attach MCP transport,
  toast with **Copy URL** action.
- `apicircle.stopEmbeddedMcp` — clean shutdown.
- `apicircle.restartEmbeddedMcp` — stop + start; **rotates the bearer token**.
- `apicircle.copyEmbeddedMcpUrl` — write the URL to clipboard.

**WorkspaceProvider** — `BridgeWorkspaceProvider` adapts
`VsCodeBridge.activeWorkspace()` to the `WorkspaceProvider` interface
the MCP host expects. MCP tool calls see the user's IN-MEMORY edits
without a disk snapshot — same surface the editor commands use.

### 17.2 `vscode.lm` proposed-API integration

**File:** `apps/vscode/src/host/proposedMcpProviderRegistration.ts`.

VS Code 1.95+ shipped a way for extensions to register MCP servers
directly with Copilot Chat (and other built-in MCP clients) without
writing config files. Phase 10 probes for the API at runtime and, when
present, registers the embedded host's URL + Bearer header as a server
definition.

**Engine gating** — the extension's `engines.vscode` is `^1.85.0` (to
keep older users supported), so we cannot compile against
`@types/vscode-proposed`. The probe is structural-typed:

```ts
const lm = (vscode as unknown as { lm?: ProposedLmApi }).lm;
if (!lm?.registerMcpServerDefinitionProvider) {
  return null; // silent no-op; .vscode/mcp.json (P6) still covers Copilot Chat
}
```

When the API is present, Copilot Chat sees the embedded host
automatically — no `.vscode/mcp.json` write required. When absent, P6's
install command still serves the same purpose.

### 17.3 Bundle budget — intentional bump

The MCP SDK's `StreamableHTTPServerTransport` + its `@hono/node-server`
runtime add ~640 KB to the bundle. The host is opt-in (default off) but
the code is statically reachable so esbuild bundles it regardless.
Phase 10 bumps `scripts/vscode-bundle-budget.mjs`:

- soft warn: 1.8 MB → **2.3 MB**
- hard fail: 2.0 MB → **2.5 MB**

Phase 11+ deferred trim: lazy-load the SDK transport via dynamic import

- externalize `@modelcontextprotocol/sdk` from `tsup`'s `noExternal`.

Bundle at Phase 10 close: **2.15 MB** (~350 KB headroom).

### 17.4 Test counts (Phase 10 close)

- **apps/vscode** — 831 tests across 84 files (up from Phase 9's
  803 / 82; +28 / +2: `embeddedMcpHost.test.ts` (22) +
  `proposedMcpProviderRegistration.test.ts` (5) + manifest + activation
  regression updates).
- **Monorepo** — 3588 tests across 325 files.

### Deferred from Phase 10

- ~~**Per-endpoint mock visual editor**~~ — **shipped in Phase 11**
  (see §18.2). MVP webview; YAML editing remains the primary path.
- ~~**Continue auto-install** (YAML writer)~~ — **shipped in Phase 11**
  (see §18.1).
- **Lazy-load `InProcessMockController`** (not load-bearing — indefinite).
- **Tsup CJS → ESM** (not load-bearing — indefinite).
- **Lazy-load embedded host's SDK transport** (would reclaim ~640 KB
  when the embedded host is off — indefinite).

## 18. Phase 11 — Visual editing + final deferred items

Phase 11 closes the last 2 actionable items from the original Phase 1
deferred-list roadmap. After Phase 11, the only outstanding items are
3 indefinite tech-debt entries (none load-bearing for users).

### 18.1 Continue YAML auto-install

**File:** `apps/vscode/src/host/mcpClientInstall.ts` (extended).

Continue uses YAML for its config (`~/.continue/config.yaml`), so the
P8 JSON-only writer couldn't target it. Phase 11 adds a third
`SchemaVariant` — `'mcpServers-yaml'` — and a `Continue` entry in
`INSTALLABLE_CLIENTS`. The shared `@apicircle/mcp-server` resolver
still returns the legacy `config.json` path (used by the manual
snippet-copy code path); the installer overrides Continue's path to
`.yaml` for the auto-install path.

Continue's existing keys (`name`, `version`, `schema`, `models`, etc.)
are preserved verbatim because we read → merge → write rather than
overwriting. 7 new unit tests covering create / update / unchanged /
foreign-key preservation / malformed-YAML handling.

`apicircle.mcp.autoConfigureClients` enum gains `continue`. **Install
MCP for All Configured Clients** now spans all 6 supported clients.

### 18.2 Mock endpoint visual editor (webview MVP)

**Files:**

- `apps/vscode/src/webview/mockEndpointEditor.ts` — webview panel +
  HTML + `parseMessage` validator.
- `apps/vscode/src/commands/editMockEndpoint.ts` —
  `apicircle.editMockEndpoint` command + `applyFormStateToMock`
  patch logic.

**Scope (MVP — by design):**
| Field | Editable in form |
|---|---|
| `method` | ✅ |
| `pathPattern` | ✅ |
| `defaultResponse.status` | ✅ |
| `defaultResponse.body.type` | ✅ (none / json / text / xml) |
| `defaultResponse.body.content` | ✅ |
| `defaultResponse.headers` | ⊘ stays YAML — preserved on save |
| `defaultResponse.delayMs` | ⊘ stays YAML — preserved |
| `defaultResponse.multipliers` | ⊘ stays YAML — preserved |
| `responseRules` | ⊘ stays YAML — preserved |
| `requestValidation` | ⊘ stays YAML — preserved |
| `requestSchema` | ⊘ stays YAML — preserved |
| `body.type` = form-data / urlencoded / binary | ⊘ display-only, save preserves |

**Security model:**

| #   | Guard                                                                                                                                 | Defeats                                             |
| --- | ------------------------------------------------------------------------------------------------------------------------------------- | --------------------------------------------------- |
| 1   | **Strict CSP** — `default-src 'none'`, per-session script nonce, no `connect-src`/`img-src`/`font-src`                                | XSS via webview content; remote-script injection    |
| 2   | **`localResourceRoots: []`**                                                                                                          | Filesystem reads from inside the webview sandbox    |
| 3   | **`parseMessage` validation** — method allowlist, status range 100–599, integer-only status, bodyType allowlist, endpointId non-empty | Malformed or hostile inbound `postMessage` payloads |
| 4   | **Host-side JSON parse-check** in `applyFormStateToMock`                                                                              | Bypass of inline highlight via crafted message      |
| 5   | **`applyMutation` round-trip** via `mock.upsert`                                                                                      | Direct writes that skip the patch contract          |

**Open flow:**

1. User right-clicks a `mock-endpoint` row in MockView → **Edit Mock Endpoint (Form)**.
2. Extension passes `{kind:'endpoint', serverId, endpointId}` (MockView shape).
3. `editMockEndpointCommand` looks up the endpoint, seeds the form, opens
   (or focuses) a webview panel.
4. User edits + Save → webview `postMessage({type:'save', state})` →
   `parseMessage` validates → `applyFormStateToMock` patches the existing
   MockEndpoint preserving every field the editor doesn't render →
   `surface.apply({kind:'mock.upsert', mock: next})`.

### 18.3 Test counts (Phase 11 close)

- **apps/vscode** — 856 tests across 86 files (up from Phase 10's
  831 / 84; +25 / +2: `mockEndpointEditor.test.ts` (11) +
  `editMockEndpoint.test.ts` (6) + 7 Continue tests in
  `mcpClientInstall.test.ts` + manifest + activation regression
  updates).
- **Monorepo** — 3613 tests across 327 files.

### 18.4 Bundle size

**2.16 MB** (+14 KB over Phase 10, still ~354 KB headroom under the
2.5 MB hard budget).

### Deferred from Phase 11

- ~~**Lazy-load `InProcessMockController`**~~ — **resolved by P12-1**
  (heavy parts were Hono + the MCP SDK, both externalized).
- ~~**Lazy-load embedded host's SDK transport**~~ — **shipped in
  Phase 12** via externalization (see §19).
- **Tsup CJS → ESM** — **deferred indefinitely with rationale** (see
  §19.2): would require bumping `engines.vscode` to ^1.94, which
  excludes a meaningful share of users on stable channels 1.85-1.93
  without a corresponding bundle benefit (P12-1 captured the wins).

**Phase 11 closes the original 11-phase deferred-list roadmap.** Phase
12 closes the carry-over indefinite items from Phase 11 + the E2E
coverage gap.

## 19. Phase 12 — Bundle externalize + E2E coverage closeout

Phase 12 is a polish phase: no new user-visible features, all wins are
under the hood. Two threads: (1) externalize the heavy SDK +
Hono deps to drop the bundle, (2) backfill E2E coverage for phases
that previously relied on unit + integration tests only.

### 19.1 Bundle externalize (the +1 win that retired 2 deferred items)

**File:** `apps/vscode/tsup.config.ts`.

Phase 10 added `@modelcontextprotocol/sdk` + its `@hono/node-server`
runtime to the bundle (~640 KB) for the embedded MCP host. Phase 12
moves these out of `dist/extension.js` into the .vsix's `node_modules`,
where Node's standard runtime resolver finds them via the existing
extension dependency tree.

**How it works:**

- `apps/vscode/package.json` declares `@modelcontextprotocol/sdk`,
  `@hono/node-server`, and `hono` as runtime `dependencies` — `vsce`
  packages these into the published .vsix's `node_modules` automatically.
- `tsup.config.ts` marks them `external` so esbuild leaves the
  `require()` calls untouched. At runtime, Node walks the standard
  module resolution path and finds them in the .vsix's `node_modules`.
- The `@apicircle/*` workspace packages stay `noExternal` (bundled
  into `dist/extension.js`) — they're small, and bundling keeps the
  cold-start parse fast.

**Wins:**

- Bundle: **2.16 MB → 1.69 MB** (−470 KB / 22%).
- Restored the original 2.0 MB hard budget (was bumped to 2.5 MB in
  Phase 10). Current headroom: 325 KB.
- Extension activation cost: only `dist/extension.js` is parsed at
  load; the externalized deps stay on disk until first `require()`
  fires through the @apicircle/\* layer (typically only on first
  embedded-host start or first mock-server start).

**Tradeoff:** the .vsix payload is unchanged on disk (same total
bytes), but split across `dist/extension.js` + `node_modules/`. That's
fine — VS Code's `.vsix` install copies the whole directory tree.

### 19.2 Why ESM migration stays deferred

VS Code 1.94+ supports ESM extensions (October 2024). Migrating would
require bumping `engines.vscode` from `^1.85.0` to `^1.94.0`, which
locks out users on 1.85-1.93 (still common in enterprise environments
and slower-moving Linux distros).

ESM's primary value-add was **enabling dynamic-import code-splitting**
for bundle wins. Phase 12 captured those wins via externalization
without changing format. Behavior-neutral migration with user cost ≠
load-bearing. Revisit if a future phase needs format-specific features
(e.g., top-level `await` in the extension entry).

### 19.3 E2E coverage closeout

Before Phase 12, `e2e/vscode/src/test/` had 14 specs covering Phases
1, 3, 4, 5, 6 + a live-GitHub harness. Phases 2, 8, 9, 10, 11 relied
on the unit + integration tier only (856 tests across 86 files in
`apps/vscode`). Phase 12 adds **5 new specs**, one per missing phase:

| Spec file                              | Covers                                                                                                   | Tests |
| -------------------------------------- | -------------------------------------------------------------------------------------------------------- | ----: |
| `2-environments-plans.test.ts`         | Phase 2 — Environments, Plans, History, Snapshots commands + view focus + empty-workspace short-circuits |     4 |
| `8-autoconfigure-vault-device.test.ts` | Phase 8 — autoConfigure + remember-device commands + setting defaults                                    |     4 |
| `9-notebooks-tests.test.ts`            | Phase 9 — Plan Notebook content type registration + `vscode.tests` API reachability                      |     3 |
| `10-embedded-mcp.test.ts`              | Phase 10 — embedded host commands + setting defaults (loopback / off) + safe-call when not running       |     6 |
| `11-continue-mock-editor.test.ts`      | Phase 11 — editMockEndpoint command + autoConfigure enum accepts `continue` + safe-call without node arg |     3 |

Pattern follows the existing P1/P3/P4/P5/P6 specs: short Mocha tests
inside `@vscode/test-electron` that prove **host-side wiring** is
correct. Deep logic coverage stays in the unit + integration tier
where it runs faster and gives better failure diagnostics.

**Total E2E spec count: 14 → 19**. Every phase from 1 through 11 now
has dedicated E2E coverage.

### 19.4 Test counts (Phase 12 close)

- **apps/vscode** unit + integration — 856 tests across 86 files
  (unchanged; Phase 12 changes are build-config + test-tier).
- **e2e/vscode** — 19 spec files (5 new in P12).
- **Monorepo** — 3613 tests across 327 files.

### 19.5 Bundle size

**1.69 MB** (−470 KB from Phase 11; 325 KB headroom under the restored
2.0 MB hard budget).

### Final deferred-items status

| #   | Item                                            | Origin | Final outcome                                  |
| --- | ----------------------------------------------- | ------ | ---------------------------------------------- |
| 1   | In-extension `McpHost`                          | P3     | Shipped P10                                    |
| 2   | Plan Notebooks                                  | P2     | Shipped P9                                     |
| 3   | Testing tab                                     | P2     | Shipped P9                                     |
| 4   | `vscode.lm.registerMcpServerDefinitionProvider` | P5     | Shipped P10                                    |
| 5a  | autoConfigure (5 clients)                       | P5     | Shipped P8                                     |
| 5b  | Continue auto-install (YAML)                    | P8     | Shipped P11                                    |
| 6   | OS-keychain remember-device                     | P4     | Shipped P8                                     |
| 7   | Mock visual editor                              | P3     | Shipped P11                                    |
| 8   | Tsup CJS → ESM                                  | P5     | **Deferred indefinitely with rationale** (P12) |
| 9   | Lazy `InProcessMockController`                  | P7     | Resolved transitively by P12-1                 |
| 10  | Lazy embedded-host SDK                          | P10    | Shipped P12 (externalization)                  |

**10 of 11 items resolved (9 shipped + 1 transitive); 1 deferred indefinitely with rationale.**

## 19a. Post-launch — lens-driven mock validation authoring

Feedback follow-up on the per-endpoint YAML editor (`*.endpoint.yaml`).
Adding a request-validation gate used to fire a chain of QuickPick /
InputBox dialogs (kind → target → expected) before the rule appeared.
That's now replaced with **insert-then-refine**, matching the rest of the
endpoint-edit UX where the change lands immediately as new YAML:

- **`🛡 Add validation rule`** (above `requestValidation:`) inserts a
  prefilled `header-required` rule with no prompts and reveals its
  `kind:` row.
- Each validation entry then carries three per-field CodeLenses, gated by
  the rule's kind:
  - **`◆ Kind`** (on the `kind:` row) — pick from the 9 kinds. The
    target / value rows **reshape** to match: switching into
    `body-required` drops both, into `content-type-equals` drops the
    target and seeds an empty value row, into `header-equals` seeds a
    value row. Same-family switches keep the existing target.
  - **`◆ Target`** (on the `target:` row, shown when the kind uses a
    target) — picks from the endpoint's own declared
    `requestSchema` params for the kind's family **first**, then for
    header kinds the curated global header catalogue
    (`HTTP_HEADERS_MAP` — the same map the Web + Desktop header editors
    surface), plus a `✏ Custom…` escape hatch.
  - **`◆ Value`** (on the `expected:` row, shown when the kind compares a
    value) — `content-type-equals` offers the Content-Type media-type
    catalogue, `header-equals` offers the picked header's known values
    (`getHeaderValues(target)`), and the `*-matches` kinds collect a
    regex through a validated input box.

**Files:** the kind table + the pure reshape / catalogue helpers live in
`apps/vscode/src/lang/mockValidationKinds.ts` (shared by the lens and the
commands so they can't disagree on what a kind needs). The commands
(`setMockValidationKind` / `Target` / `Expected`) parse the endpoint,
mutate the single rule, and re-render that entry via the lossless
`renderValidationRule` — `failResponse` and every other field round-trip
through the parser untouched. The lenses are emitted by
`EndpointCodeLensProvider` (`apps/vscode/src/lang/endpointCodeLens.ts`).

## 19b. Post-launch — full field-level CodeLens editing + capped multipliers

Extends the lens-driven authoring to the whole mock surface.

**Multipliers — array, soft-capped at 1.**
`MockResponseConfig.multipliers` stays a `MockResponseMultiplier[]`; a new
`MAX_RESPONSE_MULTIPLIERS = 1` constant (in `@apicircle/shared`) caps how many
the authoring surfaces allow today. The cap is a soft guardrail — the engine
(`applyMultipliers`) applies every entry, so raising the constant to N is the
only change needed (no migration, no engine change). Enforced in the
desktop/web editor (Add disabled at cap), the `*.endpoint.yaml` lenses
(`✱ Add multiplier` hidden at cap; `✕ Remove multiplier` per entry), and the
MCP tools (`mock.set_multipliers` / `prompt.set_endpoint_multipliers` reject
`length > MAX`).

**`*.mock.yaml` — per-endpoint open link.** Each endpoint summary row gets an
`↗ Open endpoint` lens (`MockCodeLensProvider`) that opens the editable
`*.endpoint.yaml` via `apicircle.openMockEndpointYaml` with the
`{ kind:'endpoint', serverId, endpointId }` MockView node shape — no
sidebar round-trip.

**`*.endpoint.yaml` — line-addressed `◆` field editors.** Each lens sits on
the field row it edits and passes `(uri, lineNumber)`. The command reads that
exact line, derives indentation from the document (so the **same** code path
works at any nesting depth — `defaultResponse`, a `responseRule.response`, or a
`validationRule.failResponse`), pops a kind-aware picker, and rewrites just that
line's value (or, for body type, the body subtree). All in
`apps/vscode/src/commands/mockFieldEdits.ts` with unit-tested pure helpers
(`replaceScalarOnLine`, `buildBodySubtree`, `buildConditionClause`,
`collectJsonArrayPaths`):

| Row                                          | Lens                          | Picker                                                            |
| -------------------------------------------- | ----------------------------- | ----------------------------------------------------------------- |
| `method:`                                    | `◆ Method`                    | the 7 HTTP methods                                                |
| any `status:`                                | `◆ Status`                    | common codes + custom 100–599                                     |
| header `- key:`                              | `◆ Key`                       | curated response-header names + custom                            |
| header `value:`                              | `◆ Value`                     | `getHeaderValues(name)` for the sibling header + custom           |
| body `type:`                                 | `◆ Body type`                 | the 7 body types (rewrites the subtree)                           |
| clause `scope:`                              | `◆ Scope`                     | the 5 condition scopes                                            |
| clause `op:`                                 | `◆ Op`                        | the 9 comparison ops                                              |
| clause `target:`                             | `◆ Target`                    | endpoint's declared params for the scope + custom                 |
| clause `value:`                              | `◆ Value`                     | free-text comparison value                                        |
| `when:`                                      | `✚ Add condition`             | inserts a fresh AND-clause                                        |
| multiplier `source.kind:`                    | `◆ Kind`                      | query / path / header / body-JSON                                 |
| multiplier `source.key:`                     | `◆ Key`                       | JSON-path input when kind is body-json-path, else a name          |
| multiplier `targetJsonPath:`                 | `◆ Path`                      | array paths discovered in the default-response JSON body + custom |
| multiplier `defaultCount:` / `min:` / `max:` | `◆ Count` / `◆ Min` / `◆ Max` | non-negative integer                                              |
| multiplier `name:`                           | `◆ Name`                      | free-text label                                                   |

The `◆ Body type` editor also reconciles the same config's `Content-Type`
header (json → `application/json`, none → drops the row). Generic scalar rows
route through two shared commands: `setMockTextField` (free-text) and
`setMockNumberField` (non-negative integer).

The status / body-type editors moved **off** the section-header rows onto the
field rows (less duplication). The walk that emits these tracks nesting context
(`headersIndent` / `whenIndent` / `multiplierIndent` / `sourceIndent`) so the
same `value:` / `key:` / `target:` / `kind:` token is interpreted correctly
whether it's in a headers list, a when-clause, or a multiplier source.

**Multiplier authoring.** `✱ Add multiplier` inserts a prefilled sample with no
prompts and hides once one exists; `✕ Remove multiplier` (on the `multiplier:`
row) clears it.

**Indentation is always derived from the document** — every field editor (and
the palette `switchMockResponseBodyType` / `addMockResponseHeader`, previously
mis-indented for nested response-rule headers and the default body) reads the
leading whitespace of the matched line rather than assuming a depth. Covered by
`apps/vscode/src/commands/mockFieldEdits.integration.test.ts`, which drives the
commands through the real parse → pick → edit → save → re-parse round-trip.

## 19c. Post-launch — mock & collection authoring overhaul

A feedback-driven sweep across all three `apicircle://` authoring surfaces.
Bundle: 2.37 MB → **2.44 MB** (under the 3.0 MB soft warn).

**Bug — `↗ Open endpoint` + lifecycle lenses.** `MockCodeLensProvider` read the
mock id from the URI **path basename**, which is the human-readable name slug —
so the command received a slug and missed `synced.mockServers[id]`. It now reads
the id from the `?id=` query (`new URLSearchParams(uri.query).get('id')`), with
the legacy path parse as a fallback.

**`*.endpoint.yaml` additions** (all in `endpointCodeLens.ts` +
`mockFieldEdits.ts` / `mockRequestSchemaEdits.ts`):

| Surface              | What changed                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| -------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| clause `value:`      | now routes to `setMockClauseValueField` — offers the header value catalogue for `scope: header`; the lens is hidden for `present` / `absent` ops                                                                                                                                                                                                                                                                                                                                    |
| rule `✚ Add header`  | anchored on the rule's `response.headers:` block (was the `- id:` row)                                                                                                                                                                                                                                                                                                                                                                                                              |
| rule `when`          | capped at `MAX_RESPONSE_RULE_CONDITIONS = 1` — `✚ Add condition` hidden once a clause exists. A rule with **zero** `when` clauses is a **red Error that blocks the save** (`parseEndpointFromYaml` rejects it): an unconditional rule shadows the default response on every request                                                                                                                                                                                                 |
| header `- key:` rows | gain a `✓ Enable` / `⊘ Disable` toggle (`toggleMockHeaderEnabled`)                                                                                                                                                                                                                                                                                                                                                                                                                  |
| `requestSchema`      | each `✚ Path/Query/Header/Cookie param` lens anchors **on its own subsection line** (`pathParams:` / `queryParams:` / `headers:` / `cookies:`), and `✚ Body example` on `body:` (or all on the `requestSchema:` header when absent / `✚ Add request schema` when the block is missing). Per-param field editors are `◆ Name / ◆ Type / ◆ Example` — the boolean `required:` row has **no** lens (edited directly in YAML). Path params prefill from the pattern's `{slot}` segments |
| JSON body `content:` | `⟳ Format JSON` reflows a stringified body (`formatJson.ts`)                                                                                                                                                                                                                                                                                                                                                                                                                        |

**`*.req.yaml` — collection-request parity** (`requestFieldEdits.ts` +
`requestCodeLens.ts`): `◆ Method`, header `◆ Key` / `◆ Value` (catalogue-aware),
query / cookie key + value, path-param values, assertion kind/op, and extraction
source — the request-side mirror of the mock field editors. The `url:` row
has **no** `◆` field editor — the URL is edited inline, and on save
`parseRequestFromYaml` syncs any `?key=val…` typed in the URL into the
structured `query:` block (URL wins for enabled rows; disabled rows pass
through; new URL keys append in order; a trailing `#fragment` is dropped) and
any `{name}` / `:name` placeholders in the path into `pathParams:` (existing
values preserved; new placeholders get an empty-string slot; stale keys
aren't auto-pruned). **Auth** scalar fields have **no** `◆` field editor
(edited directly in YAML); only `⟳ Format JSON` on the JSON auth fields
(`payload` / `jwtHeaders`) is kept. **Form-data** `✚ Add text row` / `✚ Add
file row` anchor on the `formRows:` line inside the body block; switching a
row kind is per-row only (`↻ Switch to text/file`).

**`APICircle: New Request`** (`newRequest.ts`) is a single **folder pick** —
choose an existing folder, the top level, or create a new folder inline — after
which a ready-to-edit **GET scaffold** (placeholder URL, `Accept` header, sample
`page` query, no auth) opens for the user to tweak and send. Invoked from a
folder's context menu, the pick is skipped. (The earlier 5-step wizard — method →
URL → folder → auth → name — is gone; everything is edited in the YAML instead.)

**Startup editor adoption** (`extension.ts`): on activation, after discovering
`.apicircle/workspace.json`, the extension inspects the editors VS Code restored
and, if one is an `apicircle://` virtual YAML or the raw
`.apicircle/workspace.json`, makes that editor's workspace the active one — so
the sidebar / status bar / MCP snippets match what's already on screen.

**Structural validation** (`lang/diagnostics.ts` + `fs/yamlStructure.ts`): an
`apicircle` `DiagnosticCollection` re-runs the parser on open/change and shows
the problem before save. A renamed / mistyped **top-level key**, or a section
with the wrong type (e.g. `responseRules: oops`), is a **red Error that blocks
the save** (the FS provider's `writeFile` already converts the parser's
`*ParseError` into `FileSystemError.NoPermissions`) — previously those would
silently drop the section. Coercible value-level issues stay yellow Warnings.
Covers endpoint, mock, and request YAML.

**Web / Desktop `requestSchema` editor.** The cross-surface gap is closed:
`packages/ui-components/src/panels/mocks/MockRequestSchemaEditor.tsx` (mounted in
the mock endpoint editor's Endpoint node) edits the same `requestSchema` the VS
Code YAML does — four param tables + "Derive from path" + body-shape docs,
routed through the existing `updateMockEndpoint` store action. See
[`docs/mock-server.md`](mock-server.md) §"Request schema across surfaces".

## 19d. Post-launch — Link Workspaces view + release lifecycle

The dormant, off-by-default **Marketplace** stub (`apicircle.marketplace`,
gated behind `apicircle.enableMarketplace`) is replaced by an always-on **Link
Workspaces** view (`apicircle.linkWorkspaces`). Phase 1 wires the publishing
side of the link/release loop — a workspace's **release ledger**
(`synced.releases.self`), the versions linked consumers pin to.

**Mutation contract.** Three additive `WorkspacePatch` variants land in
`@apicircle/core`: `release.publish` (carries a pre-built `ReleaseVersion` — the
async SHA-256 `workspaceSnapshot` is computed by `buildReleaseEntry` so the
reducer stays pure + synchronous), `release.deprecate`, and `release.yank`. The
extension is a well-behaved headless writer: every release write routes through
`surface.apply` → `applyMutation`. The same patches are exposed as four MCP
tools (`release.list` / `.publish` / `.deprecate` / `.yank`, 81 → 85 catalog).

**Surfaces.**

- **TreeView** (`LinkWorkspaceView`) — a **Releases** group: the current version
  - every published version newest-first, each with deprecated / withdrawn
    status and a `tag` / `warning` / `circle-slash` icon. A **Publish release**
    title button; per-version **Deprecate** / **Withdraw** context-menu actions.
- **`apicircle://<ws>/releases/releases.yaml`** — a read-only generated document
  (`releasesYaml.ts`). Writes are blocked: the ledger is action-driven, never
  edited by hand (publishing needs the async snapshot; deprecate / withdraw are
  per-version transitions).
- **CodeLens** (`releasesCodeLens.ts`) — **▶ Publish release…** on the
  `currentVersion:` line; **⚠ Deprecate** / **⛔ Withdraw** on each `- version:`
  row, hidden when the action is already in effect (reads the sibling `status:`).
- **Commands** (`releaseActions.ts`) — `apicircle.openReleaseHistory`,
  `apicircle.publishRelease` (patch / minor / major QuickPick off the current
  version, or a custom semver, + notes prompt + confirm), `apicircle.deprecateRelease`
  (confirm), `apicircle.withdrawRelease` (typed `WITHDRAW v<x>` confirmation).

## 19e. Post-launch — linked-workspace consuming side + GitHub tagging/topics

Completes the link loop in the extension (previously Desktop/Web-only).

**Mutation contract.** Three additive `linkedWorkspace.*` `WorkspacePatch`
variants in `@apicircle/core`: `upsert` (link record + optional cached ledger +
collections/environments snapshot), `remove` (cascades across
`releases.perLink`, `linkedOverrides`, `local.linkedCollections`, and the
per-link GitHub session), and `applyUpdate` (atomic three-way-merge result).
The pure `parseLinkedWorkspaceJson` / `buildLinkedSnapshot` / `ledgerFromProbe`
helpers move into `@apicircle/core/linked` so the store, VS Code, and CLI share
one implementation. Four MCP tools expose the pure-data config:
`linked.list` / `linked.get` / `linked.set_config` / `linked.unlink`
(85 → 89 catalog).

**GitHub auth.** `@apicircle/git`'s `GitHubClient` (token per-call) driven by
VS Code's built-in `vscode.authentication.getSession('github', ['repo'])`
(`host/githubAuth.ts`) — no PAT vault. Anonymous-friendly flows (marketplace
search) pass a silent token when one exists; link / tag flows prompt sign-in.

**Surfaces.**

- **TreeView** — a **Linked workspaces** group (`repo`-icon rows showing
  `kind · pin`) beside the Releases group. Title actions **Link a Workspace…**
  - **Search Marketplace…**; per-row context menu **Review update / Refresh /
    Changelog / Unlink**.
- **`apicircle://<ws>/links/<name>.link.yaml`** (`linkYaml.ts`) — editable
  config (name, description, pinnedVersion, scope, sessionMode,
  requiredSecretKeyIds, marketplace); read-only identity (repoFullName, branch,
  kind, linkedAt) is preserved on save. `pinnedVersion` is validated against the
  cached ledger at save time. `delete` unlinks.
- **CodeLens** (`linkCodeLens.ts`) — ◆ field editors + **⤓ Review update ·
  ⟳ Refresh ledger · 📓 Changelog · ⊗ Unlink** on the name line; ✚/⊘ on each
  required-key row.
- **Commands** (`linkActions.ts`) — `linkWorkspace` (repo/branch/version pick →
  fetch → `buildLinkedSnapshot` → `linkedWorkspace.upsert`), `searchMarketplace`,
  `refreshLinkedWorkspace`, `reviewLinkedUpdate` (preview + bulk
  accept-source/keep-mine → `linkedWorkspace.applyUpdate`), and the pure config
  field editors / unlink.
- **Repo-side release ops** (`repoActions.ts`) — `tagRelease` (creates a
  `v<x>` tag on the default-branch HEAD, optional GitHub Release; replace-on-
  exists) and `editRepoTopics` (keeps `apicircle`, validates GitHub's topic
  rules). Owner/name is derived from the folder's `origin` remote, falling back
  to a prompt.

**Streamlined vs. Desktop.** The native (no-webview) update review offers a
single **Accept all source / Keep all mine** decision rather than the Desktop
modal's per-entry conflict picker — the same `previewLinkedUpdate` /
`applyLinkedUpdate` core engine, a simpler resolution surface. Per-entry
resolution + dedicated-session credential storage are the remaining deltas.

## 19f. Post-launch — linked-workspace gap closure (consume / merge / secrets)

Completes the consuming side so a linked workspace is usable, not just manageable.

- **Linked requests are runnable.** A linked workspace expands to its cached
  requests; each opens as the EFFECTIVE request (source + override) at
  `apicircle://<ws>/linked/<link>/<name>.req.yaml`. Editing + saving stores a
  minimal override (`computeRequestOverridePatch` diffs against the
  same-round-tripped source so parser defaults don't register as edits);
  **▶ Send** runs it via the shared send path; **↺ Reset to source** / delete
  drops the override; **Discard all modifications** clears a link's overrides.
- **Per-entry update review.** `reviewLinkedUpdate` offers _Resolve each_
  (decision per conflict) plus bulk _Accept all source / Keep all mine_.
  Field-level **auto-merge** (core `previewLinkedUpdate.autoMergeable`) means a
  conflict only surfaces when the override and the source changed the _same_
  field — disjoint edits merge silently.
- **Dedicated sessions.** `sessionMode: dedicated` links keep a per-link PAT in
  `context.secrets` (🔑 Set / Clear token, or auto-stored when you provide one);
  fetches use it instead of the built-in GitHub session.
- **Required-secret provisioning.** 🔑 Provide value on each required-key row
  stores an OS-encrypted value in `context.secrets`; wiped on unlink.
- **Override patches** (`linkedOverride.*`) + the shared
  `mergeRequestOverride` / `computeRequestOverridePatch` core helpers back all
  of the above.

## 19g. Post-launch — send-time resolution, attachments, CLI

Closes the platform-wide items previously called out under §19f.

**Send-time variable/secret interpolation.** `apicircle.sendRequest` now runs
the request through a shared core resolver (`resolveRequestForExecution` in
`@apicircle/core/environment`) before handing it to `executeRequest`. The
resolver layers, in precedence order:

1. `request.contextVars` (highest)
2. plan variables / `globalContext` extractions
3. local + linked envs, ordered by `synced.environments.priorityOrder` —
   linked envs join the priority list as `{kind:'linked', linkedWorkspaceId,
envName}` and pass through `applyLinkedEnvironmentOverrides` so the
   consumer's `linkedOverrides.environmentVars` apply before lookup
4. secrets (lowest) — provisioned values for every linked workspace's
   `requiredSecretKeyIds`, keyed by their `SecretKeyMeta.label`

Vault-encrypted env rows are decrypted up-front (`VsCodeVaultManager.decryptValue`).
Rows the vault can't decrypt (locked / corrupt) are dropped silently and the
placeholder reports as missing — a non-blocking notification surfaces missing
names so the user knows why a literal `{{TOKEN}}` reached the wire.

**Linked binary-attachment download.** When a linked request carries a binary
body or `formRows: [{kind:'file'}]`, the executor's `resolveAttachment` hook
fetches the bytes from the source repo's `.apicircle/attachments/<slotId>`
over GitHub (`GitHubClient.getBinaryContents`) at send time. Per-send cache;
respects the link's `sessionMode` (dedicated PAT first, otherwise the built-in
GitHub session). Owned-request attachments still surface the canonical
"Attachment X required but not downloaded locally" error — they need an IDB
model the extension doesn't have, and aren't a linked-workspace concern.

**Linked env-var override editor.** `apicircle.setLinkedEnvVarOverride` prompts
for link → env → var (or "add a new variable…" to inject) → mode (replace /
remove / reset). Routes through the `linkedOverride.setEnvVar` /
`removeEnvVar` patches.

**Linked envs in the priority picker.** `setEnvPriorityOrder` enumerates local
envs AND every cached linked workspace's envs in the multi-pick step, and
persists a heterogeneous `EnvPriorityRef[]` (`local` + `linked` kinds) as the
resolver expects.

## 20. See also

- [Architecture: platform](architecture/platform.md) — surfaces design record
- [MCP tools reference](mcp-tools-reference.md) — the catalog the extension exposes
- [Auth matrix](auth.md) — the 17 auth types it supports
- [Mock server guide](mock-server.md) — the engine it embeds
- [Connect your AI client](connect-your-ai-client.md) — wiring Claude/Cursor/etc.
