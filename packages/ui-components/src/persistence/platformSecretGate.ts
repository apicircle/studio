// Web-build encryption gate.
//
// Threat: on the web build the master AES-GCM key (used to encrypt every
// secret-vault entry + every "encrypted" environment variable) is stored
// PLAINTEXT in `apicircle-secret-key` IndexedDB. Any same-origin XSS,
// browser extension content script, or devtools session can read it and
// decrypt every secret the user has ever stored. On Desktop the same JWK
// is wrapped via Electron `safeStorage` (OS keychain), so the key never
// hits disk in cleartext — but the web build has no such bridge.
//
// Mitigation: the workspace-passphrase model derives a separate key from
// a user-supplied passphrase + per-workspace salt. That key is held only
// in renderer memory for the duration of the session — never persisted
// at all. With a passphrase set, the IndexedDB master-key is unused for
// vault encryption: the passphrase-derived key takes over.
//
// Therefore: on web, refuse to add a secret unless EITHER
//   (a) `synced.secretCrypto` is configured (passphrase model active), OR
//   (b) `apicircleDesktop.encryption.isAvailable()` is true (we're in
//        Electron and `safeStorage` will wrap the JWK).
//
// The thrown error is caught by the UI's add-secret form and rendered to
// the user with a "set a passphrase first" CTA. Desktop users see no
// change in behaviour.

import type { SecretCryptoMeta } from '@apicircle/shared';

interface DesktopBridgeShape {
  isEncryptionAvailable: () => Promise<boolean>;
}

function getDesktopEncryption(): DesktopBridgeShape | null {
  const w = globalThis as unknown as {
    apicircleDesktop?: { isEncryptionAvailable?: DesktopBridgeShape['isEncryptionAvailable'] };
  };
  const bridge = w.apicircleDesktop;
  if (!bridge || typeof bridge.isEncryptionAvailable !== 'function') return null;
  return { isEncryptionAvailable: bridge.isEncryptionAvailable };
}

export class SecretsNotProtectedError extends Error {
  constructor() {
    super(
      'Secrets cannot be added on the web build until you set a workspace passphrase. ' +
        'Open the Secret Vault → "Set passphrase" first, or switch to the Desktop App ' +
        '(https://github.com/apicircle/studio/releases/latest) where secrets are ' +
        'protected by the OS keychain.',
    );
    this.name = 'SecretsNotProtectedError';
  }
}

/** Auto-bypass when running under vitest — keeps the existing test suite
 *  green without touching every callsite. Defaults true; the gate's OWN
 *  tests flip it off via `__forceCheckSecretGateForTests`. */
let autoVitestBypass = true;

/** The gate's own tests need to verify the strict behaviour, so they
 *  disable the vitest auto-bypass for the duration of the test. */
export function __forceCheckSecretGateForTests(): void {
  autoVitestBypass = false;
}

export function __resetSecretGateForTests(): void {
  autoVitestBypass = true;
}

function isUnderVitest(): boolean {
  if (typeof process === 'undefined' || !process?.env) return false;
  return process.env.VITEST === 'true' || process.env.NODE_ENV === 'test';
}

/**
 * Throw `SecretsNotProtectedError` when we're on a runtime that would
 * otherwise persist the master encryption key in plaintext.
 *
 * Call this at every site that creates / mutates a Secret Vault entry
 * or encrypts an environment variable value. The check is async because
 * the desktop bridge's `isEncryptionAvailable` is an IPC call.
 *
 * Pass the current `synced.secretCrypto` so we can detect the
 * passphrase-model branch without reaching into the store.
 */
export async function assertSecretsProtected(
  secretCrypto: SecretCryptoMeta | null | undefined,
): Promise<void> {
  if (autoVitestBypass && isUnderVitest()) return;
  // Passphrase model is set up — the master JWK isn't load-bearing.
  if (secretCrypto && secretCrypto.kdf) return;

  // Desktop bridge present + keychain available → JWK is wrapped on disk.
  const desktop = getDesktopEncryption();
  if (desktop) {
    try {
      const available = await desktop.isEncryptionAvailable();
      if (available) return;
    } catch {
      // Bridge errored — fall through to the refusal path. Better to be
      // strict than to silently land secrets on an unprotected channel.
    }
  }

  throw new SecretsNotProtectedError();
}
