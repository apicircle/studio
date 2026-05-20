import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  SecretsNotProtectedError,
  __forceCheckSecretGateForTests,
  __resetSecretGateForTests,
  assertSecretsProtected,
} from './platformSecretGate';
import type { SecretCryptoMeta } from '@apicircle/shared';

// The gate auto-bypasses under vitest so the broader test suite doesn't
// have to wire up a passphrase / desktop bridge for every callsite. The
// gate's OWN tests verify the strict behaviour — flip the auto-bypass off
// before each one and restore the defaults after.
beforeEach(() => {
  __forceCheckSecretGateForTests();
});
afterEach(() => {
  __resetSecretGateForTests();
});

const passphraseMeta: SecretCryptoMeta = {
  kdf: 'pbkdf2-sha256-v1',
  salt: 'c2FsdA==',
  iterations: 1_200_000,
  verifier: 'dmVyaWZpZXI=',
};

describe('assertSecretsProtected — passphrase model', () => {
  it('accepts when synced.secretCrypto is present (passphrase model active)', async () => {
    await expect(assertSecretsProtected(passphraseMeta)).resolves.toBeUndefined();
  });
});

describe('assertSecretsProtected — desktop bridge', () => {
  // We stub apicircleDesktop on globalThis per-test.
  beforeEach(() => {
    delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
  });
  afterEach(() => {
    delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
  });

  it('accepts when the desktop bridge reports keychain available', async () => {
    (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop = {
      isEncryptionAvailable: () => Promise.resolve(true),
    };
    await expect(assertSecretsProtected(null)).resolves.toBeUndefined();
  });

  it('rejects when the desktop bridge reports keychain unavailable', async () => {
    (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop = {
      isEncryptionAvailable: () => Promise.resolve(false),
    };
    await expect(assertSecretsProtected(null)).rejects.toBeInstanceOf(SecretsNotProtectedError);
  });

  it('rejects when the desktop bridge throws (defensive — fail closed)', async () => {
    (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop = {
      isEncryptionAvailable: () => Promise.reject(new Error('IPC down')),
    };
    await expect(assertSecretsProtected(null)).rejects.toBeInstanceOf(SecretsNotProtectedError);
  });
});

describe('assertSecretsProtected — web build (no passphrase, no desktop)', () => {
  beforeEach(() => {
    delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
  });

  it('rejects with SecretsNotProtectedError when secretCrypto is null/undefined', async () => {
    await expect(assertSecretsProtected(null)).rejects.toBeInstanceOf(SecretsNotProtectedError);
    await expect(assertSecretsProtected(undefined)).rejects.toBeInstanceOf(
      SecretsNotProtectedError,
    );
  });

  it('error message guides the user to set a passphrase or switch to Desktop', async () => {
    try {
      await assertSecretsProtected(null);
    } catch (err) {
      expect((err as Error).message).toMatch(/passphrase/i);
      expect((err as Error).message).toMatch(/Desktop/i);
    }
  });
});
