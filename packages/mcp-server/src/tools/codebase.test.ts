import { describe, expect, it } from 'vitest';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';
import { codebaseExtractCollectionTool } from './codebase';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';

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
      meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
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

function makeCtx() {
  return {
    workspace: new InMemoryWorkspaceProvider(freshState()),
    mock: new InProcessMockController(),
  };
}

describe('codebase.extract_collection', () => {
  it('detects Express handlers', async () => {
    const source = `
      const router = express.Router();
      router.get('/users', listUsers);
      app.post('/users/:id', createUser);
    `;
    const out = (await codebaseExtractCollectionTool.handler(
      { source, frameworks: [] },
      makeCtx(),
    )) as { count: number; candidates: Array<{ method: string; path: string; framework: string }> };
    expect(out.count).toBe(2);
    expect(out.candidates[0]).toMatchObject({
      method: 'GET',
      path: '/users',
      framework: 'express',
    });
    expect(out.candidates[1]).toMatchObject({ method: 'POST', path: '/users/:id' });
  });

  it('detects FastAPI decorators', async () => {
    const source = `
      @app.get("/items/{id}")
      async def read_item(id: int):
          return {"id": id}
    `;
    const out = (await codebaseExtractCollectionTool.handler(
      { source, frameworks: [] },
      makeCtx(),
    )) as { candidates: Array<{ framework: string }> };
    expect(out.candidates[0]?.framework).toBe('fastapi');
  });

  it('detects NestJS decorators', async () => {
    const source = `
      @Controller('users')
      class UsersController {
        @Get('/list')
        list() {}
      }
    `;
    const out = (await codebaseExtractCollectionTool.handler(
      { source, frameworks: ['nest'] },
      makeCtx(),
    )) as { candidates: Array<{ framework: string; path: string }> };
    expect(out.candidates[0]?.framework).toBe('nest');
    expect(out.candidates[0]?.path).toBe('/list');
  });

  it('detects Spring @GetMapping', async () => {
    const source = `
      @GetMapping("/api/health")
      public ResponseEntity<String> health() { return ok(); }
    `;
    const out = (await codebaseExtractCollectionTool.handler(
      { source, frameworks: ['spring'] },
      makeCtx(),
    )) as { candidates: Array<{ method: string; framework: string }> };
    expect(out.candidates[0]).toMatchObject({ method: 'GET', framework: 'spring' });
  });

  it('returns an empty list for source with no routes', async () => {
    const out = (await codebaseExtractCollectionTool.handler(
      { source: 'console.log("hi");', frameworks: [] },
      makeCtx(),
    )) as { count: number };
    expect(out.count).toBe(0);
  });
});
