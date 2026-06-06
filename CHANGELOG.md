# Changelog

> ### ⚠️ macOS install note — remove the quarantine flag
>
> The desktop builds are **unsigned** until code-signing certificates are
> funded. On macOS Sequoia and newer, this means that after dragging
> **API Circle Studio** into `/Applications`, the first launch can fail with
> _"API Circle Studio is damaged and can't be opened. You should move it to
> the Trash."_ — and the **Open Anyway** button under System Settings →
> Privacy & Security may not appear at all. The binary is fine; macOS is
> refusing to run anything carrying the download-quarantine extended
> attribute from an unidentified developer.
>
> Open **Terminal** and run this once to strip the flag, then re-launch the
> app from `/Applications`:
>
> ```
> xattr -d com.apple.quarantine /Applications/API\ Circle\ Studio.app
> ```
>
> If Terminal answers `No such xattr` the flag was already absent — ignore
> the message. Repeat the command once per auto-update until signed builds
> ship. Full per-platform walk-through:
> [`docs/installing.md`](docs/installing.md).

## 1.0.9 - 2026-06-06

### Global File Assets — provenance state machine + unified upload flow

- **All file uploads now mint a reusable Global Asset.** Dropping a file
  into a form-data row (`attachFormFile`), a binary request body
  (`attachBinaryFile`), or a mock-server binary response
  (`attachMockResponseFile`) now creates a `GlobalFileAsset` entry the
  same way the Global Assets sidebar does. The consumer (row, body, or
  mock response) carries `globalFileAssetId` instead of a private slot,
  so every file in the workspace is discoverable from the Global Assets
  library and gets a cross-cutting reference count. (Behavior change:
  clearing a row no longer auto-deletes the bytes — the asset becomes
  "Unused" in the library so the user can prune deliberately.)
- **Per-asset provenance state machine.** Every Global File Asset gains
  two optional ref slots — `workingBranchRef` and `baseBranchRef` — and
  six lifecycle states: `uploading`, `workingOnly`, `merged`, `baseOnly`,
  `missing`, `diverged`. The push flow stamps `workingBranchRef` with
  the GitHub blob sha + commit sha after every successful push. The
  refresh flow runs a verification pass that probes each ref, drops
  ones that 404, opportunistically promotes the base ref when the PR
  merges, and runs a cleanup invariant that drops the working ref when
  both refs hold the same blob (single source of truth = base).
  (`packages/shared/src/types.ts`,
  `packages/core/src/workspace/patches.ts`,
  `packages/core/src/workspace/applyMutation.ts`,
  `packages/ui-components/src/store/workspaceStore.ts`)
- **Pre-push buffer + reference index in `WorkspaceLocal`.**
  `pendingFileUploads` records assets whose bytes are in IDB but not
  yet on a Git ref so the "Uploaded locally" pill flips immediately on
  drop. `assetUsageIndex` is a cross-cutting "used in N places" map
  recomputed by `assetUsageAggregator` on every `commitSynced` (same
  pattern as `usedInAggregator`). The index walks request bodies AND
  mock-server response bodies — the legacy per-asset walker only
  scanned requests.
- **Status pills + ref-count UX across four surfaces.** New
  `<FileAssetStatusPill>` primitive shipped, wired into the Global
  Assets sidebar (list rows + detail editor), form-data row editor,
  binary body editor, and mock-response binary body editor. Pill
  reflects the live ref state; hover surfaces the verified branch and
  consumer count. Removal confirmation now lists every affected
  request and mock endpoint with a "Delete and unbind N" CTA, gated
  by `ConfirmDialog`'s typed-confirm path.
