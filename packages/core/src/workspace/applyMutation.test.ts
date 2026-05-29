import { describe, expect, it } from 'vitest';
import type {
  Folder,
  Request as ApiRequest,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { applyMutation } from './applyMutation';

const T0 = '2026-04-27T00:00:00.000Z';
const T1 = '2026-04-28T00:00:00.000Z';

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
    url: 'https://example.test/x',
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

function makeFolder(id: string, parentId: string | null = null, name = id): Folder {
  return { id, name, parentId };
}

describe('applyMutation - request', () => {
  it('creates a request and adds it to the tree', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const req = makeRequest('r1');
    const { next, changedIds } = applyMutation(
      state,
      { kind: 'request.create', request: req },
      { now: T1 },
    );
    expect(next.synced.collections.requests['r1']).toEqual(req);
    expect(next.synced.collections.tree.children).toEqual([{ kind: 'request', id: 'r1' }]);
    expect(next.synced.meta.updatedAt).toBe(T1);
    expect(changedIds).toEqual(['r1']);
  });

  it('skips create when the id already exists', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
          requests: { r1: makeRequest('r1') },
          folders: {},
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'request.create', request: makeRequest('r1') });
    expect(out.next).toBe(state);
    expect(out.changedIds).toEqual([]);
  });

  it('updates a request and bumps updatedAt', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
          requests: { r1: makeRequest('r1') },
          folders: {},
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(
      state,
      { kind: 'request.update', id: 'r1', patch: { name: 'renamed', method: 'POST' } },
      { now: T1 },
    );
    expect(out.next.synced.collections.requests['r1'].name).toBe('renamed');
    expect(out.next.synced.collections.requests['r1'].method).toBe('POST');
    expect(out.next.synced.collections.requests['r1'].id).toBe('r1');
    expect(out.next.synced.collections.requests['r1'].createdAt).toBe(T0);
    expect(out.next.synced.collections.requests['r1'].updatedAt).toBe(T1);
    expect(out.changedIds).toEqual(['r1']);
  });

  it('returns same state when updating a missing request', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, {
      kind: 'request.update',
      id: 'missing',
      patch: { name: 'x' },
    });
    expect(out.next).toBe(state);
    expect(out.changedIds).toEqual([]);
  });

  it('deletes a request and leaves linked-workspace overrides untouched (overrides target source-side requests)', () => {
    // Linked-request overrides live on `synced.linkedOverrides.requests`
    // and are keyed by the LINKED workspace's request id, not by an owned
    // request id. Deleting an owned request must not collateral-damage
    // them - the test pins this invariant.
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
          requests: { r1: makeRequest('r1') },
          folders: {},
        },
        linkedOverrides: {
          requests: {
            'lw1:r1': {
              linkedWorkspaceId: 'lw1',
              itemId: 'r1',
              patch: {},
              updatedAt: T0,
            },
            'lw1:other': {
              linkedWorkspaceId: 'lw1',
              itemId: 'other',
              patch: {},
              updatedAt: T0,
            },
          },
          environmentVars: {},
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'request.delete', id: 'r1' }, { now: T1 });
    expect(out.next.synced.collections.requests['r1']).toBeUndefined();
    expect(out.next.synced.collections.tree.children).toEqual([]);
    // Linked overrides untouched - both keys still present.
    expect(Object.keys(out.next.synced.linkedOverrides.requests).sort()).toEqual(
      ['lw1:other', 'lw1:r1'].sort(),
    );
    expect(out.changedIds).toEqual(['r1']);
  });

  it('delete leaves local untouched (no override-cleanup walks local anymore)', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
          requests: { r1: makeRequest('r1') },
          folders: {},
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'request.delete', id: 'r1' });
    expect(out.next.local).toBe(state.local);
  });

  it('delete is a no-op for an unknown id', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'request.delete', id: 'missing' });
    expect(out.next).toBe(state);
  });
});

