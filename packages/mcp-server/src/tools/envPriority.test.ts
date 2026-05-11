import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';
import {
  environmentCreateTool,
  environmentSetActiveTool,
  environmentSetPriorityTool,
} from './crud';

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

describe('environment priority MCP tools', () => {
  it('environment.set_active sets the active environment', async () => {
    await environmentCreateTool.handler({ name: 'dev', variables: [] }, ctx);
    await environmentSetActiveTool.handler({ name: 'dev' }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.environments.activeName).toBe('dev');
  });

  it('environment.set_active clears the active environment with name=null', async () => {
    await environmentCreateTool.handler({ name: 'dev', variables: [] }, ctx);
    await environmentSetActiveTool.handler({ name: 'dev' }, ctx);
    await environmentSetActiveTool.handler({ name: null }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.environments.activeName).toBeNull();
  });

  it('environment.set_priority replaces the priority order', async () => {
    await environmentCreateTool.handler({ name: 'dev', variables: [] }, ctx);
    await environmentCreateTool.handler({ name: 'staging', variables: [] }, ctx);
    await environmentCreateTool.handler({ name: 'prod', variables: [] }, ctx);
    await environmentSetPriorityTool.handler({ order: ['prod', 'dev'] }, ctx);
    const state = await ctx.workspace.read();
    // The applyMutation env.setPriority accepts only the supplied order; the
    // applyMutation internals decide whether to keep unlisted envs at the
    // tail. The test verifies prod and dev are at the front in that order.
    expect(state.synced.environments.priorityOrder.slice(0, 2)).toEqual([
      { kind: 'local', name: 'prod' },
      { kind: 'local', name: 'dev' },
    ]);
  });
});
