import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { applyMutation } from '@apicircle/core';
import { saveToFile, loadFromFile } from '@apicircle/core/workspace/file-backed';
import {
  registerWorkspace,
  saveRegistry,
  loadRegistry,
  workspaceDirFor,
  emptyRegistry as _emptyRegistry,
} from '@apicircle/core/workspace/registry';
import { FileBackedWorkspaceProvider } from './FileBackedWorkspaceProvider';
import { MultiWorkspaceProvider } from './MultiWorkspaceProvider';
import { SingleWorkspaceAdapter } from './Workspaces';
import { InProcessMockController } from './InProcessMockController';
import { workspaceReadTool } from '../tools/crud';

// =============================================================================
// Cross-surface integration tests.
//
// These tests validate that the CLI, MCP server, and Desktop app can all
// operate on the same `~/.apicircle/` directory layout without conflict.
// Each test simulates multi-writer scenarios where one surface writes and
// another reads — the same workspace.json file, same registry.json index.
//
// This is the integration layer that proves the rename from
// `workspace.synced.json` → `workspace.json` and the relocation to
// `~/.apicircle/` didn't break cross-surface interop.
// =============================================================================

const T0 = '2026-06-14T00:00:00.000Z';

function makeSynced(workspaceId: string, requestCount = 0): WorkspaceSynced {
  const requests: Record<string, any> = {};
  for (let i = 0; i < requestCount; i++) {
    requests[`r-${i}`] = {
      id: `r-${i}`,
      name: `Request ${i}`,
      folderId: null,
      method: 'GET',
      url: `http://localhost/api/${i}`,
      headers: [],
      query: [],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: T0,
      updatedAt: T0,
    };
  }
  return {
    schemaVersion: 1,
    workspaceId,
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      requests: requests as never,
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.1.0' },
  };
}

function makeLocal(workspaceId: string): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId,
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
  };
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-xsurf-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

