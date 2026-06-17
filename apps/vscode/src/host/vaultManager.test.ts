import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest';
import { initSecretCrypto } from '@apicircle/core';
import { VsCodeVaultManager, VaultLockedError, VaultCryptoError } from './vaultManager';

// Tiny iteration count keeps PBKDF2 derivation fast in the test pool —
// the algorithm path is identical to production.
const TEST_ITERATIONS = 100;

describe('VsCodeVaultManager', () => {
  let nowMs = 1_700_000_000_000;
  let timeoutCallbacks: Array<{ fn: () => void; delay: number; cancelled: boolean }> = [];
  let nextTimerId = 1;
  const fakeSetTimeout = ((fn: () => void, delay: number) => {
    const id = nextTimerId++;
    timeoutCallbacks.push({ fn, delay, cancelled: false });
    return { id } as unknown as ReturnType<typeof setTimeout>;
  }) as unknown as typeof setTimeout;
  const fakeClearTimeout = ((handle: ReturnType<typeof setTimeout>) => {
    const idx = (handle as unknown as { id: number }).id - 1;
    if (timeoutCallbacks[idx]) timeoutCallbacks[idx].cancelled = true;
  }) as unknown as typeof clearTimeout;

  function makeManager() {
    return new VsCodeVaultManager({
      now: () => nowMs,
      setTimeout: fakeSetTimeout,
      clearTimeout: fakeClearTimeout,
    });
  }

  beforeEach(() => {
    nowMs = 1_700_000_000_000;
    timeoutCallbacks = [];
    nextTimerId = 1;
  });

  afterEach(() => {
    timeoutCallbacks = [];
  });

  describe('initialize', () => {
    it('mints a SecretCryptoMeta blob and unlocks the workspace', async () => {
      const m = makeManager();
      const blob = await m.initialize('ws1', 'hunter2', TEST_ITERATIONS);
      expect(blob.kdf).toBe('pbkdf2-sha256-v1');
      expect(blob.salt).toBeTruthy();
      expect(blob.verifier).toBeTruthy();
      expect(blob.iterations).toBe(TEST_ITERATIONS);
      expect(m.isUnlocked('ws1')).toBe(true);
    });

    it('fires a "unlocked" change event after init', async () => {
      const m = makeManager();
      const calls: Array<[string, string]> = [];
      m.onDidChange((id, reason) => calls.push([id, reason]));
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      expect(calls).toEqual([['ws1', 'unlocked']]);
    });
  });

  describe('unlock', () => {
    it('accepts the right passphrase and caches the key', async () => {
      const init = await initSecretCrypto('correct', TEST_ITERATIONS);
      const m = makeManager();
      const res = await m.unlock('ws1', 'correct', init.crypto);
      expect(res.ok).toBe(true);
      expect(m.isUnlocked('ws1')).toBe(true);
    });

    it('returns ok:false (does NOT throw) on wrong passphrase', async () => {
      const init = await initSecretCrypto('correct', TEST_ITERATIONS);
      const m = makeManager();
      const res = await m.unlock('ws1', 'WRONG', init.crypto);
      expect(res.ok).toBe(false);
      if (!res.ok) expect(res.reason).toMatch(/Wrong passphrase/i);
      expect(m.isUnlocked('ws1')).toBe(false);
    });

    it('returns ok:false on an unsupported KDF (no key stored)', async () => {
      const init = await initSecretCrypto('p', TEST_ITERATIONS);
      const m = makeManager();
      const res = await m.unlock('ws1', 'p', {
        ...init.crypto,
        kdf: 'argon2-future' as 'pbkdf2-sha256-v1',
      });
      expect(res.ok).toBe(false);
      expect(m.isUnlocked('ws1')).toBe(false);
    });
  });

  // ----- P4R2-G3: isUnlockedAgainst verifies cached key matches on-disk blob -----

  describe('isUnlockedAgainst (stale-cache detection)', () => {
    it('returns true when cached key was derived from the same verifier', async () => {
      const m = makeManager();
      const blob = await m.initialize('ws1', 'pp', TEST_ITERATIONS);
      expect(m.isUnlockedAgainst('ws1', blob)).toBe(true);
    });

    it('returns false when the on-disk blob has a different verifier (teammate rotated)', async () => {
      const m = makeManager();
      const blob = await m.initialize('ws1', 'pp', TEST_ITERATIONS);
      // Simulate: a teammate rotated the passphrase and pushed a new blob.
      const rotated = { ...blob, verifier: blob.verifier + 'X' };
      expect(m.isUnlockedAgainst('ws1', rotated)).toBe(false);
      // But isUnlocked still reports true — the cached key is just stale.
      expect(m.isUnlocked('ws1')).toBe(true);
    });

    it('returns false when the workspace is locked', async () => {
      const m = makeManager();
      const blob = await m.initialize('ws1', 'pp', TEST_ITERATIONS);
      m.lock('ws1');
      expect(m.isUnlockedAgainst('ws1', blob)).toBe(false);
    });

    it('returns false when the blob arg is null/undefined', async () => {
      const m = makeManager();
      await m.initialize('ws1', 'pp', TEST_ITERATIONS);
      expect(m.isUnlockedAgainst('ws1', null)).toBe(false);
      expect(m.isUnlockedAgainst('ws1', undefined)).toBe(false);
    });
  });

  // ----- P4R2-G15: unlockedWorkspaceIds for "locked N vaults" toast -----

  describe('unlockedWorkspaceIds', () => {
    it('returns the empty array when nothing is unlocked', () => {
      const m = makeManager();
      expect(m.unlockedWorkspaceIds()).toEqual([]);
    });

    it('returns every currently-unlocked workspace id', async () => {
      const m = makeManager();
      await m.initialize('ws-a', 'p', TEST_ITERATIONS);
      await m.initialize('ws-b', 'p', TEST_ITERATIONS);
      expect(m.unlockedWorkspaceIds().sort()).toEqual(['ws-a', 'ws-b']);
    });

    it('shrinks as workspaces are locked', async () => {
      const m = makeManager();
      await m.initialize('ws-a', 'p', TEST_ITERATIONS);
      await m.initialize('ws-b', 'p', TEST_ITERATIONS);
      m.lock('ws-a');
      expect(m.unlockedWorkspaceIds()).toEqual(['ws-b']);
    });
  });

  describe('lock + lockAll', () => {
    it('lock(id) clears just that workspace', async () => {
      const m = makeManager();
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      await m.initialize('ws2', 'p', TEST_ITERATIONS);
      m.lock('ws1');
      expect(m.isUnlocked('ws1')).toBe(false);
      expect(m.isUnlocked('ws2')).toBe(true);
    });

    it('lockAll() clears every workspace and fires a "locked" event per id', async () => {
      const m = makeManager();
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      await m.initialize('ws2', 'p', TEST_ITERATIONS);
      const events: string[] = [];
      m.onDidChange((id, reason) => events.push(`${id}:${reason}`));
      m.lockAll();
      expect(m.isUnlocked('ws1')).toBe(false);
      expect(m.isUnlocked('ws2')).toBe(false);
      expect(events.sort()).toEqual(['ws1:locked', 'ws2:locked']);
    });

    it('lock on an already-locked workspace is a no-op', async () => {
      const m = makeManager();
      const events: string[] = [];
      m.onDidChange((id, reason) => events.push(`${id}:${reason}`));
      m.lock('ws-unknown');
      expect(events).toEqual([]);
    });
  });

  describe('encryptValue + decryptValue', () => {
    it('round-trips through the cached key', async () => {
      const m = makeManager();
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const wire = await m.encryptValue('ws1', 'hello-world');
      expect(wire).toMatch(/^enc:v1:/);
      const plain = await m.decryptValue('ws1', wire);
      expect(plain).toBe('hello-world');
    });

    it('encryptValue throws VaultLockedError when locked', async () => {
      const m = makeManager();
      await expect(m.encryptValue('ws1', 'x')).rejects.toBeInstanceOf(VaultLockedError);
    });

    it('decryptValue throws VaultLockedError when locked', async () => {
      const m = makeManager();
      await expect(m.decryptValue('ws1', 'enc:v1:x:y')).rejects.toBeInstanceOf(VaultLockedError);
    });

    it('decryptValue throws VaultCryptoError on a malformed wire string', async () => {
      const m = makeManager();
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      await expect(m.decryptValue('ws1', 'not-an-encrypted-payload')).rejects.toBeInstanceOf(
        VaultCryptoError,
      );
    });

    it('decryptValue throws VaultCryptoError on tampered ciphertext', async () => {
      const m = makeManager();
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const wire = await m.encryptValue('ws1', 'hello');
      // Flip one base64 character in the ciphertext.
      const parts = wire.split(':');
      parts[3] = parts[3]
        .split('')
        .map((c, i) => (i === 0 && c !== 'A' ? 'A' : c))
        .join('');
      await expect(m.decryptValue('ws1', parts.join(':'))).rejects.toBeInstanceOf(VaultCryptoError);
    });

    it('a wrong-passphrase key cannot decrypt the original ciphertext', async () => {
      // Unlock with one passphrase, encrypt, lock, unlock with a DIFFERENT
      // passphrase under a different blob, and confirm decrypt fails.
      const aInit = await initSecretCrypto('alpha', TEST_ITERATIONS);
      const bInit = await initSecretCrypto('beta', TEST_ITERATIONS);
      const m = makeManager();
      await m.unlock('ws1', 'alpha', aInit.crypto);
      const wire = await m.encryptValue('ws1', 'secret');
      m.lock('ws1');
      await m.unlock('ws1', 'beta', bInit.crypto);
      await expect(m.decryptValue('ws1', wire)).rejects.toBeInstanceOf(VaultCryptoError);
    });
  });

  describe('auto-lock timer', () => {
    it('arms a setTimeout matching autoLockMinutes', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(5);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      // The most recent un-cancelled callback should match 5min.
      const live = timeoutCallbacks.filter((c) => !c.cancelled);
      expect(live.length).toBe(1);
      expect(live[0].delay).toBe(5 * 60_000);
    });

    it('firing the timer auto-locks the workspace + emits "auto-locked"', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(5);
      const events: string[] = [];
      m.onDidChange((id, reason) => events.push(`${id}:${reason}`));
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      events.length = 0; // discard the initial "unlocked" event
      const live = timeoutCallbacks.find((c) => !c.cancelled);
      expect(live).toBeDefined();
      live!.fn();
      expect(m.isUnlocked('ws1')).toBe(false);
      expect(events).toEqual(['ws1:auto-locked']);
    });

    it('autoLockMinutes=0 disables the timer entirely', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(0);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const live = timeoutCallbacks.filter((c) => !c.cancelled);
      expect(live.length).toBe(0);
    });

    it('touch() resets the timer (extends the unlock window)', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(5);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const initial = timeoutCallbacks.find((c) => !c.cancelled);
      m.touch('ws1');
      // The first timer should now be cancelled, and a new one armed.
      expect(initial!.cancelled).toBe(true);
      const live = timeoutCallbacks.filter((c) => !c.cancelled);
      expect(live.length).toBe(1);
    });

    it('setAutoLockMinutes re-arms every active timer with the new value', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(5);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      m.setAutoLockMinutes(15);
      const live = timeoutCallbacks.filter((c) => !c.cancelled);
      expect(live.length).toBe(1);
      expect(live[0].delay).toBe(15 * 60_000);
    });

    it('a fired timer for a replaced entry does not double-fire', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(5);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const stale = timeoutCallbacks.find((c) => !c.cancelled);
      // Re-initialize — replaces the entry and the timer.
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const events: string[] = [];
      m.onDidChange((id, reason) => events.push(`${id}:${reason}`));
      // The original timer's clearTimeout was called when we replaced the
      // entry — calling the stale fn should be a no-op (the cancelled
      // callback's identity check inside armTimer guards against this).
      stale!.fn();
      expect(events).toEqual([]);
      expect(m.isUnlocked('ws1')).toBe(true);
    });

    it('encryptValue resets the timer (counts as activity)', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(5);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const initial = timeoutCallbacks.find((c) => !c.cancelled)!;
      await m.encryptValue('ws1', 'secret');
      expect(initial.cancelled).toBe(true);
      const live = timeoutCallbacks.filter((c) => !c.cancelled);
      expect(live.length).toBe(1);
    });

    it('decryptValue resets the timer (counts as activity)', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(5);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const wire = await m.encryptValue('ws1', 'x');
      const initial = timeoutCallbacks.filter((c) => !c.cancelled).at(-1)!;
      await m.decryptValue('ws1', wire);
      expect(initial.cancelled).toBe(true);
    });
  });

  describe('snapshot()', () => {
    it('reports unlocked=false with null timestamps when locked', () => {
      const m = makeManager();
      const s = m.snapshot('ws1');
      expect(s).toEqual({
        workspaceId: 'ws1',
        unlocked: false,
        lastActivityAt: null,
        remainingMinutes: null,
      });
    });

    it('reports remainingMinutes when auto-lock active', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(10);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      const s = m.snapshot('ws1');
      expect(s.unlocked).toBe(true);
      expect(s.lastActivityAt).toBe(nowMs);
      expect(s.remainingMinutes).toBeCloseTo(10, 5);
    });

    it('remainingMinutes is null when auto-lock disabled', async () => {
      const m = makeManager();
      m.setAutoLockMinutes(0);
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      expect(m.snapshot('ws1').remainingMinutes).toBeNull();
    });
  });

  describe('listener safety', () => {
    it('dispose() while another listener is firing does not skip adjacent listeners', async () => {
      const m = makeManager();
      const seen: string[] = [];
      const subA: { dispose: () => void } = m.onDidChange((id) => {
        seen.push(`A:${id}`);
        subA.dispose();
      });
      m.onDidChange((id) => seen.push(`B:${id}`));
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      expect(seen).toEqual(['A:ws1', 'B:ws1']);
    });

    it('a throwing listener does not block subsequent listeners', async () => {
      const logSpy = vi.fn();
      const m = new VsCodeVaultManager({
        now: () => nowMs,
        setTimeout: fakeSetTimeout,
        clearTimeout: fakeClearTimeout,
        log: logSpy,
      });
      const seen: string[] = [];
      m.onDidChange(() => {
        throw new Error('boom');
      });
      m.onDidChange((id) => seen.push(id));
      await m.initialize('ws1', 'p', TEST_ITERATIONS);
      expect(seen).toEqual(['ws1']);
      expect(logSpy).toHaveBeenCalledWith(expect.stringContaining('boom'));
    });
  });
});
