import { describe, expect, it } from 'vitest';
import {
  decryptString,
  deriveKeyFromSlotValue,
  encryptString,
  exportKey,
  generateAesKey,
  generateSlotSalt,
  importKey,
  serializePayload,
  tryParsePayload,
} from './crypto';

describe('AES-GCM crypto helpers', () => {
  it('round-trips a UTF-8 string through encrypt + decrypt', async () => {
    const key = await generateAesKey();
    const payload = await encryptString('hello world 🌍', key);
    expect(payload.ciphertext.length).toBeGreaterThan(0);
    expect(payload.iv.length).toBeGreaterThan(0);
    expect(await decryptString(payload, key)).toBe('hello world 🌍');
  });

  it('produces a different ciphertext for the same plaintext (random IV)', async () => {
    const key = await generateAesKey();
    const a = await encryptString('same', key);
    const b = await encryptString('same', key);
    expect(a.iv).not.toBe(b.iv);
    expect(a.ciphertext).not.toBe(b.ciphertext);
  });

  it('decryption throws when given the wrong key', async () => {
    const k1 = await generateAesKey();
    const k2 = await generateAesKey();
    const payload = await encryptString('top secret', k1);
    await expect(decryptString(payload, k2)).rejects.toBeDefined();
  });

  it('exportKey + importKey produces a key that decrypts prior ciphertext', async () => {
    const original = await generateAesKey();
    const payload = await encryptString('persisted', original);
    const jwk = await exportKey(original);
    const restored = await importKey(jwk);
    expect(await decryptString(payload, restored)).toBe('persisted');
  });

  describe('serialization', () => {
    it('serializePayload prefixes with enc:v1: for forward compatibility', () => {
      expect(serializePayload({ iv: 'AAAA', ciphertext: 'BBBB' })).toBe('enc:v1:AAAA:BBBB');
    });

    it('tryParsePayload recovers the parts of a serialized payload', () => {
      expect(tryParsePayload('enc:v1:AAAA:BBBB')).toEqual({ iv: 'AAAA', ciphertext: 'BBBB' });
    });

    it('tryParsePayload returns null for unrecognized strings', () => {
      expect(tryParsePayload('plain text')).toBeNull();
      expect(tryParsePayload('enc:v2:AAAA:BBBB')).toBeNull();
      expect(tryParsePayload('enc:v1:AAAA')).toBeNull();
      expect(tryParsePayload('')).toBeNull();
    });
  });

  describe('per-slot key derivation', () => {
    it('generateSlotSalt returns a fresh base64 salt each call', () => {
      const a = generateSlotSalt();
      const b = generateSlotSalt();
      expect(a).not.toBe(b);
      // 16 raw bytes → base64 length 24 (with `=` padding).
      expect(a.length).toBe(24);
      expect(b.length).toBe(24);
    });

    it('deriveKeyFromSlotValue produces stable keys for the same (value, salt)', async () => {
      const salt = generateSlotSalt();
      const k1 = await deriveKeyFromSlotValue('s3cret', salt);
      const k2 = await deriveKeyFromSlotValue('s3cret', salt);
      const payload = await encryptString('payload', k1);
      // Same value + same salt on a second call decrypts ciphertext from the first.
      expect(await decryptString(payload, k2)).toBe('payload');
    });

    it('different slot values yield non-interoperable keys', async () => {
      const salt = generateSlotSalt();
      const correct = await deriveKeyFromSlotValue('right', salt);
      const wrong = await deriveKeyFromSlotValue('wrong', salt);
      const payload = await encryptString('payload', correct);
      await expect(decryptString(payload, wrong)).rejects.toBeDefined();
    });

    it('different salts yield non-interoperable keys for the same value', async () => {
      const saltA = generateSlotSalt();
      const saltB = generateSlotSalt();
      const keyA = await deriveKeyFromSlotValue('same-value', saltA);
      const keyB = await deriveKeyFromSlotValue('same-value', saltB);
      const payload = await encryptString('payload', keyA);
      await expect(decryptString(payload, keyB)).rejects.toBeDefined();
    });
  });
});
