import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';
import {
  assertionCreateTool,
  assertionDeleteTool,
  assertionReadTool,
  assertionUpdateTool,
  environmentCreateTool,
  environmentDeleteTool,
  environmentReadTool,
  environmentUpdateTool,
  folderCreateTool,
  folderDeleteTool,
  folderReadTool,
  folderUpdateTool,
  planCreateTool,
  planDeleteTool,
  planReadTool,
  planRunTool,
  planUpdateTool,
  requestCreateTool,
  requestDeleteTool,
  requestReadTool,
  requestUpdateTool,
  workspaceReadTool,
  workspaceWriteTool,
} from './crud';

const T0 = '2026-04-27T00:00:00.000Z';

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

let ctx: { workspace: InMemoryWorkspaceProvider; mock: InProcessMockController };

beforeEach(() => {
  ctx = {
    workspace: new InMemoryWorkspaceProvider(freshState()),
    mock: new InProcessMockController(),
  };
});

describe('request CRUD tools', () => {
  it('create + read round-trips', async () => {
    const created = (await requestCreateTool.handler(
      { name: 'List', method: 'GET' as const, url: '/a' },
      ctx,
    )) as { id: string };
    const read = await requestReadTool.handler({ id: created.id }, ctx);
    expect(read).toMatchObject({ found: true });
  });

  it('list returns summaries when no id is passed', async () => {
    await requestCreateTool.handler({ name: 'A', method: 'GET' as const, url: '/x' }, ctx);
    await requestCreateTool.handler({ name: 'B', method: 'POST' as const, url: '/y' }, ctx);
    const out = (await requestReadTool.handler({}, ctx)) as { count: number };
    expect(out.count).toBe(2);
  });

  it('returns found:false for an unknown id', async () => {
    const out = await requestReadTool.handler({ id: 'missing' }, ctx);
    expect(out).toEqual({ found: false });
  });

  it('update changes fields', async () => {
    const created = (await requestCreateTool.handler(
      { name: 'Old', method: 'GET' as const, url: '/x' },
      ctx,
    )) as { id: string };
    await requestUpdateTool.handler(
      { id: created.id, patch: { name: 'New', method: 'POST' } },
      ctx,
    );
    const state = await ctx.workspace.read();
    expect(state.synced.collections.requests[created.id].name).toBe('New');
    expect(state.synced.collections.requests[created.id].method).toBe('POST');
  });

  it('delete removes a request', async () => {
    const created = (await requestCreateTool.handler(
      { name: 'X', method: 'GET' as const, url: '/x' },
      ctx,
    )) as { id: string };
    await requestDeleteTool.handler({ id: created.id }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.collections.requests[created.id]).toBeUndefined();
  });
});

describe('folder CRUD tools', () => {
  it('create + read + update + delete cycle', async () => {
    const created = (await folderCreateTool.handler({ name: 'A' }, ctx)) as { id: string };
    const read = await folderReadTool.handler({ id: created.id }, ctx);
    expect(read).toMatchObject({ found: true });

    const second = (await folderCreateTool.handler({ name: 'B' }, ctx)) as { id: string };
    await folderUpdateTool.handler({ id: second.id, parentId: created.id }, ctx);
    const state1 = await ctx.workspace.read();
    expect(state1.synced.collections.folders[second.id].parentId).toBe(created.id);

    await folderDeleteTool.handler({ id: created.id }, ctx);
    const state2 = await ctx.workspace.read();
    expect(state2.synced.collections.folders[created.id]).toBeUndefined();
    // Reparented to root
    expect(state2.synced.collections.folders[second.id].parentId).toBeNull();
  });

  it('folder.read with no id lists all folders', async () => {
    await folderCreateTool.handler({ name: 'A' }, ctx);
    await folderCreateTool.handler({ name: 'B' }, ctx);
    const out = (await folderReadTool.handler({}, ctx)) as { count: number };
    expect(out.count).toBe(2);
  });

  it('folder.read returns found:false for unknown id', async () => {
    const out = await folderReadTool.handler({ id: 'missing' }, ctx);
    expect(out).toEqual({ found: false });
  });
});