- **Four new MCP tools.** `assets.list_files` (provenance state
  - usage map per asset), `assets.create_file` (metadata-only —
    bytes are out-of-band by design since MCP can't carry blobs),
    `assets.update_file` (rename / re-describe, refs preserved),
    `assets.delete_file` (cascade with consumer list in the
    response envelope). 78 MCP tools total now.
    (`packages/mcp-server/src/tools/globalAssets.ts`)
- **Test coverage.** 10 new patch tests for the asset state-machine
  variants, 9 aggregator tests, 13 status-pill tests, 1 push test
  pinning the post-commit ref stamp, 2 refresh tests pinning the
  verification probe + cleanup invariant, 9 MCP tool tests, plus the
  three direct-upload editor tests rewritten for the new "orphan ->
  Unused" contract.

### Git layout — the synced workspace doc lives under `.apicircle/`

- **`workspace.json` moved from the repo root into `.apicircle/`.** Every
  Git-backed workspace now lays out as:
  ```
  .apicircle/
  ├── workspace.json
  └── attachments/<slotId>
  ```
  Attachments already lived under `.apicircle/` since 1.0.0 — that's where
  the dotfolder name came from. Co-locating the synced doc next to its
  attachments finally consolidates everything API-Circle-managed under a
  single hidden directory so a workspace repo can host READMEs, CI files,
  and unrelated tooling at the root without colliding with our payload.
  This is a hard cutover (no legacy fallback): connect a repo to 1.0.x and
  re-push so the new push lands `.apicircle/workspace.json`. Existing
  example repos and template forks need to be re-laid-out by their
  owners — there is no in-place migration.
  (`packages/core/src/git/repoPaths.ts`,
  `packages/core/src/git/repoPaths.test.ts`,
  `packages/core/src/git/serializeWorkspace.ts`,
  `packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/store/pushWorkspace.test.ts`,
  `e2e/web/live-github/_github-rest.ts`)
- **GitHub API surface unchanged.** Push still flows getRef → getCommit →
  optional createBlob (attachments) → createTree → createCommit →
  updateRef; only the path inside the tree entry changed. Refresh, link
  probes, linked-update apply/preview, release-ledger reads, and the
  seed-initial-commit on empty repos all now address
  `.apicircle/workspace.json` directly.

### Bug fix — file uploads no longer vanish during auto-refresh

- **`refreshWorkspace` race repaired.** A file dropped into a form-data row
  (`attachFormFile`) or uploaded via the Global Assets sidebar
  (`addGlobalFileAsset`) while a refresh was in-flight could disappear
  within two seconds. Root cause: `refreshWorkspace` captured `synced`
  at function entry, then awaited two GitHub round-trips
  (`probeBranchRetirement` + `getContents`) before computing the
  3-way diff. Any mutation that landed during that 200ms–2s window
  was silently dropped by the auto-merge path because `applyMerge`
  saw the pre-upload snapshot, and `persistMerged` then wrote the
  merged-without-the-file doc back via `set({ synced: merged })`.
  The fix re-reads `synced` / `local` from the store immediately before
  `computeThreeWayDiff`, so the merge honors any in-flight edits.
  Trigger surface: `useFocusRefresh` cold-fires `refreshWorkspace()`
  on workspace mount whenever a working branch is connected, which is
  how the race became reproducible in seconds.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/store/refreshWorkspace.test.ts`)

### Test coverage — new live-GitHub spec for file uploads

- **`16-form-data-file-uploads-live.spec.ts`** pins both file-upload
  paths through a real GitHub push: Global Assets sidebar upload bound
  to a form-data row + direct file upload via `attachFormFile` on a
  separate row. Asserts the synced doc carries the right bindings,
  both blobs land at `.apicircle/attachments/<slotId>` on the remote
  working branch, and the bytes round-trip unchanged. Also pins the
  current contract that direct form-data uploads stay private to their
  row (NOT auto-registered as Global Assets) — that assertion is the
  canary for any future change that promotes them.
  (`e2e/web/live-github/16-form-data-file-uploads-live.spec.ts`)

## 1.0.8 - 2026-06-03

The workspace-sync hardening release. The disk-mirror loop between the
desktop, the MCP server, the CLI, and any external editor of
`workspace.synced.json` finally closes: MCP no longer pins to whichever
workspace was active at boot, desktop hydrate no longer clobbers writes
made while it was closed, and external file changes auto-surface in the
running UI without the user clicking **Refresh**. Registry changes from
the CLI flow into the switcher live, and the switcher disambiguates
name collisions so legacy duplicates aren't a dead end. Workspace name
uniqueness is now case-insensitive end-to-end, and the refresh toasts
report on-disk request / folder / environment counts so an AI client
that claims to have created a 21-request collection while the desktop
only sees one can be spotted at a glance.

### Workspace sync — MCP / CLI / desktop now share one source of truth

- **MCP server no longer pins to its boot-time active workspace.**
  `MultiWorkspaceProvider` used to cache the per-id
  `FileBackedWorkspaceProvider` resolved at `init()` time. If the user
  switched workspaces in the desktop while their AI client's MCP server
  was already running, MCP kept writing to the OLD workspace and the
  desktop never saw the writes. The active provider is now a lazy
  wrapper that re-reads `registry.json` on every `read` / `apply` /
  `write` call — one tiny JSON read per tool call in exchange for
  always-correct routing.
  (`packages/mcp-server/src/providers/MultiWorkspaceProvider.ts`,
  `MultiWorkspaceProvider.test.ts`)
- **Desktop boot no longer overwrites MCP / CLI writes made while it was
  closed.** Before this fix, `hydrate()` always queued an IDB→disk write
  at the end of boot, regardless of which side was newer — so any
  `apicircle-mcp` or `apicircle` CLI edits to `workspace.synced.json`
  silently disappeared the next time the desktop opened. Hydrate now
  compares `meta.updatedAt` between IDB and disk: when disk is newer
  (an external writer changed the file while the desktop was closed),
  the store adopts the on-disk doc and the boot-time IDB→disk write is
  skipped. The pre-existing one-time-merge path (different
  `workspaceId`s) is unchanged.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/store/hydrateDiskAdoption.test.ts`)
- **`refreshFromDisk` no longer flushes pending IDB writes before
  reading disk.** The MCP-panel Refresh button used to start by draining
  `flushPendingPersist()`, which could write a stale in-memory snapshot
  to disk on top of fresh MCP / CLI content. The order is now read →
  decide → (optionally) flush, so a click on Refresh can never destroy
  what it's meant to surface.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `refreshFromDisk.test.ts`)
- **Refresh-from-disk persists the adopted state to IndexedDB.** When
  refresh sees a newer disk doc, it now writes that state back to IDB
  immediately instead of waiting for the next user mutation. Closes a
  small window where a crash between adoption and the next mutation
  would lose the freshly-imported content.
  (`packages/ui-components/src/store/workspaceStore.ts`)

### Auto-refresh on external file changes

