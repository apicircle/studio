import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import {
  createWorkspaceOnDisk,
  defaultWorkspacesRoot,
  listWorkspacesOnDisk,
  resolveWorkspace,
  WorkspaceResolutionError,
} from './resolveWorkspace';
import {
  registerWorkspace,
  saveRegistry,
  type WorkspaceRegistry,
} from '@apicircle/core/workspace/registry';
import { saveToFile } from '@apicircle/core/workspace/file-backed';

let tmpDir: string;
let workspacesRoot: string;
let prevEnv: string | undefined;
const ORIGINAL_CWD = process.cwd();

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-cli-rw-'));
  workspacesRoot = path.join(tmpDir, 'workspaces');
  prevEnv = process.env.APICIRCLE_WORKSPACES_ROOT;
  process.env.APICIRCLE_WORKSPACES_ROOT = workspacesRoot;
});

afterEach(async () => {
  process.chdir(ORIGINAL_CWD);
  if (prevEnv === undefined) delete process.env.APICIRCLE_WORKSPACES_ROOT;
  else process.env.APICIRCLE_WORKSPACES_ROOT = prevEnv;
  await fs.rm(tmpDir, { recursive: true, force: true });
});

const T0 = '2026-05-22T00:00:00.000Z';

async function seedRegistry(
  workspaces: Array<{ id: string; name: string; active?: boolean }>,
): Promise<WorkspaceRegistry> {
  let active: string | null = null;
  for (const w of workspaces) {
    if (w.active) active = w.id;
    await saveToFile(path.join(workspacesRoot, w.id), {
      synced: {
        schemaVersion: 1,
        workspaceId: w.id,
        collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
        environments: { items: {}, activeName: null, priorityOrder: [] },
        linkedWorkspaces: {},
        linkedOverrides: { requests: {}, environmentVars: {} },
        releases: { self: null, perLink: {} },
        globalAssets: { schemas: {}, graphql: {} },
        mockServers: {},
        meta: { createdAt: T0, updatedAt: T0, appVersion: '1.0.0' },
      },
      local: {
        schemaVersion: 1,
        workspaceId: w.id,
        executionPlans: {},
        history: { requestRuns: [], planRuns: [] },
        secretIndex: { entries: {} },
        sessions: { github: { workspace: null, links: {} } },
        connectedRepo: null,
        workingBranch: null,
        seededWorkspaceSha: null,
        retiredBranch: null,
        sync: {
          lastPulledSnapshot: null,
          lastPulledSha: null,
          lastPulledAt: null,
          dirtyKeys: [],
        },
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
      },
    });
    await registerWorkspace(workspacesRoot, {
      id: w.id,
      name: w.name,
      createdAt: T0,
      lastOpenedAt: T0,
    });
  }
  if (active) {
    const reg = await listWorkspacesOnDisk();
    await saveRegistry(workspacesRoot, { ...reg.registry, activeWorkspaceId: active });
  }
  return (await listWorkspacesOnDisk()).registry;
}

describe('defaultWorkspacesRoot', () => {
  it('honors APICIRCLE_WORKSPACES_ROOT', () => {
    expect(defaultWorkspacesRoot()).toBe(workspacesRoot);
  });
});