describe('Cross-surface integration: CLI ↔ MCP ↔ Desktop', () => {
  // -------------------------------------------------------------------------
  // Scenario 1: CLI creates a workspace + registry entry, MCP reads it.
  // Validates the CLI's write path produces files the MCP can consume.
  // -------------------------------------------------------------------------
  it('CLI-written workspace.json is readable by MCP FileBackedWorkspaceProvider', async () => {
    const wsId = 'ws-cli-created';
    const wsDir = workspaceDirFor(root, wsId);

    // Simulate CLI `apicircle workspaces create`
    await saveToFile(wsDir, {
      synced: makeSynced(wsId, 2),
      local: makeLocal(wsId),
    });
    await registerWorkspace(root, {
      id: wsId,
      name: 'CLI Workspace',
      createdAt: T0,
      lastOpenedAt: T0,
    });

    // MCP boots against the per-workspace dir (single-workspace mode)
    const provider = new FileBackedWorkspaceProvider(wsDir);
    const state = await provider.read();
    expect(state.synced.workspaceId).toBe(wsId);
    expect(Object.keys(state.synced.collections.requests)).toHaveLength(2);
  });

  // -------------------------------------------------------------------------
  // Scenario 2: CLI writes via applyMutation, MCP sees the mutation.
  // Validates that mutation writes are visible cross-process.
  // -------------------------------------------------------------------------
  it('CLI mutation via applyMutation is visible to MCP on next read', async () => {
    const wsId = 'ws-mutate';
    const wsDir = workspaceDirFor(root, wsId);

    // Initial seed (like a fresh `apicircle workspaces create`)
    const synced = makeSynced(wsId, 0);
    const local = makeLocal(wsId);
    await saveToFile(wsDir, { synced, local });

    // CLI applies a mutation (simulates `apicircle import` or `apicircle run`)
    const { next } = applyMutation(
      { synced, local },
      {
        kind: 'environment.upsert',
        environment: {
          name: 'production',
          variables: [{ key: 'API_KEY', value: 'secret', encrypted: false }],
        },
      },
    );
    await saveToFile(wsDir, next);

    // MCP reads the same directory — should see the new environment
    const provider = new FileBackedWorkspaceProvider(wsDir);
    const state = await provider.read();
    expect(state.synced.environments.items['production']).toBeDefined();
    expect(state.synced.environments.items['production'].variables[0].key).toBe('API_KEY');
  });

  // -------------------------------------------------------------------------
  // Scenario 3: Multi-workspace registry created by Desktop, MCP discovers all.
  // Validates that the MCP's MultiWorkspaceProvider reads the same registry
  // the Desktop wrote.
  // -------------------------------------------------------------------------
  it('Desktop-written registry.json is discoverable by MCP MultiWorkspaceProvider', async () => {
    // Simulate desktop creating 2 workspaces
    const ws1 = 'ws-alpha';
    const ws2 = 'ws-beta';
    await saveToFile(workspaceDirFor(root, ws1), {
      synced: makeSynced(ws1, 3),
      local: makeLocal(ws1),
    });
    await saveToFile(workspaceDirFor(root, ws2), {
      synced: makeSynced(ws2, 1),
      local: makeLocal(ws2),
    });
    await registerWorkspace(root, { id: ws1, name: 'Alpha', createdAt: T0, lastOpenedAt: T0 });
    await registerWorkspace(root, { id: ws2, name: 'Beta', createdAt: T0, lastOpenedAt: T0 });
    const reg = await loadRegistry(root);
    await saveRegistry(root, { ...reg!, activeWorkspaceId: ws1 });

    // MCP boots in multi-workspace mode
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    const list = await mwp.list();
    expect(list).toHaveLength(2);
    expect(list.find((w) => w.id === ws1)?.counts?.requests).toBe(3);
    expect(list.find((w) => w.id === ws2)?.counts?.requests).toBe(1);

    // Active workspace resolves to ws1
    const active = mwp.activeProvider();
    const state = await active.read();
    expect(state.synced.workspaceId).toBe(ws1);
  });

  // -------------------------------------------------------------------------
  // Scenario 4: MCP applies a mutation, Desktop file watcher should see it.
  // Validates that MCP writes land at the correct path (workspace.json)
  // so the Desktop watcher (which monitors workspace.json) will detect it.
  // -------------------------------------------------------------------------
  it('MCP mutation writes to workspace.json (detectable by Desktop watcher)', async () => {
    const wsId = 'ws-mcp-writes';
    const wsDir = workspaceDirFor(root, wsId);
    await saveToFile(wsDir, {
      synced: makeSynced(wsId, 1),
      local: makeLocal(wsId),
    });

    // MCP applies a request.create mutation
    const provider = new FileBackedWorkspaceProvider(wsDir);
    await provider.apply({
      kind: 'request.create',
      request: {
        id: 'r-new',
        name: 'POST created-by-mcp',
        folderId: null,
        method: 'POST',
        url: 'http://localhost/mcp-created',
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
    });

    // Desktop reads workspace.json directly (simulating what the file
    // watcher + refreshFromDisk would do)
    const raw = await fs.readFile(path.join(wsDir, 'workspace.json'), 'utf-8');
    const persisted = JSON.parse(raw) as WorkspaceSynced;
    expect(persisted.collections.requests['r-new']).toBeDefined();
    expect(persisted.collections.requests['r-new'].name).toBe('POST created-by-mcp');
  });

  // -------------------------------------------------------------------------
  // Scenario 5: Desktop switches active workspace, MCP's lazy resolver picks
  // it up on next read (no restart needed).
  // -------------------------------------------------------------------------
  it('Desktop active-workspace switch is visible to MCP without restart', async () => {
    const ws1 = 'ws-first';
    const ws2 = 'ws-second';
    await saveToFile(workspaceDirFor(root, ws1), {
      synced: makeSynced(ws1, 1),
      local: makeLocal(ws1),
    });
    await saveToFile(workspaceDirFor(root, ws2), {
      synced: makeSynced(ws2, 5),
      local: makeLocal(ws2),
    });
    await registerWorkspace(root, { id: ws1, name: 'First', createdAt: T0, lastOpenedAt: T0 });
    await registerWorkspace(root, { id: ws2, name: 'Second', createdAt: T0, lastOpenedAt: T0 });
    let reg = await loadRegistry(root);
    await saveRegistry(root, { ...reg!, activeWorkspaceId: ws1 });

    // MCP boots — sees ws1 as active
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    let state = await mwp.activeProvider().read();
    expect(state.synced.workspaceId).toBe(ws1);

    // Desktop switches to ws2 (writes registry.json directly)
    reg = await loadRegistry(root);
    await saveRegistry(root, { ...reg!, activeWorkspaceId: ws2 });

    // MCP's lazy resolver picks up the switch on next read
    state = await mwp.activeProvider().read();
    expect(state.synced.workspaceId).toBe(ws2);
    expect(Object.keys(state.synced.collections.requests)).toHaveLength(5);
  });

  // -------------------------------------------------------------------------
  // Scenario 6: Full tool-handler flow — simulates what an AI client sees.
  // MCP tool handler reads workspace.json through the provider stack.
  // -------------------------------------------------------------------------
  it('workspace.read tool handler returns data from workspace.json (full stack)', async () => {
    const wsId = 'ws-tool-test';
    const wsDir = workspaceDirFor(root, wsId);
    await saveToFile(wsDir, {
      synced: makeSynced(wsId, 3),
      local: makeLocal(wsId),
    });

    const workspace = new FileBackedWorkspaceProvider(wsDir);
    const workspaces = new SingleWorkspaceAdapter(workspace, null);
    const ctx = { workspace, workspaces, mock: new InProcessMockController() };

    const result = (await workspaceReadTool.handler({}, ctx)) as {
      kind: string;
      synced: WorkspaceSynced;
    };
    expect(result.kind).toBe('single');
    expect(result.synced.workspaceId).toBe(wsId);
    expect(Object.keys(result.synced.collections.requests)).toHaveLength(3);
  });

  // -------------------------------------------------------------------------
  // Scenario 7: Concurrent writers (CLI + MCP) don't corrupt the file.
  // Both use proper-lockfile via withWorkspace/FileBackedWorkspaceProvider.
  // -------------------------------------------------------------------------
  it('concurrent writes from two providers resolve without corruption', async () => {
    const wsId = 'ws-concurrent';
    const wsDir = workspaceDirFor(root, wsId);
    await saveToFile(wsDir, {
      synced: makeSynced(wsId, 0),
      local: makeLocal(wsId),
    });

    // Simulate two independent FileBackedWorkspaceProvider instances
    // (like CLI + MCP both running against the same workspace dir)
    const provider1 = new FileBackedWorkspaceProvider(wsDir);
    const provider2 = new FileBackedWorkspaceProvider(wsDir);

    // Apply different mutations concurrently
    const [_r1, _r2] = await Promise.all([
      provider1.apply({
        kind: 'environment.upsert',
        environment: { name: 'env-from-cli', variables: [] },
      }),
      provider2.apply({
        kind: 'environment.upsert',
        environment: { name: 'env-from-mcp', variables: [] },
      }),
    ]);

    // At least one of the mutations persisted; the file isn't corrupt
    const state = await loadFromFile(wsDir);
    expect(state).not.toBeNull();
    const envNames = Object.keys(state!.synced.environments.items);
    // Both should exist because proper-lockfile serializes the writes
    expect(envNames).toContain('env-from-cli');
    expect(envNames).toContain('env-from-mcp');
  });

  // -------------------------------------------------------------------------
  // Scenario 8: workspace.json path correctness — no workspace.synced.json.
  // -------------------------------------------------------------------------
  it('no workspace.synced.json is ever created in the workspace directory', async () => {
    const wsId = 'ws-no-legacy';
    const wsDir = workspaceDirFor(root, wsId);
    await saveToFile(wsDir, {
      synced: makeSynced(wsId, 1),
      local: makeLocal(wsId),
    });

    // Apply a mutation through the provider
    const provider = new FileBackedWorkspaceProvider(wsDir);
    await provider.apply({
      kind: 'environment.upsert',
      environment: { name: 'staging', variables: [] },
    });

    // Verify workspace.json exists and workspace.synced.json does NOT
    const entries = await fs.readdir(wsDir);
    expect(entries).toContain('workspace.json');
    expect(entries).toContain('workspace.local.json');
    expect(entries).not.toContain('workspace.synced.json');
  });
});