- **The renderer reflects MCP / CLI / hand-edits without a click.** The
  desktop main process now watches `<userData>/workspaces/` and the
  per-id `workspace.synced.json` files. When an external writer
  touches one, the renderer auto-fires `refreshFromDisk` so the editor
  and Environments panel pick up the change immediately. Self-writes
  from the desktop's own mirror are suppressed via a stat-snapshot
  (`{mtimeMs, size}`) recorded after each manager write — robust
  against OS event delays and burst writes (an earlier prototype's
  1.5s time window had both failure modes).
  (`apps/desktop/src/main/workspaceFile/workspaceWatcher.ts`,
  `apps/desktop/src/main/workspaceFile/workspaceFileManager.ts`,
  `apps/desktop/src/main/ipc/workspaceFileBridge.ts`,
  `apps/desktop/src/main/preload.ts`, `apps/desktop/src/main/main.ts`,
  `packages/ui-components/src/desktop/bridge.ts`,
  `packages/ui-components/src/App.tsx`, `workspaceWatcher.test.ts`)
- **Registry changes from CLI / MCP appear in the desktop switcher.**
  The watcher's `'registry'`-event branch used to no-op. It now calls
  the new `refreshRegistryFromDisk` store action, which re-reads
  `<root>/registry.json` and pushes it into `workspaceRegistry` so a
  `apicircle workspaces create` run alongside the desktop surfaces in
  the switcher without a restart. A toast announces how many new
  workspaces appeared.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/App.tsx`,
  `packages/ui-components/src/store/refreshFromDisk.test.ts`)
- **Boot ordering: watcher attaches before the renderer window opens.**
  `startWorkspaceFileWatcher(...)` now runs before
  `mainWindow = createWindow()` so any boot-time renderer writes go
  through a `WorkspaceFileManager` that already has self-write
  suppression wired. Previously a small window existed where the
  watcher saw the desktop's own initial mirror write as "external" and
  triggered a needless refresh cycle. (`apps/desktop/src/main/main.ts`)
- **End-to-end desktop coverage for the auto-refresh path.** New
  Playwright spec `e2e/desktop/external-write-refresh.spec.ts` boots
  the Electron app, writes `workspace.synced.json` externally
  (simulating an MCP / CLI write), and asserts the new request appears
  in the editor without the user clicking Refresh. A second case
  appends a workspace to `registry.json` and asserts the switcher /
  toast picks it up.

### Workspace name uniqueness — case-insensitive end-to-end

- **Workspace create + rename are now case-insensitive unique.**
  Previously `My Workspace` and `my workspace` could coexist (the CLI
  rejected the collision, but the desktop's persistence helper only
  did a case-sensitive compare). Both `createWorkspace` and
  `updateRegistryEntryName` in `workspaceStorage.ts` now use a
  case-insensitive guard, matching the CLI's existing behaviour.
  (`packages/ui-components/src/persistence/workspaceStorage.ts`)
- **Workspace switcher disambiguates colliding names.** When two
  registry entries share a name (case-insensitive) — leftover from
  pre-1.0.8 builds or a legacy-migration race — the switcher appends
  a short `#xxxx` id suffix to ONLY the colliding rows so the user
  can tell them apart. Unique names render unchanged.
  (`packages/ui-components/src/layout/WorkspaceSwitcher.tsx`)

### Refresh visibility

- **Refresh toasts now report on-disk counts.** "Already up to date" /
  "Workspace refreshed from disk" / "Merged in" all include a
  `1 request · 0 folders · 1 environment` line, so when an AI client
  claims to have created a 21-request collection but the desktop only
  sees `httpbin`, the mismatch is visible at a glance instead of hiding
  behind a generic success toast.
  (`packages/ui-components/src/panels/mcp/mcpPanelTypes.ts`,
  `packages/ui-components/src/panels/mcp/ConnectionSection.tsx`)

### Internals