describe('applyMutation - folder', () => {
  it('creates a folder and adds it to the tree', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const folder = makeFolder('f1');
    const out = applyMutation(state, { kind: 'folder.create', folder }, { now: T1 });
    expect(out.next.synced.collections.folders['f1']).toEqual(folder);
    expect(out.next.synced.collections.tree.children).toEqual([{ kind: 'folder', id: 'f1' }]);
    expect(out.next.synced.meta.updatedAt).toBe(T1);
  });

  it('skips folder.create when the id already exists', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
          requests: {},
          folders: { f1: makeFolder('f1') },
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'folder.create', folder: makeFolder('f1') });
    expect(out.next).toBe(state);
  });

  it('deletes a folder and reparents children', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: {
            id: 'root',
            type: 'root',
            children: [
              { kind: 'folder', id: 'parent' },
              { kind: 'folder', id: 'child' },
            ],
          },
          requests: { r1: makeRequest('r1', { folderId: 'parent' }) },
          folders: {
            parent: makeFolder('parent', null),
            child: makeFolder('child', 'parent'),
          },
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'folder.delete', id: 'parent' }, { now: T1 });
    expect(out.next.synced.collections.folders['parent']).toBeUndefined();
    expect(out.next.synced.collections.folders['child'].parentId).toBeNull();
    expect(out.next.synced.collections.requests['r1'].folderId).toBeNull();
    expect(out.next.synced.collections.tree.children).toEqual([{ kind: 'folder', id: 'child' }]);
  });

  it('folder.delete is a no-op for unknown ids', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'folder.delete', id: 'missing' });
    expect(out.next).toBe(state);
  });

  it('moves a folder to a new parent', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
          requests: {},
          folders: {
            a: makeFolder('a', null),
            b: makeFolder('b', null),
            c: makeFolder('c', 'a'),
          },
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(
      state,
      { kind: 'folder.move', id: 'c', newParentId: 'b' },
      { now: T1 },
    );
    expect(out.next.synced.collections.folders['c'].parentId).toBe('b');
  });

  it('folder.move is a no-op when the folder is missing', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, {
      kind: 'folder.move',
      id: 'missing',
      newParentId: null,
    });
    expect(out.next).toBe(state);
  });

  it('folder.move is a no-op when parent is unchanged', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
          requests: {},
          folders: { a: makeFolder('a', null) },
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'folder.move', id: 'a', newParentId: null });
    expect(out.next).toBe(state);
  });

  it('rejects self-parenting', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
          requests: {},
          folders: { a: makeFolder('a', null) },
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'folder.move', id: 'a', newParentId: 'a' });
    expect(out.next).toBe(state);
  });

  it('rejects cycles', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
          requests: {},
          folders: {
            a: makeFolder('a', null),
            b: makeFolder('b', 'a'),
            c: makeFolder('c', 'b'),
          },
        },
      }),
      local: makeLocal(),
    };
    // Trying to move a under c (which is a's grandchild) would cycle.
    const out = applyMutation(state, { kind: 'folder.move', id: 'a', newParentId: 'c' });
    expect(out.next).toBe(state);
  });
});

