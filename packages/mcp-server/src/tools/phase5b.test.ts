// Integration tests for Phase 5b MCP tools - plan step ops, mock rule
// editing, history, and env import/export. Each test exercises the tool
// through the same in-memory provider the production handlers use.

import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { SingleWorkspaceAdapter } from '../providers/Workspaces';
import { InProcessMockController } from '../providers/InProcessMockController';
import {
  environmentCreateTool,
  environmentExportTool,
  environmentImportTool,
  planAddStepTool,
  planCreateTool,
  planRemoveStepTool,
  planReorderStepsTool,
  planSetVariablesTool,
} from './crud';
import {
  mockAddEndpointTool,
  mockCreateManualTool,
  mockSetMultipliersTool,
  mockSetResponseRulesTool,
  mockSetValidationRulesTool,
} from './mocks';
import {
  historyDeleteRunTool,
  historyGetRunTool,
  historyListRunsTool,
  historyPurgeTool,
} from './history';

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

let ctx: {
  workspace: InMemoryWorkspaceProvider;
  workspaces: SingleWorkspaceAdapter;
  mock: InProcessMockController;
};

function buildCtx(state = freshState()): typeof ctx {
  const workspace = new InMemoryWorkspaceProvider(state);
  return {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new InProcessMockController(),
  };
}

beforeEach(() => {
  ctx = buildCtx();
});

// =============================================================================
// Plan step granular ops
// =============================================================================

