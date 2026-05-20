import { describe, expect, it, vi } from 'vitest';
import type {
  ExecutionPlan,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { PlanRunDeniedError, resolvePlanRef, runPlan } from './runPlan';
import type { WorkspaceState } from './patches';

const T0 = '2026-05-01T00:00:00.000Z';

function makeSynced(overrides: Partial<WorkspaceSynced> = {}): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
    ...overrides,
  };
}

function makeLocal(overrides: Partial<WorkspaceLocal> = {}): WorkspaceLocal {
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
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    ...overrides,
  };
}

function makeRequest(id: string, partial: Partial<ApiRequest> = {}): ApiRequest {
  return {
    id,
    name: id,
    folderId: null,
    method: 'GET',
    url: 'https://api.test/x',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

function makePlan(id: string, partial: Partial<ExecutionPlan> = {}): ExecutionPlan {
  return {
    id,
    name: id,
    steps: [],
    envPriorityOrder: [],
    createdAt: T0,
    updatedAt: T0,
    ...partial,
  };
}

interface RouteSpec {
  status?: number;
  body?: string;
  headers?: Record<string, string>;
}

function makeFetch(routes: Record<string, RouteSpec>): {
  fetchImpl: typeof fetch;
  calls: Array<{ url: string; method: string; headers: Record<string, string> }>;
} {
  const calls: Array<{ url: string; method: string; headers: Record<string, string> }> = [];
  const fetchImpl = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    const headers: Record<string, string> = {};
    if (init?.headers) {
      new Headers(init.headers).forEach((v, k) => {
        headers[k] = v;
      });
    }
    calls.push({ url, method: init?.method ?? 'GET', headers });
    const key = Object.keys(routes).find((k) => url.startsWith(k)) ?? '*';
    const route = routes[key] ?? routes['*'] ?? { status: 200, body: '{}' };
    return new Response(route.body ?? '{}', {
      status: route.status ?? 200,
      headers: { 'content-type': 'application/json', ...(route.headers ?? {}) },
    });
  }) as typeof fetch;
  return { fetchImpl, calls };
}

describe('resolvePlanRef', () => {
  it('resolves by exact id', () => {
    const synced = makeSynced({ executionPlans: { p1: makePlan('p1', { name: 'Smoke' }) } });
    const out = resolvePlanRef(synced, 'p1');
    expect(out).toMatchObject({ ok: true, id: 'p1' });
  });

  it('resolves by name, case-insensitively', () => {
    const synced = makeSynced({ executionPlans: { p1: makePlan('p1', { name: 'Smoke Suite' }) } });
    const out = resolvePlanRef(synced, 'smoke suite');
    expect(out).toMatchObject({ ok: true, id: 'p1' });
  });

  it('rejects an ambiguous name', () => {
    const synced = makeSynced({
      executionPlans: {
        p1: makePlan('p1', { name: 'Dup' }),
        p2: makePlan('p2', { name: 'dup' }),
      },
    });
    const out = resolvePlanRef(synced, 'Dup');
    expect(out.ok).toBe(false);
    if (!out.ok) expect(out.error).toMatch(/ambiguous/);
  });

  it('reports available plans when the name is unknown', () => {
    const synced = makeSynced({ executionPlans: { p1: makePlan('p1', { name: 'Smoke' }) } });
    const out = resolvePlanRef(synced, 'Nope');
    expect(out).toMatchObject({ ok: false, available: ['Smoke'] });
  });

  it('reports an empty workspace', () => {
    const out = resolvePlanRef(makeSynced(), 'anything');
    expect(out).toMatchObject({ ok: false, available: [] });
  });
});

