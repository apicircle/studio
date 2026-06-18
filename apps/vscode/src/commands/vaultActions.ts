import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { VsCodeVaultManager } from '../host/vaultManager';
import { VaultCryptoError, VaultLockedError } from '../host/vaultManager';
import {
  rememberPassphrase,
  forgetPassphrase,
  readRememberedPassphrase,
  forgetAllPassphrases,
} from '../host/vaultDeviceMemory';

// =============================================================================
// Vault commands — passphrase unlock + secret-value reveal flow.
//
// These wrap the host-level VsCodeVaultManager + the workspace bridge so the
// commands themselves stay in one place. The manager doesn't know about
// vscode.window, and the bridge doesn't know about crypto; this file is
// the seam.
//
// Commands:
//   • apicircle.unlockVault           — top-level + status-bar trigger
//   • apicircle.lockVault             — manual lock
//   • apicircle.setupVaultPassphrase  — first-time setup (no SecretCrypto yet)
//   • apicircle.changeVaultPassphrase — re-encrypt + replace SecretCrypto
//   • apicircle.openVaultEntry        — reveal a single encrypted env variable
//
// The "copy secret to clipboard with auto-clear" behaviour lives inside
// `openVaultEntry` — selecting "Copy" sets the clipboard, schedules a
// timeout reading `apicircle.secrets.clipboardClearSeconds`, and clears
// only if the clipboard's current value still matches what we wrote.
// =============================================================================

export interface VaultActionsDeps {
  bridge: VsCodeBridge;
  vault: VsCodeVaultManager;
  /** P8: VS Code SecretStorage handle (OS-keychain-backed). When provided,
   * unlock-success paths consult `getRememberOnDevice()` and, if true,
   * persist the passphrase via `rememberPassphrase()` so the next session
   * can silent-unlock. Optional for tests that don't exercise the
   * remember-device flow. */
  secrets?: vscode.SecretStorage;
  /** P8: returns the current value of `apicircle.secrets.rememberOnDevice`.
   * Default false; opt-in. */
  getRememberOnDevice?: () => boolean;
  /** Diagnostic sink for non-fatal events. Mirrors mock-actions DI shape. */
  log?: (msg: string) => void;
}

interface VariableNode {
  kind: 'variable' | 'variable-encrypted';
  envName: string;
  key: string;
}

// ---------------------------------------------------------------------------
// Unlock / lock
// ---------------------------------------------------------------------------

export async function unlockVaultCommand(deps: VaultActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showInformationMessage(
      'No active API Circle workspace. Open a workspace to unlock its vault.',
    );
    return;
  }
  const state = await active.read();
  if (!state.synced.secretCrypto) {
    const choice = await vscode.window.showInformationMessage(
      'This workspace has no secret vault yet. Set up a passphrase to start encrypting secrets.',
      'Set Up Passphrase',
      'Cancel',
    );
    if (choice === 'Set Up Passphrase') {
      await setupVaultPassphraseCommand(deps);
    }
    return;
  }
  // Audit-R2-G3: a teammate may have rotated the passphrase and Git-
  // pushed a new SecretCryptoMeta blob. The locally-cached key was
  // derived from the OLD verifier — if it doesn't match the on-disk
  // blob's verifier, the cache is stale and every downstream decrypt
  // would throw "bad tag". Drop the stale key and re-prompt.
  if (deps.vault.isUnlockedAgainst(active.workspace.id, state.synced.secretCrypto)) {
    await vscode.window.showInformationMessage('Vault is already unlocked.');
    return;
  }
  if (deps.vault.isUnlocked(active.workspace.id)) {
    deps.vault.lock(active.workspace.id);
    deps.log?.('cached key stale (blob verifier changed); dropping + re-prompting');
    // P4R3-G11: surface the staleness to the user — without this the
    // re-prompt looks like a regression ("I just unlocked, why am I being
    // asked again?"). Non-modal info toast so the prompt stays usable.
    void vscode.window.showInformationMessage(
      'Vault passphrase changed externally (likely a Git pull from a teammate who rotated). Please re-enter the new passphrase.',
    );
  }
  const passphrase = await vscode.window.showInputBox({
    prompt: `Unlock vault for "${active.workspace.label}"`,
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'Workspace passphrase',
  });
  if (passphrase === undefined) return; // user cancelled
  const result = await deps.vault.unlock(
    active.workspace.id,
    passphrase,
    state.synced.secretCrypto,
  );
  if (!result.ok) {
    deps.log?.(`unlock rejected: ${result.reason}`);
    await vscode.window.showErrorMessage(`Failed to unlock vault: ${result.reason}`);
    return;
  }
  // P8: persist on-device when the user opted in. The setting is the
  // sole consent surface — no per-unlock prompt; the user has already
  // toggled it explicitly in Settings before the first unlock.
  await rememberIfEnabled(deps, active.workspace.id, passphrase);
  await vscode.window.showInformationMessage('Vault unlocked.');
}

