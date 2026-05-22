import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { saveToFile } from '@apicircle/core/workspace/file-backed';

// `WorkspaceFileManager` only touches Electron's `app.getPath` when no
// explicit dir is passed to the constructor. The tests below always pass
// a dir, so we stub the import to avoid pulling in real Electron under vitest.
vi.mock('electron', () => ({
  app: {
    getPath: (key: string) => {
      if (key === 'userData') return '/fake/user-data';
      throw new Error(`unknown getPath ${key}`);
    },
  },
}));

import { WorkspaceFileManager } from './workspaceFileManager';

const T0 = '2026-05-22T00:00:00.000Z';

function makeSynced(workspaceId = 'ws-1'): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId,
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.0.0' },
  };
}

function makeLocal(workspaceId = 'ws-1'): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId,
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
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}

let tmpDir: string;
let workspacesRoot: string;
let legacyDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-wfm-'));
  workspacesRoot = path.join(tmpDir, 'workspaces');
  legacyDir = path.join(tmpDir, 'workspace');
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('WorkspaceFileManager (multi-workspace)', () => {
  it('init() returns an empty registry when there is no legacy dir and no registry yet', async () => {
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    const { migrated, registry } = await mgr.init();
    expect(migrated).toBe(false);
    expect(registry.workspaces).toEqual([]);
    expect(registry.activeWorkspaceId).toBeNull();
  });

  it('init() migrates a legacy single-workspace dir into the registry', async () => {
    await saveToFile(legacyDir, {
      synced: makeSynced('ws-legacy'),
      local: makeLocal('ws-legacy'),
    });
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    const { migrated, registry } = await mgr.init();
    expect(migrated).toBe(true);
    expect(registry.activeWorkspaceId).toBe('ws-legacy');
    expect(registry.workspaces.map((w) => w.id)).toEqual(['ws-legacy']);
    // Legacy synced.json should have been removed.
    await expect(fs.access(path.join(legacyDir, 'workspace.synced.json'))).rejects.toBeTruthy();
    // The state now lives under <root>/<id>/.
    const loaded = await mgr.readWorkspace('ws-legacy');
    expect(loaded?.synced.workspaceId).toBe('ws-legacy');
  });

  it('writeWorkspace() round-trips by id', async () => {
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    await mgr.writeWorkspace('ws-rt', {
      synced: makeSynced('ws-rt'),
      local: makeLocal('ws-rt'),
    });
    const loaded = await mgr.readWorkspace('ws-rt');
    expect(loaded?.synced.workspaceId).toBe('ws-rt');
    expect(loaded?.local.workspaceId).toBe('ws-rt');
  });

  it('writeWorkspace() rejects when the inner workspaceId does not match the arg', async () => {
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    await expect(
      mgr.writeWorkspace('ws-arg', {
        synced: makeSynced('ws-inner'),
        local: makeLocal('ws-inner'),
      }),
    ).rejects.toThrow(/workspaceId mismatch/);
  });

  it('coalesces overlapping writes for the SAME workspaceId to the latest state', async () => {
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    const s1 = makeSynced('ws-c');
    s1.meta = { ...s1.meta, updatedAt: '2026-05-22T00:00:00.001Z' };
    const s2 = makeSynced('ws-c');
    s2.meta = { ...s2.meta, updatedAt: '2026-05-22T00:00:00.002Z' };
    const s3 = makeSynced('ws-c');
    s3.meta = { ...s3.meta, updatedAt: '2026-05-22T00:00:00.003Z' };
    const p1 = mgr.writeWorkspace('ws-c', { synced: s1, local: makeLocal('ws-c') });
    const p2 = mgr.writeWorkspace('ws-c', { synced: s2, local: makeLocal('ws-c') });
    const p3 = mgr.writeWorkspace('ws-c', { synced: s3, local: makeLocal('ws-c') });
    await Promise.all([p1, p2, p3]);
    const loaded = await mgr.readWorkspace('ws-c');
    expect(loaded?.synced.meta.updatedAt).toBe('2026-05-22T00:00:00.003Z');
  });

  it('writes to different workspaceIds land in parallel without clobbering each other', async () => {
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    await Promise.all([
      mgr.writeWorkspace('ws-a', { synced: makeSynced('ws-a'), local: makeLocal('ws-a') }),
      mgr.writeWorkspace('ws-b', { synced: makeSynced('ws-b'), local: makeLocal('ws-b') }),
    ]);
    expect((await mgr.readWorkspace('ws-a'))?.synced.workspaceId).toBe('ws-a');
    expect((await mgr.readWorkspace('ws-b'))?.synced.workspaceId).toBe('ws-b');
  });

  it('flush() awaits queued + in-flight writes across every workspaceId', async () => {
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    void mgr.writeWorkspace('ws-flush-a', {
      synced: makeSynced('ws-flush-a'),
      local: makeLocal('ws-flush-a'),
    });
    void mgr.writeWorkspace('ws-flush-b', {
      synced: makeSynced('ws-flush-b'),
      local: makeLocal('ws-flush-b'),
    });
    await mgr.flush();
    expect((await mgr.readWorkspace('ws-flush-a'))?.synced.workspaceId).toBe('ws-flush-a');
    expect((await mgr.readWorkspace('ws-flush-b'))?.synced.workspaceId).toBe('ws-flush-b');
  });

  it('registerWorkspaceEntry / setActiveWorkspace update the registry', async () => {
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    await mgr.writeWorkspace('ws-r', {
      synced: makeSynced('ws-r'),
      local: makeLocal('ws-r'),
    });
    const r1 = await mgr.registerWorkspaceEntry({
      id: 'ws-r',
      name: 'Registered',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    expect(r1.workspaces.map((w) => w.id)).toContain('ws-r');
    expect(r1.activeWorkspaceId).toBe('ws-r');
    await mgr.writeWorkspace('ws-r2', {
      synced: makeSynced('ws-r2'),
      local: makeLocal('ws-r2'),
    });
    await mgr.registerWorkspaceEntry({
      id: 'ws-r2',
      name: 'Second',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    const r2 = await mgr.setActiveWorkspace('ws-r2');
    expect(r2.activeWorkspaceId).toBe('ws-r2');
  });

  it('deleteWorkspaceFile() removes the dir + registry entry; picks a fallback active', async () => {
    const mgr = new WorkspaceFileManager({ workspacesRoot, legacyDir });
    await mgr.writeWorkspace('ws-a', {
      synced: makeSynced('ws-a'),
      local: makeLocal('ws-a'),
    });
    await mgr.registerWorkspaceEntry({
      id: 'ws-a',
      name: 'A',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    await mgr.writeWorkspace('ws-b', {
      synced: makeSynced('ws-b'),
      local: makeLocal('ws-b'),
    });
    await mgr.registerWorkspaceEntry({
      id: 'ws-b',
      name: 'B',
      createdAt: T0,
      lastOpenedAt: '2026-06-01T00:00:00.000Z',
    });
    await mgr.setActiveWorkspace('ws-a');
    const next = await mgr.deleteWorkspaceFile('ws-a');
    expect(next.workspaces.map((w) => w.id)).toEqual(['ws-b']);
    expect(next.activeWorkspaceId).toBe('ws-b');
    expect(await mgr.readWorkspace('ws-a')).toBeNull();
  });
});
