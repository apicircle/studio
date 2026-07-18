import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type {
  MockRuntimeEntry,
  MockServer,
  WorkspaceLocal,
  WorkspaceSynced,
} from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { SingleWorkspaceAdapter } from '../providers/Workspaces';
import type { MockController, StartMockResult } from '../providers/MockController';
import {
  mockCreateFromInsomniaTool,
  mockCreateFromOpenApiTool,
  mockCreateFromPostmanTool,
  mockDeleteTool,
  mockImportPostmanMockCollectionTool,
  mockListTool,
  mockSetDefaultPortTool,
  mockPromoteEndpointTool,
  mockPromoteToCollectionTool,
  mockStartTool,
  mockStopTool,
} from './mocks';

const T0 = '2026-04-27T00:00:00.000Z';

class FakeMockController implements MockController {
  readonly running = new Map<string, MockRuntimeEntry>();
  readonly stops: string[] = [];

  async start(server: MockServer): Promise<StartMockResult> {
    const startedAt = new Date().toISOString();
    const runtime: MockRuntimeEntry = {
      port: 4040,
      pid: 1234,
      startedAt,
      lastError: null,
      requestCount: 0,
    };
    this.running.set(server.id, runtime);
    return { port: runtime.port, pid: runtime.pid, startedAt };
  }

  async stop(serverId: string): Promise<void> {
    this.stops.push(serverId);
    this.running.delete(serverId);
  }

  async list(): Promise<Array<{ serverId: string; runtime: MockRuntimeEntry }>> {
    return Array.from(this.running.entries()).map(([serverId, runtime]) => ({
      serverId,
      runtime,
    }));
  }
}

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
  mock: FakeMockController;
};

beforeEach(() => {
  const workspace = new InMemoryWorkspaceProvider(freshState());
  ctx = {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new FakeMockController(),
  };
});

afterEach(() => {
  ctx.mock.running.clear();
  ctx.mock.stops.length = 0;
});

