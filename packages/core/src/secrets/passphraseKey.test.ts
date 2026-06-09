import { describe, expect, it } from 'vitest';
import { initSecretCrypto, unlockSecretCrypto } from './passphraseKey';

// Override the OWASP-floor iteration count down to a tiny value just for
// these tests — the algorithm path is identical and PBKDF2 at 1.2M iters
// under WebCrypto is too slow for the default 5s per-test timeout,
// especially under parallel-suite contention.
const TEST_ITERATIONS = 100;

describe('passphraseKey', () => {
  it('initSecretCrypto produces a usable AES-GCM key + a unique verifier per salt', async () => {
    const a = await initSecretCrypto('hunter2', TEST_ITERATIONS);
    const b = await initSecretCrypto('hunter2', TEST_ITERATIONS);
    // Same passphrase, different salts → different verifiers.
    expect(a.crypto.salt).not.toBe(b.crypto.salt);
    expect(a.crypto.verifier).not.toBe(b.crypto.verifier);
    expect(a.crypto.kdf).toBe('pbkdf2-sha256-v1');
    expect(a.crypto.iterations).toBe(TEST_ITERATIONS);
    // Key is usable for AES-GCM encrypt/decrypt round-trip.
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const ct = await crypto.subtle.encrypt(
      { name: 'AES-GCM', iv },
      a.key,
      new TextEncoder().encode('hello'),
    );
    const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, a.key, ct);
    expect(new TextDecoder().decode(pt)).toBe('hello');
  });

  it('unlockSecretCrypto accepts the right passphrase and produces the same key', async () => {
    const { crypto: blob, key: original } = await initSecretCrypto(
      'correct horse battery staple',
      TEST_ITERATIONS,
    );
    const result = await unlockSecretCrypto('correct horse battery staple', blob);
    expect(result.ok).toBe(true);
    if (result.ok) {
      // Round-trip a small payload through the unlocked key to confirm
      // the bytes match what the init-time key would produce.
      const iv = crypto.getRandomValues(new Uint8Array(12));
      const ct = await crypto.subtle.encrypt(
        { name: 'AES-GCM', iv },
        original,
        Uint8Array.of(1, 2, 3),
      );
      const pt = await crypto.subtle.decrypt({ name: 'AES-GCM', iv }, result.key, ct);
      expect(new Uint8Array(pt as ArrayBuffer)).toEqual(Uint8Array.of(1, 2, 3));
    }
  });

  it('unlockSecretCrypto rejects a wrong passphrase', async () => {
    const { crypto: blob } = await initSecretCrypto('correct', TEST_ITERATIONS);
    const result = await unlockSecretCrypto('WRONG', blob);
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.reason).toMatch(/Wrong passphrase/i);
    }
  });

  it('unlockSecretCrypto rejects an unknown KDF version', async () => {
    const { crypto: blob } = await initSecretCrypto('p', TEST_ITERATIONS);
    const tampered = { ...blob, kdf: 'argon2-future' as 'pbkdf2-sha256-v1' };
    const result = await unlockSecretCrypto('p', tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/Unsupported KDF/);
  });

  it('unlockSecretCrypto rejects a corrupt salt', async () => {
    const { crypto: blob } = await initSecretCrypto('p', TEST_ITERATIONS);
    const tampered = { ...blob, salt: '%%%not-base64%%%' };
    const result = await unlockSecretCrypto('p', tampered);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toMatch(/salt is corrupt/i);
  });

  it('initSecretCrypto rejects an empty passphrase', async () => {
    await expect(initSecretCrypto('', TEST_ITERATIONS)).rejects.toThrow(/cannot be empty/);
  });

  it('initSecretCrypto rejects a non-positive iteration count', async () => {
    await expect(initSecretCrypto('p', 0)).rejects.toThrow(/iterations must be/);
  });
});
