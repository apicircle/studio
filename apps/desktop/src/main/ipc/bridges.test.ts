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

// Stand-in for an IpcMainInvokeEvent originating from the bundled file://
// renderer. assertTrustedSender prefix-matches `event.senderFrame.url`, so any
// file:// URL is accepted.
const trustedEvent = { senderFrame: { url: 'file:///dist/index.html' } };

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
    const snippet = handlers.get(MCP_CHANNELS.getConfigSnippet)!(trustedEvent, 'claude-desktop');
    expect(JSON.parse(snippet as string).mcpServers).toBeDefined();
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
