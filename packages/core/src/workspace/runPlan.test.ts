import { beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ExecutionPlan,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { PlanRunDeniedError, resolvePlanRef, runPlan } from './runPlan';
import type { WorkspaceState } from './patches';

import * as workspaceSharing from '../workspaceSharing';

// Linked plan steps are refused outright when workspace sharing is off (the
// shipped build). Forcing the accessor on keeps the linked-step execution
// engine covered; the refusal itself is asserted at the bottom of this file.
beforeEach(() => {
  vi.spyOn(workspaceSharing, 'isWorkspaceSharingEnabled').mockReturnValue(true);
});

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
    // `token` is named like a credential: used by step 2, never returned to be saved.
    expect(out.nextState.local.globalContext).toEqual({});
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

  it('runs a linked-workspace step from the cached snapshot', async () => {
    const linkedRequest = makeRequest('r1', { url: 'https://linked.test/upload' });
    const synced = makeSynced({
      linkedWorkspaces: {
        lw1: {
          id: 'lw1',
          kind: 'private',
          name: 'Linked API',
          sourceWorkspaceId: 'remote-ws-1',
          source: {
            provider: 'github',
            repoFullName: 'acme/linked-api',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections', 'environments'],
          pinnedVersion: null,
          updatePolicy: 'manual',
          linkedAt: T0,
          requiredSecretKeyIds: [],
        },
      },
      executionPlans: {
        p1: makePlan('p1', { steps: [{ requestId: 'r1', linkedWorkspaceId: 'lw1' }] }),
      },
    });
    const state: WorkspaceState = {
      synced,
      local: makeLocal({
        linkedCollections: {
          lw1: {
            pulledAt: T0,
            ref: 'HEAD@main',
            collections: {
              tree: { id: 'root', type: 'root', children: [] },
              requests: { r1: linkedRequest },
              folders: {},
            },
            environments: { items: {}, activeName: null, priorityOrder: [] },
          },
        },
      }),
    };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.passed).toBe(true);
    expect(out.steps[0].requestName).toBe('r1');
    expect(calls[0].url).toBe('https://linked.test/upload');
  });

  it('refuses a linked step when workspace sharing is off, without sending', async () => {
    // The shipped build. This engine is what the VS Code extension and every
    // headless consumer run plans through, so the refusal has to happen here —
    // gating only the web store would leave linked steps executing on the
    // other surfaces. Byte-identical fixture to the test above; only the flag
    // differs, so a pass here cannot be an artefact of a broken setup.
    vi.spyOn(workspaceSharing, 'isWorkspaceSharingEnabled').mockReturnValue(false);
    const linkedRequest = makeRequest('r1', { url: 'https://linked.test/upload' });
    const synced = makeSynced({
      linkedWorkspaces: {
        lw1: {
          id: 'lw1',
          kind: 'public',
          name: 'Payments',
          sourceWorkspaceId: 'src',
          source: {
            provider: 'github',
            repoFullName: 'org/payments',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections'],
          pinnedVersion: '1.0.0',
          updatePolicy: 'manual',
          linkedAt: T0,
          requiredSecretKeyIds: [],
        },
      },
      executionPlans: {
        p1: makePlan('p1', { steps: [{ requestId: 'r1', linkedWorkspaceId: 'lw1' }] }),
      },
    });
    const state: WorkspaceState = {
      synced,
      local: makeLocal({
        linkedCollections: {
          lw1: {
            pulledAt: T0,
            ref: 'HEAD@main',
            collections: {
              tree: { id: 'root', type: 'root', children: [] },
              requests: { r1: linkedRequest },
              folders: {},
            },
            environments: { items: {}, activeName: null, priorityOrder: [] },
          },
        },
      }),
    };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.passed).toBe(false);
    expect(out.steps[0].error).toMatch(/linked workspace, which this build does not include/);
    // Refused before it reached the wire.
    expect(calls).toHaveLength(0);
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

describe('runPlan — encryption keys and stored secrets', () => {
  // Slot s1 (label ADMIN_TOKEN_KEY) encrypts the ADMIN_TOKEN variable.
  const keyedSynced = (requests: Record<string, ApiRequest>, steps: ExecutionPlan['steps']) =>
    makeSynced({
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests, folders: {} },
      environments: {
        items: {
          prod: {
            name: 'prod',
            variables: [
              { key: 'ADMIN_TOKEN', value: 'enc:v1:x', encrypted: true, secretKeyId: 's1' },
            ],
          },
        },
        activeName: null,
        priorityOrder: [{ kind: 'local', name: 'prod' }],
      },
      secretKeys: { s1: { id: 's1', label: 'ADMIN_TOKEN_KEY', salt: 'x', createdAt: T0 } },
      executionPlans: { p1: makePlan('p1', { steps }) },
    });

  it('refuses a step that names an encryption key — nothing is sent — and runs the rest', async () => {
    const leak = makeRequest('leak', {
      headers: [{ key: 'Authorization', value: 'Bearer {{ADMIN_TOKEN_KEY}}', enabled: true }],
    });
    const ok = makeRequest('ok', { url: 'https://api.test/ok' });
    const state: WorkspaceState = {
      synced: keyedSynced({ leak, ok }, [{ requestId: 'leak' }, { requestId: 'ok' }]),
      local: makeLocal(),
    };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl, secretsById: { s1: 'the-key-value' } });

    expect(calls.map((c) => c.url)).toEqual(['https://api.test/ok']);
    expect(out.passed).toBe(false);
    expect(out.steps[0]).toMatchObject({ requestName: 'leak', passed: false, result: null });
    expect(out.steps[0].error).toBe(
      'Not sent. {{ADMIN_TOKEN_KEY}} is the encryption key of ADMIN_TOKEN, not a variable, ' +
        'so its value is never sent. Write {{ADMIN_TOKEN}} to send the variable.',
    );
    // The refusal is in history too, and the key's value is nowhere in it.
    const refused = out.nextState.local.history.requestRuns.find((r) => r.requestId === 'leak');
    expect(refused?.error).toBe(out.steps[0].error);
    expect(JSON.stringify(out.nextState.local)).not.toContain('the-key-value');
  });

  it('stops at a refused step under --bail', async () => {
    const leak = makeRequest('leak', { url: 'https://api.test/{{ADMIN_TOKEN_KEY}}' });
    const ok = makeRequest('ok');
    const state: WorkspaceState = {
      synced: keyedSynced({ leak, ok }, [{ requestId: 'leak' }, { requestId: 'ok' }]),
      local: makeLocal(),
    };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl, bail: true });

    expect(out.steps).toHaveLength(1);
    expect(calls).toHaveLength(0);
  });

  it('finds a key that a linked environment binds through the consumer override', async () => {
    const linkedRequest = makeRequest('r1', { url: 'https://linked.test/?k={{ADMIN_TOKEN_KEY}}' });
    const synced = makeSynced({
      secretKeys: { s1: { id: 's1', label: 'ADMIN_TOKEN_KEY', salt: 'x', createdAt: T0 } },
      linkedWorkspaces: {
        lw1: {
          id: 'lw1',
          kind: 'private',
          name: 'Linked API',
          sourceWorkspaceId: 'remote-ws-1',
          source: {
            provider: 'github',
            repoFullName: 'acme/linked-api',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections', 'environments'],
          pinnedVersion: null,
          updatePolicy: 'manual',
          linkedAt: T0,
          requiredSecretKeyIds: [],
        },
      },
      linkedOverrides: {
        requests: {},
        environmentVars: {
          'lw1:dev:TOKEN': {
            linkedWorkspaceId: 'lw1',
            envName: 'dev',
            varKey: 'TOKEN',
            value: 'enc:v1:y',
            encrypted: true,
            secretKeyId: 's1',
            updatedAt: T0,
          },
        },
      },
      executionPlans: {
        p1: makePlan('p1', { steps: [{ requestId: 'r1', linkedWorkspaceId: 'lw1' }] }),
      },
    });
    const state: WorkspaceState = {
      synced,
      local: makeLocal({
        linkedCollections: {
          lw1: {
            pulledAt: T0,
            ref: 'HEAD@main',
            collections: {
              tree: { id: 'root', type: 'root', children: [] },
              requests: { r1: linkedRequest },
              folders: {},
            },
            environments: {
              items: {
                dev: { name: 'dev', variables: [{ key: 'TOKEN', value: 'p', encrypted: false }] },
              },
              activeName: null,
              priorityOrder: [],
            },
          },
        },
      }),
    };
    const { fetchImpl, calls } = makeFetch({ '*': { status: 200 } });

    const out = await runPlan(state, 'p1', { fetchImpl, secretsById: { s1: 'v' } });

    expect(calls).toHaveLength(0);
    expect(out.steps[0].error).toContain('is the encryption key of TOKEN');
  });

  it('hides supplied secret values and credential headers in the stored run', async () => {
    const r1 = makeRequest('r1', {
      url: 'https://api.test/x?q={{ADMIN_TOKEN}}',
      headers: [
        { key: 'Authorization', value: 'Bearer {{ADMIN_TOKEN}}', enabled: true },
        { key: 'X-Echo', value: 'tok:{{ADMIN_TOKEN}}', enabled: true },
        { key: 'Accept', value: 'application/json', enabled: true },
      ],
    });
    const state: WorkspaceState = {
      synced: keyedSynced({ r1 }, [{ requestId: 'r1' }]),
      local: makeLocal(),
    };
    const { fetchImpl, calls } = makeFetch({
      '*': { status: 200, body: '{"echo":"plaintext-admin-token","access_token":"fresh-xyz"}' },
    });

    const out = await runPlan(state, 'p1', {
      fetchImpl,
      secretsById: { s1: 'plaintext-admin-token' },
    });

    // The wire got the real value…
    expect(calls[0].headers.authorization).toBe('Bearer plaintext-admin-token');
    // …history did not.
    const run = out.nextState.local.history.requestRuns[0];
    expect(run.secretsHidden).toBe(true);
    expect(run.requestHeaders).toEqual({
      Authorization: '[hidden]',
      'X-Echo': '[hidden]',
      Accept: 'application/json',
    });
    expect(run.url).toBe('https://api.test/x?q=[hidden]');
    expect(run.responseBodyPreview).toBe('{"echo":"[hidden]","access_token":"[hidden]"}');
    expect(JSON.stringify(out.nextState.local)).not.toContain('plaintext-admin-token');
  });
});

