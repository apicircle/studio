import { ipcMain, safeStorage } from 'electron';
import { assertTrustedSender } from '../security/assertTrustedSender';

// =============================================================================
// IPC bridge for OS-keychain secret wrapping. The renderer's persistence layer
// wraps the master JWK with the OS keychain via the contextBridge
// `apicircleDesktop.{encryptString,decryptString,isEncryptionAvailable}`
// namespace (preload.ts). safeStorage isn't available in the sandboxed
// renderer/preload, so the actual calls run here in the main process.
// =============================================================================

// Hard cap on plaintext / ciphertext we'll accept from the renderer over IPC.
// The renderer should never need to encrypt a value larger than this; bound it
// so a compromised renderer can't OOM the main process with a 1GB string.
export const MAX_SECRET_PAYLOAD_BYTES = 1_048_576; // 1 MiB

const CHANNEL = {
  isAvailable: 'apicircle:secret:isAvailable',
  encrypt: 'apicircle:secret:encrypt',
  decrypt: 'apicircle:secret:decrypt',
} as const;

export function registerSecretsBridge(): void {
  ipcMain.handle(CHANNEL.isAvailable, (event) => {
    assertTrustedSender(event);
    return safeStorage.isEncryptionAvailable();
  });

  ipcMain.handle(CHANNEL.encrypt, (event, plaintext: unknown) => {
    assertTrustedSender(event);
    if (typeof plaintext !== 'string') {
      throw new Error('plaintext must be a string');
    }
    if (plaintext.length > MAX_SECRET_PAYLOAD_BYTES) {
      throw new Error('plaintext exceeds MAX_SECRET_PAYLOAD_BYTES');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS keychain not available on this platform');
    }
    const buffer = safeStorage.encryptString(plaintext);
    return buffer.toString('base64');
  });

  ipcMain.handle(CHANNEL.decrypt, (event, ciphertextBase64: unknown) => {
    assertTrustedSender(event);
    if (typeof ciphertextBase64 !== 'string') {
      throw new Error('ciphertext must be a base64 string');
    }
    if (ciphertextBase64.length > MAX_SECRET_PAYLOAD_BYTES * 2) {
      // base64 inflates by ~4/3; allow a margin then hard-cap.
      throw new Error('ciphertext exceeds MAX_SECRET_PAYLOAD_BYTES');
    }
    if (!safeStorage.isEncryptionAvailable()) {
      throw new Error('OS keychain not available on this platform');
    }
    const buffer = Buffer.from(ciphertextBase64, 'base64');
    return safeStorage.decryptString(buffer);
  });
}

export const SECRET_CHANNELS = CHANNEL;
