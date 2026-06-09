import type * as vscode from 'vscode';

// =============================================================================
// Phase 8 — "Remember vault on this device" via VS Code SecretStorage.
//
// Optional UX layer on top of P4's `VsCodeVaultManager`. When the user opts
// in (via the `apicircle.secrets.rememberOnDevice` setting), this module:
//
//   1. After successful unlock → persists the passphrase to VS Code's
//      `context.secrets` (which on each platform delegates to the OS
//      keychain — Keychain on macOS, Credential Manager on Windows,
//      libsecret on Linux).
//
//   2. On extension activation → reads the passphrase back and calls the
//      VaultManager's existing `unlock()` to "silent-unlock" the vault.
//      If silent-unlock fails (passphrase no longer valid because the
//      vault was rotated externally), the stored entry is wiped and the
//      regular passphrase prompt is surfaced.
//
//   3. On user lock + setting disabled / Forget command → wipes the
//      stored entry.
//
// Security threat model (Phase 8 audit):
//
//   - "OS keychain compromise" — attacker reads SecretStorage. They obtain
//     the passphrase. They can decrypt the vault NOW and any FUTURE
//     rotations. Identical to attacker stealing a stored AES key, except
//     they ALSO learn whatever the user re-uses the passphrase for
//     OUTSIDE this app. This is the unavoidable cost of any "remember"
//     UX; the setting defaults OFF and the docs spell out this caveat.
//
//   - "Workspace JSON exfiltration" — unchanged. The encrypted blob is
//     useless without the key; SecretStorage isn't reachable from a
//     workspace read.
//
//   - "Different VS Code profile / different machine" — keys are
//     namespaced by `workspaceId`, so different VS Code installations
//     have their own SecretStorage data. Sync (Settings Sync excludes
//     SecretStorage by design) doesn't carry these across devices.
//
//   - "Stale stored key after rotation" — vault rotation re-encrypts
//     everything under a NEW passphrase + bumps the verifier. The stored
//     entry decrypts nothing; on next activation `unlockFromDevice`
//     returns `false` and the user is prompted normally. The stale entry
//     is wiped at that point.
//
//   - "Auto-lock interaction" — auto-lock only clears the IN-MEMORY key.
//     The stored device entry persists, so the NEXT activation
//     silent-unlocks again. Users who want absolute lock-out should
//     either disable remember-device or run "Forget Vault Credentials
//     on This Device".
// =============================================================================

const STORAGE_PREFIX = 'apicircle.vault.passphrase.';

/** Build the SecretStorage key for a given workspace. Namespaced so
 *  different workspaces in the same VS Code instance stay isolated. */
function storageKey(workspaceId: string): string {
  return `${STORAGE_PREFIX}${workspaceId}`;
}

/**
 * Persist the passphrase for `workspaceId` to VS Code SecretStorage. Caller
 * is responsible for gating on the `apicircle.secrets.rememberOnDevice`
 * setting — this function unconditionally stores.
 */
export async function rememberPassphrase(
  secrets: vscode.SecretStorage,
  workspaceId: string,
  passphrase: string,
): Promise<void> {
  await secrets.store(storageKey(workspaceId), passphrase);
}

/**
 * Forget the stored passphrase for `workspaceId`. Safe to call when no
 * entry exists (delete is a no-op in that case).
 */
export async function forgetPassphrase(
  secrets: vscode.SecretStorage,
  workspaceId: string,
): Promise<void> {
  await secrets.delete(storageKey(workspaceId));
}

/**
 * Read the stored passphrase, if any. Returns `undefined` when the user
 * never opted in, when they ran the Forget command, or when the workspace
 * has never been remembered.
 */
export async function readRememberedPassphrase(
  secrets: vscode.SecretStorage,
  workspaceId: string,
): Promise<string | undefined> {
  return secrets.get(storageKey(workspaceId));
}

/**
 * Forget every remembered passphrase across all workspaces. Used by the
 * "Forget Vault Credentials on All Devices" command — wipes any leftover
 * entries from workspaces the user no longer opens (where targeted
 * `forgetPassphrase(workspaceId)` would never fire).
 *
 * VS Code's `SecretStorage` exposes no `list()` method by design (the
 * keychain doesn't enumerate). We accept a workspaceIds list from the
 * caller (typically the desktop bridge's `listWorkspaces()` result) and
 * delete each in turn. Unknown-workspace passphrases stored from a
 * previous session that the caller can't enumerate are left behind —
 * documented as a known limitation. Users can clear stale entries via
 * OS keychain tools if needed.
 */
export async function forgetAllPassphrases(
  secrets: vscode.SecretStorage,
  workspaceIds: readonly string[],
): Promise<number> {
  let cleared = 0;
  for (const id of workspaceIds) {
    const existing = await secrets.get(storageKey(id));
    if (existing !== undefined) {
      await secrets.delete(storageKey(id));
      cleared += 1;
    }
  }
  return cleared;
}
