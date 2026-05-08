import { describe, expect, it } from 'vitest';
import {
  LOCAL_STORE,
  REGISTRY_STORE,
  SYNCED_STORE,
  clearAll,
  deleteWorkspaceRecords,
  readRecord,
  readRegistry,
  type WorkspaceRegistry,
  writeBoth,
  writeRecord,
  writeRegistry,
} from './db';

describe('IndexedDB layer (B.6 multi-workspace key)', () => {
  it('returns null for an empty store', async () => {
    const result = await readRecord<{ workspaceId: string }>(SYNCED_STORE, 'never-existed');
    expect(result).toBeNull();
  });

  it('round-trips a record by workspaceId through writeRecord + readRecord', async () => {
    const fixture = { workspaceId: 'ws-1', n: 42 };
    await writeRecord(SYNCED_STORE, fixture);
    const out = await readRecord<typeof fixture>(SYNCED_STORE, 'ws-1');
    expect(out).toEqual(fixture);
  });

  it('readRecord with a different workspaceId returns null (records are scoped per workspace)', async () => {
    await writeRecord(SYNCED_STORE, { workspaceId: 'ws-A', n: 1 });
    await writeRecord(SYNCED_STORE, { workspaceId: 'ws-B', n: 2 });
    expect(await readRecord<{ n: number }>(SYNCED_STORE, 'ws-A')).toEqual({
      workspaceId: 'ws-A',
      n: 1,
    });
    expect(await readRecord<{ n: number }>(SYNCED_STORE, 'ws-B')).toEqual({
      workspaceId: 'ws-B',
      n: 2,
    });
    expect(await readRecord(SYNCED_STORE, 'ws-C')).toBeNull();
  });

  it('writeBoth writes synced and local atomically in one transaction (keyed by workspaceId)', async () => {
    const synced = { workspaceId: 'ws-1', tag: 'synced' };
    const local = { workspaceId: 'ws-1', tag: 'local' };
    await writeBoth(synced, local);
    expect(await readRecord(SYNCED_STORE, 'ws-1')).toEqual(synced);
    expect(await readRecord(LOCAL_STORE, 'ws-1')).toEqual(local);
  });

  it('writeBoth supports null on either side (skip writing that store)', async () => {
    await clearAll();
    await writeBoth({ workspaceId: 'ws-1', tag: 'synced-only' }, null);
    expect(await readRecord(SYNCED_STORE, 'ws-1')).toEqual({
      workspaceId: 'ws-1',
      tag: 'synced-only',
    });
    expect(await readRecord(LOCAL_STORE, 'ws-1')).toBeNull();

    await writeBoth(null, { workspaceId: 'ws-1', tag: 'local-only' });
    expect(await readRecord(SYNCED_STORE, 'ws-1')).toEqual({
      workspaceId: 'ws-1',
      tag: 'synced-only',
    });
    expect(await readRecord(LOCAL_STORE, 'ws-1')).toEqual({
      workspaceId: 'ws-1',
      tag: 'local-only',
    });
  });

  it('deleteWorkspaceRecords removes both synced + local for a workspace', async () => {
    await writeBoth(
      { workspaceId: 'ws-doomed', tag: 'synced' },
      { workspaceId: 'ws-doomed', tag: 'local' },
    );
    await writeBoth(
      { workspaceId: 'ws-survives', tag: 'synced' },
      { workspaceId: 'ws-survives', tag: 'local' },
    );
    await deleteWorkspaceRecords('ws-doomed');
    expect(await readRecord(SYNCED_STORE, 'ws-doomed')).toBeNull();
    expect(await readRecord(LOCAL_STORE, 'ws-doomed')).toBeNull();
    // Other workspace untouched.
    expect(await readRecord(SYNCED_STORE, 'ws-survives')).not.toBeNull();
  });

  it('readRegistry / writeRegistry round-trip the workspace registry', async () => {
    const registry: WorkspaceRegistry = {
      schemaVersion: 1,
      activeWorkspaceId: 'ws-1',
      workspaces: [{ id: 'ws-1', name: 'Default', createdAt: 't', lastOpenedAt: 't' }],
    };
    await writeRegistry(registry);
    const out = await readRegistry();
    expect(out).toEqual(registry);
  });

  it('clearAll empties all three stores', async () => {
    await writeRecord(SYNCED_STORE, { workspaceId: 'ws-x' });
    await writeRecord(LOCAL_STORE, { workspaceId: 'ws-x' });
    await writeRegistry({
      schemaVersion: 1,
      activeWorkspaceId: 'ws-x',
      workspaces: [{ id: 'ws-x', name: 'X', createdAt: 't', lastOpenedAt: 't' }],
    });
    await clearAll();
    expect(await readRecord(SYNCED_STORE, 'ws-x')).toBeNull();
    expect(await readRecord(LOCAL_STORE, 'ws-x')).toBeNull();
    expect(await readRegistry()).toBeNull();
    // The REGISTRY_STORE constant exists; just sanity-check the export.
    expect(REGISTRY_STORE).toBe('registry');
  });
});