- **CI: `visual-baseline` job is now manual-dispatch only.** The Linux
  baseline PNGs are not committed yet, so the job ran every push to main
  as a no-op (`continue-on-error`) only to upload first-run artifacts.
  It's now off by default and triggered on demand from the Actions tab
  when (re)generating baselines. No change to local
  `pnpm test:e2e:visual`. (`.github/workflows/e2e.yml`,
  `docs/qa/README.md`, `CLAUDE.md`)

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`,
`@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`,
`@apicircle/mcp-server`, `@apicircle/mock-server-core`,
`@apicircle/shared`, plus the e2e and example workspaces — all at
`1.0.8`.

## 1.0.7 - 2026-06-02

The portable-exchange and encrypted-env hardening release. Folders ship to —
and re-attach from — a single self-describing `.apicircle.json` envelope
through the UI, CLI, and MCP, with per-credential opt-in so secrets never
leak by accident. Environment exports now travel with their ciphertext
(envelope v2) so re-imports stop forcing manual rebinds across machines,
and the Environments panel + Vault dock surface the missing-slot /
decrypt-failure cases that previously dead-ended users. The MCP Prompts
cards copy reliably (and the workspace-scope chip is renamed to
**Collections**). The default theme and font revert to **One Dark Pro** +
**System Sans** — the 1.0.5 Command Center + Cascadia Code defaults are
still one click away under Settings → Appearance — and the font picker
hides any catalog entry that silently falls back to your OS default face.

### Folder export hardening — credentials, CLI, MCP, re-attach toast

- **Security:** the Export Folder modal now enumerates every credential-bearing
  field detected inside the subtree (Bearer tokens, OAuth2 client secrets +
  access + refresh tokens, AWS SigV4 secret keys, NTLM / Digest passwords,
  Hawk keys, JWT signing material, `api-key.value`). They are **redacted by
  default**; the user opts each one in via a per-row checkbox. The summary
  bar surfaces the live counter ("3 credentials will be redacted" → "1
  credential included · 2 redacted"). Redaction blanks credential fields to
  `""` and keeps identity fields (clientId, username, tokenUrl, …) so the
  importer still knows which IdP the request belonged to. Same fail-safe
  shape as `redactForGit`.
- **`applyMutation` parity:** new `folder.import_apicircle` patch variant +
  applyMutation switch case so headless writers (CLI, MCP, future automation)
  graft an envelope through the same single mutation choke point the UI
  store uses. The pure graft logic moved into
  `@apicircle/core/workspace/apicircleFolderImport`;
  `apicircleImportAction.ts` in `ui-components` is now a thin re-export
  shim.
- **MCP catalog:** two new tools (now 74 total).
  - `folder.export_json` — collect a folder envelope. Accepts an optional
    `includeCredentialIds` array (same id shape the export modal uses) and
    redacts everything else. Returns `{ envelope, json, filename, report }`.
  - `folder.import_json` — accept either `json` (string) or `envelope`
    (object). Routes through
    `WorkspaceProvider.apply({ kind: 'folder.import_apicircle' })`, so
    name-uniquify + dependency dedupe semantics are identical to the UI.
- **CLI:**
  - `apicircle export folder <name-or-id> [--out file] [--include-credential <id> ...] [--list-credentials]`
    — write the envelope to disk or stdout. `--list-credentials` prints the
    detected credential rows so users can pick which `--include-credential`
    ids to pass.
  - `apicircle import apicircle <file>` (new source-type) — graft an
    envelope via `folder.import_apicircle`. Emits a re-attach note on
    stderr for any file-asset metadata that landed without bytes.
- **Re-attach toast:** importing an envelope that carries file-asset metadata
  now surfaces a one-time info toast pointing the user at **Global Assets →
  Global Files**, eliminating the previous silent-fail UX.
- **E2E:** new `e2e/web/folder-export.spec.ts` covering the kebab → modal →
  redact toggle → download → re-import round trip (intercepted via the
  Playwright `download` event).

### Encrypted env vars — Export-as-JSON now carries ciphertext (envelope v2)

- `apicircleEnvironment` envelope bumped from **v1 → v2**. Encrypted
  variables now travel with their ciphertext + per-slot salt + slot
  label, matching the contract Git push/pull has always had. On the
  destination, the row decrypts with the user's local slot value at
  request-execute time — no more forced manual rebind on every
  machine. v1 envelopes still parse for back-compat; the parser
  surfaces `payloadVersion: 1 | 2` so consumers can fork behavior.
- Import-side resolution split: when the source's salt matches a
  destination slot's salt (same workspace re-import, or two machines
  that genuinely share the slot value), the row re-points and works
  immediately. When the salts differ, a new slot is minted from the
  source's salt + label so the row binds to something self-consistent
  and the user is asked to provide the matching plaintext via the
  existing missing-slots gate. The colliding-id case (different
  source slot, same id by chance) generates a fresh id; the
  destination's slot stays untouched.
- `applyMutation` gains a new patch variant: `secretKey.upsert` —
  used by MCP `environment.import` to mint slot metadata atomically
  alongside the env upsert. The MCP response now includes
  `mintedSlots` so AI clients can surface what the user needs to
  provide. Headless writers (CLI, future automation) get the same
  surface.
- Plaintext slot VALUES still never leave the device. The change
  shipped here is symmetric with Git: ciphertext + slot-derivation
  parameters travel, the plaintext lives only on the user's machine.

### Encrypted env vars — Decrypt-failure banner on the Environments panel

- The resolver used to silently substitute `<MISSING:LABEL>` for ANY
  decryption failure — including the case where the user provided a
  slot value but it didn't decrypt the row's ciphertext (a re-keyed
  slot, a passphrase change, a typo on re-entry). The user only
  noticed when the request hit the wire with a literal
  `<MISSING:LABEL>` and the upstream returned a 400.
- The Environments panel now surfaces a per-env banner listing the
  rows that failed to decrypt with a concrete next step:
  _"`KEY_NAME` — slot `LABEL` — open the Vault dock and re-enter the
  slot value, or use the row's Unbind button to clear the value and
  type a fresh plaintext."_ `missing-slot-value` is intentionally
  excluded from the banner (the Vault's `ProvideMissingSlotsGate`
  already handles that case loudly enough); the banner focuses on
  `decrypt-failed` + `invalid-ciphertext` rows the user can't fix
  without more context.
- The wire request still carries `<MISSING:LABEL>` for the failed
  rows — that behavior is unchanged. The banner just tells the user
  WHICH slot failed and WHY before they see the wire response.
- New workspace-store surface: `envDecryptFailures` +
  `clearEnvDecryptFailures()`. `decryptEnvironments` returns
  structured failure reasons (`missing-slot-meta` /
  `missing-slot-value` / `invalid-ciphertext` / `decrypt-failed`)
  consumed by the banner and any future surfaces (e.g. a CLI warning
  on `apicircle run`).

### Encrypted env vars — Unbind no longer dead-ends on decrypt failure

- Clicking **Unbind** on an encrypted environment variable used to
  return a silent toast ("Could not unbind secret key") whenever the
  row's ciphertext couldn't be decrypted with this device's slot value
  — a common situation after pulling a workspace whose secret slot
  hasn't been re-provisioned, or after a passphrase change. The user
  was stuck: the only workaround was to rename the variable key, which
  forced the row out of the encrypted branch by side effect.
- Unbind now surfaces a confirm dialog when the soft decrypt path
  fails: _"`KEY_NAME` can't be decrypted on this device. Unbinding
  will clear the value to empty."_ On confirm, the binding is dropped
  and `value` is set to `''` so the user can type a fresh plaintext
  immediately. The happy path (this device CAN decrypt) is unchanged
  — the value is recovered to plaintext without a prompt.
- New store-action signature: `unbindVariableSecretKey(envName,
index, opts?)`. The optional `opts.force` flag bypasses the decrypt
  requirement and clears the value. UI callers run the soft path
  first, then re-invoke with `{ force: true }` after user confirms.
  External callers (MCP, CLI) keep the same default behaviour and can
  opt in.

### Secret Vault — "Set passphrase" CTA on web

- The Secret Vault dock now surfaces a **Set passphrase** call-to-action
  with a short rationale whenever the workspace has no `secretCrypto`
  blob configured on the web build. Previously, attempting to add a
  secret returned an error pointing at a "Set passphrase" button that
  didn't exist anywhere in the UI — a dead end for users who hadn't
  set one up. Clicking the CTA opens the existing passphrase-setup
  modal; on success the New-secret form is unlocked.
- A matching **Unlock secrets** CTA replaces the same slot when the
  workspace already has a passphrase but the in-memory key was cleared
  (cold start, idle-lock, browser refresh). Clicking it opens the
  unlock modal directly instead of forcing a failed-Save round trip.
- Defense-in-depth: if any flow still throws `SecretsNotProtectedError`
  (deep link, race, legacy tab), the Vault tab now intercepts it and
  opens the setup modal automatically instead of toasting a message
  that referenced a button the user couldn't find.
- New workspace-store surface: `passphraseModal`,
  `openPassphraseSetup()`, `openPassphraseUnlock()`,
  `closePassphraseModal()`. `PassphrasePromptModalGate` reads modal
  state from the store now instead of the dead local `setupOpen` state
  it carried before, so any flow can request the prompt.
- Desktop builds are unaffected — `safeStorage`-wrapped master keys
  already satisfy the platform secret gate, so the CTA isn't shown
  there.

### Import — API Circle environment exports round-trip with a "Provide secret values" bind step

- The unified **Import** modal under the "API Circle exchange" source now
  accepts environment exports (`{ "apicircleEnvironment": 1, ... }`) as
  well as folder exports. The dropdown entry sniffs the document's magic
  key and routes to the right parser, so the file the Environments
  sidebar's **Export as JSON** action produces can be re-imported on
  another machine (or back into the same workspace, where it lands under
  a collision-renamed `<name> (2)` slot) without any extra step.
- **Encrypted rows now travel with the slot's user-recognizable label.**
  The v1 envelope's encrypted-row shape gained an additive `secret.label`
  field alongside `secretKeyId`:
  ```json
  {
    "key": "TOKEN",
    "encrypted": true,
    "secretKeyId": "sec_abc",
    "secret": { "label": "PROD_TOKEN" }
  }
  ```
  Older readers (including the previous MCP validator) ignore the new
  field and still accept the row — strictly additive, no breaking
  change. Older exports without `secret.label` continue to import; the
  parser falls back to the variable key as the prompt label and flags
  it so the UI can hint "this label was synthesized".
- **The importer prompts you on import instead of silently storing dead
  bindings.** When the destination workspace doesn't have a matching
  vault slot for an encrypted row, the modal now switches into a
  second-step "Provide secret values" form listing each unresolved
  binding with a masked input. Filling a value creates a fresh vault
  slot under the source's label and binds the variable to it. The step
  is fully **skippable** — the env is already persisted, so a skip
  leaves the bindings dangling for later resolution under Environments.
- **Same-workspace re-imports stay quiet.** If the destination's
  `synced.secretKeys` already carries a slot whose id or label matches
  the export, the importer re-points the row's `secretKeyId` to that
  slot and skips the bind step entirely.
- Public surface from `@apicircle/core`:
  - `parseApicircleEnvironment(input)` /
    `parseApicircleEnvironmentDoc(doc)` →
    `ParsedApicircleEnvironment` (`name`, `variables`,
    `encryptedBindingHints`, `warnings`)
  - `EncryptedBindingHint` — `{ varKey, label, originSecretKeyId?,
labelFromFallback }`
  - `isApicircleEnvironment(doc)` discriminator
- New workspace store types + action:
  - `ApicircleEnvironmentPendingBinding` —
    `{ envName, varKey, label, labelFromFallback }`
  - `importApicircleEnvironment(parsed) → { name, pendingBindings,
warnings } | null` — collision-suffixes the env name, resolves
    encrypted hints against `synced.secretKeys` (id match, then label
    match), and returns the unresolved bindings for the UI to prompt.
- MCP `environment.import` routes through the same core parser. Response
  envelope grew a `pendingBindings` array and a `warnings` pass-through
  so AI clients can surface unresolved bindings to the user (or wire
  them up via the existing `addSecret` / bind tools). Error strings for
  malformed envelopes now match the user-facing message the modal
  surfaces, eliminating UI/MCP drift.
- Parser warnings (dropped rows, demoted encrypted rows, missing
  `secretKeyId`) now surface in the UI as an info toast after import
  instead of disappearing silently.
- This closes the asymmetry where the MCP `environment.import` tool
  already accepted the v1 envelope but the human-facing UI did not —
  the exporter, the bind step, the MCP path, and the env-panel are all
  in lockstep.

### Folder export — "Export as JSON" + API Circle exchange import

- Each folder's kebab menu now carries an **Export as JSON** action. Picking
  it opens a prompt that lists everything the export envelope will carry —
  the folder + its subtree of subfolders and requests, plus a
  **Global Asset dependencies** report broken down by:
  - **JSON Schemas** referenced via `Request.bodySchemaId` (embedded in
    the export so the importer can recreate them in Global Assets → JSON
    Schemas with a name+content dedupe pass)
  - **GraphQL definitions** referenced via `Request.graphqlSchemaId`
    (embedded — same dedupe pattern, by name + kind + source)
  - **Global files** referenced via binary attachments and form-data file
    rows (**metadata-only** — bytes stay in their Git LFS sidecars; the
    importer surfaces these so the user can re-attach them inside Global
    Assets → Global Files after import)
- The exporter emits a single self-describing JSON file
  (`<slug>.apicircle.json`) carrying the `format: "apicircle.folder/v1"`
  discriminator and a stable, indented serialization that round-trips
  byte-for-byte through the importer.
- The unified **Import** modal's `apicircle` source-format slot — previously
  a placeholder that displayed a "not yet importable" message — is now a
  real parser. The same modal accepts the exported file, shows the same
  dependency breakdown, and routes through the new
  `importApicircleFolder` workspace store action. Existing import paths
  (Postman v2.1, Postman environment, Insomnia v4, cURL) are unchanged.
- Public surface from `@apicircle/core`:
  - `collectFolderExport({ synced, folderId })` → `{ envelope, report }`
  - `serializeFolderExport(envelope)` → JSON string
  - `suggestFolderExportFilename(envelope)` → safe slug.apicircle.json
  - `parseApicircleFolderExport(input)` /
    `parseApicircleFolderExportDoc(doc)` →
    `ParsedApicircleFolderExport` with fresh ids, remapped refs, and
    warnings for any dangling references
  - `isApicircleFolderExport(doc)` discriminator + the
    `APICIRCLE_FOLDER_EXPORT_FORMAT` token
- All new code lands with co-located unit tests (Vitest) at 100% line,
  branch, function, and statement coverage; the editor sidebar +
  ImportModal integration is also covered.

### MCP — Prompts copy fixed, category renamed to Collections

- The MCP → Prompts cards now copy reliably: the click handler falls back
  to `document.execCommand('copy')` when `navigator.clipboard.writeText`
  is unavailable (HTTP, file://, embedded webview) and surfaces an error
  toast when the write actually fails instead of silently no-op'ing.
- Clicking a card now flashes an inline **Copied!** status tooltip next
  to the Copy badge (in addition to the existing toast), so the
  acknowledgement is anchored next to the affordance the user pressed.
- The singular **Workspace** category chip is renamed to **Collections**
  — the plural **Workspaces** (multi-workspace discovery) chip is
  unchanged. Type/id `McpPromptCategory` member `'workspace'` was
  renamed to `'collections'` along with the four prompt records that
  reference it.

### Default appearance reverts to One Dark Pro + System Sans

- New workspaces now boot in **One Dark Pro** with **System Sans** instead
  of the 1.0.5 defaults (Command Center + Cascadia Code). All built-in
  themes and fonts remain available in the Settings → Appearance pickers;
  this only changes the out-of-the-box look. Existing workspaces keep
  their saved preference.
- Updated runtime fallbacks across the UI store, CLI/core seeders, font
  picker, theme picker, Monaco bridge, the legacy-migration default in
  `workspaceStorage.hydrateWorkspace`, plus the matching unit + E2E specs.

### Font picker — auto-filter "no-op" options

- The Settings → Font family picker now hides any catalog entry whose stack
  silently falls through to the same OS face as your platform default. A
  webfont that failed to download, or a named family that isn't installed,
  no longer appears as an option you can "pick" without anything changing.
- Detection uses a canvas advance-width comparison against the
  `system-mono` and `system-sans` baselines, runs once per app load
  (cached), preloads every catalog webfont stylesheet so the measurement
  sees real metrics, and waits on `document.fonts.ready` before
  measuring.
- The currently-selected font is always force-included in the list — even
  if the detector would otherwise filter it — so a user whose saved font
  later stops loading can still see it and choose something else.
- New module `packages/ui-components/src/theme/fontAvailability.ts` plus
  unit tests; `ensureWebfontLink` is now exported from
  `theme/applyFont.ts` so the detector can preload stylesheets.

### MCP tool catalog — now 74 tools

- The catalog grows by two: `folder.export_json` and `folder.import_json`,
  the headless equivalents of the new **Export as JSON** / API Circle
  exchange import paths. The full enumeration lives in
  [`packages/shared/src/mcp.ts`](packages/shared/src/mcp.ts); the signatures
  - envelopes are documented in
    [`docs/mcp-tools-reference.md`](docs/mcp-tools-reference.md).
- `environment.import` gained a `pendingBindings` array in its response
  envelope so AI clients can surface unresolved encrypted-row bindings to
  the user (and wire them up via `secret.add` + the env-panel bind path).

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`,
`@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`,
`@apicircle/mcp-server`, `@apicircle/mock-server-core`,
`@apicircle/shared`, plus the e2e and example workspaces — all at
`1.0.7`.

