import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '@apicircle/core/providers';
import { SingleWorkspaceAdapter } from '@apicircle/core/providers';
import { InProcessMockController } from '@apicircle/core/providers';
import {
  releaseDeprecateTool,
  releaseListTool,
  releasePublishTool,
  releaseYankTool,
} from './releases';

const T0 = '2026-06-06T00:00:00.000Z';

function freshState(): { synced: WorkspaceSynced; local: WorkspaceLocal } {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
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

beforeEach(() => {
  const workspace = new InMemoryWorkspaceProvider(freshState());
  ctx = {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new InProcessMockController(),
  };
});

describe('release.publish', () => {
  it('publishes a first version with a snapshot fingerprint', async () => {
    const out = (await releasePublishTool.handler({ version: '1.0.0', notes: 'first' }, ctx)) as {
      ok: boolean;
      version: string;
      currentVersion: string;
      workspaceSnapshot: string;
    };
    expect(out.ok).toBe(true);
    expect(out.version).toBe('1.0.0');
    expect(out.currentVersion).toBe('1.0.0');
    expect(out.workspaceSnapshot).toMatch(/^[0-9a-f]{64}$/);

    const state = await ctx.workspace.read();
    expect(state.synced.releases.self!.versions).toHaveLength(1);
    expect(state.synced.releases.self!.versions[0].notes).toBe('first');
  });

  it('returns ok:false on invalid semver without mutating', async () => {
    const out = (await releasePublishTool.handler({ version: 'v1', notes: '' }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/Invalid semver/);
    const state = await ctx.workspace.read();
    expect(state.synced.releases.self).toBeNull();
  });

  it('returns ok:false on a duplicate version', async () => {
    await releasePublishTool.handler({ version: '1.0.0', notes: '' }, ctx);
    const out = (await releasePublishTool.handler({ version: '1.0.0', notes: '' }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/already exists/);
  });
});

describe('release.list', () => {
  it('returns versions newest-first with flags', async () => {
    await releasePublishTool.handler({ version: '1.0.0', notes: 'a' }, ctx);
    await releasePublishTool.handler({ version: '1.2.0', notes: 'b' }, ctx);
    await releaseDeprecateTool.handler({ version: '1.0.0' }, ctx);

    const out = (await releaseListTool.handler({}, ctx)) as {
      currentVersion: string;
      count: number;
      versions: Array<{ version: string; deprecated: boolean }>;
    };
    expect(out.currentVersion).toBe('1.2.0');
    expect(out.count).toBe(2);
    expect(out.versions.map((v) => v.version)).toEqual(['1.2.0', '1.0.0']);
    expect(out.versions.find((v) => v.version === '1.0.0')!.deprecated).toBe(true);
  });

  it('returns an empty ledger when nothing is published', async () => {
    const out = (await releaseListTool.handler({}, ctx)) as { currentVersion: null; count: number };
    expect(out.currentVersion).toBeNull();
    expect(out.count).toBe(0);
  });
});

describe('release.deprecate + release.yank', () => {
  it('flips the deprecated flag', async () => {
    await releasePublishTool.handler({ version: '1.0.0', notes: '' }, ctx);
    const out = (await releaseDeprecateTool.handler({ version: '1.0.0' }, ctx)) as { ok: boolean };
    expect(out.ok).toBe(true);
    const state = await ctx.workspace.read();
    expect(state.synced.releases.self!.versions[0].deprecated).toBe(true);
  });

  it('flips the yanked flag', async () => {
    await releasePublishTool.handler({ version: '1.0.0', notes: '' }, ctx);
    const out = (await releaseYankTool.handler({ version: '1.0.0' }, ctx)) as { ok: boolean };
    expect(out.ok).toBe(true);
    const state = await ctx.workspace.read();
    expect(state.synced.releases.self!.versions[0].yanked).toBe(true);
  });

  it('returns ok:false when the version is unknown', async () => {
    await releasePublishTool.handler({ version: '1.0.0', notes: '' }, ctx);
    const out = (await releaseYankTool.handler({ version: '9.9.9' }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not found/);
  });

  it('returns ok:false when no ledger exists', async () => {
    const out = (await releaseDeprecateTool.handler({ version: '1.0.0' }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/No releases/);
  });
});
