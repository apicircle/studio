import { beforeEach, describe, expect, it } from 'vitest';
import type { MockServer, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { SingleWorkspaceAdapter } from '../providers/Workspaces';
import { InProcessMockController } from '../providers/InProcessMockController';
import {
  mockAddEndpointTool,
  mockCreateFromOpenApiTool,
  mockPromoteEndpointTool,
  mockRefreshTool,
  mockUpdateEndpointTool,
} from './mocks';

const T0 = '2026-04-27T00:00:00.000Z';

const openapi = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'P', version: '1' },
  paths: { '/pets': { get: { responses: { '200': { description: 'ok' } } } } },
});

function linkedMock(id: string): MockServer {
  return {
    id,
    name: 'Linked',
    source: { kind: 'openapi-asset', assetId: 'a1', format: 'json', mode: 'linked' },
    endpoints: [
      {
        id: 'e1',
        name: 'GET /pets',
        method: 'GET',
        pathPattern: '/pets',
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
}

function freshState(mocks: Record<string, MockServer> = {}): {
  synced: WorkspaceSynced;
  local: WorkspaceLocal;
} {
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
      mockServers: mocks,
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

function setupCtx(state: { synced: WorkspaceSynced; local: WorkspaceLocal }) {
  const workspace = new InMemoryWorkspaceProvider(state);
  ctx = {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new InProcessMockController(),
  };
}

beforeEach(() => {
  setupCtx(freshState());
});

describe('mock.refresh', () => {
  it('re-derives endpoints for an inline-spec mock', async () => {
    const created = (await mockCreateFromOpenApiTool.handler(
      { name: 'API', spec: openapi, format: 'json' },
      ctx,
    )) as { id: string };
    const out = (await mockRefreshTool.handler({ id: created.id }, ctx)) as {
      ok: boolean;
      endpointCount: number;
    };
    expect(out.ok).toBe(true);
    expect(out.endpointCount).toBe(1);
  });

  it('refuses to refresh an asset-backed mock (no attachment bytes over MCP)', async () => {
    setupCtx(freshState({ m1: linkedMock('m1') }));
    const out = (await mockRefreshTool.handler({ id: 'm1' }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/backed by a spec asset/);
  });

  it('returns not found for an unknown mock', async () => {
    const out = (await mockRefreshTool.handler({ id: 'nope' }, ctx)) as {
      ok: boolean;
      error: string;
    };
    expect(out.ok).toBe(false);
    expect(out.error).toBe('mock not found');
  });
});

describe('linked mocks are read-only over MCP', () => {
  beforeEach(() => {
    setupCtx(freshState({ m1: linkedMock('m1') }));
  });

  it('rejects mock.add_endpoint', async () => {
    const out = (await mockAddEndpointTool.handler(
      { mockId: 'm1', method: 'POST', pathPattern: '/x' },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/read-only/);
  });

  it('rejects mock.update_endpoint', async () => {
    const out = (await mockUpdateEndpointTool.handler(
      { mockId: 'm1', endpointId: 'e1', pathPattern: '/y' },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/read-only/);
  });
});

describe('mock.promote_endpoint', () => {
  beforeEach(() => {
    setupCtx(freshState({ m1: linkedMock('m1') }));
  });

  it('promotes a mock endpoint into a collection request (allowed on linked mocks)', async () => {
    const out = (await mockPromoteEndpointTool.handler(
      { mockId: 'm1', endpointId: 'e1' },
      ctx,
    )) as { ok: boolean; requestId: string };
    expect(out.ok).toBe(true);
    const state = await ctx.workspace.read();
    const req = state.synced.collections.requests[out.requestId];
    expect(req.method).toBe('GET');
    expect(req.url).toBe('/pets');
  });

  it('returns not found for a missing endpoint', async () => {
    const out = (await mockPromoteEndpointTool.handler(
      { mockId: 'm1', endpointId: 'nope' },
      ctx,
    )) as { ok: boolean; error: string };
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/not found/);
  });
});
