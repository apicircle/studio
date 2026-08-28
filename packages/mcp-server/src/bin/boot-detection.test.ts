import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceSynced } from '@apicircle/shared';
import { workspaceListTool } from '../tools/workspaceList';
import { workspaceReadTool } from '../tools/crud';
import { FileBackedWorkspaceProvider } from '@apicircle/core/providers';
import { SingleWorkspaceAdapter } from '@apicircle/core/providers';
import { InProcessMockController } from '@apicircle/core/providers';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import type { WorkspaceState } from '@apicircle/core';

// =============================================================================
// Boot-detection integration tests — verify the two-path workspace detection
// logic that the `apicircle-mcp` binary uses at startup.
//
// Each test replicates one of the on-disk layouts and confirms that the
// correct provider is wired up and produces working tool results. These tests
// exercise the full provider → tool handler → response path without launching
// a child process.
// =============================================================================

const T0 = '2026-06-14T00:00:00.000Z';

function makeSynced(workspaceId = 'ws-test'): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId,
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      requests: {
        'r-1': {
          id: 'r-1',
          name: 'GET health',
          folderId: null,
          method: 'GET',
          url: 'http://localhost:3000/health',
          headers: [],
          query: [],
          body: { type: 'none', content: '' },
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
    environments: {
      items: {
        dev: { name: 'dev', variables: [{ key: 'HOST', value: 'localhost', encrypted: false }] },
      },
      activeName: 'dev',
      priorityOrder: [],
    },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.1.0' },
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-boot-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

// ---------------------------------------------------------------------------
// Path 2: workspace.json → FileBackedWorkspaceProvider (single-workspace mode)
// ---------------------------------------------------------------------------
describe('Path 2: single-workspace (workspace.json)', () => {
  it('workspace.list returns counts from workspace.json', async () => {
    const state: WorkspaceState = {
      synced: makeSynced(),
      local: {
        schemaVersion: 1,
        workspaceId: 'ws-test',
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
        attachmentCache: {},
        globalContext: {},
        mockRuntime: { active: {} },
        ui: {
          activeRequestId: null,
          sidebarExpandedSections: [],
          themeId: 'one-dark-pro',
          fontId: 'system-sans',
          fontSizePercent: 100,
        },
        settings: { validateOnSend: true, monacoConsumesWheel: false },
        snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
      },
    };
    await saveToFile(tmpDir, state);

    const workspace = new FileBackedWorkspaceProvider(tmpDir);
    const workspaces = new SingleWorkspaceAdapter(workspace, null);
    const ctx = { workspace, workspaces, mock: new InProcessMockController() };

    const out = (await workspaceListTool.handler({}, ctx)) as {
      workspaceCount: number;
      workspaces: Array<{ id: string; counts: { requests: number; environments: number } }>;
    };
    expect(out.workspaceCount).toBe(1);
    expect(out.workspaces[0].id).toBe('ws-test');
    expect(out.workspaces[0].counts.requests).toBe(1);
    expect(out.workspaces[0].counts.environments).toBe(1);
  });

  it('workspace.read returns synced+local from workspace.json', async () => {
    const state: WorkspaceState = {
      synced: makeSynced(),
      local: {
        schemaVersion: 1,
        workspaceId: 'ws-test',
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
        attachmentCache: {},
        globalContext: {},
        mockRuntime: { active: {} },
        ui: {
          activeRequestId: null,
          sidebarExpandedSections: [],
          themeId: 'one-dark-pro',
          fontId: 'system-sans',
          fontSizePercent: 100,
        },
        settings: { validateOnSend: true, monacoConsumesWheel: false },
        snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
      },
    };
    await saveToFile(tmpDir, state);

    const workspace = new FileBackedWorkspaceProvider(tmpDir);
    const workspaces = new SingleWorkspaceAdapter(workspace, null);
    const ctx = { workspace, workspaces, mock: new InProcessMockController() };

    const out = (await workspaceReadTool.handler({}, ctx)) as {
      kind: string;
      synced: WorkspaceSynced;
    };
    expect(out.kind).toBe('single');
    expect(out.synced.collections.requests['r-1'].name).toBe('GET health');
  });

  it('apply via file-backed provider persists to workspace.json', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'workspace.json'),
      JSON.stringify(makeSynced('ws-repo')),
      'utf-8',
    );

    const workspace = new FileBackedWorkspaceProvider(tmpDir);
    const workspaces = new SingleWorkspaceAdapter(workspace, null);
    const ctx = { workspace, workspaces, mock: new InProcessMockController() };

    const { requestCreateTool } = await import('../tools/crud');
    const result = (await requestCreateTool.handler(
      { name: 'POST create', method: 'POST', url: '/api/create' },
      ctx,
    )) as { id: string };
    expect(result.id).toBeTruthy();

    // Verify it landed in workspace.json on disk.
    const raw = await fs.readFile(path.join(tmpDir, 'workspace.json'), 'utf-8');
    const persisted = JSON.parse(raw) as WorkspaceSynced;
    expect(persisted.collections.requests[result.id]).toBeDefined();
    expect(persisted.collections.requests[result.id].name).toBe('POST create');
  });
});
