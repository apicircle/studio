import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';
import {
  mockAddEndpointTool,
  mockCreateManualTool,
  mockDeleteEndpointTool,
  mockListEndpointsTool,
  mockUpdateEndpointTool,
} from './mocks';

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

describe('mock manual + endpoint MCP tools', () => {
  it('mock.create_manual creates an empty manual mock', async () => {
    const out = (await mockCreateManualTool.handler(
      { name: 'My API', defaultPort: 4040 },
      ctx,
    )) as { id: string };
    expect(out.id).toBeTruthy();
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[out.id];
    expect(mock.name).toBe('My API');
    expect(mock.endpoints).toEqual([]);
    expect(mock.defaultPort).toBe(4040);
    expect(mock.cors.enabled).toBe(true);
    expect(mock.source.kind).toBe('manual');
  });

  it('mock.add_endpoint appends an endpoint with the specified default response', async () => {
    const created = (await mockCreateManualTool.handler({ name: 'API' }, ctx)) as { id: string };
    const added = (await mockAddEndpointTool.handler(
      {
        mockId: created.id,
        method: 'POST' as const,
        pathPattern: '/items',
        name: 'Create item',
        response: { status: 201, jsonBody: '{"created":true}', contentType: 'application/json' },
      },
      ctx,
    )) as { ok: true; endpointId: string };
    expect(added.ok).toBe(true);
    const state = await ctx.workspace.read();
    const endpoint = state.synced.mockServers[created.id].endpoints[0];
    expect(endpoint.id).toBe(added.endpointId);
    expect(endpoint.method).toBe('POST');
    expect(endpoint.pathPattern).toBe('/items');
    expect(endpoint.defaultResponse.status).toBe(201);
    if (endpoint.defaultResponse.body.type !== 'json') throw new Error('expected json body');
    expect(endpoint.defaultResponse.body.content).toBe('{"created":true}');
  });

  it('mock.add_endpoint mirrors endpoints into manual source', async () => {
    const created = (await mockCreateManualTool.handler({ name: 'API' }, ctx)) as { id: string };
    await mockAddEndpointTool.handler(
      { mockId: created.id, method: 'GET' as const, pathPattern: '/x' },
      ctx,
    );
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[created.id];
    if (mock.source.kind !== 'manual') throw new Error('expected manual source');
    expect(mock.source.endpoints).toHaveLength(1);
    expect(mock.endpoints).toHaveLength(1);
  });

  it('mock.update_endpoint patches method + path + status', async () => {
    const created = (await mockCreateManualTool.handler({ name: 'API' }, ctx)) as { id: string };
    const added = (await mockAddEndpointTool.handler(
      { mockId: created.id, method: 'GET' as const, pathPattern: '/old' },
      ctx,
    )) as { ok: true; endpointId: string };
    await mockUpdateEndpointTool.handler(
      {
        mockId: created.id,
        endpointId: added.endpointId,
        method: 'PUT' as const,
        pathPattern: '/new',
        response: { status: 202 },
      },
      ctx,
    );
    const state = await ctx.workspace.read();
    const endpoint = state.synced.mockServers[created.id].endpoints[0];
    expect(endpoint.method).toBe('PUT');
    expect(endpoint.pathPattern).toBe('/new');
    expect(endpoint.defaultResponse.status).toBe(202);
  });

  it('mock.delete_endpoint removes the endpoint', async () => {
    const created = (await mockCreateManualTool.handler({ name: 'API' }, ctx)) as { id: string };
    const added = (await mockAddEndpointTool.handler(
      { mockId: created.id, method: 'GET' as const, pathPattern: '/x' },
      ctx,
    )) as { ok: true; endpointId: string };
    const out = await mockDeleteEndpointTool.handler(
      { mockId: created.id, endpointId: added.endpointId },
      ctx,
    );
    expect(out).toMatchObject({ ok: true });
    const state = await ctx.workspace.read();
    expect(state.synced.mockServers[created.id].endpoints).toHaveLength(0);
  });

  it('mock.list_endpoints returns summaries', async () => {
    const created = (await mockCreateManualTool.handler({ name: 'API' }, ctx)) as { id: string };
    await mockAddEndpointTool.handler(
      { mockId: created.id, method: 'GET' as const, pathPattern: '/a' },
      ctx,
    );
    await mockAddEndpointTool.handler(
      { mockId: created.id, method: 'POST' as const, pathPattern: '/b', name: 'Create B' },
      ctx,
    );
    const list = (await mockListEndpointsTool.handler({ mockId: created.id }, ctx)) as {
      ok: true;
      count: number;
      endpoints: Array<{ method: string; pathPattern: string; name: string }>;
    };
    expect(list.ok).toBe(true);
    expect(list.count).toBe(2);
    const paths = list.endpoints.map((e) => `${e.method} ${e.pathPattern}`).sort();
    expect(paths).toEqual(['GET /a', 'POST /b']);
  });

  it('returns ok:false with not found when targeting an unknown mock', async () => {
    const out = await mockListEndpointsTool.handler({ mockId: 'no-such' }, ctx);
    expect(out).toMatchObject({ ok: false, error: 'mock not found' });
  });
});
