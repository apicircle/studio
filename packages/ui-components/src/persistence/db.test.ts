import { describe, expect, it } from 'vitest';
import { LOCAL_STORE, SYNCED_STORE, clearAll, readRecord, writeBoth, writeRecord } from './db';

describe('IndexedDB layer', () => {
  it('returns null for an empty store', async () => {
    const result = await readRecord<{ x: number }>(SYNCED_STORE);
    expect(result).toBeNull();
  });

  it('round-trips a record through writeRecord + readRecord', async () => {
    const fixture = { workspaceId: 'abc', n: 42 };
    await writeRecord(SYNCED_STORE, fixture);
    const out = await readRecord<typeof fixture>(SYNCED_STORE);
    expect(out).toEqual(fixture);
  });

  it('writeBoth writes synced and local atomically in one transaction', async () => {
    const synced = { tag: 'synced', n: 1 };
    const local = { tag: 'local', n: 2 };
    await writeBoth(synced, local);
    expect(await readRecord(SYNCED_STORE)).toEqual(synced);
    expect(await readRecord(LOCAL_STORE)).toEqual(local);
  });

  it('writeBoth supports null on either side (skip writing that store)', async () => {
    await writeBoth({ tag: 'synced-only' }, null);
    expect(await readRecord(SYNCED_STORE)).toEqual({ tag: 'synced-only' });
    expect(await readRecord(LOCAL_STORE)).toBeNull();

    await writeBoth(null, { tag: 'local-only' });
    expect(await readRecord(SYNCED_STORE)).toEqual({ tag: 'synced-only' });
    expect(await readRecord(LOCAL_STORE)).toEqual({ tag: 'local-only' });
  });

  it('clearAll empties both stores', async () => {
    await writeRecord(SYNCED_STORE, { x: 1 });
    await writeRecord(LOCAL_STORE, { y: 2 });
    await clearAll();
    expect(await readRecord(SYNCED_STORE)).toBeNull();
    expect(await readRecord(LOCAL_STORE)).toBeNull();
  });
});