describe('applyMutation - environments', () => {
  it('creates a new env and appends it to the priority list', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(
      state,
      {
        kind: 'environment.upsert',
        environment: { name: 'dev', variables: [] },
      },
      { now: T1 },
    );
    expect(out.next.synced.environments.items['dev']).toEqual({ name: 'dev', variables: [] });
    expect(out.next.synced.environments.priorityOrder).toEqual([{ kind: 'local', name: 'dev' }]);
  });

  it('updates an existing env without re-appending to priority list', () => {
    const state = {
      synced: makeSynced({
        environments: {
          items: { dev: { name: 'dev', variables: [] } },
          activeName: 'dev',
          priorityOrder: [{ kind: 'local', name: 'dev' }],
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, {
      kind: 'environment.upsert',
      environment: { name: 'dev', variables: [{ key: 'API_URL', value: 'x', encrypted: false }] },
    });
    expect(out.next.synced.environments.items['dev'].variables).toHaveLength(1);
    expect(out.next.synced.environments.priorityOrder).toEqual([{ kind: 'local', name: 'dev' }]);
  });

  it('upsert with a blank name is a no-op', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, {
      kind: 'environment.upsert',
      environment: { name: '   ', variables: [] },
    });
    expect(out.next).toBe(state);
  });

  it('deletes an env and clears active/priority references', () => {
    const state = {
      synced: makeSynced({
        environments: {
          items: { dev: { name: 'dev', variables: [] }, prod: { name: 'prod', variables: [] } },
          activeName: 'dev',
          priorityOrder: [
            { kind: 'local', name: 'dev' },
            { kind: 'local', name: 'prod' },
          ],
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'environment.delete', name: 'dev' });
    expect(out.next.synced.environments.items['dev']).toBeUndefined();
    expect(out.next.synced.environments.activeName).toBeNull();
    expect(out.next.synced.environments.priorityOrder).toEqual([{ kind: 'local', name: 'prod' }]);
  });

  it('environment.delete is a no-op for unknown names', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'environment.delete', name: 'missing' });
    expect(out.next).toBe(state);
  });

  it('setActive picks an existing env', () => {
    const state = {
      synced: makeSynced({
        environments: {
          items: { dev: { name: 'dev', variables: [] } },
          activeName: null,
          priorityOrder: [{ kind: 'local', name: 'dev' }],
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'environment.setActive', name: 'dev' });
    expect(out.next.synced.environments.activeName).toBe('dev');
  });

  it('setActive ignores unknown env names', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'environment.setActive', name: 'missing' });
    expect(out.next).toBe(state);
  });

  it('setActive is a no-op when value already matches', () => {
    const state = {
      synced: makeSynced({
        environments: {
          items: { dev: { name: 'dev', variables: [] } },
          activeName: 'dev',
          priorityOrder: [{ kind: 'local', name: 'dev' }],
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'environment.setActive', name: 'dev' });
    expect(out.next).toBe(state);
  });

  it('setActive can clear with null', () => {
    const state = {
      synced: makeSynced({
        environments: {
          items: { dev: { name: 'dev', variables: [] } },
          activeName: 'dev',
          priorityOrder: [{ kind: 'local', name: 'dev' }],
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'environment.setActive', name: null });
    expect(out.next.synced.environments.activeName).toBeNull();
  });

  it('setPriority filters to known + dedupes', () => {
    const state = {
      synced: makeSynced({
        environments: {
          items: { dev: { name: 'dev', variables: [] }, prod: { name: 'prod', variables: [] } },
          activeName: null,
          priorityOrder: [
            { kind: 'local', name: 'dev' },
            { kind: 'local', name: 'prod' },
          ],
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, {
      kind: 'environment.setPriority',
      order: [
        { kind: 'local', name: 'prod' },
        { kind: 'local', name: 'dev' },
        { kind: 'local', name: 'dev' },
        { kind: 'local', name: 'unknown' },
      ],
    });
    expect(out.next.synced.environments.priorityOrder).toEqual([
      { kind: 'local', name: 'prod' },
      { kind: 'local', name: 'dev' },
    ]);
  });
});

describe('applyMutation - assertions', () => {
  it('appends a new assertion', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
          requests: { r1: makeRequest('r1') },
          folders: {},
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, {
      kind: 'assertion.upsert',
      requestId: 'r1',
      assertion: { id: 'a1', kind: 'status', op: 'equals', expected: 200 },
    });
    expect(out.next.synced.collections.requests['r1'].assertions).toHaveLength(1);
  });

  it('replaces an existing assertion in place', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
          requests: {
            r1: makeRequest('r1', {
              assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
            }),
          },
          folders: {},
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, {
      kind: 'assertion.upsert',
      requestId: 'r1',
      assertion: { id: 'a1', kind: 'status', op: 'equals', expected: 201 },
    });
    expect(out.next.synced.collections.requests['r1'].assertions[0].expected).toBe(201);
  });

  it('assertion.upsert is a no-op when the request is missing', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, {
      kind: 'assertion.upsert',
      requestId: 'missing',
      assertion: { id: 'a1', kind: 'status', op: 'equals', expected: 200 },
    });
    expect(out.next).toBe(state);
  });

  it('deletes an assertion by id', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
          requests: {
            r1: makeRequest('r1', {
              assertions: [
                { id: 'a1', kind: 'status', op: 'equals', expected: 200 },
                { id: 'a2', kind: 'status', op: 'equals', expected: 201 },
              ],
            }),
          },
          folders: {},
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, {
      kind: 'assertion.delete',
      requestId: 'r1',
      assertionId: 'a1',
    });
    expect(out.next.synced.collections.requests['r1'].assertions).toEqual([
      { id: 'a2', kind: 'status', op: 'equals', expected: 201 },
    ]);
  });

  it('assertion.delete is a no-op for unknown request', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, {
      kind: 'assertion.delete',
      requestId: 'missing',
      assertionId: 'a1',
    });
    expect(out.next).toBe(state);
  });

  it('assertion.delete is a no-op when the assertion id is unknown', () => {
    const state = {
      synced: makeSynced({
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
          requests: { r1: makeRequest('r1') },
          folders: {},
        },
      }),
      local: makeLocal(),
    };
    const out = applyMutation(state, {
      kind: 'assertion.delete',
      requestId: 'r1',
      assertionId: 'missing',
    });
    expect(out.next).toBe(state);
  });
});

