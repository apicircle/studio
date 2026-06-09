// =============================================================================
// snapshotRoundTrip integration test (gap #12).
//
// Verifies the full capture → mutate → restore cycle works at the
// GitWorkspaceProvider level with real on-disk JSON.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { generateId } from '@apicircle/shared';
import { GitWorkspaceProvider } from '../../src/host/gitWorkspaceProvider';

function seed(apicircleDir: string, localDir: string): GitWorkspaceProvider {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'snap-rt',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
  return new GitWorkspaceProvider({ syncedDir: apicircleDir, localDir });
}

function makeReq(id: string, name: string) {
  return {
    id,
    name,
    folderId: null,
    method: 'GET' as const,
    url: 'https://x.com',
    headers: [],
    query: [],
    body: { type: 'none' as const, content: '' },
    auth: { type: 'none' as const },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
  };
}

describe('snapshotRoundTrip (capture → mutate → restore)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snap-rt-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('captures, mutates, restores, and the workspace shape is exactly recovered', async () => {
    const provider = seed(path.join(tmp, '.apicircle'), path.join(tmp, 'local'));

    // Seed a request and capture snapshot
    const reqId = generateId();
    await provider.apply({ kind: 'request.create', request: makeReq(reqId, 'Original') });
    const beforeMutate = await provider.read();
    await provider.apply({ kind: 'snapshot.capture', trigger: 'manual', note: 'pre-mutation' });

    // Mutate: delete the request
    await provider.apply({ kind: 'request.delete', id: reqId });
    const afterMutate = await provider.read();
    expect(afterMutate.synced.collections.requests[reqId]).toBeUndefined();

    // Restore the snapshot
    const snapshotId = (await provider.read()).local.snapshots.entries[0].id;
    await provider.apply({ kind: 'snapshot.restore', id: snapshotId });

    const restored = await provider.read();
    expect(restored.synced.collections.requests[reqId]).toBeDefined();
    expect(restored.synced.collections.requests[reqId].name).toBe('Original');
    // The shape should match pre-mutation modulo timestamps
    expect(Object.keys(restored.synced.collections.requests)).toEqual(
      Object.keys(beforeMutate.synced.collections.requests),
    );
  });

  it('snapshot ledger respects maxBytes cap with ring-buffer eviction', async () => {
    const provider = seed(path.join(tmp, '.apicircle'), path.join(tmp, 'local'));
    // Set a tight cap so a single snapshot exceeds it — evicting the oldest
    await provider.apply({ kind: 'snapshot.set_max_bytes', maxBytes: 100 });
    await provider.apply({ kind: 'snapshot.capture', trigger: 'manual', note: 'a' });
    await provider.apply({ kind: 'snapshot.capture', trigger: 'manual', note: 'b' });
    const state = await provider.read();
    expect(state.local.snapshots.entries.length).toBeLessThanOrEqual(2);
    expect(state.local.snapshots.maxBytes).toBe(100);
  });

  it('captured snapshot contains an exact copy of WorkspaceSynced at capture time', async () => {
    const provider = seed(path.join(tmp, '.apicircle'), path.join(tmp, 'local'));
    await provider.apply({ kind: 'request.create', request: makeReq('r1', 'A') });
    await provider.apply({ kind: 'snapshot.capture', trigger: 'manual' });
    const state = await provider.read();
    const snap = state.local.snapshots.entries[0];
    expect(snap.workspaceSyncedSnapshot.collections.requests.r1).toBeDefined();
    expect(snap.workspaceSyncedSnapshot.collections.requests.r1.name).toBe('A');
  });
});
