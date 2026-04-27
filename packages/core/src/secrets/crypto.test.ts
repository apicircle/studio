import { describe, expect, it } from 'vitest';
import {
  decryptString,
  encryptString,
  exportKey,
  generateAesKey,
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
});
