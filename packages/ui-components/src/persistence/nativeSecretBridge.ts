// Plan §1 + P8: in the desktop shell the master JWK never lands in
// IndexedDB plaintext. Electron's preload exposes a `NativeSecretBridge`
// on `globalThis.apicircleDesktop` that wraps any payload with the OS
// keychain (via Electron's `safeStorage`). The web app exposes nothing,
// so `secretKey.ts` falls back to plain JWK persistence.
//
// Encrypt + decrypt take and return base64 strings — easy to round-trip
// through structured-clone IDB without worrying about Buffer / ArrayBuffer
// quirks across the Electron context bridge.

export interface NativeSecretBridge {
  /**
   * Encrypts a UTF-8 string with the OS keychain. Returns a base64
   * ciphertext that's safe to persist in IndexedDB on this machine
   * only — the platform key is non-portable.
   */
  encryptString(plaintext: string): Promise<string>;
  /**
   * Decrypts a previously-produced base64 ciphertext. Throws if the
   * payload was produced on a different machine, by a different user,
   * or if the platform key has rotated since.
   */
  decryptString(ciphertext: string): Promise<string>;
  /**
   * Probe — `false` means the bridge is mounted but the OS keychain
   * isn't actually available (e.g. a Linux box without libsecret). The
   * caller can fall back to plaintext persistence with a warning rather
   * than failing the workspace boot.
   */
  isEncryptionAvailable(): Promise<boolean>;
}

declare global {
  var apicircleDesktop: NativeSecretBridge | undefined;
}

/**
 * Returns the desktop bridge when it's mounted, null otherwise. Cached
 * after first call: the bridge is set once at app boot via Electron
 * preload and never reattaches.
 */
export function getNativeSecretBridge(): NativeSecretBridge | null {
  if (typeof globalThis === 'undefined') return null;
  return globalThis.apicircleDesktop ?? null;
}
