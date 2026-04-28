import { describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from './InMemoryWorkspaceProvider';

const T0 = '2026-04-27T00:00:00.000Z';

function emptySynced(): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    workspaceName: 'W',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
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
    overrides: { items: {} },
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: null },
    connectedRepo: null,
    workingBranch: null,
    sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
    linkedCollections: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: { activeRequestId: null, sidebarExpandedSections: [], themeId: 'studio-dark' },
  };
}

describe('InMemoryWorkspaceProvider', () => {
  it('returns the initial state on read', async () => {
    const p = new InMemoryWorkspaceProvider({ synced: emptySynced(), local: emptyLocal() });
    const state = await p.read();
    expect(state.synced.workspaceId).toBe('ws-1');
  });

  it('apply persists the mutation between reads', async () => {
    const p = new InMemoryWorkspaceProvider({ synced: emptySynced(), local: emptyLocal() });
    const out = await p.apply({
      kind: 'environment.upsert',
      environment: { name: 'dev', variables: [] },
    });
    expect(out.changedIds).toEqual(['dev']);
    const state = await p.read();
    expect(state.synced.environments.items['dev']).toBeDefined();
  });

  it('write replaces synced + local independently', async () => {
    const p = new InMemoryWorkspaceProvider({ synced: emptySynced(), local: emptyLocal() });
    const newSynced: WorkspaceSynced = { ...emptySynced(), workspaceName: 'Renamed' };
    const out = await p.write({ synced: newSynced });
    expect(out.synced.workspaceName).toBe('Renamed');
    expect(out.local.workspaceId).toBe('ws-1');
  });

  it('write with no fields is a no-op', async () => {
    const p = new InMemoryWorkspaceProvider({ synced: emptySynced(), local: emptyLocal() });
    const out = await p.write({});
    expect(out.synced.workspaceId).toBe('ws-1');
  });
});