## 1.0.5 - 2026-05-29

A theme and font expansion release. Studio's appearance catalog roughly
doubles, every theme gains a matched Monaco editor variant, and the
out-of-the-box look-and-feel switches to **Command Center** + **Cascadia
Code**.

### Themes — 30 new palettes

- 18 new dark presets: VS Code Dark, GitHub Dark Dimmed, Terminal Green,
  Terminal Amber, OLED Black, Carbon Dark, Slate Dark, Zinc Dark,
  Everforest Dark, Kanagawa Wave, Kanagawa Dragon, Horizon Dark, City
  Lights, Nightfox Dark, Command Center, Ink Dark, Muted Teal Dark, and
  Redwood Dark.
- 10 new light presets: VS Code Light, Xcode Light, Minimal Light,
  Porcelain Light, Cloud Light, Everforest Light, Kanagawa Lotus,
  Clarity Light, Nord Light, and Sage Light.
- 2 new high-contrast variants: GitHub Dark High Contrast and GitHub
  Light High Contrast.
- New `monacoThemes.ts` ships a matched Monaco editor variant for every
  preset, so the code editor recolors in lockstep with the shell.
- Supporting CSS-variable surface rewritten in
  `apps/web/src/styles/global.css` to back the broader palette set.

### Fonts — 20 new families

