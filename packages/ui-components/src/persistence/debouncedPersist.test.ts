import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import {
  PERSIST_DEBOUNCE_MS,
  __setPersistersForTests,
  flushPendingPersist,
  queueSaveBoth,
  queueSaveLocal,
  queueSaveSynced,
  resetPendingPersistForTests,
} from './debouncedPersist';

// Tests inject fake writers via `__setPersistersForTests`. This avoids the
// vi.mock-hoisting headache of `./workspaceStorage` being resolved twice
// across the test file and `debouncedPersist.ts` (vitest's resolver was
// matching one but not the other — see notes in debouncedPersist.ts).

const writeLog: Array<{ kind: 'synced' | 'local' | 'both'; value: unknown }> = [];
const saveSyncedFake = vi.fn(async (s: WorkspaceSynced) => {
  writeLog.push({ kind: 'synced', value: s });
});
const saveLocalFake = vi.fn(async (l: WorkspaceLocal) => {
  writeLog.push({ kind: 'local', value: l });
});
const saveBothFake = vi.fn(async (s: WorkspaceSynced, l: WorkspaceLocal) => {
  writeLog.push({ kind: 'both', value: { synced: s, local: l } });
});

function fakeSynced(tag: string): WorkspaceSynced {
  return { workspaceId: tag } as unknown as WorkspaceSynced;
}
function fakeLocal(tag: string): WorkspaceLocal {
  return { workspaceId: tag } as unknown as WorkspaceLocal;
}

beforeEach(() => {
  vi.useFakeTimers();
  writeLog.length = 0;
  saveSyncedFake.mockClear();
  saveLocalFake.mockClear();
  saveBothFake.mockClear();
  resetPendingPersistForTests();
  __setPersistersForTests({
    saveSynced: saveSyncedFake,
    saveLocal: saveLocalFake,
    saveBoth: saveBothFake,
  });
});

afterEach(() => {
  vi.useRealTimers();
  __setPersistersForTests({}); // restore real persisters
});

describe('queueSaveSynced — debounce + coalescing', () => {
  it('writes nothing before the debounce window elapses', () => {
    queueSaveSynced(fakeSynced('a'));
    vi.advanceTimersByTime(PERSIST_DEBOUNCE_MS - 1);
    expect(saveSyncedFake).not.toHaveBeenCalled();
  });

  it('writes once after the debounce window elapses', async () => {
    queueSaveSynced(fakeSynced('a'));
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    expect(saveSyncedFake).toHaveBeenCalledTimes(1);
    expect(writeLog).toEqual([{ kind: 'synced', value: fakeSynced('a') }]);
  });

  it('coalesces rapid writes — only the latest value lands on disk', async () => {
    queueSaveSynced(fakeSynced('a'));
    queueSaveSynced(fakeSynced('b'));
    queueSaveSynced(fakeSynced('c'));
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    expect(saveSyncedFake).toHaveBeenCalledTimes(1);
    expect(writeLog).toEqual([{ kind: 'synced', value: fakeSynced('c') }]);
  });

  it('keeps resetting the timer while writes keep arriving (sliding window)', async () => {
    queueSaveSynced(fakeSynced('first'));
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS - 10);
    expect(saveSyncedFake).not.toHaveBeenCalled();
    queueSaveSynced(fakeSynced('second'));
    await vi.advanceTimersByTimeAsync(20);
    expect(saveSyncedFake).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    expect(writeLog).toEqual([{ kind: 'synced', value: fakeSynced('second') }]);
  });
});

describe('queueSaveLocal', () => {
  it('writes after the debounce window', async () => {
    queueSaveLocal(fakeLocal('l1'));
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    expect(writeLog).toEqual([{ kind: 'local', value: fakeLocal('l1') }]);
  });
});

describe('coalescing across synced + local within one tick', () => {
  it('combines into a single saveBoth transaction', async () => {
    queueSaveSynced(fakeSynced('s'));
    queueSaveLocal(fakeLocal('l'));
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    expect(saveBothFake).toHaveBeenCalledTimes(1);
    expect(saveSyncedFake).not.toHaveBeenCalled();
    expect(saveLocalFake).not.toHaveBeenCalled();
  });

  it('queueSaveBoth produces a single saveBoth transaction', async () => {
    queueSaveBoth(fakeSynced('s'), fakeLocal('l'));
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS);
    expect(writeLog).toEqual([
      { kind: 'both', value: { synced: fakeSynced('s'), local: fakeLocal('l') } },
    ]);
  });
});

describe('flushPendingPersist', () => {
  it('flushes immediately without waiting for the debounce window', async () => {
    queueSaveSynced(fakeSynced('flush-me'));
    await flushPendingPersist();
    expect(writeLog).toEqual([{ kind: 'synced', value: fakeSynced('flush-me') }]);
  });

  it('cancels the pending timer so the debounce does not double-write', async () => {
    queueSaveSynced(fakeSynced('once'));
    await flushPendingPersist();
    // Advance past the original debounce window — no second write should fire.
    await vi.advanceTimersByTimeAsync(PERSIST_DEBOUNCE_MS * 2);
    expect(saveSyncedFake).toHaveBeenCalledTimes(1);
  });

  it('is a safe no-op when nothing is queued', async () => {
    await expect(flushPendingPersist()).resolves.toBeUndefined();
    expect(saveSyncedFake).not.toHaveBeenCalled();
  });

  it('serialises overlapping flushes so on-disk order matches call order', async () => {
    // First saveSynced never resolves until we let it. The second flush
    // should wait for the first before issuing its write.
    let resolveFirst: (() => void) | null = null;
    saveSyncedFake.mockImplementationOnce(
      () =>
        new Promise<void>((resolve) => {
          resolveFirst = resolve;
          writeLog.push({ kind: 'synced', value: fakeSynced('first') });
        }),
    );

    queueSaveSynced(fakeSynced('first'));
    const flushA = flushPendingPersist();

    // Let flushA enter its await on the in-flight write.
    await Promise.resolve();

    queueSaveSynced(fakeSynced('second'));
    const flushB = flushPendingPersist();

    // First flush hasn't resolved → second flush is awaiting it.
    expect(writeLog).toEqual([{ kind: 'synced', value: fakeSynced('first') }]);
    resolveFirst!();
    await flushA;
    await flushB;
    expect(writeLog).toEqual([
      { kind: 'synced', value: fakeSynced('first') },
      { kind: 'synced', value: fakeSynced('second') },
    ]);
  });
});
