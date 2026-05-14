import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';
import { requestCreateTool } from './crud';
import {
  promptAddMockEndpointTool,
  promptAddPlanStepsTool,
  promptCreateAssertionTool,
  promptCreateEnvironmentTool,
  promptCreateFolderTreeTool,
  promptCreateMockServerTool,
  promptCreatePlanTool,
  promptCreateRequestTool,
  promptSetEndpointMultipliersTool,
  promptSetEndpointResponseRulesTool,
  promptSetEndpointValidationRulesTool,
  promptSetPlanVariablesTool,
  promptUpdateRequestTool,
} from './prompt';

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

describe('prompt.create_request', () => {
  it('persists a fully-shaped request with headers, query, body, auth, assertions', async () => {
    const out = (await promptCreateRequestTool.handler(
      {
        name: 'Get user',
        method: 'GET' as const,
        url: 'https://api.example.com/users/{id}',
        folderId: null,
        headers: [{ key: 'X-Trace', value: 'abc', enabled: true }],
        queryParams: [{ key: 'expand', value: 'profile', enabled: true }],
        pathParams: { id: '42' },
        body: { type: 'none' as const, content: '' },
        auth: { type: 'bearer' as const, token: 'tok-123' },
        assertions: [
          {
            kind: 'status' as const,
            op: 'equals' as const,
            expected: 200,
          },
        ],
      },
      ctx,
    )) as { id: string };
    expect(out.id).toBeTruthy();
    const state = await ctx.workspace.read();
    const req = state.synced.collections.requests[out.id];
    expect(req).toBeDefined();
    expect(req.method).toBe('GET');
    expect(req.url).toBe('https://api.example.com/users/{id}');
    expect(req.headers).toEqual([{ key: 'X-Trace', value: 'abc', enabled: true }]);
    expect(req.query).toEqual([{ key: 'expand', value: 'profile', enabled: true }]);
    expect(req.pathParams).toEqual({ id: '42' });
    expect(req.auth).toEqual({ type: 'bearer', token: 'tok-123' });
    expect(req.assertions).toHaveLength(1);
    expect(req.assertions[0].id).toBeTruthy();
  });

  it('defaults auth to inherit when omitted', async () => {
    const out = (await promptCreateRequestTool.handler(
      { name: 'X', method: 'GET' as const, url: '/x' },
      ctx,
    )) as { id: string };
    const state = await ctx.workspace.read();
    expect(state.synced.collections.requests[out.id].auth).toEqual({ type: 'inherit' });
  });

  it('sets graphql variables when body type is graphql', async () => {
    const out = (await promptCreateRequestTool.handler(
      {
        name: 'gql',
        method: 'POST' as const,
        url: '/graphql',
        body: {
          type: 'graphql' as const,
          content: '{ user { id } }',
          variables: '{"id":1}',
        },
      },
      ctx,
    )) as { id: string };
    const state = await ctx.workspace.read();
    expect(state.synced.collections.requests[out.id].body.variables).toBe('{"id":1}');
  });
});

