import { describe, expect, it, vi } from 'vitest';
import { generateId } from './ids';

describe('generateId', () => {
  it('returns RFC4122 v4 UUID format', () => {
    const id = generateId();
    expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  });

  it('produces unique values across many calls', () => {
    const ids = new Set<string>();
    for (let i = 0; i < 1000; i++) ids.add(generateId());
    expect(ids.size).toBe(1000);
  });

  it('uses crypto.randomUUID when available', () => {
    const spy = vi.spyOn(crypto, 'randomUUID');
    generateId();
    expect(spy).toHaveBeenCalledOnce();
  });

  it('falls back to getRandomValues when randomUUID is missing', () => {
    const original = crypto.randomUUID;
    delete (crypto as { randomUUID?: unknown }).randomUUID;
    try {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      (crypto as { randomUUID: typeof original }).randomUUID = original;
    }
  });

  it('falls back to Math.random when crypto is fully unavailable', () => {
    const originalCrypto = globalThis.crypto;
    delete (globalThis as { crypto?: unknown }).crypto;
    try {
      const id = generateId();
      expect(id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
    } finally {
      (globalThis as { crypto: typeof originalCrypto }).crypto = originalCrypto;
    }
  });
});