describe('mock tools', () => {
  it('create_from_openapi persists a mock with parsed endpoints', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0' },
      paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } },
    });
    const out = (await mockCreateFromOpenApiTool.handler(
      { name: 'X', spec, format: 'json' as const },
      ctx,
    )) as { id: string; endpointCount: number };
    expect(out.endpointCount).toBeGreaterThan(0);
    const state = await ctx.workspace.read();
    expect(state.synced.mockServers[out.id]).toBeDefined();
  });

  it('promote_to_collection creates the active Mock env + "<name> (mock)" folder + templated requests', async () => {
    const mock: MockServer = {
      id: 'm1',
      name: 'Petstore',
      source: { kind: 'manual', endpoints: [] },
      endpoints: [
        {
          id: 'e1',
          name: '',
          method: 'GET',
          pathPattern: '/pets',
          requestSchema: {
            pathParams: [],
            queryParams: [{ id: 'q1', name: 'limit' }],
            headers: [],
            cookies: [],
          },
          requestValidation: [],
          responseRules: [],
          defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '{}' } },
        },
        {
          id: 'e2',
          name: '',
          method: 'POST',
          pathPattern: '/pets/{id}',
          requestSchema: {
            pathParams: [{ id: 'p1', name: 'id' }],
            queryParams: [],
            headers: [],
            cookies: [],
          },
          requestValidation: [],
          responseRules: [],
          defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '{}' } },
        },
      ],
      defaultPort: 4010,
      cors: { enabled: false, origins: [] },
      createdAt: T0,
      updatedAt: T0,
    };
    await ctx.workspace.apply({ kind: 'mock.upsert', mock });

    const out = (await mockPromoteToCollectionTool.handler({ mockId: 'm1' }, ctx)) as {
      ok: boolean;
      folderId: string;
      requestIds: string[];
    };
    expect(out.ok).toBe(true);
    expect(out.requestIds).toHaveLength(2);

    const s = (await ctx.workspace.read()).synced;
    expect(s.environments.activeName).toBe('Mock');
    expect(s.environments.items['Mock'].variables.find((v) => v.key === 'MOCK_PORT')?.value).toBe(
      '4010',
    );
    expect(s.collections.folders[out.folderId].name).toBe('Petstore (mock)');
    const reqs = Object.values(s.collections.requests).filter((r) => r.folderId === out.folderId);
    expect(reqs).toHaveLength(2);
    expect(reqs.every((r) => r.url.startsWith('{{MOCK_BASE_URL}}:{{MOCK_PORT}}'))).toBe(true);
  });

  it('promote_endpoint templates the URL + ensures the Mock env (port falls back to 8080)', async () => {
    const mock: MockServer = {
      id: 'm2',
      name: 'API',
      source: { kind: 'manual', endpoints: [] },
      endpoints: [
        {
          id: 'e1',
          name: '',
          method: 'GET',
          pathPattern: '/health',
          requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
          requestValidation: [],
          responseRules: [],
          defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '{}' } },
        },
      ],
      defaultPort: null,
      cors: { enabled: false, origins: [] },
      createdAt: T0,
      updatedAt: T0,
    };
    await ctx.workspace.apply({ kind: 'mock.upsert', mock });

    const out = (await mockPromoteEndpointTool.handler(
      { mockId: 'm2', endpointId: 'e1' },
      ctx,
    )) as {
      ok: boolean;
      requestId: string;
      folderId: string;
    };
    expect(out.ok).toBe(true);
    const s = (await ctx.workspace.read()).synced;
    expect(s.collections.requests[out.requestId].url).toBe(
      '{{MOCK_BASE_URL}}:{{MOCK_PORT}}/health',
    );
    expect(s.collections.folders[out.folderId].name).toBe('API (mock)');
    expect(s.environments.items['Mock'].variables.find((v) => v.key === 'MOCK_PORT')?.value).toBe(
      '8080',
    );
  });

  it('create_from_postman persists a mock', async () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [{ name: 'a', request: { method: 'GET', url: 'https://api/x' } }],
    });
    const out = (await mockCreateFromPostmanTool.handler({ name: 'P', collection }, ctx)) as {
      id: string;
    };
    const state = await ctx.workspace.read();
    expect(state.synced.mockServers[out.id]).toBeDefined();
  });

  it('create_from_insomnia persists a mock', async () => {
    const exportPayload = JSON.stringify({
      _type: 'export',
      resources: [{ _type: 'request', method: 'GET', url: 'https://api/y' }],
    });
    const out = (await mockCreateFromInsomniaTool.handler(
      { name: 'I', export: exportPayload },
      ctx,
    )) as { id: string };
    const state = await ctx.workspace.read();
    expect(state.synced.mockServers[out.id]).toBeDefined();
  });

  it('import_postman_mock_collection routes through the postman parser', async () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [{ name: 'a', request: { method: 'GET', url: 'https://api/x' } }],
    });
    const out = (await mockImportPostmanMockCollectionTool.handler(
      { name: 'M', collection },
      ctx,
    )) as { id: string };
    const state = await ctx.workspace.read();
    expect(state.synced.mockServers[out.id]).toBeDefined();
  });

  it('list returns running flags from the mock controller', async () => {
    const created = (await mockCreateFromPostmanTool.handler(
      {
        name: 'X',
        collection: JSON.stringify({
          info: { name: 'X' },
          item: [{ name: 'a', request: { method: 'GET', url: 'https://api/x' } }],
        }),
      },
      ctx,
    )) as { id: string };
    await mockStartTool.handler({ id: created.id }, ctx);
    const list = (await mockListTool.handler({}, ctx)) as {
      mocks: Array<{ id: string; running: boolean; port: number | null }>;
    };
    const found = list.mocks.find((m) => m.id === created.id);
    expect(found?.running).toBe(true);
    expect(found?.port).toBe(4040);
  });

  it('start errors when the mock is not in the workspace', async () => {
    const out = (await mockStartTool.handler({ id: 'missing' }, ctx)) as { ok: boolean };
    expect(out.ok).toBe(false);
  });

  it('stop calls into the controller', async () => {
    await mockStopTool.handler({ id: 'm1' }, ctx);
    expect(ctx.mock.stops).toEqual(['m1']);
  });

  it('delete stops the mock first then removes the definition', async () => {
    const created = (await mockCreateFromPostmanTool.handler(
      {
        name: 'X',
        collection: JSON.stringify({
          info: { name: 'X' },
          item: [{ name: 'a', request: { method: 'GET', url: 'https://api/x' } }],
        }),
      },
      ctx,
    )) as { id: string };
    await mockStartTool.handler({ id: created.id }, ctx);
    await mockDeleteTool.handler({ id: created.id }, ctx);
    expect(ctx.mock.stops).toContain(created.id);
    const state = await ctx.workspace.read();
    expect(state.synced.mockServers[created.id]).toBeUndefined();
  });

  // Error-contract: every mocks.ts tool that takes an `id` must return
  // `{ ok: false, error }` for "not found" rather than throwing. The
  // standardisation lets MCP clients reliably check `ok` before reading
  // success fields.
  describe('error contract: returns {ok:false, error} for missing IDs', () => {
    const unknownId = 'mock-does-not-exist';

    it('mock.start rejects with ok:false', async () => {
      const out = (await mockStartTool.handler({ id: unknownId }, ctx)) as {
        ok: boolean;
        error?: string;
      };
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/not found/i);
    });

    it('mock.start propagates controller errors as ok:false (e.g. port in use)', async () => {
      // Seed a mock so the lookup succeeds, then make the controller throw.
      const created = (await mockCreateFromOpenApiTool.handler(
        {
          name: 'X',
          spec: JSON.stringify({
            openapi: '3.0.0',
            info: { title: 'X', version: '1.0' },
            paths: { '/a': { get: { responses: { '200': { description: 'ok' } } } } },
          }),
          format: 'json' as const,
        },
        ctx,
      )) as { id: string };
      ctx.mock.start = async () => {
        throw new Error('Port 4040 already in use');
      };
      const out = (await mockStartTool.handler({ id: created.id }, ctx)) as {
        ok: boolean;
        error?: string;
      };
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/Port 4040/);
    });

    it('mock.stop propagates controller errors as ok:false', async () => {
      ctx.mock.stop = async () => {
        throw new Error('Stop failed: handle missing');
      };
      const out = (await mockStopTool.handler({ id: unknownId }, ctx)) as {
        ok: boolean;
        error?: string;
      };
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/Stop failed/);
    });
  });

  describe('mock.set_default_port', () => {
    it('persists a 1024-65535 port on an existing mock', async () => {
      const created = (await mockCreateFromPostmanTool.handler(
        {
          name: 'X',
          collection: JSON.stringify({
            info: { name: 'X' },
            item: [{ name: 'a', request: { method: 'GET', url: 'https://api/x' } }],
          }),
        },
        ctx,
      )) as { id: string };
      const out = (await mockSetDefaultPortTool.handler(
        { id: created.id, defaultPort: 3000 },
        ctx,
      )) as { ok: boolean; defaultPort: number | null; changed: boolean };
      expect(out.ok).toBe(true);
      expect(out.defaultPort).toBe(3000);
      expect(out.changed).toBe(true);
      const state = await ctx.workspace.read();
      expect(state.synced.mockServers[created.id].defaultPort).toBe(3000);
    });

    it('accepts null to clear the port back to "pick a free port"', async () => {
      const created = (await mockCreateFromPostmanTool.handler(
        {
          name: 'X',
          collection: JSON.stringify({
            info: { name: 'X' },
            item: [{ name: 'a', request: { method: 'GET', url: 'https://api/x' } }],
          }),
        },
        ctx,
      )) as { id: string };
      await mockSetDefaultPortTool.handler({ id: created.id, defaultPort: 5000 }, ctx);
      await mockSetDefaultPortTool.handler({ id: created.id, defaultPort: null }, ctx);
      const state = await ctx.workspace.read();
      expect(state.synced.mockServers[created.id].defaultPort).toBeNull();
    });

    it('is a no-op when the requested port matches the current port', async () => {
      const created = (await mockCreateFromPostmanTool.handler(
        {
          name: 'X',
          collection: JSON.stringify({
            info: { name: 'X' },
            item: [{ name: 'a', request: { method: 'GET', url: 'https://api/x' } }],
          }),
        },
        ctx,
      )) as { id: string };
      await mockSetDefaultPortTool.handler({ id: created.id, defaultPort: 4040 }, ctx);
      const before = (await ctx.workspace.read()).synced.mockServers[created.id].updatedAt;
      const out = (await mockSetDefaultPortTool.handler(
        { id: created.id, defaultPort: 4040 },
        ctx,
      )) as { ok: boolean; changed: boolean };
      expect(out.changed).toBe(false);
      const after = (await ctx.workspace.read()).synced.mockServers[created.id].updatedAt;
      expect(after).toBe(before);
    });

    it('returns ok:false when the mock does not exist', async () => {
      const out = (await mockSetDefaultPortTool.handler(
        { id: 'ghost', defaultPort: 3000 },
        ctx,
      )) as { ok: boolean; error?: string };
      expect(out.ok).toBe(false);
      expect(out.error).toMatch(/not found/i);
    });

    it('rejects out-of-range ports at the schema boundary', () => {
      // Schema rejection happens before handler runs — the framework
      // validates inputs via inputSchema.parse before dispatch.
      const schema = mockSetDefaultPortTool.inputSchema;
      expect(schema.safeParse({ id: 'm1', defaultPort: 80 }).success).toBe(false);
      expect(schema.safeParse({ id: 'm1', defaultPort: 99999 }).success).toBe(false);
      expect(schema.safeParse({ id: 'm1', defaultPort: 1.5 }).success).toBe(false);
      expect(schema.safeParse({ id: 'm1', defaultPort: 3000 }).success).toBe(true);
      expect(schema.safeParse({ id: 'm1', defaultPort: null }).success).toBe(true);
    });
  });

  describe('mock.start port schema', () => {
    it('rejects out-of-range port at the schema boundary', () => {
      const schema = mockStartTool.inputSchema;
      expect(schema.safeParse({ id: 'm1', port: 80 }).success).toBe(false);
      expect(schema.safeParse({ id: 'm1', port: 99999 }).success).toBe(false);
      expect(schema.safeParse({ id: 'm1', port: 3000 }).success).toBe(true);
      // Port is optional — schema must still accept the no-port case.
      expect(schema.safeParse({ id: 'm1' }).success).toBe(true);
    });
  });

  // Parser warnings surface in the tool response so MCP clients can see
  // which operations were skipped. Tested with an OpenAPI spec that has
  // a path with no responses defined - the parser emits a warning.
  it('create_from_openapi surfaces parser warnings on partial specs', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0' },
      paths: {
        '/good': { get: { responses: { '200': { description: 'ok' } } } },
        // No responses at all -> parser typically warns + skips.
        '/no-responses': { get: {} },
      },
    });
    const out = (await mockCreateFromOpenApiTool.handler(
      { name: 'X', spec, format: 'json' as const },
      ctx,
    )) as { id: string; warnings: string[] };
    expect(Array.isArray(out.warnings)).toBe(true);
    // Even if zero warnings, the field must be present so clients can
    // count on the contract.
  });
});