describe('runPlan — extracted values that look like credentials', () => {
  function chainSynced(
    login: Partial<ApiRequest>,
    use: Partial<ApiRequest>,
    extra: Record<string, ApiRequest> = {},
    steps: Array<{ requestId: string }> = [{ requestId: 'login' }, { requestId: 'use' }],
  ): WorkspaceSynced {
    return makeSynced({
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: {
          login: makeRequest('login', { url: 'https://api.test/login', ...login }),
          use: makeRequest('use', { url: 'https://api.test/use', ...use }),
          ...extra,
        },
        folders: {},
      },
      executionPlans: { p1: makePlan('p1', { steps }) },
    });
  }

  it('sends a held token to later steps but never returns it, and hides it in history', async () => {
    const synced = chainSynced(
      {
        extractions: [
          { id: 'e1', variable: 'AUTH', source: 'body', path: 'data.access_token', enabled: true },
          { id: 'e2', variable: 'USER_ID', source: 'body', path: 'data.id', enabled: true },
        ],
      },
      {
        url: 'https://api.test/use?user={{USER_ID}}',
        headers: [{ key: 'Authorization', value: 'Bearer {{AUTH}}', enabled: true }],
        body: { type: 'json', content: '{"t":"{{AUTH}}"}' },
        method: 'POST',
      },
    );
    const state: WorkspaceState = {
      synced,
      local: makeLocal({ globalContext: { KEPT: 'k' } }),
    };
    const { fetchImpl, calls } = makeFetch({
      'https://api.test/login': {
        status: 200,
        body: '{"data":{"access_token":"login-token-value","id":"42"}}',
      },
      '*': { status: 200, body: '{"t":"login-token-value"}' },
    });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(calls[1].headers.authorization).toBe('Bearer login-token-value');
    expect(calls[1].url).toBe('https://api.test/use?user=42');
    // The saved capture is returned; the held one is not.
    expect(out.nextState.local.globalContext).toEqual({ KEPT: 'k', USER_ID: '42' });
    // Neither stored run holds the token: not the login response that produced it,
    // nor the request body that sent it under a name that is not a credential's.
    expect(JSON.stringify(out.nextState.local)).not.toContain('login-token-value');
    const [useRun, loginRun] = out.nextState.local.history.requestRuns;
    expect(loginRun.responseBodyPreview).toBe('{"data":{"access_token":"[hidden]","id":"42"}}');
    expect(useRun.requestBodyPreview).toBe('{"t":"[hidden]"}');
    expect(useRun.responseBodyPreview).toBe('{"t":"[hidden]"}');
  });

  it('drops a saved value of the same name when a later capture is held', async () => {
    const synced = chainSynced(
      {
        extractions: [
          { id: 'e1', variable: 'SESSION', source: 'cookie', path: 'sid', enabled: true },
        ],
      },
      {},
    );
    const state: WorkspaceState = {
      synced,
      local: makeLocal({ globalContext: { SESSION: 'on' } }),
    };
    const { fetchImpl } = makeFetch({
      'https://api.test/login': { status: 200, headers: { 'set-cookie': 'sid=s3ss10n-value' } },
      '*': { status: 200 },
    });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(out.nextState.local.globalContext).toEqual({});
  });

  it('saves a value again once a later capture no longer looks like a credential', async () => {
    const reuse = makeRequest('again', {
      url: 'https://api.test/again',
      extractions: [{ id: 'e1', variable: 'NEXT', source: 'body', path: 'next', enabled: true }],
    });
    const synced = chainSynced(
      {
        extractions: [{ id: 'e1', variable: 'NEXT', source: 'body', path: 'next', enabled: true }],
      },
      { url: 'https://api.test/use?n={{NEXT}}' },
      { again: reuse },
      [{ requestId: 'login' }, { requestId: 'use' }, { requestId: 'again' }],
    );
    const state: WorkspaceState = { synced, local: makeLocal() };
    const { fetchImpl, calls } = makeFetch({
      'https://api.test/login': {
        status: 200,
        body: '{"next":"ghp_abcdefghijklmnopqrstuvwxyz0123456789"}',
      },
      'https://api.test/again': { status: 200, body: '{"next":"page-2"}' },
      '*': { status: 200 },
    });

    const out = await runPlan(state, 'p1', { fetchImpl });

    expect(calls[1].url).toBe('https://api.test/use?n=ghp_abcdefghijklmnopqrstuvwxyz0123456789');
    expect(out.nextState.local.globalContext).toEqual({ NEXT: 'page-2' });
    // The step that captured `page-2` still sent nothing held under a stored name.
    expect(JSON.stringify(out.nextState.local)).not.toContain(
      'ghp_abcdefghijklmnopqrstuvwxyz0123456789',
    );
  });
});
