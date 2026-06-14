import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { MockServer, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';

// In-process ipcMain stand-in. The mock factory builds the registry inside
// itself so vitest's hoisting doesn't reach for an outer reference (vi.mock
// is hoisted to the top of the file). The test pulls handlers back out via
// `electron.ipcMain.__handlers__`.
vi.mock('electron', () => {
  const handlers = new Map<string, (...args: unknown[]) => unknown>();
  return {
    ipcMain: {
      handle: (channel: string, fn: (...args: unknown[]) => unknown) => {
        handlers.set(channel, fn);
      },
      __handlers__: handlers,
    },
    app: {
      getPath: () => '/fake/user-data',
    },
  };
});

import { ipcMain as ipcMainMock } from 'electron';
const handlers = (
  ipcMainMock as unknown as { __handlers__: Map<string, (...a: unknown[]) => unknown> }
).__handlers__;

const T0 = '2026-04-27T00:00:00.000Z';

// Stand-in for an IpcMainInvokeEvent originating from the bundled file://
// renderer. assertTrustedSender prefix-matches `event.senderFrame.url`, so any
// file:// URL is accepted.
const trustedEvent = { senderFrame: { url: 'file:///dist/index.html' } };

import { MockManager } from '../mock/mockManager';
import { McpManager } from '../mcp/mcpManager';
import { WorkspaceFileManager } from '../workspaceFile/workspaceFileManager';
import { registerMockBridge, MOCK_CHANNELS } from './mockBridge';
import { registerMcpBridge, MCP_CHANNELS } from './mcpBridge';
import { registerWorkspaceFileBridge, WORKSPACE_FILE_CHANNELS } from './workspaceFileBridge';

function fixtureMock(id: string): MockServer {
  return {
    id,
    name: 'X',
    source: { kind: 'manual', endpoints: [] },
    endpoints: [
      {
        id: 'e1',
        name: 'GET /health',
        method: 'GET',
        pathPattern: '/health',
        requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
        requestValidation: [],
        responseRules: [],
        defaultResponse: {
          status: 200,
          headers: [],
          body: { type: 'json', content: '{}' },
        },
      },
    ],
    defaultPort: 0,
    cors: { enabled: false, origins: [] },
    createdAt: T0,
    updatedAt: T0,
  };
}

beforeEach(() => {
  handlers.clear();
});

describe('mock IPC bridge', () => {
  it('registers handlers for every mock channel', () => {
    registerMockBridge(new MockManager());
    expect(handlers.has(MOCK_CHANNELS.start)).toBe(true);
    expect(handlers.has(MOCK_CHANNELS.stop)).toBe(true);
    expect(handlers.has(MOCK_CHANNELS.list)).toBe(true);
    expect(handlers.has(MOCK_CHANNELS.getRuntime)).toBe(true);
    expect(handlers.has(MOCK_CHANNELS.stopAll)).toBe(true);
  });

  it('start handler delegates to the manager', async () => {
    const manager = new MockManager();
    registerMockBridge(manager);
    const handler = handlers.get(MOCK_CHANNELS.start);
    expect(handler).toBeDefined();
    const runtime = (await handler!(trustedEvent, fixtureMock('m1'))) as { port: number };
    expect(runtime.port).toBeGreaterThan(0);
    await manager.stopAll();
  });

  it('stop + list + getRuntime + stopAll delegate to the manager', async () => {
    const manager = new MockManager();
    registerMockBridge(manager);
    const start = handlers.get(MOCK_CHANNELS.start)!;
    const list = handlers.get(MOCK_CHANNELS.list)!;
    const getRuntime = handlers.get(MOCK_CHANNELS.getRuntime)!;
    const stop = handlers.get(MOCK_CHANNELS.stop)!;
    const stopAll = handlers.get(MOCK_CHANNELS.stopAll)!;

    await start(trustedEvent, fixtureMock('m1'));
    expect((list(trustedEvent) as Array<{ serverId: string }>).map((e) => e.serverId)).toContain(
      'm1',
    );
    expect(getRuntime(trustedEvent, 'm1')).not.toBeNull();
    expect(await stop(trustedEvent, 'm1')).toEqual({ ok: true });
    expect(getRuntime(trustedEvent, 'm1')).toBeNull();

    await start(trustedEvent, fixtureMock('m2'));
    expect(await stopAll(trustedEvent)).toEqual({ ok: true });
    expect((list(trustedEvent) as unknown[]).length).toBe(0);
  });
});

describe('mcp IPC bridge', () => {
  it('registers handlers for every MCP channel', () => {
    registerMcpBridge(new McpManager('/ws'));
    expect(handlers.has(MCP_CHANNELS.status)).toBe(true);
    expect(handlers.has(MCP_CHANNELS.getConfigSnippet)).toBe(true);
    expect(handlers.has(MCP_CHANNELS.getConfigPath)).toBe(true);
    expect(handlers.has(MCP_CHANNELS.toolCatalog)).toBe(true);
  });

  it('status returns the manager paths', () => {
    registerMcpBridge(new McpManager('/ws'));
    const handler = handlers.get(MCP_CHANNELS.status)!;
    const out = handler(trustedEvent) as { workspaceDir: string };
    expect(out.workspaceDir).toBe('/ws');
  });

  it('snippet + path + catalog delegate to the manager', () => {
    registerMcpBridge(new McpManager('/ws'));
    const snippet = handlers.get(MCP_CHANNELS.getConfigSnippet)!(
      trustedEvent,
      'claude-desktop',
    ) as { forwardSlash: string; escaped: string; identical: boolean };
    expect(snippet.identical).toBe(true);
    expect(JSON.parse(snippet.forwardSlash).mcpServers).toBeDefined();
    const cfgPath = handlers.get(MCP_CHANNELS.getConfigPath)!(trustedEvent, 'cursor');
    expect(typeof cfgPath).toBe('string');
    const catalog = handlers.get(MCP_CHANNELS.toolCatalog)!(trustedEvent) as readonly string[];
    expect(catalog.length).toBeGreaterThan(30);
  });

  it('rejects an IPC call whose sender frame is not file://', () => {
    registerMcpBridge(new McpManager('/ws'));
    const handler = handlers.get(MCP_CHANNELS.status)!;
    expect(() => handler({ senderFrame: { url: 'https://attacker.example/' } })).toThrow(
      /Untrusted IPC sender/,
    );
  });

  it('rejects an IPC call with no senderFrame at all (e.g. detached frame)', () => {
    registerMcpBridge(new McpManager('/ws'));
    const handler = handlers.get(MCP_CHANNELS.status)!;
    expect(() => handler({})).toThrow(/Untrusted IPC sender/);
  });
});

function makeSyncedFixture(workspaceId = 'ws-test'): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId,
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.0.0' },
  };
}

