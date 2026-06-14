import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import {
  REGISTRY_FILE,
  WORKSPACES_SUBDIR,
  defaultApicircleRoot,
  deleteWorkspaceById,
  emptyRegistry,
  findWorkspaceEntry,
  loadRegistry,
  loadWorkspaceById,
  registerWorkspace,
  saveRegistry,
  saveWorkspaceById,
  setActiveWorkspace,
  workspaceDirFor,
  type WorkspaceRegistry,
} from './workspaceRegistry';

const T0 = '2026-05-22T00:00:00.000Z';
const T1 = '2026-06-01T00:00:00.000Z';

function makeSynced(workspaceId = 'ws-1'): WorkspaceSynced {
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

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-reg-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('defaultApicircleRoot', () => {
  it('returns ~/.apicircle', () => {
    expect(defaultApicircleRoot()).toBe(path.join(os.homedir(), '.apicircle'));
  });
});

describe('workspaceDirFor', () => {
  it('joins root + workspaces/ + workspaceId', () => {
    expect(workspaceDirFor('/r', 'ws-a')).toBe(path.join('/r', WORKSPACES_SUBDIR, 'ws-a'));
  });
});

describe('emptyRegistry', () => {
  it('returns the canonical empty shape', () => {
    expect(emptyRegistry()).toEqual({
      schemaVersion: 1,
      activeWorkspaceId: null,
      workspaces: [],
    });
  });
});

describe('loadRegistry / saveRegistry', () => {
  it('returns null when the registry file does not exist', async () => {
    expect(await loadRegistry(root)).toBeNull();
  });

  it('round-trips a registry through disk', async () => {
    const registry: WorkspaceRegistry = {
      schemaVersion: 1,
      activeWorkspaceId: 'ws-a',
      workspaces: [{ id: 'ws-a', name: 'A', createdAt: T0, lastOpenedAt: T0 }],
    };
    await saveRegistry(root, registry);
    const loaded = await loadRegistry(root);
    expect(loaded).toEqual(registry);
  });

  it('writes registry.json atomically (no .tmp leftover after success)', async () => {
    await saveRegistry(root, emptyRegistry());
    const entries = await fs.readdir(root);
    expect(entries).toContain(REGISTRY_FILE);
    expect(entries.some((e) => e.endsWith('.tmp'))).toBe(false);
  });

  it('normalizes missing array fields in a hand-crafted registry file', async () => {
    // Write a malformed-but-recoverable JSON directly. Normalizer should
    // backfill `workspaces` to an empty array rather than crashing readers.
    await fs.writeFile(
      path.join(root, REGISTRY_FILE),
      JSON.stringify({ schemaVersion: 1, activeWorkspaceId: null }),
      'utf-8',
    );
    const loaded = await loadRegistry(root);
    expect(loaded).not.toBeNull();
    expect(loaded!.workspaces).toEqual([]);
  });
});

describe('saveWorkspaceById / loadWorkspaceById', () => {
  it('writes the pair under <root>/<id>/ and reads it back', async () => {
    const state = { synced: makeSynced('ws-x'), local: makeLocal('ws-x') };
    await saveWorkspaceById(root, 'ws-x', state);
    const loaded = await loadWorkspaceById(root, 'ws-x');
    expect(loaded?.synced.workspaceId).toBe('ws-x');
    expect(loaded?.local.workspaceId).toBe('ws-x');
  });

  it('returns null when the workspace subdirectory is missing', async () => {
    expect(await loadWorkspaceById(root, 'ws-absent')).toBeNull();
  });

  it('writes to the correct subdirectory and leaves siblings untouched', async () => {
    await saveWorkspaceById(root, 'ws-a', {
      synced: makeSynced('ws-a'),
      local: makeLocal('ws-a'),
    });
    await saveWorkspaceById(root, 'ws-b', {
      synced: makeSynced('ws-b'),
      local: makeLocal('ws-b'),
    });
    expect((await loadWorkspaceById(root, 'ws-a'))?.synced.workspaceId).toBe('ws-a');
    expect((await loadWorkspaceById(root, 'ws-b'))?.synced.workspaceId).toBe('ws-b');
  });
});

describe('registerWorkspace', () => {
  it('adds a new entry and makes it active when registry was empty', async () => {
    const next = await registerWorkspace(root, {
      id: 'ws-1',
      name: 'First',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    expect(next.activeWorkspaceId).toBe('ws-1');
    expect(next.workspaces).toHaveLength(1);
  });

  it('preserves an existing active workspace when adding a second entry', async () => {
    await registerWorkspace(root, { id: 'ws-1', name: 'A', createdAt: T0, lastOpenedAt: T0 });
    const next = await registerWorkspace(root, {
      id: 'ws-2',
      name: 'B',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    expect(next.activeWorkspaceId).toBe('ws-1');
    expect(next.workspaces.map((w) => w.id).sort()).toEqual(['ws-1', 'ws-2']);
  });

  it('upserts: re-registering with the same id replaces the entry, not appends', async () => {
    await registerWorkspace(root, { id: 'ws-1', name: 'Old', createdAt: T0, lastOpenedAt: T0 });
    const next = await registerWorkspace(root, {
      id: 'ws-1',
      name: 'Renamed',
      createdAt: T0,
      lastOpenedAt: T1,
    });
    expect(next.workspaces).toHaveLength(1);
    expect(next.workspaces[0].name).toBe('Renamed');
    expect(next.workspaces[0].lastOpenedAt).toBe(T1);
  });
});

describe('setActiveWorkspace', () => {
  it('switches the active id and bumps lastOpenedAt', async () => {
    await registerWorkspace(root, { id: 'ws-1', name: 'A', createdAt: T0, lastOpenedAt: T0 });
    await registerWorkspace(root, { id: 'ws-2', name: 'B', createdAt: T0, lastOpenedAt: T0 });
    const before = Date.now();
    const next = await setActiveWorkspace(root, 'ws-2');
    expect(next.activeWorkspaceId).toBe('ws-2');
    const updated = next.workspaces.find((w) => w.id === 'ws-2');
    expect(updated).toBeDefined();
    expect(Date.parse(updated!.lastOpenedAt)).toBeGreaterThanOrEqual(before);
  });

  it('throws when the target id is not in the registry', async () => {
    await registerWorkspace(root, { id: 'ws-1', name: 'A', createdAt: T0, lastOpenedAt: T0 });
    await expect(setActiveWorkspace(root, 'ws-nope')).rejects.toThrow(/is not in the registry/);
  });
});

describe('deleteWorkspaceById', () => {
  beforeEach(async () => {
    await saveWorkspaceById(root, 'ws-a', {
      synced: makeSynced('ws-a'),
      local: makeLocal('ws-a'),
    });
    await registerWorkspace(root, { id: 'ws-a', name: 'A', createdAt: T0, lastOpenedAt: T0 });
    await saveWorkspaceById(root, 'ws-b', {
      synced: makeSynced('ws-b'),
      local: makeLocal('ws-b'),
    });
    await registerWorkspace(root, { id: 'ws-b', name: 'B', createdAt: T0, lastOpenedAt: T1 });
  });

  it('removes the subdirectory and drops the registry entry', async () => {
    const next = await deleteWorkspaceById(root, 'ws-a');
    expect(next.workspaces.map((w) => w.id)).toEqual(['ws-b']);
    expect(await loadWorkspaceById(root, 'ws-a')).toBeNull();
  });

  it('promotes the next-most-recent remaining workspace to active when the active is deleted', async () => {
    await setActiveWorkspace(root, 'ws-a');
    const next = await deleteWorkspaceById(root, 'ws-a');
    expect(next.activeWorkspaceId).toBe('ws-b');
  });

  it('sets activeWorkspaceId to null when the last remaining workspace is deleted', async () => {
    await deleteWorkspaceById(root, 'ws-a');
    const next = await deleteWorkspaceById(root, 'ws-b');
    expect(next.workspaces).toEqual([]);
    expect(next.activeWorkspaceId).toBeNull();
  });

  it('is idempotent — deleting a missing workspace returns the current registry', async () => {
    const next = await deleteWorkspaceById(root, 'ws-never-existed');
    expect(next.workspaces.map((w) => w.id).sort()).toEqual(['ws-a', 'ws-b']);
  });
});

describe('findWorkspaceEntry', () => {
  const registry: WorkspaceRegistry = {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-a',
    workspaces: [
      { id: 'ws-a', name: 'Petstore', createdAt: T0, lastOpenedAt: T0 },
      { id: 'ws-b', name: 'Internal API', createdAt: T0, lastOpenedAt: T0 },
    ],
  };

  it('matches by exact id', () => {
    expect(findWorkspaceEntry(registry, 'ws-b')?.name).toBe('Internal API');
  });

  it('matches by case-insensitive name', () => {
    expect(findWorkspaceEntry(registry, 'petstore')?.id).toBe('ws-a');
    expect(findWorkspaceEntry(registry, 'PETSTORE')?.id).toBe('ws-a');
    expect(findWorkspaceEntry(registry, 'Petstore')?.id).toBe('ws-a');
  });

  it('returns null on no match', () => {
    expect(findWorkspaceEntry(registry, 'nope')).toBeNull();
  });

  it('prefers an id match over a name collision', () => {
    const r: WorkspaceRegistry = {
      schemaVersion: 1,
      activeWorkspaceId: null,
      // Pathological case — the id of one workspace is literally the name of another.
      workspaces: [
        { id: 'ws-x', name: 'real-name', createdAt: T0, lastOpenedAt: T0 },
        { id: 'real-name', name: 'other', createdAt: T0, lastOpenedAt: T0 },
      ],
    };
    expect(findWorkspaceEntry(r, 'real-name')?.id).toBe('real-name');
  });
});

describe('end-to-end registry lifecycle', () => {
  // Sanity-check that all the helpers compose into a sensible workspace
  // lifecycle without needing the higher layers (CLI / MCP / desktop).
  it('seed → list → switch active → delete → empty', async () => {
    await saveWorkspaceById(root, 'ws-a', {
      synced: makeSynced('ws-a'),
      local: makeLocal('ws-a'),
    });
    let r = await registerWorkspace(root, {
      id: 'ws-a',
      name: 'A',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    expect(r.activeWorkspaceId).toBe('ws-a');

    await saveWorkspaceById(root, 'ws-b', {
      synced: makeSynced('ws-b'),
      local: makeLocal('ws-b'),
    });
    r = await registerWorkspace(root, {
      id: 'ws-b',
      name: 'B',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    expect(r.workspaces).toHaveLength(2);

    r = await setActiveWorkspace(root, 'ws-b');
    expect(r.activeWorkspaceId).toBe('ws-b');

    r = await deleteWorkspaceById(root, 'ws-b');
    expect(r.activeWorkspaceId).toBe('ws-a');

    r = await deleteWorkspaceById(root, 'ws-a');
    expect(r.workspaces).toEqual([]);
    expect(r.activeWorkspaceId).toBeNull();
  });
});
