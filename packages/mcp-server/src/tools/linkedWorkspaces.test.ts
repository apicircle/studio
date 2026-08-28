import { beforeEach, describe, expect, it } from 'vitest';
import type {
  LinkedWorkspace,
  ReleaseHistory,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '@apicircle/core/providers';
import { SingleWorkspaceAdapter } from '@apicircle/core/providers';
import { InProcessMockController } from '@apicircle/core/providers';
import {
  linkedGetTool,
  linkedListTool,
  linkedSetConfigTool,
  linkedUnlinkTool,
} from './linkedWorkspaces';

const T0 = '2026-06-06T00:00:00.000Z';

function link(id: string, over: Partial<LinkedWorkspace> = {}): LinkedWorkspace {
  return {
    id,
    kind: 'public',
    name: 'Payments API',
    sourceWorkspaceId: 'remote-ws-1',
    source: {
      provider: 'github',
      repoFullName: 'org/payments',
      branch: 'main',
      sessionMode: 'workspace',
    },
    scope: ['collections', 'environments'],
    pinnedVersion: null,
    updatePolicy: 'manual',
    linkedAt: T0,
    requiredSecretKeyIds: [],
    ...over,
  };
}

const ledger: ReleaseHistory = {
  currentVersion: '1.1.0',
  versions: [
    {
      version: '1.0.0',
      publishedAt: T0,
      notes: '',
      workspaceSnapshot: 'a'.repeat(64),
      deprecated: false,
      yanked: false,
    },
    {
      version: '1.1.0',
      publishedAt: T0,
      notes: '',
      workspaceSnapshot: 'b'.repeat(64),
      deprecated: false,
      yanked: false,
    },
  ],
};

function freshState(
  links: Record<string, LinkedWorkspace> = {},
  perLink: Record<string, ReleaseHistory> = {},
): { synced: WorkspaceSynced; local: WorkspaceLocal } {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: links,
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink },
      globalAssets: { schemas: {}, graphql: {} },
      mockServers: {},
      meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
    },
    local: {
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
      snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    },
  };
}

let ctx: {
  workspace: InMemoryWorkspaceProvider;
  workspaces: SingleWorkspaceAdapter;
  mock: InProcessMockController;
};

function setup(
  links: Record<string, LinkedWorkspace> = {},
  perLink: Record<string, ReleaseHistory> = {},
) {
  const workspace = new InMemoryWorkspaceProvider(freshState(links, perLink));
  ctx = {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new InProcessMockController(),
  };
}

beforeEach(() => setup());

describe('linked.list / linked.get', () => {
  it('lists linked workspaces with cached current version', async () => {
    setup({ lw1: link('lw1') }, { lw1: ledger });
    const out = (await linkedListTool.handler({}, ctx)) as {
      count: number;
      links: Array<{ id: string; cachedCurrentVersion: string | null }>;
    };
    expect(out.count).toBe(1);
    expect(out.links[0].id).toBe('lw1');
    expect(out.links[0].cachedCurrentVersion).toBe('1.1.0');
  });

  it('get returns the link + ledger', async () => {
    setup({ lw1: link('lw1') }, { lw1: ledger });
    const out = (await linkedGetTool.handler({ id: 'lw1' }, ctx)) as {
      ok: boolean;
      ledger: ReleaseHistory;
    };
    expect(out.ok).toBe(true);
    expect(out.ledger.currentVersion).toBe('1.1.0');
  });

  it('get returns ok:false for an unknown id', async () => {
    const out = (await linkedGetTool.handler({ id: 'nope' }, ctx)) as { ok: boolean };
    expect(out.ok).toBe(false);
  });
});

describe('linked.set_config', () => {
  it('pins a version that exists in the cached ledger', async () => {
    setup({ lw1: link('lw1') }, { lw1: ledger });
    const out = (await linkedSetConfigTool.handler({ id: 'lw1', pinnedVersion: '1.0.0' }, ctx)) as {
      ok: boolean;
    };
    expect(out.ok).toBe(true);
    const state = await ctx.workspace.read();
    expect(state.synced.linkedWorkspaces.lw1.pinnedVersion).toBe('1.0.0');
  });

  it('rejects pinning a version not in the cached ledger', async () => {
    setup({ lw1: link('lw1') }, { lw1: ledger });
    const out = (await linkedSetConfigTool.handler({ id: 'lw1', pinnedVersion: '9.9.9' }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not in the cached ledger/);
  });

  it('unpins with pinnedVersion: null', async () => {
    setup({ lw1: link('lw1', { pinnedVersion: '1.0.0' }) }, { lw1: ledger });
    await linkedSetConfigTool.handler({ id: 'lw1', pinnedVersion: null }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.linkedWorkspaces.lw1.pinnedVersion).toBeNull();
  });

  it('updates scope, session mode, required keys, and marketplace metadata', async () => {
    setup({ lw1: link('lw1') }, { lw1: ledger });
    await linkedSetConfigTool.handler(
      {
        id: 'lw1',
        name: 'Payments (pinned)',
        scope: ['collections'],
        sessionMode: 'dedicated',
        requiredSecretKeyIds: ['k1', 'k2'],
        marketplace: { listedAs: 'Payments', tags: ['payments'], summary: 'A payments API' },
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    const l = state.synced.linkedWorkspaces.lw1;
    expect(l.name).toBe('Payments (pinned)');
    expect(l.scope).toEqual(['collections']);
    expect(l.source.sessionMode).toBe('dedicated');
    expect(l.requiredSecretKeyIds).toEqual(['k1', 'k2']);
    expect(l.marketplace?.listedAs).toBe('Payments');
  });

  it('clears marketplace metadata with marketplace: null', async () => {
    setup(
      { lw1: link('lw1', { marketplace: { listedAs: 'x', tags: [], summary: 'y' } }) },
      { lw1: ledger },
    );
    await linkedSetConfigTool.handler({ id: 'lw1', marketplace: null }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.linkedWorkspaces.lw1.marketplace).toBeUndefined();
  });
});

describe('linked.unlink', () => {
  it('removes the link and its cached ledger', async () => {
    setup({ lw1: link('lw1') }, { lw1: ledger });
    const out = (await linkedUnlinkTool.handler({ id: 'lw1' }, ctx)) as { ok: boolean };
    expect(out.ok).toBe(true);
    const state = await ctx.workspace.read();
    expect(state.synced.linkedWorkspaces.lw1).toBeUndefined();
    expect(state.synced.releases.perLink.lw1).toBeUndefined();
  });

  it('returns ok:false for an unknown id', async () => {
    const out = (await linkedUnlinkTool.handler({ id: 'nope' }, ctx)) as { ok: boolean };
    expect(out.ok).toBe(false);
  });
});