describe('applyMutation - mocks', () => {
  const fixtureMock = {
    id: 'm1',
    name: 'Petstore',
    source: { kind: 'manual' as const, endpoints: [] },
    endpoints: [],
    defaultPort: null,
    cors: { enabled: false, origins: [] as string[] },
    createdAt: T0,
    updatedAt: T0,
  };

  it('upserts a new mock server', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'mock.upsert', mock: fixtureMock }, { now: T1 });
    expect(out.next.synced.mockServers['m1']).toBeDefined();
    expect(out.next.synced.meta.updatedAt).toBe(T1);
  });

  it('overwrites an existing mock', () => {
    const state = {
      synced: makeSynced({ mockServers: { m1: { ...fixtureMock, name: 'old' } } }),
      local: makeLocal(),
    };
    const out = applyMutation(state, {
      kind: 'mock.upsert',
      mock: { ...fixtureMock, name: 'new' },
    });
    expect(out.next.synced.mockServers['m1'].name).toBe('new');
  });

  it('delete drops the mock and its runtime entry', () => {
    const state = {
      synced: makeSynced({ mockServers: { m1: fixtureMock } }),
      local: makeLocal({
        mockRuntime: {
          active: {
            m1: {
              port: 4040,
              pid: null,
              startedAt: T0,
              lastError: null,
              requestCount: 0,
            },
          },
        },
      }),
    };
    const out = applyMutation(state, { kind: 'mock.delete', id: 'm1' });
    expect(out.next.synced.mockServers['m1']).toBeUndefined();
    expect(out.next.local.mockRuntime.active['m1']).toBeUndefined();
  });

  it('mock.delete is a no-op for unknown id', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'mock.delete', id: 'missing' });
    expect(out.next).toBe(state);
  });

  it('mock.delete preserves local when no runtime entry', () => {
    const state = {
      synced: makeSynced({ mockServers: { m1: fixtureMock } }),
      local: makeLocal(),
    };
    const out = applyMutation(state, { kind: 'mock.delete', id: 'm1' });
    expect(out.next.local).toBe(state.local);
  });
});

describe('applyMutation - plans', () => {
  const plan = {
    id: 'p1',
    name: 'Smoke',
    steps: [],
    envPriorityOrder: [],
    createdAt: T0,
    updatedAt: T0,
  };

  it('upserts a new plan', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'plan.upsert', plan }, { now: T1 });
    expect(out.next.local.executionPlans['p1']).toBeDefined();
    expect(out.next.local.executionPlans['p1'].updatedAt).toBe(T1);
    // synced is unchanged for plan operations
    expect(out.next.synced).toBe(state.synced);
  });

  it('plan.upsert preserves createdAt on update', () => {
    const state = {
      synced: makeSynced(),
      local: makeLocal({ executionPlans: { p1: { ...plan, createdAt: T0 } } }),
    };
    const out = applyMutation(
      state,
      { kind: 'plan.upsert', plan: { ...plan, name: 'Renamed', createdAt: 'should-be-ignored' } },
      { now: T1 },
    );
    expect(out.next.local.executionPlans['p1'].createdAt).toBe(T0);
    expect(out.next.local.executionPlans['p1'].name).toBe('Renamed');
  });

  it('deletes a plan and drops its history rows', () => {
    const state = {
      synced: makeSynced(),
      local: makeLocal({
        executionPlans: { p1: plan, p2: { ...plan, id: 'p2' } },
        history: {
          requestRuns: [],
          planRuns: [
            {
              id: 'pr1',
              planId: 'p1',
              startedAt: T0,
              durationMs: 1,
              withAssertions: false,
              steps: [],
            },
            {
              id: 'pr2',
              planId: 'p2',
              startedAt: T0,
              durationMs: 1,
              withAssertions: false,
              steps: [],
            },
          ],
        },
      }),
    };
    const out = applyMutation(state, { kind: 'plan.delete', id: 'p1' });
    expect(out.next.local.executionPlans['p1']).toBeUndefined();
    expect(out.next.local.history.planRuns).toEqual([
      { id: 'pr2', planId: 'p2', startedAt: T0, durationMs: 1, withAssertions: false, steps: [] },
    ]);
  });

  it('plan.delete is a no-op for unknown id', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const out = applyMutation(state, { kind: 'plan.delete', id: 'missing' });
    expect(out.next).toBe(state);
  });
});

describe('applyMutation - defaults', () => {
  it('uses the current time when `now` is not supplied', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    const before = new Date().toISOString();
    const out = applyMutation(state, { kind: 'request.create', request: makeRequest('r1') });
    const after = new Date().toISOString();
    const stamped = out.next.synced.meta.updatedAt;
    expect(stamped >= before).toBe(true);
    expect(stamped <= after).toBe(true);
  });
});
