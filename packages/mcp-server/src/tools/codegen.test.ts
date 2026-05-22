import { describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { InMemoryWorkspaceProvider } from '../providers/InMemoryWorkspaceProvider';
import { SingleWorkspaceAdapter } from '../providers/Workspaces';
import { InProcessMockController } from '../providers/InProcessMockController';
import { generateCodeTool } from './codegen';

const T0 = '2026-04-27T00:00:00.000Z';

function stateWithRequest(): { synced: WorkspaceSynced; local: WorkspaceLocal } {
  return {
    synced: {
      schemaVersion: 1,
      workspaceId: 'ws-1',
      collections: {
        tree: { id: 'r', type: 'root', children: [{ kind: 'request', id: 'r1' }] },
        requests: {
          r1: {
            id: 'r1',
            name: 'Demo',
            folderId: null,
            method: 'POST',
            url: 'https://api.example.test/users',
            headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
            query: [{ key: 'q', value: '1', enabled: true }],
            body: { type: 'json', content: '{"x":1}' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: T0,
            updatedAt: T0,
          },
        },
        folders: {},
      },
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
  const workspace = new InMemoryWorkspaceProvider(stateWithRequest());
  return {
    workspace,
    workspaces: new SingleWorkspaceAdapter(workspace, 'ws-test'),
    mock: new InProcessMockController(),
  };
}

describe('generate.code tool', () => {
  it('renders curl', async () => {
    const out = (await generateCodeTool.handler(
      { requestId: 'r1', target: 'curl' },
      makeCtx(),
    )) as { code: string };
    expect(out.code).toContain('curl -X POST');
    expect(out.code).toContain('Content-Type: application/json');
    expect(out.code).toContain('?q=1');
  });

  it('renders fetch', async () => {
    const out = (await generateCodeTool.handler(
      { requestId: 'r1', target: 'fetch' },
      makeCtx(),
    )) as { code: string };
    expect(out.code).toContain('await fetch(');
  });

  it('renders node-axios', async () => {
    const out = (await generateCodeTool.handler(
      { requestId: 'r1', target: 'node-axios' },
      makeCtx(),
    )) as { code: string };
    expect(out.code).toContain("import axios from 'axios'");
  });

  it('renders python-requests', async () => {
    const out = (await generateCodeTool.handler(
      { requestId: 'r1', target: 'python-requests' },
      makeCtx(),
    )) as { code: string };
    expect(out.code).toContain('import requests');
  });

  it('renders go', async () => {
    const out = (await generateCodeTool.handler({ requestId: 'r1', target: 'go' }, makeCtx())) as {
      code: string;
    };
    expect(out.code).toContain('package main');
    expect(out.code).toContain('http.NewRequest');
  });

  it('renders rust', async () => {
    const out = (await generateCodeTool.handler(
      { requestId: 'r1', target: 'rust' },
      makeCtx(),
    )) as { code: string };
    expect(out.code).toContain('reqwest::Client');
  });

  it('returns ok:false for unknown request id', async () => {
    const out = (await generateCodeTool.handler(
      { requestId: 'missing', target: 'curl' },
      makeCtx(),
    )) as { ok: boolean };
    expect(out.ok).toBe(false);
  });
});
