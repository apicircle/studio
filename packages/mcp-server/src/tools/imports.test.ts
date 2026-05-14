import { describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';
import {
  importCurlTool,
  importHarTool,
  importInsomniaTool,
  importOpenApiTool,
  importPostmanTool,
} from './imports';

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

function makeCtx() {
  return {
    workspace: new InMemoryWorkspaceProvider(freshState()),
    mock: new InProcessMockController(),
  };
}

describe('import tools', () => {
  it('import.curl creates a request from a cURL command', async () => {
    const ctx = makeCtx();
    const result = (await importCurlTool.handler(
      {
        curl: 'curl -X POST https://api.example.test/users -H "Content-Type: application/json" -d \'{"x":1}\'',
      },
      ctx,
    )) as { id: string };
    const state = await ctx.workspace.read();
    expect(state.synced.collections.requests[result.id].method).toBe('POST');
    expect(state.synced.collections.requests[result.id].url).toBe('https://api.example.test/users');
  });

  it('import.openapi creates one request per operation', async () => {
    const ctx = makeCtx();
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0' },
      paths: {
        '/a': { get: { responses: { '200': { description: 'ok' } } } },
        '/b': { post: { responses: { '200': { description: 'ok' } } } },
      },
    });
    const result = (await importOpenApiTool.handler({ spec, format: 'json' as const }, ctx)) as {
      createdIds: string[];
    };
    expect(result.createdIds.length).toBe(2);
  });

  it('import.postman handles a basic collection', async () => {
    const ctx = makeCtx();
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [{ name: 'a', request: { method: 'GET', url: 'https://api.x/y' } }],
    });
    const result = (await importPostmanTool.handler({ collection }, ctx)) as {
      createdIds: string[];
    };
    expect(result.createdIds.length).toBe(1);
  });

  it('import.insomnia parses request resources', async () => {
    const ctx = makeCtx();
    const exportPayload = JSON.stringify({
      _type: 'export',
      resources: [{ _type: 'request', method: 'GET', url: 'https://api.x/z', name: 'List' }],
    });
    const result = (await importInsomniaTool.handler({ export: exportPayload }, ctx)) as {
      createdIds: string[];
    };
    expect(result.createdIds.length).toBe(1);
  });

  it('import.har creates one request per HAR entry', async () => {
    const ctx = makeCtx();
    const har = JSON.stringify({
      log: {
        entries: [
          {
            request: {
              method: 'GET',
              url: 'https://api.x/a',
              headers: [{ name: 'X-K', value: 'v' }],
              queryString: [{ name: 'q', value: '1' }],
            },
          },
          {
            request: {
              method: 'POST',
              url: 'https://api.x/b',
              postData: { text: '{"a":1}', mimeType: 'application/json' },
            },
          },
        ],
      },
    });
    const result = (await importHarTool.handler({ har }, ctx)) as { createdIds: string[] };
    expect(result.createdIds.length).toBe(2);
    const state = await ctx.workspace.read();
    const reqs = Object.values(state.synced.collections.requests);
    expect(reqs.find((r) => r.method === 'POST')?.body.content).toBe('{"a":1}');
  });

  it('import.har returns warnings on entries missing method/url', async () => {
    const ctx = makeCtx();
    const har = JSON.stringify({
      log: { entries: [{ request: {} }] },
    });
    const result = (await importHarTool.handler({ har }, ctx)) as {
      createdIds: string[];
      warnings: string[];
    };
    expect(result.createdIds.length).toBe(0);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('import.har returns a parse error for malformed JSON', async () => {
    const ctx = makeCtx();
    const result = (await importHarTool.handler({ har: '{not json' }, ctx)) as {
      createdIds: string[];
      warnings: string[];
    };
    expect(result.createdIds).toEqual([]);
    expect(result.warnings[0]).toMatch(/HAR parse error/);
  });
});