- 10 new monospace families: Noto Sans Mono, Martian Mono, Fragment
  Mono, Overpass Mono, Cousine, Courier Prime, PT Mono, Oxygen Mono,
  B612 Mono, Share Tech Mono.
- 10 new sans families: macOS System, Aptos, Public Sans, Noto Sans,
  Atkinson Hyperlegible, Lexend, Outfit, Sora, Barlow, Urbanist.

### New defaults

- The default theme is now **Command Center** (was One Dark Pro).
- The default font is now **Cascadia Code** (was System Sans).
- Existing workspaces keep their saved preference; only the
  out-of-the-box experience changes.

### Editor and CLI polish

- Cleaner spacing and focus styling in `AuthEditor`, `BodyTab`,
  `HeadersTab`, `KeyValueRows`, and `HeaderAutocomplete`.
- `apicircle` and `apicircle-mcp` now expose `--version` / `-v` / `-V`
  and `--help` / `-h` flags via new `bin/args.ts` parsers and an
  auto-generated `packageVersion.ts` constant per package.
- New Playwright spec `e2e/web/help-and-theme.spec.ts` covers the
  Settings → Help / Theme picker flow against the new catalog.

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`,
`@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`,
`@apicircle/mcp-server`, `@apicircle/mock-server-core`,
`@apicircle/shared`, plus the e2e and example workspaces — all at
`1.0.5`.

## 1.0.4 - 2026-05-29

The Global Assets and live-GitHub hardening release. This release makes file
uploads reusable across requests, mocks, linked workspaces, and headless
execution, then promotes the stabilized live GitHub suite to the canonical
`pnpm test:e2e:live-github` pipeline.

### Global Assets files

- Global Assets now includes a Files library alongside JSON Schemas and
  GraphQL definitions.
- Binary request bodies, form-data file rows, and mock binary responses can
  reference reusable Global File Assets.
- File asset metadata is tracked in `workspace.json`; file bytes are stored as
  Git blobs under `.apicircle/attachments/` so workspace diffs stay small and
  readable.
- Linked workspace panels show required attachments, file sizes, missing vs
  downloaded state, and the requests that require each file.
- Sending a request, retrying/replaying history, or running an execution plan
  now prompts to download missing required assets, verifies checksums, then
  continues execution. Canceling leaves execution stopped.
- `apicircle run` follows the same checksum-verified download path for
  headless execution plans.
- Deleting a Global File Asset clears request/mock mappings and is covered by
  diff, unit, and live GitHub E2E coverage.

### Canonical live GitHub suite

- The passing v2 live suite is now the only `e2e:live-github` implementation.
  Legacy `e2e/web/live/**` specs and the old `live-github.spec.ts` smoke have
  been removed.
- `chromium-live-github` now runs `e2e/web/live-github/**/*.spec.ts` only,
  single worker, against real `api.github.com`.
- The GitHub Actions workflow `e2e-live-github` runs on `main` pushes,
  nightly, and manual dispatch using bot-owned ephemeral repos.
- Required GitHub Actions configuration:
  - Variable: `APICIRCLE_E2E_BOT_OWNER`
  - Secrets: `APICIRCLE_E2E_BOT_PAT`,
    `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`
- Coverage includes private/public linking, dedicated per-link PATs, release
  notes and on-demand updates, dependency diff buckets, snapshots, branch and
  workspace transitions, Global Assets, attachment download, and execution with
  linked assets.

### Documentation and onboarding

- README, QA docs, bot setup guide, Help Center content, and onboarding copy now
  describe Global Assets files, linked attachment downloads, CLI execution
  behavior, and the canonical live GitHub workflow.
- All workspace package manifests are bumped to `1.0.4` for the desktop release
  train.

## 1.0.3

A connect-and-share release. The MCP setup flow, AI-client onboarding, and community surfacing all got first-class treatment, and the web app now ships to GitHub Pages on every push.

### MCP connect flow

- New `HowToConnect` component drives per-client setup instructions in the MCP panel — Claude Desktop, ChatGPT, Cursor, Copilot, Continue, Cline, Zed, and Windsurf each get a tailored snippet.
- Centralized desktop-bridge contract (`@apicircle/ui-components/desktop`) so MCP config snippets, disk-mirror paths, and IPC handshakes share one typed entry point.
- MCP config snippets now expose path variants (binary vs npx vs absolute) and the right shape for each client's config file.
- README, `docs/connect-your-ai-client.md`, and the onboarding tour now agree on a single set of setup steps and call out the workspace disk mirror explicitly.

### Community section (Settings)

- New **Settings → Community** surface fetches live community stats (downloads, contributors, GitHub activity) with debounced caching in IndexedDB.
- `fetchCommunityStats`, `communityStorage`, and `externalLinks` helpers ship behind the section; desktop builds get a native download CTA via the new `desktopDownload` primitive.

### Web app deployment

- New `.github/workflows/deploy-web.yml` builds `apps/web` and deploys it to GitHub Pages on every push to `main` — the hosted web build is now continuously available.

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`, `@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`, `@apicircle/mcp-server`, `@apicircle/mock-server-core`, `@apicircle/shared`, plus the e2e and example workspaces — all at `1.0.3`.

