import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { MockServer } from '@apicircle/shared';

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

import { MockManager } from '../mock/mockManager';
import { McpManager } from '../mcp/mcpManager';
import { registerMockBridge, MOCK_CHANNELS } from './mockBridge';
import { registerMcpBridge, MCP_CHANNELS } from './mcpBridge';

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
    const runtime = (await handler!({}, fixtureMock('m1'))) as { port: number };
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

    await start({}, fixtureMock('m1'));
    expect((list({}) as Array<{ serverId: string }>).map((e) => e.serverId)).toContain('m1');
    expect(getRuntime({}, 'm1')).not.toBeNull();
    expect(await stop({}, 'm1')).toEqual({ ok: true });
    expect(getRuntime({}, 'm1')).toBeNull();

    await start({}, fixtureMock('m2'));
    expect(await stopAll({})).toEqual({ ok: true });
    expect((list({}) as unknown[]).length).toBe(0);
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
    const out = handler({}) as { workspaceDir: string };
    expect(out.workspaceDir).toBe('/ws');
  });

  it('snippet + path + catalog delegate to the manager', () => {
    registerMcpBridge(new McpManager('/ws'));
    const snippet = handlers.get(MCP_CHANNELS.getConfigSnippet)!({}, 'claude-desktop');
    expect(JSON.parse(snippet as string).mcpServers).toBeDefined();
    const cfgPath = handlers.get(MCP_CHANNELS.getConfigPath)!({}, 'cursor');
    expect(typeof cfgPath).toBe('string');
    const catalog = handlers.get(MCP_CHANNELS.toolCatalog)!({}) as readonly string[];
    expect(catalog.length).toBeGreaterThan(30);
  });
});
