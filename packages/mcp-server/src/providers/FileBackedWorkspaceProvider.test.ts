import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import { FileBackedWorkspaceProvider } from './FileBackedWorkspaceProvider';

const T0 = '2026-04-27T00:00:00.000Z';

function emptySynced(): WorkspaceSynced {
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

function emptyLocal(): WorkspaceLocal {
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
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}

let dir: string;

beforeEach(async () => {
  dir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-fbwp-'));
});

afterEach(async () => {
  await fs.rm(dir, { recursive: true, force: true });
});

describe('FileBackedWorkspaceProvider', () => {
  it('reads from disk', async () => {
    await saveToFile(dir, { synced: emptySynced(), local: emptyLocal() });
    const p = new FileBackedWorkspaceProvider(dir);
    const state = await p.read();
    expect(state.synced.workspaceId).toBe('ws-1');
  });

  it('throws when no workspace exists at the path', async () => {
    const p = new FileBackedWorkspaceProvider(path.join(dir, 'missing'));
    await expect(p.read()).rejects.toThrow();
  });

  it('apply persists a mutation to disk under the lock', async () => {
    await saveToFile(dir, { synced: emptySynced(), local: emptyLocal() });
    const p = new FileBackedWorkspaceProvider(dir);
    const out = await p.apply({
      kind: 'environment.upsert',
      environment: { name: 'dev', variables: [] },
    });
    expect(out.changedIds).toEqual(['dev']);
    const reloaded = await p.read();
    expect(reloaded.synced.environments.items['dev']).toBeDefined();
  });

  it('write replaces both halves of the workspace on disk', async () => {
    await saveToFile(dir, { synced: emptySynced(), local: emptyLocal() });
    const p = new FileBackedWorkspaceProvider(dir);
    const next: WorkspaceSynced = { ...emptySynced(), workspaceName: 'Renamed' };
    const out = await p.write({ synced: next });
    expect(out.synced.workspaceName).toBe('Renamed');
    const reloaded = await p.read();
    expect(reloaded.synced.workspaceName).toBe('Renamed');
  });
});