/**
 * P8: silent-unlock attempt from VS Code SecretStorage. Called from
 * `extension.ts` activation BEFORE any per-workspace lock-icon renders,
 * so the user sees "unlocked" if they opted in last session.
 *
 * Returns a per-workspace status:
 *   - 'silent-unlocked'   — used the stored passphrase, vault is unlocked
 *   - 'no-stored-entry'   — user never opted in, or wiped it
 *   - 'stored-but-stale'  — stored passphrase no longer decrypts (rotation);
 *                           stored entry is wiped as a side effect
 *   - 'no-vault-yet'      — workspace has no SecretCryptoMeta
 *
 * Errors are swallowed and logged; activation must never reject.
 */
export async function silentUnlockFromDevice(
  deps: VaultActionsDeps,
  workspaceId: string,
): Promise<'silent-unlocked' | 'no-stored-entry' | 'stored-but-stale' | 'no-vault-yet'> {
  if (!deps.secrets) return 'no-stored-entry';
  const stored = await readRememberedPassphrase(deps.secrets, workspaceId);
  if (stored === undefined) return 'no-stored-entry';
  // The caller (extension activation) iterates every workspace, so we
  // need to look up THIS workspace's state — not the currently-active one.
  const wsProvider = deps.bridge.listWorkspaces().find((s) => s.workspace.id === workspaceId);
  if (!wsProvider) {
    deps.log?.(`silentUnlock(${workspaceId}): no provider — leaving stored entry in place`);
    return 'no-stored-entry';
  }
  let state;
  try {
    state = await wsProvider.read();
  } catch (err) {
    deps.log?.(
      `silentUnlock(${workspaceId}) read failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    return 'no-stored-entry';
  }
  if (!state.synced.secretCrypto) return 'no-vault-yet';
  const result = await deps.vault.unlock(workspaceId, stored, state.synced.secretCrypto);
  if (!result.ok) {
    deps.log?.(`silentUnlock(${workspaceId}) failed (${result.reason}) — wiping stale entry`);
    await forgetPassphrase(deps.secrets, workspaceId);
    return 'stored-but-stale';
  }
  deps.log?.(`silentUnlock(${workspaceId}) ok`);
  return 'silent-unlocked';
}

/**
 * P8: explicit user-driven "Forget Vault Credentials on This Device" command.
 * Two-step prompt — confirm + execute — to avoid an accidental click
 * surfacing the passphrase prompt on next session.
 */
export async function forgetVaultOnDeviceCommand(deps: VaultActionsDeps): Promise<void> {
  if (!deps.secrets) {
    void vscode.window.showWarningMessage(
      'Remember-on-device storage is not available in this VS Code build (no SecretStorage).',
    );
    return;
  }
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    // No active workspace → offer the "forget ALL" path so the user can
    // still wipe stale entries from previously-opened workspaces. We can
    // enumerate all workspaces via the bridge.
    const all = deps.bridge.listWorkspaces();
    if (all.length === 0) {
      void vscode.window.showInformationMessage(
        'No API Circle workspaces are known to this VS Code session — nothing to forget.',
      );
      return;
    }
    const confirm = await vscode.window.showWarningMessage(
      `Forget remembered vault passphrases for ALL ${all.length} known workspace(s)? You'll need to re-enter the passphrase the next time each is opened.`,
      { modal: true },
      'Forget All',
    );
    if (confirm !== 'Forget All') return;
    const cleared = await forgetAllPassphrases(
      deps.secrets,
      all.map((s) => s.workspace.id),
    );
    deps.log?.(`forgot ${cleared} remembered passphrase(s)`);
    await vscode.window.showInformationMessage(
      cleared === 0
        ? 'No remembered passphrases were present.'
        : `Forgot ${cleared} remembered passphrase(s) on this device.`,
    );
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Forget the remembered vault passphrase for "${active.workspace.label}" on this device? You'll need to re-enter it next time.`,
    { modal: true },
    'Forget',
  );
  if (confirm !== 'Forget') return;
  await forgetPassphrase(deps.secrets, active.workspace.id);
  deps.log?.(`forgot remembered passphrase for ${active.workspace.id}`);
  await vscode.window.showInformationMessage(
    `Forgot remembered passphrase for "${active.workspace.label}" on this device.`,
  );
}

