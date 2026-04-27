import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { decryptString, encryptString } from '@apicircle-v2/core';
import { __resetSecretKeyForTests, getMasterKey } from './secretKey';
import type { NativeSecretBridge } from './nativeSecretBridge';

/**
 * Integration tests for the desktop secret bridge. We mount a fake
 * bridge on `globalThis.apicircleDesktop` and assert that the master
 * JWK round-trips through it on persistence + retrieval. Web's existing
 * tests (no bridge) live in secretKey.test.ts and continue to pass —
 * the same `getMasterKey()` covers both paths.
 */

interface BridgeWithSpies extends NativeSecretBridge {
  encryptCalls: string[];
  decryptCalls: string[];
}

function makeBridge(opts?: { available?: boolean }): BridgeWithSpies {
  const encryptCalls: string[] = [];
  const decryptCalls: string[] = [];
  // Trivial reversible "encryption" — base64 with a marker. Real bridges
  // hand off to the OS keychain via Electron safeStorage; we just need
  // round-trip fidelity for the test.
  return {
    encryptCalls,
    decryptCalls,
    encryptString: async (plaintext) => {
      encryptCalls.push(plaintext);
      return `KCH:${btoa(unescape(encodeURIComponent(plaintext)))}`;
    },
    decryptString: async (ciphertext) => {
      decryptCalls.push(ciphertext);
      if (!ciphertext.startsWith('KCH:')) throw new Error('bad ciphertext');
      return decodeURIComponent(escape(atob(ciphertext.slice(4))));
    },
    isEncryptionAvailable: async () => opts?.available ?? true,
  };
}

describe('master secret key — desktop bridge', () => {
  beforeEach(() => {
    __resetSecretKeyForTests();
  });

  afterEach(() => {
    delete (globalThis as { apicircleDesktop?: NativeSecretBridge }).apicircleDesktop;
  });

  it('wraps the JWK with the bridge on first generate, unwraps on next load', async () => {
    const bridge = makeBridge();
    (globalThis as { apicircleDesktop?: NativeSecretBridge }).apicircleDesktop = bridge;

    const k1 = await getMasterKey();
    expect(bridge.encryptCalls).toHaveLength(1);
    // The bridge received the JWK as JSON.
    const passed = JSON.parse(bridge.encryptCalls[0]) as JsonWebKey;
    expect(passed.kty).toBe('oct');

    // Drop in-memory cache and verify the bridge's decryptString unwraps
    // the stored ciphertext on the next load.
    __resetSecretKeyForTests();
    const k2 = await getMasterKey();
    expect(bridge.decryptCalls).toHaveLength(1);

    // Round-trip an encrypted payload through both keys to prove they're
    // the same key (CryptoKey identity isn't preserved across import).
    const payload = await encryptString('hello', k1);
    expect(await decryptString(payload, k2)).toBe('hello');
  });

  it('falls back to plain JWK persistence when the bridge reports unavailable', async () => {
    const bridge = makeBridge({ available: false });
    (globalThis as { apicircleDesktop?: NativeSecretBridge }).apicircleDesktop = bridge;

    await getMasterKey();
    // No encrypt should have fired because the bridge is unavailable; the
    // JWK lives in IDB plaintext (same as the web path).
    expect(bridge.encryptCalls).toHaveLength(0);
  });

  it('regenerates the key when a wrapped payload exists but the bridge is gone', async () => {
    const bridge = makeBridge();
    (globalThis as { apicircleDesktop?: NativeSecretBridge }).apicircleDesktop = bridge;

    const original = await getMasterKey();
    const payload = await encryptString('locked', original);

    // Simulate the user opening the web build of the same workspace —
    // bridge gone, but the IDB still holds the wrapped JWK.
    delete (globalThis as { apicircleDesktop?: NativeSecretBridge }).apicircleDesktop;
    __resetSecretKeyForTests();

    const replacement = await getMasterKey();
    // Old ciphertext can't decrypt under the regenerated key — that's
    // expected: the wrapped payload was unrecoverable and we made a new
    // one rather than failing the boot.
    await expect(decryptString(payload, replacement)).rejects.toBeDefined();
  });
});