describe('resolveWorkspace', () => {
  it('resolves --workspace-name by id', async () => {
    await seedRegistry([
      { id: 'ws-a', name: 'Alpha' },
      { id: 'ws-b', name: 'Beta' },
    ]);
    const r = await resolveWorkspace({ name: 'ws-b' });
    expect(r.id).toBe('ws-b');
    expect(r.name).toBe('Beta');
    expect(r.fromRegistry).toBe(true);
    expect(r.dir).toBe(path.join(workspacesRoot, 'ws-b'));
  });

  it('resolves --workspace-name by name (case-insensitive)', async () => {
    await seedRegistry([{ id: 'ws-a', name: 'Alpha' }]);
    const r = await resolveWorkspace({ name: 'aLpHa' });
    expect(r.id).toBe('ws-a');
  });

  it('resolves --workspace-path without consulting the registry', async () => {
    const explicit = path.join(tmpDir, 'standalone');
    await fs.mkdir(explicit, { recursive: true });
    const r = await resolveWorkspace({ path: explicit });
    expect(r.fromRegistry).toBe(false);
    expect(r.id).toBeNull();
    expect(r.dir).toBe(path.resolve(explicit));
  });

  it('rejects when --workspace-name and --workspace-path are both passed', async () => {
    await expect(resolveWorkspace({ name: 'Alpha', path: '/tmp/x' })).rejects.toThrow(
      /mutually exclusive/,
    );
  });

  it('errors when --workspace-name is unknown and a registry exists', async () => {
    await seedRegistry([{ id: 'ws-a', name: 'Alpha' }]);
    await expect(resolveWorkspace({ name: 'nope' })).rejects.toThrow(WorkspaceResolutionError);
  });

  it('errors when --workspace-path targets a missing directory', async () => {
    const dead = path.join(tmpDir, 'does', 'not', 'exist');
    await expect(resolveWorkspace({ path: dead })).rejects.toThrow(/not found/);
  });

  it('does NOT misinterpret a name that looks like a path (e.g. "v2.5")', async () => {
    // Pre-refactor a name containing "." would have been treated as a path.
    // With explicit flags, --workspace-name "v2.5" is unambiguously a name.
    await seedRegistry([{ id: 'ws-v', name: 'v2.5' }]);
    const r = await resolveWorkspace({ name: 'v2.5' });
    expect(r.fromRegistry).toBe(true);
    expect(r.id).toBe('ws-v');
  });

  it('falls back to the active workspace when neither flag is given', async () => {
    await seedRegistry([
      { id: 'ws-a', name: 'Alpha' },
      { id: 'ws-b', name: 'Beta', active: true },
    ]);
    const r = await resolveWorkspace({});
    expect(r.id).toBe('ws-b');
    expect(r.name).toBe('Beta');
  });

  it('falls back to cwd when no registry and no flag is given', async () => {
    // No seed → no registry exists at workspacesRoot.
    process.chdir(tmpDir);
    const r = await resolveWorkspace({});
    expect(r.fromRegistry).toBe(false);
    expect(r.dir).toBe(path.resolve(tmpDir));
  });

  it('errors when --workspace-name is given but no registry exists', async () => {
    await expect(resolveWorkspace({ name: 'Alpha' })).rejects.toThrow(/No workspaces/);
  });
});

describe('createWorkspaceOnDisk', () => {
  it('creates a new workspace and registers it as active when none was set', async () => {
    const { entry, registry } = await createWorkspaceOnDisk({ name: 'Demo' });
    expect(entry.name).toBe('Demo');
    expect(registry.activeWorkspaceId).toBe(entry.id);
    expect(registry.workspaces.map((w) => w.id)).toContain(entry.id);
    const onDisk = await fs.readFile(
      path.join(workspacesRoot, entry.id, 'workspace.synced.json'),
      'utf-8',
    );
    expect(JSON.parse(onDisk).workspaceId).toBe(entry.id);
  });

  it('rejects duplicate names', async () => {
    await createWorkspaceOnDisk({ name: 'Demo' });
    await expect(createWorkspaceOnDisk({ name: 'demo' })).rejects.toThrow(/already exists/);
  });

  it('honors --sample by seeding one request', async () => {
    const { state } = await createWorkspaceOnDisk({ name: 'Sampled', sampleRequest: true });
    expect(Object.keys(state.synced.collections.requests)).toHaveLength(1);
  });
});

describe('listWorkspacesOnDisk', () => {
  it('returns an empty list when nothing has been seeded', async () => {
    const { registry } = await listWorkspacesOnDisk();
    expect(registry.workspaces).toEqual([]);
    expect(registry.activeWorkspaceId).toBeNull();
  });

  it('returns every registered workspace', async () => {
    await seedRegistry([
      { id: 'ws-a', name: 'Alpha' },
      { id: 'ws-b', name: 'Beta', active: true },
    ]);
    const { registry } = await listWorkspacesOnDisk();
    expect(registry.workspaces.map((w) => w.id).sort()).toEqual(['ws-a', 'ws-b']);
    expect(registry.activeWorkspaceId).toBe('ws-b');
  });
});