## 1.0.2

The disk-mirror release. Workspaces can now live as plain JSON on disk alongside the IndexedDB store, and the MCP panel grew first-class connect / prompts / how-to surfaces.

### Disk-mirror workspaces

- New desktop `workspaceFileManager` + `workspaceFileBridge` IPC: persist a workspace to a directory on disk and round-trip it back into the store.
- `diskMirror` + `diskMirrorMerge` in `@apicircle/ui-components/persistence` keep the on-disk JSON in sync with IndexedDB, with debounced writes and three-way merge on refresh.
- `workspaceRegistry` in `@apicircle/core` and `resolveWorkspace` in `@apicircle/cli` give headless tools the same multi-workspace addressing model the UI uses.
- New CLI `apicircle workspaces` command — list, inspect, and resolve registered workspaces.
- `@apicircle/mcp-server` gained a `MultiWorkspaceProvider`, a `workspace.list` tool, and a `Workspaces` host abstraction so MCP clients can target a specific workspace.

### MCP panel refresh

- `McpServerPanel` split into focused sections: `ConnectionSection`, `HowToConnectSection`, `PromptsSection`, with typed panel state in `mcpPanelTypes` and a curated `mcpPrompts` catalog.
- New `McpSidebar` navigation and richer Help Center content for MCP setup.

