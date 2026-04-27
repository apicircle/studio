import { describe, expect, it } from 'vitest';
import { decryptString, encryptString } from '@apicircle-v2/core';
import { __resetSecretKeyForTests, getMasterKey } from './secretKey';

describe('master secret key', () => {
  it('returns the same key on repeated calls within a session (memo cache)', async () => {
    const a = await getMasterKey();
    const b = await getMasterKey();
    expect(a).toBe(b);
  });

  it('persists the key across the in-memory cache reset (IDB-backed)', async () => {
    const original = await getMasterKey();
    const payload = await encryptString('top secret', original);

    // Simulate a page reload: drop the in-memory cache + DB connection cache.
    __resetSecretKeyForTests();
    const reloaded = await getMasterKey();
    expect(await decryptString(payload, reloaded)).toBe('top secret');
  });

  it('produces different keys after a fresh IDB factory (different installations)', async () => {
    const k1 = await getMasterKey();
    const payload = await encryptString('locale', k1);

    // Fresh fake-indexeddb factory simulates a different machine / browser.
    const { IDBFactory } = await import('fake-indexeddb');
    globalThis.indexedDB = new IDBFactory();
    __resetSecretKeyForTests();

    const k2 = await getMasterKey();
    await expect(decryptString(payload, k2)).rejects.toBeDefined();
  });
});
