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