/**
 * Persist the passphrase to SecretStorage when `apicircle.secrets.
 * rememberOnDevice` is true. No-op when deps are missing (tests).
 */
async function rememberIfEnabled(
  deps: VaultActionsDeps,
  workspaceId: string,
  passphrase: string,
): Promise<void> {
  if (!deps.secrets || !deps.getRememberOnDevice) return;
  if (!deps.getRememberOnDevice()) return;
  try {
    await rememberPassphrase(deps.secrets, workspaceId, passphrase);
    deps.log?.(`remembered passphrase for ${workspaceId}`);
  } catch (err) {
    // Storage failure is non-fatal — vault still works for THIS session,
    // user just won't get silent-unlock next time. Log + carry on.
    deps.log?.(
      `rememberPassphrase failed (non-fatal): ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

export function lockVaultCommand(deps: VaultActionsDeps): void {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    // Audit-R2-G15: distinguish "I locked N vaults" from "nothing to do" so
    // the toast isn't misleading. lockAll() iterates `entries` and returns
    // count via reading the size beforehand.
    const wasUnlocked = deps.vault.unlockedWorkspaceIds();
    deps.vault.lockAll();
    void vscode.window.showInformationMessage(
      wasUnlocked.length === 0
        ? 'No vaults were unlocked.'
        : `Locked ${wasUnlocked.length} vault(s).`,
    );
    return;
  }
  if (!deps.vault.isUnlocked(active.workspace.id)) {
    void vscode.window.showInformationMessage('Vault is already locked.');
    return;
  }
  deps.vault.lock(active.workspace.id);
  void vscode.window.showInformationMessage('Vault locked.');
}

// ---------------------------------------------------------------------------
// Setup / change passphrase
// ---------------------------------------------------------------------------

export async function setupVaultPassphraseCommand(deps: VaultActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showInformationMessage(
      'No active API Circle workspace. Open a workspace to set up its vault.',
    );
    return;
  }
  const state = await active.read();
  if (state.synced.secretCrypto) {
    const choice = await vscode.window.showWarningMessage(
      'This workspace already has a passphrase. Set up again to ROTATE the passphrase (you will need to re-encrypt existing values).',
      { modal: true },
      'Rotate',
    );
    if (choice !== 'Rotate') return;
    return changeVaultPassphraseCommand(deps);
  }

  const passphrase = await vscode.window.showInputBox({
    prompt: 'Choose a workspace passphrase (lost passphrase = lost secrets — no recovery)',
    password: true,
    ignoreFocusOut: true,
    placeHolder: 'New passphrase (8+ chars recommended)',
    validateInput: (v) =>
      v.trim().length === 0 ? 'Passphrase cannot be empty or whitespace-only' : null,
  });
  if (passphrase === undefined) return;
  const confirm = await vscode.window.showInputBox({
    prompt: 'Re-enter passphrase to confirm',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v !== passphrase ? 'Passphrases do not match' : null),
  });
  if (confirm === undefined) return;

  try {
    const blob = await deps.vault.initialize(active.workspace.id, passphrase);
    await active.apply({ kind: 'secret.crypto.set', crypto: blob });
    await vscode.window.showInformationMessage(
      'Vault passphrase set. The blob lives in workspace.json and travels with Git; the passphrase never leaves this device.',
    );
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    deps.log?.(`setup failed: ${msg}`);
    await vscode.window.showErrorMessage(`Failed to set up vault: ${msg}`);
  }
}

export async function changeVaultPassphraseCommand(deps: VaultActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) return;
  const state = await active.read();
  const blob = state.synced.secretCrypto;
  if (!blob) {
    await vscode.window.showInformationMessage(
      'No vault to rotate — run "API Circle: Set Up Vault Passphrase" first.',
    );
    return;
  }

  const oldPassphrase = await vscode.window.showInputBox({
    prompt: 'Current passphrase',
    password: true,
    ignoreFocusOut: true,
  });
  if (oldPassphrase === undefined) return;
  const verify = await deps.vault.unlock(active.workspace.id, oldPassphrase, blob);
  if (!verify.ok) {
    await vscode.window.showErrorMessage(`Current passphrase is wrong: ${verify.reason}`);
    return;
  }

  const newPassphrase = await vscode.window.showInputBox({
    prompt: 'New passphrase',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) =>
      v.trim().length === 0 ? 'Passphrase cannot be empty or whitespace-only' : null,
  });
  if (newPassphrase === undefined) return;
  const confirm = await vscode.window.showInputBox({
    prompt: 'Re-enter new passphrase',
    password: true,
    ignoreFocusOut: true,
    validateInput: (v) => (v !== newPassphrase ? 'Passphrases do not match' : null),
  });
  if (confirm === undefined) return;

  // Audit-G1: atomicity strategy.
  // The naive flow (decrypt-all → init-new → apply-blob → re-encrypt-each)
  // leaves a window where the synced doc holds the new blob but some
  // ciphertext is still encrypted under the OLD key. If step 4 throws
  // partway, those values become unrecoverable.
  //
  // The fix: stage every NEW wire in memory BEFORE applying the blob
  // patch. That way the apply sequence is:
  //   - apply secret.crypto.set with newBlob
  //   - apply env.upsert for each affected env with the pre-staged new wires
  // A failure in the apply chain still leaves the workspace inconsistent
  // (no per-workspace transaction), but the dangerous window is gone:
  // if step "apply secret.crypto.set" succeeds, all subsequent env.upsert
  // calls are pure data writes that can't fail at the crypto layer.

  // Step 1: collect every encrypted env-variable wire string + decrypt under
  // the old key. Hold the plaintexts in memory only for the rotation.
  const oldWires: Array<{ envName: string; varKey: string; plain: string }> = [];
  for (const [envName, env] of Object.entries(state.synced.environments.items)) {
    for (const variable of env.variables) {
      if (variable.encrypted && variable.value.startsWith('enc:v1:')) {
        try {
          const plain = await deps.vault.decryptValue(active.workspace.id, variable.value);
          oldWires.push({ envName, varKey: variable.key, plain });
        } catch (err) {
          await vscode.window.showErrorMessage(
            `Cannot rotate — failed to decrypt "${variable.key}" in "${envName}": ${err instanceof Error ? err.message : String(err)}`,
          );
          return;
        }
      }
    }
  }

  // Step 2: re-initialise the vault under the new passphrase. This installs
  // the new key in the manager BUT does NOT yet persist the blob.
  const newBlob = await deps.vault.initialize(active.workspace.id, newPassphrase);

  // Step 3: encrypt every plaintext under the NEW key before touching the
  // synced doc. If a step here throws, the on-disk state is still old (good).
  const newWires: Array<{ envName: string; varKey: string; wire: string }> = [];
  for (const { envName, varKey, plain } of oldWires) {
    try {
      const wire = await deps.vault.encryptValue(active.workspace.id, plain);
      newWires.push({ envName, varKey, wire });
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Rotation failed before any state change — re-encrypt of "${varKey}" failed: ${err instanceof Error ? err.message : String(err)}`,
      );
      // Best-effort: lock the (still in-memory) new key so the workspace
      // returns to "locked under old passphrase, unrelated session" state.
      deps.vault.lock(active.workspace.id);
      return;
    }
  }

  // Step 4: apply the new blob + every env.upsert in sequence. Failures
  // past this point may leave the workspace partially rotated, but the
  // dangerous "blob points at key that can't decrypt the wires" window
  // is closed.
  //
  // P4R4-G1: if `apply secret.crypto.set` itself throws (FS error / disk
  // full / advisory-lock contention), the on-disk blob stays OLD while
  // the in-memory cached key is NEW. Without the catch, the next decrypt
  // would silently use the new key against old ciphertext and fail
  // opaquely. Wrap + lock on any failure so the next unlock prompts
  // for the OLD passphrase.
  try {
    await active.apply({ kind: 'secret.crypto.set', crypto: newBlob });
  } catch (err) {
    deps.vault.lock(active.workspace.id);
    await vscode.window.showErrorMessage(
      `Rotation aborted while persisting the new blob — workspace state untouched, vault locked. Re-unlock with the OLD passphrase. (${err instanceof Error ? err.message : String(err)})`,
    );
    return;
  }

  // Group wires by env to minimise env.upsert calls.
  const byEnv = new Map<string, Map<string, string>>();
  for (const { envName, varKey, wire } of newWires) {
    let m = byEnv.get(envName);
    if (!m) {
      m = new Map();
      byEnv.set(envName, m);
    }
    m.set(varKey, wire);
  }
  // P4R4-G1: a failure in the env.upsert loop leaves the workspace
  // PARTIALLY rotated — new blob on disk + some old wires + some new
  // wires. The caller is warned but the workspace is not unrecoverable:
  // re-running rotate with the NEW passphrase will succeed for the
  // already-re-encrypted vars (they decrypt under the new key) and
  // fail on the still-old ones (decrypt under new key throws). We
  // surface what we know on failure rather than silently swallowing.
  for (const [envName, wires] of byEnv) {
    try {
      const refresh = await active.read();
      const env = refresh.synced.environments.items[envName];
      if (!env) continue;
      const next = {
        ...env,
        variables: env.variables.map((v) =>
          wires.has(v.key) ? { ...v, value: wires.get(v.key)! } : v,
        ),
      };
      await active.apply({ kind: 'environment.upsert', environment: next });
    } catch (err) {
      await vscode.window.showErrorMessage(
        `Rotation partially failed for environment "${envName}": ${err instanceof Error ? err.message : String(err)}. The vault blob is rotated but some encrypted variables in this env may still hold ciphertext under the old key — re-running rotation with the NEW passphrase will retry them.`,
      );
      return;
    }
  }
  await vscode.window.showInformationMessage(
    `Passphrase rotated; ${newWires.length} encrypted variable(s) re-encrypted.`,
  );
}

