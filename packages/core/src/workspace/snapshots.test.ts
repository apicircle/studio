// Snapshot capture/restore + ring-buffer eviction tests. Each test runs
// against a fresh state via the same makeSynced/makeLocal fixtures the
// rest of applyMutation.test.ts uses.

import { describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { applyMutation } from './applyMutation';

const T0 = '2026-04-27T00:00:00.000Z';
const T1 = '2026-04-27T00:00:01.000Z';
const T2 = '2026-04-27T00:00:02.000Z';

function makeSynced(): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    workspaceName: 'W',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
  };
}

function makeLocal(maxBytes = 1024 * 1024): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: { workspace: null, links: {} } },
    connectedRepo: null,
    workingBranch: null,
    seededWorkspaceSha: null,
    retiredBranch: null,
    sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
    linkedCollections: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes },
  };
}

describe('snapshot.capture', () => {
  it('captures a verbatim copy of synced and adds it to the ledger', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'snapshot.capture', trigger: 'manual' }, { now: T1 });
    expect(out.next.local.snapshots.entries).toHaveLength(1);
    const entry = out.next.local.snapshots.entries[0];
    expect(entry.triggeredBy).toBe('manual');
    expect(entry.createdAt).toBe(T1);
    expect(entry.workspaceSyncedSnapshot).toBe(state.synced);
    expect(entry.sizeBytes).toBeGreaterThan(0);
  });

  it('captures preserve user-supplied notes', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(
      state,
      { kind: 'snapshot.capture', trigger: 'manual', note: 'before refactor' },
      { now: T1 },
    );
    expect(out.next.local.snapshots.entries[0].note).toBe('before refactor');
  });

  it('newest entries land at index 0', () => {
    let state = { synced: makeSynced(), local: makeLocal() };
    state = applyMutation(state, { kind: 'snapshot.capture', trigger: 'manual' }, { now: T1 }).next;
    state = applyMutation(
      state,
      { kind: 'snapshot.capture', trigger: 'pre-push' },
      { now: T2 },
    ).next;
    expect(state.local.snapshots.entries[0].triggeredBy).toBe('pre-push');
    expect(state.local.snapshots.entries[1].triggeredBy).toBe('manual');
  });

  it('evicts oldest entries when total size exceeds maxBytes', () => {
    // Pin maxBytes to ~1 KB so one capture's serialized doc + a second one
    // forces eviction. The fixture serializes to ~400 B, so two captures
    // total > 1 KB and the older one drops.
    let state = { synced: makeSynced(), local: makeLocal(800) };
    state = applyMutation(state, { kind: 'snapshot.capture', trigger: 'manual' }, { now: T1 }).next;
    expect(state.local.snapshots.entries).toHaveLength(1);
    state = applyMutation(
      state,
      { kind: 'snapshot.capture', trigger: 'pre-push' },
      { now: T2 },
    ).next;
    expect(state.local.snapshots.entries).toHaveLength(1);
    expect(state.local.snapshots.entries[0].triggeredBy).toBe('pre-push');
  });

  it('respects an unlimited cap (POSITIVE_INFINITY)', () => {
    let state = { synced: makeSynced(), local: makeLocal(Number.POSITIVE_INFINITY) };
    for (let i = 0; i < 5; i++) {
      state = applyMutation(
        state,
        { kind: 'snapshot.capture', trigger: 'manual' },
        { now: `2026-04-27T00:00:0${i}.000Z` },
      ).next;
    }
    expect(state.local.snapshots.entries).toHaveLength(5);
  });
});

describe('snapshot.restore', () => {
  it('replaces synced with the captured doc and clears lastPulledSnapshot', () => {
    let state = { synced: makeSynced(), local: makeLocal() };
    state.local = {
      ...state.local,
      sync: {
        ...state.local.sync,
        lastPulledSnapshot: { foo: 'bar' } as unknown as WorkspaceSynced,
        lastPulledSha: 'abc123',
      },
    };
    const captured = applyMutation(
      state,
      { kind: 'snapshot.capture', trigger: 'manual' },
      { now: T1 },
    );
    state = captured.next;
    const id = captured.changedIds[0];

    // Mutate synced to simulate user work after the capture, then restore.
    state.synced = { ...state.synced, workspaceName: 'mutated' };
    const restored = applyMutation(state, { kind: 'snapshot.restore', id }, { now: T2 });
    expect(restored.next.synced.workspaceName).toBe('W');
    // Restore is a logical re-fork — diff base must be cleared.
    expect(restored.next.local.sync.lastPulledSnapshot).toBeNull();
    expect(restored.next.local.sync.lastPulledSha).toBeNull();
  });

  it('is a no-op for unknown ids', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'snapshot.restore', id: 'nope' }, { now: T1 });
    expect(out.next).toBe(state);
    expect(out.changedIds).toEqual([]);
  });
});

describe('snapshot.delete', () => {
  it('removes the entry from the ledger', () => {
    let state = { synced: makeSynced(), local: makeLocal() };
    const captured = applyMutation(
      state,
      { kind: 'snapshot.capture', trigger: 'manual' },
      { now: T1 },
    );
    state = captured.next;
    const id = captured.changedIds[0];
    const out = applyMutation(state, { kind: 'snapshot.delete', id }, { now: T2 });
    expect(out.next.local.snapshots.entries).toHaveLength(0);
    expect(out.changedIds).toEqual([id]);
  });

  it('is a no-op for unknown ids', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'snapshot.delete', id: 'nope' }, { now: T1 });
    expect(out.next).toBe(state);
  });
});

describe('snapshot.set_max_bytes', () => {
  it('lowers the cap and evicts entries that no longer fit', () => {
    let state = { synced: makeSynced(), local: makeLocal(Number.POSITIVE_INFINITY) };
    for (let i = 0; i < 4; i++) {
      state = applyMutation(
        state,
        { kind: 'snapshot.capture', trigger: 'manual' },
        { now: `2026-04-27T00:00:0${i}.000Z` },
      ).next;
    }
    expect(state.local.snapshots.entries).toHaveLength(4);
    // Drop the cap to ~1 byte — everything should evict except possibly the
    // newest (since we only evict until total <= cap; with 1 byte cap, even
    // the newest exceeds it, so all four go).
    const out = applyMutation(state, { kind: 'snapshot.set_max_bytes', maxBytes: 1 }, { now: T2 });
    expect(out.next.local.snapshots.maxBytes).toBe(1);
    expect(out.next.local.snapshots.entries.length).toBeLessThan(4);
  });

  it('clamps negative values to 0', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'snapshot.set_max_bytes', maxBytes: -1 }, { now: T1 });
    expect(out.next.local.snapshots.maxBytes).toBe(0);
  });
});