describe('runPlan', () => {
  it('throws for an unknown plan id', async () => {
    const state: WorkspaceState = { synced: makeSynced(), local: makeLocal() };
    await expect(runPlan(state, 'missing')).rejects.toThrow(/not found/);
  });

  it('runs every enabled step and records a PlanRun in history', async () => {
    const r1 = makeRequest('r1', { url: 'https://api.test/a' });
    const r2 = makeRequest('r2', { url: 'https://api.test/b' });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1, r2 },
        folders: {},
      },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }, { requestId: 'r2' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl } = makeFetch({ '*': { status: 200, body: '{"ok":true}' } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.passed).toBe(true);
    expect(out.steps).toHaveLength(2);
    expect(out.steps.every((s) => s.passed && !s.skipped)).toBe(true);
    expect(out.planRun.steps).toHaveLength(2);
    expect(out.nextState.local.history.planRuns).toHaveLength(1);
    expect(out.nextState.local.history.requestRuns).toHaveLength(2);
    // Input state is untouched.
    expect(state.local.history.planRuns).toHaveLength(0);
  });

  it('fails the run when an assertion fails', async () => {
    const r1 = makeRequest('r1', {
      url: 'https://api.test/a',
      assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
    });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1 },
        folders: {},
      },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl } = makeFetch({ '*': { status: 500, body: '{}' } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.passed).toBe(false);
    expect(out.steps[0].assertionResults[0].passed).toBe(false);
    expect(out.planRun.steps[0].passed).toBe(false);
  });

  it('does not evaluate assertions when withAssertions is false', async () => {
    const r1 = makeRequest('r1', {
      assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
    });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1 },
        folders: {},
      },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl } = makeFetch({ '*': { status: 500, body: '{}' } });

    const out = await runPlan(state, 'p1', { fetchImpl, withAssertions: false });

    // status 500 still means !ok, so the step fails — but on transport, not assertions.
    expect(out.steps[0].assertionResults).toHaveLength(0);
  });

  it('skips disabled steps without recording a run', async () => {
    const r1 = makeRequest('r1');
    const r2 = makeRequest('r2');
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1, r2 },
        folders: {},
      },
      executionPlans: {
        p1: makePlan('p1', {
          steps: [{ requestId: 'r1', enabled: false }, { requestId: 'r2' }],
        }),
      },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.steps[0].skipped).toBe(true);
    expect(out.steps[1].skipped).toBe(false);
    expect(out.planRun.steps).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('carries extracted context vars into later steps', async () => {
    const r1 = makeRequest('r1', {
      url: 'https://api.test/login',
      extractions: [{ id: 'e1', variable: 'token', source: 'body', path: 'token', enabled: true }],
    });
    const r2 = makeRequest('r2', { url: 'https://api.test/use?t={{token}}' });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1, r2 },
        folders: {},
      },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }, { requestId: 'r2' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({
      'https://api.test/login': { status: 200, body: '{"token":"abc123"}' },
      '*': { status: 200, body: '{}' },
    });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(calls[1].url).toContain('t=abc123');
    expect(out.nextState.local.globalContext.token).toBe('abc123');
  });

  it('halts on the first failure when stopOnAssertionFailure is set', async () => {
    const r1 = makeRequest('r1', {
      url: 'https://api.test/a',
      assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
    });
    const r2 = makeRequest('r2', { url: 'https://api.test/b' });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1, r2 },
        folders: {},
      },
      executionPlans: {
        p1: makePlan('p1', {
          steps: [{ requestId: 'r1' }, { requestId: 'r2' }],
          stopOnAssertionFailure: true,
        }),
      },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 500 } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.steps).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('records a missing-request step as a failure without firing a request', async () => {
    const synced = makeSynced({
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'gone' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.passed).toBe(false);
    expect(out.steps[0].error).toMatch(/no longer exists/);
    expect(calls).toHaveLength(0);
  });

  it('records a linked-workspace step as an unsupported failure', async () => {
    const synced = makeSynced({
      executionPlans: {
        p1: makePlan('p1', { steps: [{ requestId: 'r1', linkedWorkspaceId: 'lw1' }] }),
      },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.passed).toBe(false);
    expect(out.steps[0].error).toMatch(/not supported/);
  });

  it('resolves env-priority variables and CLI-supplied secrets', async () => {
    const r1 = makeRequest('r1', {
      url: '{{BASE}}/health',
      headers: [{ key: 'X-Key', value: '{{API_KEY}}', enabled: true }],
    });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1 },
        folders: {},
      },
      environments: {
        items: {
          prod: {
            name: 'prod',
            variables: [
              { key: 'BASE', value: 'https://api.test', encrypted: false },
              { key: 'API_KEY', value: 'enc:v1:ignored', encrypted: true, secretKeyId: 's1' },
            ],
          },
        },
        activeName: null,
        priorityOrder: [{ kind: 'local', name: 'prod' }],
      },
      secretKeys: { s1: { id: 's1', label: 'apiKey', salt: 'x', createdAt: T0 } },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl, secretsById: { s1: 'top-secret' } });

    expect(calls[0].url).toBe('https://api.test/health');
    expect(calls[0].headers['x-key']).toBe('top-secret');
    expect(out.steps[0].missingVariables).toHaveLength(0);
  });

  it('flags unresolved variables (including missing secrets) per step', async () => {
    const r1 = makeRequest('r1', { url: 'https://api.test/x?v={{NOPE}}' });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1 },
        folders: {},
      },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.steps[0].missingVariables).toContain('NOPE');
  });

  it('lets plan variables override env values', async () => {
    const r1 = makeRequest('r1', { url: '{{BASE}}/x' });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1 },
        folders: {},
      },
      environments: {
        items: {
          prod: {
            name: 'prod',
            variables: [{ key: 'BASE', value: 'https://prod.test', encrypted: false }],
          },
        },
        activeName: null,
        priorityOrder: [{ kind: 'local', name: 'prod' }],
      },
      executionPlans: {
        p1: makePlan('p1', {
          steps: [{ requestId: 'r1' }],
          variables: [{ key: 'BASE', value: 'https://staging.test' }],
        }),
      },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    await runPlan(state, 'p1', { fetchImpl });

    expect(calls[0].url).toBe('https://staging.test/x');
  });

  it('halts on the first failed step when bail is set, even without assertions', async () => {
    const r1 = makeRequest('r1', { url: 'https://api.test/a' });
    const r2 = makeRequest('r2', { url: 'https://api.test/b' });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1, r2 },
        folders: {},
      },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }, { requestId: 'r2' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 500 } });

    const out = await runPlan(state, 'p1', { fetchImpl, withAssertions: false, bail: true });

    expect(out.steps).toHaveLength(1);
    expect(calls).toHaveLength(1);
  });

  it('bails on a missing-request step', async () => {
    const r2 = makeRequest('r2');
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r2 },
        folders: {},
      },
      executionPlans: {
        p1: makePlan('p1', { steps: [{ requestId: 'gone' }, { requestId: 'r2' }] }),
      },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl, bail: true });

    expect(out.steps).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it('layers the --env environment on top of the priority order', async () => {
    const r1 = makeRequest('r1', { url: '{{BASE}}/x' });
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1 },
        folders: {},
      },
      environments: {
        items: {
          prod: {
            name: 'prod',
            variables: [{ key: 'BASE', value: 'https://prod.test', encrypted: false }],
          },
          staging: {
            name: 'staging',
            variables: [{ key: 'BASE', value: 'https://staging.test', encrypted: false }],
          },
        },
        activeName: null,
        priorityOrder: [{ kind: 'local', name: 'prod' }],
      },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    await runPlan(state, 'p1', { fetchImpl, env: 'staging' });

    expect(calls[0].url).toBe('https://staging.test/x');
  });

  it('invokes the authorize hook and propagates a denial', async () => {
    const r1 = makeRequest('r1');
    const synced = makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: { r1 },
        folders: {},
      },
      executionPlans: { p1: makePlan('p1', { steps: [{ requestId: 'r1' }] }) },
    });
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });
    const authorize = vi.fn(() => {
      throw new PlanRunDeniedError('not allowed');
    });

    await expect(
      runPlan(state, 'p1', { fetchImpl, authorize, actor: { kind: 'os', name: 'alice' } }),
    ).rejects.toBeInstanceOf(PlanRunDeniedError);
    // Denial happens before any HTTP request fires.
    expect(calls).toHaveLength(0);
    expect(authorize).toHaveBeenCalledWith(
      expect.objectContaining({ planId: 'p1', actor: { kind: 'os', name: 'alice' } }),
    );
  });
});