// ---------------------------------------------------------------------------
// Open vault entry (replaces the Phase 4 placeholder in variableActions)
// ---------------------------------------------------------------------------

interface OpenVaultEntryConfig {
  /** Seconds to keep the secret on the clipboard before clearing. `0` = never. */
  clipboardClearSeconds: number;
}

export async function openVaultEntryCommand(
  deps: VaultActionsDeps,
  config: OpenVaultEntryConfig,
  node?: VariableNode,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active || !node) return;
  const state = await active.read();
  const env = state.synced.environments.items[node.envName];
  const variable = env?.variables.find((v) => v.key === node.key);
  if (!variable) return;
  if (!variable.encrypted) {
    // Audit-R2-G2: Non-encrypted variables route to the regular edit flow.
    // Normalize the kind to 'variable' before handing off — the downstream
    // command's VariableNode type expects 'variable', and the node we
    // received was 'variable-encrypted' (the click-from-encrypted-row path).
    await vscode.commands.executeCommand('apicircle.editVariableValue', {
      kind: 'variable',
      envName: node.envName,
      key: node.key,
    });
    return;
  }

  // Ensure the vault is unlocked AND the cached key matches the on-disk
  // blob (audit-R2-G3 — same stale-cache guard as unlockVault).
  if (!deps.vault.isUnlockedAgainst(active.workspace.id, state.synced.secretCrypto)) {
    // If we hold a stale key, drop it so we re-prompt with the new blob.
    if (deps.vault.isUnlocked(active.workspace.id)) {
      deps.vault.lock(active.workspace.id);
    }
    if (!state.synced.secretCrypto) {
      // Audit-G12: if there's no `secretCrypto` blob but the variable still
      // carries an `enc:v1:...` wire, the workspace was wiped (clear) and
      // the ciphertext was orphaned. Tell the user clearly — generic
      // "decryption failed" buried this context.
      const looksEncrypted = variable.value.startsWith('enc:v1:');
      const message = looksEncrypted
        ? `"${variable.key}" looks encrypted but this workspace has no vault passphrase set. The blob was likely cleared via "Change Passphrase" or an external write — this value is unrecoverable. Delete the variable or overwrite it via the env YAML.`
        : 'No vault passphrase set for this workspace. Use "API Circle: Set Up Vault Passphrase" first.';
      await vscode.window.showWarningMessage(message);
      return;
    }
    const choice = await vscode.window.showInformationMessage(
      'Vault is locked. Unlock to view this encrypted value.',
      'Unlock',
      'Cancel',
    );
    if (choice !== 'Unlock') return;
    await unlockVaultCommand(deps);
    if (!deps.vault.isUnlocked(active.workspace.id)) return;
  }

  let plain: string;
  try {
    plain = await deps.vault.decryptValue(active.workspace.id, variable.value);
  } catch (err) {
    if (err instanceof VaultLockedError) {
      await vscode.window.showWarningMessage('Vault locked again — try unlocking and retrying.');
      return;
    }
    if (err instanceof VaultCryptoError) {
      await vscode.window.showErrorMessage(`Decryption failed: ${err.message}`);
      return;
    }
    throw err;
  }

  const action = await vscode.window.showInformationMessage(
    `Decrypted "${variable.key}" — choose an action.`,
    { modal: false },
    'Copy to Clipboard',
    'Show in Notification (15s)',
  );

  if (action === 'Copy to Clipboard') {
    await vscode.env.clipboard.writeText(plain);
    scheduleClipboardClear(plain, config.clipboardClearSeconds, deps.log);
    await vscode.window.showInformationMessage(
      config.clipboardClearSeconds > 0
        ? `Copied; clipboard auto-clears in ${config.clipboardClearSeconds}s.`
        : 'Copied; auto-clear disabled (settings → clipboardClearSeconds=0).',
    );
  } else if (action === 'Show in Notification (15s)') {
    // Non-blocking 15-second toast that displays the value. We deliberately
    // do NOT echo to OutputChannel — the user explicitly chose a reveal
    // surface.
    await vscode.window.showInformationMessage(`${variable.key} = ${plain}`, { modal: false });
  }
}

/** Wipe the clipboard if (and only if) it still contains the secret we wrote.
 * Called only from `openVaultEntryCommand` above; kept as a top-level helper
 * so the auto-clear semantics are testable via the integration suite. */
function scheduleClipboardClear(
  secret: string,
  seconds: number,
  log?: (msg: string) => void,
): void {
  if (seconds <= 0) return;
  setTimeout(() => {
    void (async () => {
      try {
        const current = await vscode.env.clipboard.readText();
        if (current === secret) {
          await vscode.env.clipboard.writeText('');
          log?.(`[vault] clipboard cleared after ${seconds}s`);
        }
      } catch (err) {
        log?.(
          `[vault] clipboard clear failed: ${err instanceof Error ? err.message : String(err)}`,
        );
      }
    })();
  }, seconds * 1000);
}
