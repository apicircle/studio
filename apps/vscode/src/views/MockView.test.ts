import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { MockView } from './MockView';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { MockServer, MockRuntimeEntry } from '@apicircle/shared';

function makeServer(over: Partial<MockServer> = {}): MockServer {
  return {
    id: 'm1',
    name: 'Pet Store',
    source: { kind: 'manual', endpoints: [] },
    endpoints: [
      {
        id: 'e1',
        method: 'GET',
        pathPattern: '/pets',
        name: 'list pets',
        requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
        requestValidation: [],
        responseRules: [],
        defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '[]' } },
      },
    ],
    defaultPort: 3000,
    cors: { enabled: false, origins: [] },
    createdAt: '2026-01-01',
    updatedAt: '2026-01-01',
    ...over,
  };
}

function makeBridge(
  servers: Record<string, MockServer>,
  runtime: Record<string, MockRuntimeEntry> = {},
): VsCodeBridge {
  return {
    activeWorkspace: () => ({
      workspace: { id: 'ws' },
      read: () =>
        Promise.resolve({
          synced: { mockServers: servers },
          local: { mockRuntime: { active: runtime } },
        }),
    }),
  } as unknown as VsCodeBridge;
}

describe('MockView', () => {
  it('returns no children when no workspace active', async () => {
    const view = new MockView({ activeWorkspace: () => undefined } as unknown as VsCodeBridge);
    expect(await view.getChildren()).toEqual([]);
  });

  it('returns empty children when no mock servers (lets viewsWelcome fire)', async () => {
    const view = new MockView(makeBridge({}));
    expect(await view.getChildren()).toEqual([]);
  });

  it('lists servers sorted alphabetically', async () => {
    const view = new MockView(
      makeBridge({
        m1: makeServer({ id: 'm1', name: 'Zebra' }),
        m2: makeServer({ id: 'm2', name: 'Alpha' }),
      }),
    );
    const kids = await view.getChildren();
    expect(kids).toEqual([
      { kind: 'server', id: 'm2' },
      { kind: 'server', id: 'm1' },
    ]);
  });

  it('returns endpoint children for a server node', async () => {
    const view = new MockView(makeBridge({ m1: makeServer() }));
    const kids = await view.getChildren({ kind: 'server', id: 'm1' });
    expect(kids).toEqual([{ kind: 'endpoint', serverId: 'm1', endpointId: 'e1' }]);
  });

  it('returns no children for endpoint leaves', async () => {
    const view = new MockView(makeBridge({ m1: makeServer() }));
    const kids = await view.getChildren({ kind: 'endpoint', serverId: 'm1', endpointId: 'e1' });
    expect(kids).toEqual([]);
  });

  it('renders idle servers with circle-outline icon + endpoint count', async () => {
    const view = new MockView(makeBridge({ m1: makeServer() }));
    const item = (await view.getTreeItem({ kind: 'server', id: 'm1' })) as vscode.TreeItem;
    expect(item.label).toBe('Pet Store');
    expect(String(item.description)).toContain('1 endpoint');
    expect((item.iconPath as { id: string }).id).toBe('circle-outline');
    expect(item.contextValue).toBe('mock-idle');
  });

  it('renders running servers with play-circle icon + port', async () => {
    const view = new MockView(
      makeBridge(
        { m1: makeServer() },
        { m1: { port: 3000, pid: 1, startedAt: '2026-01-01', lastError: null, requestCount: 0 } },
      ),
    );
    const item = (await view.getTreeItem({ kind: 'server', id: 'm1' })) as vscode.TreeItem;
    expect(String(item.description)).toContain(':3000');
    expect((item.iconPath as { id: string }).id).toBe('play-circle');
    expect(item.contextValue).toBe('mock-running');
  });

  it('renders endpoint as "METHOD path" with description = name', async () => {
    const view = new MockView(makeBridge({ m1: makeServer() }));
    const item = (await view.getTreeItem({
      kind: 'endpoint',
      serverId: 'm1',
      endpointId: 'e1',
    })) as vscode.TreeItem;
    expect(item.label).toBe('GET /pets');
    expect(item.description).toBe('list pets');
    expect(item.contextValue).toBe('mock-endpoint');
  });

  it('shows (deleted mock) stub when server id no longer exists', async () => {
    const view = new MockView(makeBridge({}));
    const item = (await view.getTreeItem({ kind: 'server', id: 'ghost' })) as vscode.TreeItem;
    expect(item.label).toBe('(deleted mock)');
  });

  it('click command opens the mock YAML through the FS provider', async () => {
    const view = new MockView(makeBridge({ m1: makeServer() }));
    const item = (await view.getTreeItem({ kind: 'server', id: 'm1' })) as vscode.TreeItem;
    expect(item.command?.command).toBe('vscode.open');
    // The mock URI shape now uses the slugified mock name as the basename
    // (so the tab title is human-readable) with the mock id riding in
    // `?id=`. "Pet Store" → "Pet-Store" via slugify.
    const arg = item.command?.arguments?.[0] as { path: string; query: string };
    expect(arg.path).toBe('/mocks/Pet-Store.yaml');
    expect(arg.query).toBe('id=m1');
  });
});