function makeLocalFixture(workspaceId = 'ws-test'): WorkspaceLocal {
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

describe('workspaceFile IPC bridge (multi-workspace)', () => {
  let tmpDir: string;
  let workspacesRoot: string;

  beforeEach(async () => {
    tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-wfb-'));
    workspacesRoot = path.join(tmpDir, 'workspaces');
  });

  afterEach(async () => {
    await fs.rm(tmpDir, { recursive: true, force: true });
  });

  function newMgr() {
    return new WorkspaceFileManager({ workspacesRoot });
  }

  it('registers handlers for every workspace-file channel', () => {
    registerWorkspaceFileBridge(newMgr());
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.status)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.init)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.readRegistry)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.writeRegistry)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.readWorkspace)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.writeWorkspace)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.deleteWorkspace)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.registerWorkspace)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.setActiveWorkspace)).toBe(true);
    expect(handlers.has(WORKSPACE_FILE_CHANNELS.flush)).toBe(true);
  });

  it('writeWorkspace + readWorkspace round-trips through disk by id', async () => {
    const mgr = newMgr();
    registerWorkspaceFileBridge(mgr);
    const payload = {
      workspaceId: 'ws-x',
      synced: makeSyncedFixture('ws-x'),
      local: makeLocalFixture('ws-x'),
    };
    await handlers.get(WORKSPACE_FILE_CHANNELS.writeWorkspace)!(trustedEvent, payload);
    const out = (await handlers.get(WORKSPACE_FILE_CHANNELS.readWorkspace)!(
      trustedEvent,
      'ws-x',
    )) as { synced: WorkspaceSynced; local: WorkspaceLocal } | null;
    expect(out).not.toBeNull();
    expect(out!.synced.workspaceId).toBe('ws-x');
  });

  it('readWorkspace returns null when the workspace is missing', async () => {
    const mgr = newMgr();
    registerWorkspaceFileBridge(mgr);
    const out = await handlers.get(WORKSPACE_FILE_CHANNELS.readWorkspace)!(trustedEvent, 'nope');
    expect(out).toBeNull();
  });

  it('status returns the workspaces root', async () => {
    const mgr = newMgr();
    registerWorkspaceFileBridge(mgr);
    const out = (await handlers.get(WORKSPACE_FILE_CHANNELS.status)!(trustedEvent)) as {
      workspacesRoot: string;
    };
    expect(out.workspacesRoot).toBe(workspacesRoot);
  });

  it('rejects a writeWorkspace whose payload workspaceId does not match synced/local', async () => {
    const mgr = newMgr();
    registerWorkspaceFileBridge(mgr);
    const payload = {
      workspaceId: 'ws-mismatch',
      synced: makeSyncedFixture('ws-a'),
      local: makeLocalFixture('ws-b'),
    };
    await expect(
      handlers.get(WORKSPACE_FILE_CHANNELS.writeWorkspace)!(trustedEvent, payload),
    ).rejects.toThrow(/workspaceId mismatch/);
  });

  it('rejects malformed writeWorkspace payloads', async () => {
    const mgr = newMgr();
    registerWorkspaceFileBridge(mgr);
    const write = handlers.get(WORKSPACE_FILE_CHANNELS.writeWorkspace)!;
    await expect(write(trustedEvent, null)).rejects.toThrow(/payload must be an object/);
    await expect(
      write(trustedEvent, {
        workspaceId: 'ws-a',
        synced: {},
        local: makeLocalFixture('ws-a'),
      }),
    ).rejects.toThrow(/synced\.workspaceId/);
  });

  it('registerWorkspace + setActiveWorkspace + deleteWorkspace flow through the registry', async () => {
    const mgr = newMgr();
    registerWorkspaceFileBridge(mgr);
    // Seed two workspaces.
    await handlers.get(WORKSPACE_FILE_CHANNELS.writeWorkspace)!(trustedEvent, {
      workspaceId: 'ws-a',
      synced: makeSyncedFixture('ws-a'),
      local: makeLocalFixture('ws-a'),
    });
    await handlers.get(WORKSPACE_FILE_CHANNELS.registerWorkspace)!(trustedEvent, {
      id: 'ws-a',
      name: 'A',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    await handlers.get(WORKSPACE_FILE_CHANNELS.writeWorkspace)!(trustedEvent, {
      workspaceId: 'ws-b',
      synced: makeSyncedFixture('ws-b'),
      local: makeLocalFixture('ws-b'),
    });
    await handlers.get(WORKSPACE_FILE_CHANNELS.registerWorkspace)!(trustedEvent, {
      id: 'ws-b',
      name: 'B',
      createdAt: T0,
      lastOpenedAt: '2026-06-01T00:00:00.000Z',
    });
    // Activate B, then delete it — A should become active.
    const r1 = (await handlers.get(WORKSPACE_FILE_CHANNELS.setActiveWorkspace)!(
      trustedEvent,
      'ws-b',
    )) as { activeWorkspaceId: string };
    expect(r1.activeWorkspaceId).toBe('ws-b');
    const r2 = (await handlers.get(WORKSPACE_FILE_CHANNELS.deleteWorkspace)!(
      trustedEvent,
      'ws-b',
    )) as { activeWorkspaceId: string; workspaces: Array<{ id: string }> };
    expect(r2.workspaces.map((w) => w.id)).toEqual(['ws-a']);
    expect(r2.activeWorkspaceId).toBe('ws-a');
  });

  it('rejects IPC calls whose sender frame is not file://', async () => {
    const mgr = newMgr();
    registerWorkspaceFileBridge(mgr);
    const evil = { senderFrame: { url: 'https://attacker.example/' } };
    await expect(
      handlers.get(WORKSPACE_FILE_CHANNELS.readWorkspace)!(evil, 'ws-a'),
    ).rejects.toThrow(/Untrusted IPC sender/);
  });
});
