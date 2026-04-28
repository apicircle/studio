import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';
import { requestCreateTool } from './crud';
import {
  promptCreateAssertionTool,
  promptCreateEnvironmentTool,
  promptCreatePlanTool,
} from './prompt';

const T0 = '2026-04-27T00:00:00.000Z';

function freshState(): { synced: WorkspaceSynced; local: WorkspaceLocal } {
  return {
    synced: {
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
    },
    local: {
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

describe('prompt tools', () => {
  it('prompt.create_environment persists an environment', async () => {
    await promptCreateEnvironmentTool.handler(
      {
        name: 'dev',
        variables: [{ key: 'API', value: 'http://localhost', encrypted: false }],
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    expect(state.synced.environments.items['dev'].variables).toHaveLength(1);
  });

  it('prompt.create_assertion adds an assertion to a request', async () => {
    const req = (await requestCreateTool.handler(
      { name: 'X', method: 'GET' as const, url: '/x' },
      ctx,
    )) as { id: string };
    await promptCreateAssertionTool.handler(
      {
        requestId: req.id,
        assertion: {
          kind: 'status' as const,
          op: 'equals' as const,
          expected: 200,
        },
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    expect(state.synced.collections.requests[req.id].assertions.length).toBe(1);
  });

  it('prompt.create_plan validates step request ids', async () => {
    const out = (await promptCreatePlanTool.handler(
      {
        name: 'Smoke',
        stepRequestIds: ['nope'],
        envPriorityOrder: [],
      },
      ctx,
    )) as { ok: boolean; missing: string[] };
    expect(out.ok).toBe(false);
    expect(out.missing).toEqual(['nope']);
  });

  it('prompt.create_plan persists when all step ids exist', async () => {
    const r1 = (await requestCreateTool.handler(
      { name: 'A', method: 'GET' as const, url: '/a' },
      ctx,
    )) as { id: string };
    const r2 = (await requestCreateTool.handler(
      { name: 'B', method: 'GET' as const, url: '/b' },
      ctx,
    )) as { id: string };
    const out = (await promptCreatePlanTool.handler(
      {
        name: 'Smoke',
        stepRequestIds: [r1.id, r2.id],
        envPriorityOrder: [],
      },
      ctx,
    )) as { ok: boolean; id: string };
    expect(out.ok).toBe(true);
    const state = await ctx.workspace.read();
    expect(state.local.executionPlans[out.id].steps).toHaveLength(2);
  });
});
