import { describe, expect, it } from 'vitest';
import type {
  MockEndpoint,
  MockRequestSchema,
  MockServer,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { makeDefaultRequestSchema } from '@apicircle/shared';
import { applyMutation } from './applyMutation';
import type { WorkspacePatch } from './patches';
import { buildMockPromotion } from './mockPromotion';

const T0 = '2026-04-27T00:00:00.000Z';

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

function makeLocal(): WorkspaceLocal {
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
  };
}

function makeEndpoint(
  id: string,
  method: MockEndpoint['method'],
  path: string,
  schema: Partial<MockRequestSchema> = {},
): MockEndpoint {
  return {
    id,
    name: '',
    method,
    pathPattern: path,
    requestSchema: { ...makeDefaultRequestSchema(), ...schema },
    requestValidation: [],
    responseRules: [],
    defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '{}' } },
  };
}

function makeMock(overrides: Partial<MockServer> = {}): MockServer {
  return {
    id: 'm1',
    name: 'Petstore',
    source: { kind: 'manual', endpoints: [] },
    endpoints: [],
    defaultPort: null,
    cors: { enabled: false, origins: [] },
    createdAt: T0,
    updatedAt: T0,
    ...overrides,
  };
}

/** Apply the built patch sequence and return the resulting synced doc. */
function applyAll(synced: WorkspaceSynced, patches: WorkspacePatch[]): WorkspaceSynced {
  let state = { synced, local: makeLocal() };
  for (const p of patches) state = applyMutation(state, p, { now: T0 }).next;
  return state.synced;
}

describe('buildMockPromotion', () => {
  it('ensures an active "Mock" env, a "<name> (mock)" folder, and a templated request per endpoint', () => {
    const ep = makeEndpoint('e1', 'POST', '/pets/{id}', {
      pathParams: [{ id: 'p1', name: 'id' }],
      queryParams: [{ id: 'q1', name: 'limit' }],
      headers: [{ id: 'h1', name: 'X-Key' }],
    });
    const mock = makeMock({ endpoints: [ep] });
    const synced0 = makeSynced({ mockServers: { m1: mock } });

    const { patches, folderId, requestIds, envName } = buildMockPromotion(
      synced0,
      mock,
      mock.endpoints,
      { now: T0 },
    );
    expect(envName).toBe('Mock');
    const synced = applyAll(synced0, patches);

    // Env: created, active, both vars (MOCK_PORT falls back to 8080).
    expect(synced.environments.activeName).toBe('Mock');
    const env = synced.environments.items['Mock'];
    expect(env.variables.find((v) => v.key === 'MOCK_BASE_URL')?.value).toBe('http://localhost');
    expect(env.variables.find((v) => v.key === 'MOCK_PORT')?.value).toBe('8080');

    // Folder + request.
    expect(synced.collections.folders[folderId].name).toBe('Petstore (mock)');
    const req = synced.collections.requests[requestIds[0]];
    expect(req.method).toBe('POST');
    expect(req.url).toBe('{{MOCK_BASE_URL}}:{{MOCK_PORT}}/pets/{id}');
    expect(req.folderId).toBe(folderId);
    expect(req.query.some((q) => q.key === 'limit' && !q.enabled)).toBe(true);
    expect(req.headers.some((h) => h.key === 'X-Key')).toBe(true);
    expect(req.pathParams).toHaveProperty('id');
  });

  it('prefills MOCK_PORT from the mock port and preserves an edited existing env value', () => {
    const mock = makeMock({ defaultPort: 4010, endpoints: [makeEndpoint('e1', 'GET', '/pets')] });
    const synced0 = makeSynced({
      mockServers: { m1: mock },
      environments: {
        items: {
          Mock: {
            name: 'Mock',
            variables: [{ key: 'MOCK_BASE_URL', value: 'http://edited', encrypted: false }],
          },
        },
        activeName: null,
        priorityOrder: [],
      },
    });
    const { patches } = buildMockPromotion(synced0, mock, mock.endpoints, { now: T0 });
    const env = applyAll(synced0, patches).environments.items['Mock'];
    expect(env.variables.find((v) => v.key === 'MOCK_BASE_URL')?.value).toBe('http://edited');
    expect(env.variables.find((v) => v.key === 'MOCK_PORT')?.value).toBe('4010');
  });

  it('reuses an existing "<name> (mock)" folder instead of creating a duplicate', () => {
    const mock = makeMock({ endpoints: [makeEndpoint('e1', 'GET', '/pets')] });
    const synced0 = makeSynced({
      mockServers: { m1: mock },
      collections: {
        tree: { id: 'root', type: 'root', children: [{ kind: 'folder', id: 'f1' }] },
        requests: {},
        folders: { f1: { id: 'f1', name: 'Petstore (mock)', parentId: null } },
      },
    });
    const { patches, folderId } = buildMockPromotion(synced0, mock, mock.endpoints, { now: T0 });
    expect(folderId).toBe('f1');
    expect(patches.some((p) => p.kind === 'folder.create')).toBe(false);
  });
});