describe('plan step granular MCP tools', () => {
  it('plan.add_step appends a step', async () => {
    const created = (await planCreateTool.handler(
      { name: 'P', steps: [], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    await planAddStepTool.handler({ planId: created.id, requestId: 'r1' }, ctx);
    await planAddStepTool.handler({ planId: created.id, requestId: 'r2' }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.executionPlans?.[created.id]?.steps.map((s) => s.requestId)).toEqual([
      'r1',
      'r2',
    ]);
  });

  it('plan.add_step inserts at the given position', async () => {
    const created = (await planCreateTool.handler(
      { name: 'P', steps: [{ requestId: 'a' }, { requestId: 'b' }], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    await planAddStepTool.handler({ planId: created.id, requestId: 'c', position: 1 }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.executionPlans?.[created.id]?.steps.map((s) => s.requestId)).toEqual([
      'a',
      'c',
      'b',
    ]);
  });

  it('plan.remove_step removes by index', async () => {
    const created = (await planCreateTool.handler(
      {
        name: 'P',
        steps: [{ requestId: 'a' }, { requestId: 'b' }, { requestId: 'c' }],
        envPriorityOrder: [],
      },
      ctx,
    )) as { id: string };
    await planRemoveStepTool.handler({ planId: created.id, index: 1 }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.executionPlans?.[created.id]?.steps.map((s) => s.requestId)).toEqual([
      'a',
      'c',
    ]);
  });

  it('plan.remove_step rejects out-of-range indices', async () => {
    const created = (await planCreateTool.handler(
      { name: 'P', steps: [{ requestId: 'a' }], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    const out = await planRemoveStepTool.handler({ planId: created.id, index: 5 }, ctx);
    expect(out).toMatchObject({ ok: false, error: 'index out of range' });
  });

  it('plan.reorder_steps permutes the steps array', async () => {
    const created = (await planCreateTool.handler(
      {
        name: 'P',
        steps: [{ requestId: 'a' }, { requestId: 'b' }, { requestId: 'c' }],
        envPriorityOrder: [],
      },
      ctx,
    )) as { id: string };
    await planReorderStepsTool.handler({ planId: created.id, order: [2, 0, 1] }, ctx);
    const state = await ctx.workspace.read();
    expect(state.synced.executionPlans?.[created.id]?.steps.map((s) => s.requestId)).toEqual([
      'c',
      'a',
      'b',
    ]);
  });

  it('plan.reorder_steps rejects non-permutations', async () => {
    const created = (await planCreateTool.handler(
      {
        name: 'P',
        steps: [{ requestId: 'a' }, { requestId: 'b' }],
        envPriorityOrder: [],
      },
      ctx,
    )) as { id: string };
    const out = await planReorderStepsTool.handler({ planId: created.id, order: [0, 0] }, ctx);
    expect(out).toMatchObject({ ok: false });
  });

  it('plan.set_variables replaces the plan-level variables', async () => {
    const created = (await planCreateTool.handler(
      { name: 'P', steps: [], envPriorityOrder: [] },
      ctx,
    )) as { id: string };
    await planSetVariablesTool.handler(
      { planId: created.id, variables: [{ key: 'x', value: '1' }] },
      ctx,
    );
    const state = await ctx.workspace.read();
    expect(state.synced.executionPlans?.[created.id]?.variables).toEqual([
      { key: 'x', value: '1' },
    ]);
  });
});

// =============================================================================
// Mock rule editing
// =============================================================================

async function makeMockWithEndpoint() {
  const mock = (await mockCreateManualTool.handler({ name: 'API' }, ctx)) as { id: string };
  const endpoint = (await mockAddEndpointTool.handler(
    { mockId: mock.id, method: 'GET' as const, pathPattern: '/x' },
    ctx,
  )) as { ok: true; endpointId: string };
  return { mockId: mock.id, endpointId: endpoint.endpointId };
}

describe('mock rule editing MCP tools', () => {
  it('mock.set_validation_rules replaces the rule list', async () => {
    const { mockId, endpointId } = await makeMockWithEndpoint();
    await mockSetValidationRulesTool.handler(
      {
        mockId,
        endpointId,
        rules: [
          {
            kind: 'header-required' as const,
            target: 'authorization',
            enabled: true,
            failResponse: { status: 401, jsonBody: '{"error":"u"}' },
          },
        ],
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    const ep = state.synced.mockServers[mockId].endpoints[0];
    expect(ep.requestValidation).toHaveLength(1);
    expect(ep.requestValidation[0].kind).toBe('header-required');
    expect(ep.requestValidation[0].failResponse.status).toBe(401);
  });

  it('mock.set_response_rules replaces the rule list', async () => {
    const { mockId, endpointId } = await makeMockWithEndpoint();
    await mockSetResponseRulesTool.handler(
      {
        mockId,
        endpointId,
        rules: [
          {
            name: 'admin',
            enabled: true,
            when: [
              { scope: 'header' as const, target: 'X-Role', op: 'equals' as const, value: 'admin' },
            ],
            response: { status: 200, jsonBody: '{"admin":true}' },
          },
        ],
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    const ep = state.synced.mockServers[mockId].endpoints[0];
    expect(ep.responseRules).toHaveLength(1);
    expect(ep.responseRules[0].when).toHaveLength(1);
  });

  it('mock.set_response_rules input schema rejects a rule with no when clauses (parity with VS Code)', () => {
    // The MCP dispatch (McpHost) parses inputSchema before the handler runs, so
    // an empty `when` is rejected at the boundary — matching the endpoint YAML
    // parser, which blocks the same shadow-the-default shape.
    const bad = mockSetResponseRulesTool.inputSchema.safeParse({
      mockId: 'm',
      endpointId: 'e',
      rules: [{ name: 'catch-all', when: [], response: {} }],
    });
    expect(bad.success).toBe(false);
    const ok = mockSetResponseRulesTool.inputSchema.safeParse({
      mockId: 'm',
      endpointId: 'e',
      rules: [
        {
          name: 'ok',
          when: [{ scope: 'query', target: 'p', op: 'equals', value: '1' }],
          response: {},
        },
      ],
    });
    expect(ok.success).toBe(true);
  });

  it('mock.set_multipliers writes + clears + caps the list at 1', async () => {
    const { mockId, endpointId } = await makeMockWithEndpoint();
    await mockSetMultipliersTool.handler(
      {
        mockId,
        endpointId,
        multipliers: [
          {
            source: { kind: 'query' as const, key: 'pageSize' },
            targetJsonPath: '$.items',
            defaultCount: 5,
          },
        ],
      },
      ctx,
    );
    let state = await ctx.workspace.read();
    expect(state.synced.mockServers[mockId].endpoints[0].defaultResponse.multipliers).toHaveLength(
      1,
    );
    expect(
      state.synced.mockServers[mockId].endpoints[0].defaultResponse.multipliers?.[0].source.key,
    ).toBe('pageSize');

    // A second multiplier is rejected (capped at 1 for now).
    const tooMany = await mockSetMultipliersTool.handler(
      {
        mockId,
        endpointId,
        multipliers: [
          { source: { kind: 'query' as const, key: 'a' }, targetJsonPath: '$.x', defaultCount: 1 },
          { source: { kind: 'query' as const, key: 'b' }, targetJsonPath: '$.y', defaultCount: 1 },
        ],
      },
      ctx,
    );
    expect(tooMany).toMatchObject({ ok: false, error: 'too many multipliers' });

    await mockSetMultipliersTool.handler({ mockId, endpointId, multipliers: [] }, ctx);
    state = await ctx.workspace.read();
    expect(
      state.synced.mockServers[mockId].endpoints[0].defaultResponse.multipliers,
    ).toBeUndefined();
  });
});

// =============================================================================
// History
// =============================================================================

describe('history MCP tools', () => {
  beforeEach(async () => {
    // Seed two request runs at different times directly into local state.
    const fresh = freshState();
    fresh.local.history.requestRuns = [
      {
        id: 'run-old',
        requestId: 'r1',
        startedAt: '2024-01-01T00:00:00.000Z',
        durationMs: 10,
        status: 200,
        statusText: 'OK',
        ok: true,
        error: undefined,
        url: '/x',
        method: 'GET',
        requestHeaders: {},
        requestBodyPreview: null,
        responseHeaders: {},
        responseBodyPreview: '',
        responseBodyKind: 'text',
        responseTruncated: false,
        assertions: [],
      },
      {
        id: 'run-new',
        requestId: 'r2',
        startedAt: new Date().toISOString(),
        durationMs: 15,
        status: 500,
        statusText: 'oops',
        ok: false,
        error: 'broken',
        url: '/y',
        method: 'POST',
        requestHeaders: {},
        requestBodyPreview: null,
        responseHeaders: {},
        responseBodyPreview: '',
        responseBodyKind: 'text',
        responseTruncated: false,
        assertions: [],
      },
    ];
    ctx = buildCtx(fresh);
  });

  it('history.list_runs returns rows in reverse chronological order', async () => {
    const out = (await historyListRunsTool.handler({ limit: 100 }, ctx)) as {
      total: number;
      runs: Array<{ id: string }>;
    };
    expect(out.total).toBe(2);
    expect(out.runs.map((r) => r.id)).toEqual(['run-new', 'run-old']);
  });

  it('history.list_runs filters by ok', async () => {
    const out = (await historyListRunsTool.handler({ limit: 100, ok: false }, ctx)) as {
      runs: Array<{ id: string }>;
    };
    expect(out.runs.map((r) => r.id)).toEqual(['run-new']);
  });

  it('history.get_run returns the full row', async () => {
    const out = await historyGetRunTool.handler({ id: 'run-old' }, ctx);
    expect(out).toMatchObject({ found: true, run: { id: 'run-old', method: 'GET' } });
  });

  it('history.get_run returns found:false for unknown id', async () => {
    expect(await historyGetRunTool.handler({ id: 'nope' }, ctx)).toEqual({ found: false });
  });

  it('history.delete_run removes the row', async () => {
    await historyDeleteRunTool.handler({ id: 'run-old' }, ctx);
    const state = await ctx.workspace.read();
    expect(state.local.history.requestRuns.map((r) => r.id)).toEqual(['run-new']);
  });

  it('history.purge_by_age drops everything older than the cutoff', async () => {
    // Cutoff = 7 days. The "run-old" row is 2024-01-01, well outside.
    const out = (await historyPurgeTool.handler({ olderThanDays: 7 }, ctx)) as {
      purgedCount: number;
    };
    expect(out.purgedCount).toBe(1);
    const state = await ctx.workspace.read();
    expect(state.local.history.requestRuns.map((r) => r.id)).toEqual(['run-new']);
  });
});

// =============================================================================
// Env import/export
// =============================================================================

describe('environment import/export MCP tools', () => {
  it('environment.export round-trips through environment.import', async () => {
    await environmentCreateTool.handler(
      {
        name: 'dev',
        variables: [
          { key: 'FOO', value: 'bar', encrypted: false },
          { key: 'API_KEY', value: 'plain' as const, encrypted: false },
        ],
      },
      ctx,
    );
    const exp = (await environmentExportTool.handler({ name: 'dev' }, ctx)) as {
      ok: true;
      json: string;
    };
    expect(exp.ok).toBe(true);
    // Re-import into a fresh ctx with overwrite false; should succeed because
    // the env doesn't exist there yet.
    ctx = buildCtx();
    const imp = (await environmentImportTool.handler(
      { json: exp.json, overwrite: false },
      ctx,
    )) as { ok: true; name: string };
    expect(imp.ok).toBe(true);
    expect(imp.name).toBe('dev');
    const state = await ctx.workspace.read();
    expect(state.synced.environments.items.dev.variables.length).toBe(2);
  });

  it('environment.import rejects malformed JSON', async () => {
    const out = await environmentImportTool.handler({ json: '{not json', overwrite: false }, ctx);
    expect(out).toMatchObject({ ok: false, error: 'invalid JSON' });
  });

  it('environment.import rejects unknown shapes', async () => {
    const out = (await environmentImportTool.handler(
      { json: JSON.stringify({ foo: 'bar' }), overwrite: false },
      ctx,
    )) as { ok: false; error: string };
    expect(out.ok).toBe(false);
    // Routed through the shared core parser — error string matches the
    // user-facing message the modal surfaces too.
    expect(out.error).toMatch(/Unsupported format/i);
  });

  it('environment.import refuses to overwrite without the flag', async () => {
    await environmentCreateTool.handler({ name: 'dev', variables: [] }, ctx);
    const exp = (await environmentExportTool.handler({ name: 'dev' }, ctx)) as {
      ok: true;
      json: string;
    };
    const out = await environmentImportTool.handler({ json: exp.json, overwrite: false }, ctx);
    expect(out).toMatchObject({ ok: false });
  });

  it('environment.import surfaces pendingBindings for unresolved encrypted rows', async () => {
    // Source workspace doesn't carry a slot — the envelope arrives with
    // an encrypted row whose label has no match on the destination.
    const envelope = {
      apicircleEnvironment: 1,
      name: 'with-secrets',
      variables: [
        { key: 'PLAIN', value: 'ok', encrypted: false },
        {
          key: 'TOKEN',
          encrypted: true,
          secretKeyId: 'sec_origin',
          secret: { label: 'PROD_TOKEN' },
        },
      ],
    };
    ctx = buildCtx();
    const out = (await environmentImportTool.handler(
      { json: JSON.stringify(envelope), overwrite: false },
      ctx,
    )) as {
      ok: true;
      name: string;
      pendingBindings: Array<{ varKey: string; label: string; labelFromFallback: boolean }>;
      warnings: string[];
    };
    expect(out.ok).toBe(true);
    expect(out.name).toBe('with-secrets');
    expect(out.pendingBindings).toEqual([
      { varKey: 'TOKEN', label: 'PROD_TOKEN', labelFromFallback: false },
    ]);
    expect(out.warnings).toEqual([]);
    // Env was persisted with the source's binding id preserved — the AI
    // client (or a teammate) can re-bind without re-importing.
    const state = await ctx.workspace.read();
    const env = state.synced.environments.items['with-secrets']!;
    expect(env.variables[0]).toEqual({ key: 'PLAIN', value: 'ok', encrypted: false });
    expect(env.variables[1]).toMatchObject({
      key: 'TOKEN',
      encrypted: true,
      secretKeyId: 'sec_origin',
    });
  });

  it('environment.import accepts the legacy shape (secretKeyId without secret.label)', async () => {
    const envelope = {
      apicircleEnvironment: 1,
      name: 'legacy',
      variables: [{ key: 'TOKEN', encrypted: true, secretKeyId: 'sec_legacy' }],
    };
    ctx = buildCtx();
    const out = (await environmentImportTool.handler(
      { json: JSON.stringify(envelope), overwrite: false },
      ctx,
    )) as {
      ok: true;
      pendingBindings: Array<{ varKey: string; label: string; labelFromFallback: boolean }>;
    };
    expect(out.ok).toBe(true);
    // Fallback label is the var key — flagged so the UI can hint.
    expect(out.pendingBindings).toEqual([
      { varKey: 'TOKEN', label: 'TOKEN', labelFromFallback: true },
    ]);
  });
});
