import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { GitBackedWorkspaceProvider } from './GitBackedWorkspaceProvider';

const T0 = '2026-06-14T00:00:00.000Z';

function makeSynced(workspaceId = 'ws-git'): WorkspaceSynced {
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
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.1.0' },
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-git-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('GitBackedWorkspaceProvider', () => {
  it('reads workspace.json (not workspace.synced.json)', async () => {
    await fs.writeFile(path.join(tmpDir, 'workspace.json'), JSON.stringify(makeSynced()), 'utf-8');
    const provider = new GitBackedWorkspaceProvider(tmpDir);
    const state = await provider.read();
    expect(state.synced.workspaceId).toBe('ws-git');
    expect(state.synced.meta.createdAt).toBe(T0);
  });

  it('synthesizes an empty local when workspace.local.json is absent', async () => {
    await fs.writeFile(path.join(tmpDir, 'workspace.json'), JSON.stringify(makeSynced()), 'utf-8');
    const provider = new GitBackedWorkspaceProvider(tmpDir);
    const state = await provider.read();
    expect(state.local.workspaceId).toBe('ws-git');
    expect(state.local.executionPlans).toEqual({});
    expect(state.local.history).toEqual({ requestRuns: [], planRuns: [] });
  });

  it('reads an existing workspace.local.json when present', async () => {
    const synced = makeSynced();
    const local: WorkspaceLocal = {
      schemaVersion: 1,
      workspaceId: 'ws-git',
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
      attachmentCache: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: {
        activeRequestId: 'req-1',
        sidebarExpandedSections: ['editor'],
        themeId: 'one-dark-pro',
        fontId: 'system-sans',
        fontSizePercent: 100,
      },
      settings: { validateOnSend: false, monacoConsumesWheel: true },
      snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    };
    await fs.writeFile(path.join(tmpDir, 'workspace.json'), JSON.stringify(synced), 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'workspace.local.json'), JSON.stringify(local), 'utf-8');

    const provider = new GitBackedWorkspaceProvider(tmpDir);
    const state = await provider.read();
    expect(state.local.ui.activeRequestId).toBe('req-1');
    expect(state.local.settings.validateOnSend).toBe(false);
  });

  it('throws when workspace.json is absent', async () => {
    const provider = new GitBackedWorkspaceProvider(tmpDir);
    await expect(provider.read()).rejects.toThrow(/No workspace found/);
  });

  it('apply mutates workspace.json on disk', async () => {
    await fs.writeFile(path.join(tmpDir, 'workspace.json'), JSON.stringify(makeSynced()), 'utf-8');
    const provider = new GitBackedWorkspaceProvider(tmpDir);
    const result = await provider.apply({
      kind: 'environment.upsert',
      environment: {
        name: 'staging',
        variables: [{ key: 'HOST', value: 'staging.example.com', encrypted: false }],
      },
    });
    expect(result.state.synced.environments.items['staging']).toBeDefined();
    expect(result.state.synced.environments.items['staging'].variables[0].key).toBe('HOST');

    // Verify it persisted to workspace.json (not workspace.synced.json).
    const raw = await fs.readFile(path.join(tmpDir, 'workspace.json'), 'utf-8');
    const persisted = JSON.parse(raw) as WorkspaceSynced;
    expect(persisted.environments.items['staging']).toBeDefined();

    // workspace.synced.json must NOT exist.
    const entries = await fs.readdir(tmpDir);
    expect(entries).not.toContain('workspace.synced.json');
  });

  it('write bulk-replaces workspace.json on disk', async () => {
    await fs.writeFile(path.join(tmpDir, 'workspace.json'), JSON.stringify(makeSynced()), 'utf-8');
    const provider = new GitBackedWorkspaceProvider(tmpDir);
    const updated = makeSynced('ws-new');
    const state = await provider.write({ synced: updated });
    expect(state.synced.workspaceId).toBe('ws-new');

    const raw = await fs.readFile(path.join(tmpDir, 'workspace.json'), 'utf-8');
    expect(JSON.parse(raw).workspaceId).toBe('ws-new');
  });

  it('write preserves the existing side when only one half is given', async () => {
    await fs.writeFile(path.join(tmpDir, 'workspace.json'), JSON.stringify(makeSynced()), 'utf-8');
    const provider = new GitBackedWorkspaceProvider(tmpDir);
    // Write only local — synced should be preserved.
    const state = await provider.write({
      local: {
        schemaVersion: 1,
        workspaceId: 'ws-git',
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
        attachmentCache: {},
        globalContext: {},
        mockRuntime: { active: {} },
        ui: {
          activeRequestId: null,
          sidebarExpandedSections: [],
          themeId: 'one-dark-pro',
          fontId: 'system-sans',
          fontSizePercent: 100,
        },
        settings: { validateOnSend: true, monacoConsumesWheel: false },
        snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
      },
    });
    expect(state.synced.workspaceId).toBe('ws-git');
  });

  it('does not leave .tmp files behind', async () => {
    await fs.writeFile(path.join(tmpDir, 'workspace.json'), JSON.stringify(makeSynced()), 'utf-8');
    const provider = new GitBackedWorkspaceProvider(tmpDir);
    await provider.apply({
      kind: 'environment.upsert',
      environment: { name: 'ci', variables: [] },
    });
    const entries = await fs.readdir(tmpDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });
});
