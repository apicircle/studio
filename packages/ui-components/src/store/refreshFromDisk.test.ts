import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';
import { __setDiskMirrorForTests } from '../persistence/diskMirror';
import { resetPendingPersistForTests } from '../persistence/debouncedPersist';

const T_OLD = '2026-05-01T00:00:00.000Z';
const T_NEW = '2026-05-22T00:00:00.000Z';

function makeSynced(workspaceId: string, updatedAt: string): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId,
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T_OLD, updatedAt, appVersion: '1.0.0' },
  };
}

function makeLocal(workspaceId: string): WorkspaceLocal {
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

function makeFakeMirror(
  diskState: { synced: WorkspaceSynced; local: WorkspaceLocal } | null,
  available = true,
) {
  return {
    isAvailable: () => available,
    init: vi.fn().mockResolvedValue({
      registry: { schemaVersion: 1, activeWorkspaceId: 'ws-a', workspaces: [] },
      migrated: false,
    }),
    readRegistry: vi.fn().mockResolvedValue({
      schemaVersion: 1,
      activeWorkspaceId: 'ws-a',
      workspaces: [],
    }),
    writeRegistry: vi.fn().mockResolvedValue(undefined),
    readWorkspace: vi.fn().mockResolvedValue(diskState),
    writeWorkspace: vi.fn().mockResolvedValue(undefined),
    deleteWorkspace: vi.fn().mockResolvedValue(null),
    registerWorkspace: vi.fn().mockResolvedValue(null),
    setActiveWorkspace: vi.fn().mockResolvedValue(null),
    flush: vi.fn().mockResolvedValue(undefined),
    workspacesRoot: vi.fn().mockResolvedValue('/fake'),
  };
}

beforeEach(() => {
  // Reset relevant store slices to a known starting point.
  useWorkspaceStore.setState({
    synced: makeSynced('ws-a', T_OLD),
    local: makeLocal('ws-a'),
  });
});

afterEach(() => {
  __setDiskMirrorForTests(null);
  resetPendingPersistForTests();
});

describe('refreshFromDisk', () => {
  it('returns no-mirror when the disk bridge is unavailable (web build)', async () => {
    __setDiskMirrorForTests(makeFakeMirror(null, /* available */ false));
    const result = await useWorkspaceStore.getState().refreshFromDisk();
    expect(result).toEqual({ kind: 'no-mirror' });
  });

  it('returns no-file when the on-disk workspace has not been written yet', async () => {
    __setDiskMirrorForTests(makeFakeMirror(null));
    const result = await useWorkspaceStore.getState().refreshFromDisk();
    expect(result).toEqual({ kind: 'no-file' });
  });

  it('returns up-to-date when memory and disk share the same workspaceId + timestamp', async () => {
    __setDiskMirrorForTests(
      makeFakeMirror({ synced: makeSynced('ws-a', T_OLD), local: makeLocal('ws-a') }),
    );
    const result = await useWorkspaceStore.getState().refreshFromDisk();
    expect(result.kind).toBe('up-to-date');
  });

  it('hydrates the store from disk when disk has a newer updatedAt', async () => {
    __setDiskMirrorForTests(
      makeFakeMirror({ synced: makeSynced('ws-a', T_NEW), local: makeLocal('ws-a') }),
    );
    const result = await useWorkspaceStore.getState().refreshFromDisk();
    expect(result.kind).toBe('updated');
    if (result.kind === 'updated') {
      expect(result.importedAt).toBe(T_NEW);
    }
    expect(useWorkspaceStore.getState().synced?.meta.updatedAt).toBe(T_NEW);
  });

  it('runs the one-time merger when disk has a different workspaceId', async () => {
    const diskSynced = makeSynced('ws-different', T_NEW);
    // Plant a single request on disk so the merger reports an import.
    diskSynced.collections.requests = {
      'disk-req-1': {
        id: 'disk-req-1',
        name: 'from disk',
        folderId: null,
        method: 'GET',
        url: 'https://example.com/from-disk',
        headers: [],
        query: [],
        body: { type: 'none', content: '' },
        auth: { type: 'inherit' },
        contextVars: [],
        extractions: [],
        assertions: [],
        createdAt: T_OLD,
        updatedAt: T_OLD,
      },
    };
    __setDiskMirrorForTests(
      makeFakeMirror({ synced: diskSynced, local: makeLocal('ws-different') }),
    );
    const result = await useWorkspaceStore.getState().refreshFromDisk();
    expect(result.kind).toBe('merged');
    if (result.kind === 'merged') {
      expect(result.importedRequestIds).toEqual(['disk-req-1']);
    }
    // Merged into memory, still keyed on the IDB workspaceId.
    expect(useWorkspaceStore.getState().synced?.workspaceId).toBe('ws-a');
    expect(useWorkspaceStore.getState().synced?.collections.requests['disk-req-1']).toBeDefined();
  });

  it('returns error when the mirror read throws', async () => {
    const fake = makeFakeMirror(null);
    fake.readWorkspace.mockRejectedValueOnce(new Error('disk failure'));
    __setDiskMirrorForTests(fake);
    const result = await useWorkspaceStore.getState().refreshFromDisk();
    expect(result.kind).toBe('error');
    if (result.kind === 'error') {
      expect(result.message).toMatch(/disk failure/);
    }
  });
});