describe('prompt.update_request', () => {
  it('returns ok:false when the id does not resolve', async () => {
    const out = (await promptUpdateRequestTool.handler(
      { id: 'missing', patch: { name: 'X' } },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe('request not found');
  });

  it('replaces only the supplied fields', async () => {
    const created = (await requestCreateTool.handler(
      { name: 'orig', method: 'GET' as const, url: '/orig' },
      ctx,
    )) as { id: string };
    await promptUpdateRequestTool.handler(
      {
        id: created.id,
        patch: {
          name: 'renamed',
          headers: [{ key: 'X-New', value: '1', enabled: true }],
        },
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    const req = state.synced.collections.requests[created.id];
    expect(req.name).toBe('renamed');
    expect(req.url).toBe('/orig');
    expect(req.headers).toEqual([{ key: 'X-New', value: '1', enabled: true }]);
  });

  it('regenerates assertion ids when assertions are replaced', async () => {
    const created = (await requestCreateTool.handler(
      { name: 'r', method: 'GET' as const, url: '/r' },
      ctx,
    )) as { id: string };
    await promptUpdateRequestTool.handler(
      {
        id: created.id,
        patch: {
          assertions: [
            {
              kind: 'status' as const,
              op: 'equals' as const,
              expected: 200,
            },
          ],
        },
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    const assertions = state.synced.collections.requests[created.id].assertions;
    expect(assertions).toHaveLength(1);
    expect(assertions[0].id).toBeTruthy();
  });
});

describe('prompt.create_folder_tree', () => {
  it('walks the tree, creating one folder per node', async () => {
    const out = (await promptCreateFolderTreeTool.handler(
      {
        parentId: null,
        tree: {
          name: 'root',
          children: [{ name: 'leaf-a' }, { name: 'branch', children: [{ name: 'leaf-b' }] }],
        },
      },
      ctx,
    )) as { createdIds: string[] };
    expect(out.createdIds).toHaveLength(4);
    const state = await ctx.workspace.read();
    expect(Object.keys(state.synced.collections.folders)).toHaveLength(4);
    // Verify pre-order: root, leaf-a, branch, leaf-b
    const folders = out.createdIds.map((id) => state.synced.collections.folders[id]);
    expect(folders.map((f) => f.name)).toEqual(['root', 'leaf-a', 'branch', 'leaf-b']);
    expect(folders[0].parentId).toBeNull();
    expect(folders[1].parentId).toBe(folders[0].id);
    expect(folders[2].parentId).toBe(folders[0].id);
    expect(folders[3].parentId).toBe(folders[2].id);
  });

  it('creates a single folder when no children are provided', async () => {
    const out = (await promptCreateFolderTreeTool.handler({ tree: { name: 'solo' } }, ctx)) as {
      createdIds: string[];
    };
    expect(out.createdIds).toHaveLength(1);
  });
});

describe('prompt.add_plan_steps', () => {
  it('rejects when the plan does not exist', async () => {
    const out = (await promptAddPlanStepsTool.handler(
      { planId: 'nope', requestIds: ['x'] },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe('plan not found');
  });

  it('rejects when any request id is unknown', async () => {
    const created = (await promptCreatePlanTool.handler(
      { name: 'p', stepRequestIds: [], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    const out = (await promptAddPlanStepsTool.handler(
      { planId: created.id, requestIds: ['nope'] },
      ctx,
    )) as { ok: boolean; missing: string[] };
    expect(out.ok).toBe(false);
    expect(out.missing).toEqual(['nope']);
  });

  it('appends multiple steps in order, preserving existing steps', async () => {
    const r1 = (await requestCreateTool.handler(
      { name: 'A', method: 'GET' as const, url: '/a' },
      ctx,
    )) as { id: string };
    const r2 = (await requestCreateTool.handler(
      { name: 'B', method: 'GET' as const, url: '/b' },
      ctx,
    )) as { id: string };
    const r3 = (await requestCreateTool.handler(
      { name: 'C', method: 'GET' as const, url: '/c' },
      ctx,
    )) as { id: string };
    const plan = (await promptCreatePlanTool.handler(
      { name: 'p', stepRequestIds: [r1.id], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    await promptAddPlanStepsTool.handler({ planId: plan.id, requestIds: [r2.id, r3.id] }, ctx);
    const state = await ctx.workspace.read();
    expect(state.local.executionPlans[plan.id].steps.map((s) => s.requestId)).toEqual([
      r1.id,
      r2.id,
      r3.id,
    ]);
  });
});

describe('prompt.set_plan_variables', () => {
  it('rejects when the plan does not exist', async () => {
    const out = (await promptSetPlanVariablesTool.handler(
      { planId: 'nope', variables: [] },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe('plan not found');
  });

  it('replaces variables and clears them with an empty array', async () => {
    const plan = (await promptCreatePlanTool.handler(
      { name: 'p', stepRequestIds: [], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    await promptSetPlanVariablesTool.handler(
      { planId: plan.id, variables: [{ key: 'k', value: 'v' }] },
      ctx,
    );
    let state = await ctx.workspace.read();
    expect(state.local.executionPlans[plan.id].variables).toEqual([{ key: 'k', value: 'v' }]);
    await promptSetPlanVariablesTool.handler({ planId: plan.id, variables: [] }, ctx);
    state = await ctx.workspace.read();
    expect(state.local.executionPlans[plan.id].variables).toEqual([]);
  });
});

describe('prompt.create_mock_server', () => {
  it('creates a manual mock with inline endpoints + rules in one shot', async () => {
    const out = (await promptCreateMockServerTool.handler(
      {
        name: 'orders',
        endpoints: [
          {
            method: 'GET' as const,
            pathPattern: '/orders',
            validationRules: [
              {
                kind: 'header-required' as const,
                target: 'Authorization',
                enabled: true,
                failResponse: { status: 401, jsonBody: '{}' },
              },
            ],
            responseRules: [
              {
                name: 'big',
                enabled: true,
                when: [
                  {
                    scope: 'query' as const,
                    target: 'page',
                    op: 'equals' as const,
                    value: '1',
                  },
                ],
                response: { status: 200, jsonBody: '[]' },
              },
            ],
            multipliers: [
              {
                source: { kind: 'query' as const, key: 'count' },
                targetJsonPath: '$',
                defaultCount: 3,
              },
            ],
          },
          { method: 'POST' as const, pathPattern: '/orders' },
        ],
      },
      ctx,
    )) as { id: string; endpointIds: string[] };
    expect(out.endpointIds).toHaveLength(2);
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[out.id];
    expect(mock).toBeDefined();
    expect(mock.endpoints).toHaveLength(2);
    expect(mock.endpoints[0].requestValidation).toHaveLength(1);
    expect(mock.endpoints[0].requestValidation[0].id).toBeTruthy();
    expect(mock.endpoints[0].responseRules).toHaveLength(1);
    expect(mock.endpoints[0].responseRules[0].when[0].id).toBeTruthy();
    expect(mock.endpoints[0].defaultResponse.multipliers).toHaveLength(1);
    // Manual-mode mocks mirror endpoints into source.
    expect(mock.source.kind).toBe('manual');
  });
});

describe('prompt.add_mock_endpoint', () => {
  it('rejects when the mock does not exist', async () => {
    const out = (await promptAddMockEndpointTool.handler(
      { mockId: 'nope', method: 'GET' as const, pathPattern: '/x' },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toBe('mock not found');
  });

  it('appends an endpoint with auto-generated ids for nested rules', async () => {
    const mock = (await promptCreateMockServerTool.handler({ name: 'm', endpoints: [] }, ctx)) as {
      id: string;
    };
    const out = (await promptAddMockEndpointTool.handler(
      {
        mockId: mock.id,
        method: 'GET' as const,
        pathPattern: '/items',
        validationRules: [
          {
            kind: 'query-required' as const,
            target: 'limit',
            enabled: true,
            failResponse: { status: 400, jsonBody: '{}' },
          },
        ],
      },
      ctx,
    )) as { ok: boolean; endpointId: string };
    expect(out.ok).toBe(true);
    expect(out.endpointId).toBeTruthy();
    const state = await ctx.workspace.read();
    const m = state.synced.mockServers[mock.id];
    expect(m.endpoints).toHaveLength(1);
    expect(m.endpoints[0].requestValidation[0].id).toBeTruthy();
  });
});

describe('prompt.set_endpoint_validation_rules', () => {
  it('replaces the rules and auto-generates ids', async () => {
    const mock = (await promptCreateMockServerTool.handler(
      {
        name: 'm',
        endpoints: [{ method: 'GET' as const, pathPattern: '/x' }],
      },
      ctx,
    )) as { id: string; endpointIds: string[] };
    await promptSetEndpointValidationRulesTool.handler(
      {
        mockId: mock.id,
        endpointId: mock.endpointIds[0],
        rules: [
          {
            kind: 'header-equals' as const,
            target: 'X-API-Version',
            expected: 'v2',
            enabled: true,
            failResponse: { status: 426, jsonBody: '{}' },
          },
        ],
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    const ep = state.synced.mockServers[mock.id].endpoints[0];
    expect(ep.requestValidation).toHaveLength(1);
    expect(ep.requestValidation[0].id).toBeTruthy();
    expect(ep.requestValidation[0].kind).toBe('header-equals');
  });

  it('clears all rules with an empty array', async () => {
    const mock = (await promptCreateMockServerTool.handler(
      {
        name: 'm',
        endpoints: [
          {
            method: 'GET' as const,
            pathPattern: '/x',
            validationRules: [
              {
                kind: 'body-required' as const,
                target: '',
                enabled: true,
                failResponse: { status: 400, jsonBody: '{}' },
              },
            ],
          },
        ],
      },
      ctx,
    )) as { id: string; endpointIds: string[] };
    await promptSetEndpointValidationRulesTool.handler(
      { mockId: mock.id, endpointId: mock.endpointIds[0], rules: [] },
      ctx,
    );
    const state = await ctx.workspace.read();
    expect(state.synced.mockServers[mock.id].endpoints[0].requestValidation).toEqual([]);
  });
});

describe('prompt.set_endpoint_response_rules', () => {
  it('replaces conditional response rules with auto-generated ids', async () => {
    const mock = (await promptCreateMockServerTool.handler(
      {
        name: 'm',
        endpoints: [{ method: 'GET' as const, pathPattern: '/x' }],
      },
      ctx,
    )) as { id: string; endpointIds: string[] };
    await promptSetEndpointResponseRulesTool.handler(
      {
        mockId: mock.id,
        endpointId: mock.endpointIds[0],
        rules: [
          {
            name: 'rule-1',
            enabled: true,
            when: [
              {
                scope: 'query' as const,
                target: 'page',
                op: 'equals' as const,
                value: '2',
              },
            ],
            response: { status: 200, jsonBody: '{"page":2}' },
          },
        ],
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    const ep = state.synced.mockServers[mock.id].endpoints[0];
    expect(ep.responseRules).toHaveLength(1);
    expect(ep.responseRules[0].id).toBeTruthy();
    expect(ep.responseRules[0].when[0].id).toBeTruthy();
  });
});

describe('prompt.set_endpoint_multipliers', () => {
  it('replaces multipliers and clears them with an empty array', async () => {
    const mock = (await promptCreateMockServerTool.handler(
      {
        name: 'm',
        endpoints: [{ method: 'GET' as const, pathPattern: '/x' }],
      },
      ctx,
    )) as { id: string; endpointIds: string[] };
    await promptSetEndpointMultipliersTool.handler(
      {
        mockId: mock.id,
        endpointId: mock.endpointIds[0],
        multipliers: [
          {
            source: { kind: 'query' as const, key: 'count' },
            targetJsonPath: '$.items',
            defaultCount: 3,
          },
        ],
      },
      ctx,
    );
    let state = await ctx.workspace.read();
    let ep = state.synced.mockServers[mock.id].endpoints[0];
    expect(ep.defaultResponse.multipliers).toHaveLength(1);
    expect(ep.defaultResponse.multipliers![0].id).toBeTruthy();

    await promptSetEndpointMultipliersTool.handler(
      { mockId: mock.id, endpointId: mock.endpointIds[0], multipliers: [] },
      ctx,
    );
    state = await ctx.workspace.read();
    ep = state.synced.mockServers[mock.id].endpoints[0];
    expect(ep.defaultResponse.multipliers).toBeUndefined();
  });
});