describe('environment CRUD tools', () => {
  it('create + list + delete', async () => {
    await environmentCreateTool.handler({ name: 'dev', variables: [] }, ctx);
    await environmentCreateTool.handler(
      {
        name: 'prod',
        variables: [{ key: 'API', value: 'x', encrypted: false }],
      },
      ctx,
    );

    const list = (await environmentReadTool.handler({}, ctx)) as { environments: unknown[] };
    expect(list.environments.length).toBe(2);

    const single = await environmentReadTool.handler({ name: 'prod' }, ctx);
    expect(single).toMatchObject({ found: true });

    await environmentDeleteTool.handler({ name: 'dev' }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.environments.items['dev']).toBeUndefined();
  });

  it('update replaces variables', async () => {
    await environmentCreateTool.handler({ name: 'dev', variables: [] }, ctx);
    await environmentUpdateTool.handler(
      {
        name: 'dev',
        variables: [{ key: 'A', value: '1', encrypted: false }],
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    expect(state.synced.environments.items['dev'].variables).toHaveLength(1);
  });

  it('environment.read returns found:false for unknown name', async () => {
    const out = await environmentReadTool.handler({ name: 'missing' }, ctx);
    expect(out).toEqual({ found: false });
  });
});

describe('plan CRUD tools', () => {
  it('create + update + delete', async () => {
    const created = (await planCreateTool.handler(
      { name: 'Smoke', steps: [], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    expect(created.id).toBeTruthy();

    await planUpdateTool.handler({ id: created.id, patch: { name: 'Smoke v2' } }, ctx);
    const single = await planReadTool.handler({ id: created.id }, ctx);
    expect(single).toMatchObject({ found: true });

    const list = (await planReadTool.handler({}, ctx)) as { count: number };
    expect(list.count).toBe(1);

    await planDeleteTool.handler({ id: created.id }, ctx);
    const state = await ctx.workspace.read();
    expect(state.local.executionPlans[created.id]).toBeUndefined();
  });

  it('plan.update is a no-op for unknown id', async () => {
    const out = await planUpdateTool.handler({ id: 'missing', patch: { name: 'x' } }, ctx);
    expect(out).toEqual({ changedIds: [] });
  });

  it('plan.read returns found:false for unknown id', async () => {
    const out = await planReadTool.handler({ id: 'missing' }, ctx);
    expect(out).toEqual({ found: false });
  });

  it('plan.run returns the not-implemented marker', async () => {
    const created = (await planCreateTool.handler(
      { name: 'X', steps: [], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    const out = (await planRunTool.handler({ id: created.id, withAssertions: true }, ctx)) as {
      ok: boolean;
    };
    expect(out.ok).toBe(false);
  });

  it('plan.run errors when plan is missing', async () => {
    const out = (await planRunTool.handler({ id: 'missing', withAssertions: false }, ctx)) as {
      ok: boolean;
    };
    expect(out.ok).toBe(false);
  });
});

describe('assertion CRUD tools', () => {
  it('create + read + update + delete', async () => {
    const req = (await requestCreateTool.handler(
      { name: 'X', method: 'GET' as const, url: '/x' },
      ctx,
    )) as { id: string };
    const created = (await assertionCreateTool.handler(
      {
        requestId: req.id,
        assertion: { kind: 'status' as const, op: 'equals' as const, expected: 200 },
      },
      ctx,
    )) as { id: string };
    expect(created.id).toBeTruthy();

    const list = await assertionReadTool.handler({ requestId: req.id }, ctx);
    expect(list).toMatchObject({ count: 1 });

    const single = await assertionReadTool.handler(
      { requestId: req.id, assertionId: created.id },
      ctx,
    );
    expect(single).toMatchObject({ found: true });

    await assertionUpdateTool.handler(
      {
        requestId: req.id,
        assertion: {
          id: created.id,
          kind: 'status',
          op: 'equals',
          expected: 201,
        },
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    expect(state.synced.collections.requests[req.id].assertions[0].expected).toBe(201);

    await assertionDeleteTool.handler({ requestId: req.id, assertionId: created.id }, ctx);
    const state2 = await ctx.workspace.read();
    expect(state2.synced.collections.requests[req.id].assertions.length).toBe(0);
  });

  it('assertion.read returns found:false when request missing', async () => {
    const out = await assertionReadTool.handler({ requestId: 'missing' }, ctx);
    expect(out).toEqual({ found: false });
  });

  it('assertion.read returns found:false for missing assertion id', async () => {
    const req = (await requestCreateTool.handler(
      { name: 'X', method: 'GET' as const, url: '/x' },
      ctx,
    )) as { id: string };
    const out = await assertionReadTool.handler({ requestId: req.id, assertionId: 'nope' }, ctx);
    expect(out).toEqual({ found: false });
  });
});

describe('workspace bulk read/write', () => {
  it('workspace.read returns the full pair', async () => {
    const out = (await workspaceReadTool.handler({}, ctx)) as {
      synced: WorkspaceSynced;
    };
    expect(out.synced.workspaceId).toBe('ws-1');
  });

  it('workspace.write replaces the pair', async () => {
    const fresh = freshState();
    const out = (await workspaceWriteTool.handler(
      {
        synced: {
          ...fresh.synced,
          meta: { ...fresh.synced.meta, appVersion: 'renamed-version' },
        },
      },
      ctx,
    )) as { ok: boolean };
    expect(out.ok).toBe(true);
    const state = await ctx.workspace.read();
    expect(state.synced.meta.appVersion).toBe('renamed-version');
  });
});