### Stability & UX

- Mock-server shutdown now reports progress and surfaces a `CloseConfirmModal` for unsaved work on app exit.
- New `PanelErrorBoundary` primitive catches per-panel render errors without taking down the shell.
- Monaco editor base hardening + validator tightening in `@apicircle/shared`.

### Release & CI

- New `.github/workflows/release.yml` automates `@apicircle/*` package publishing to npm via changesets.
- Vite `base` set to relative so the built `index.html` references assets correctly when served from a sub-path.
- All GitHub Actions workflows bumped to current action versions.

## 1.0.1

A release-tooling patch. No app-facing behavior changes — focus was getting the desktop installers and CI pipeline ready for the public release.

### Desktop release pipeline

- Hardened `.github/workflows/desktop-release.yml`: installs deb tooling, guards mac code-signing on empty env vars, and enforces a tag guard so the workflow only fires on release tags.
- Added Debian metadata (`maintainer`, `synopsis`, `description`) to `apps/desktop/package.json` so the `.deb` artifact passes lintian.
- Switched the desktop main-process build to `tsup` (`apps/desktop/tsup.config.ts`) for faster, more predictable bundling.

### CI fixes

- `scripts/render-icons.mjs` now degrades gracefully when Playwright's browser dependency isn't installed, so the icon-render step no longer blocks the build.
- CodeQL workflow updates to align with the public-release branch protections.

## 1.0.0

First public release of API Circle Studio — a Git-native, AI-native API workspace.

### Workspace & Git sync

- Two-document workspace model (synced + local) with stable JSON serialization for clean Git diffs.
- GitHub sync: PAT connect with scope guidance, auto-branch, push (including attachments), PR creation, on-demand refresh, and 3-way conflict resolution.
- Link Workspace + releases: private and public links, marketplace search, cached collections, version pinning, and a changelog viewer.

### Requests & execution

- 17 authentication schemes, all end-to-end functional — Bearer, Basic, API key, custom header, the full OAuth2 grant set, AWS SigV4, Digest, NTLM, Hawk, and JWT.
- Imports: cURL, OpenAPI / Swagger, Postman, Insomnia, and HAR.
- Environments with priority ordering, assertions, and multi-step execution plans.

### Platform surfaces

- **Local mock servers** — a Hono-based engine that serves OpenAPI / Postman / Insomnia specs on localhost.
- **MCP server** — exposes the workspace as a tool catalog any Model Context Protocol client can drive.
- **CLI** — `apicircle mock | mcp | import | run` for headless and CI use.
- **Desktop app** (Electron) with OS-keychain secret storage, plus the web app and embeddable npm packages.

### Published packages

`@apicircle/shared`, `@apicircle/core`, `@apicircle/mock-server-core`, `@apicircle/mcp-server`, and `@apicircle/cli` — all at `1.0.0`.
