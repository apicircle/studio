import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// MockView — workspace mock servers tree.
//
// Layout:
//   ▾ Pet Store              ▶ :3000  ← running (port shown)
//      GET /pets
//      POST /pets
//      GET /pets/{id}
//   ▾ Order Service          ◦ idle
//      GET /orders
//      ...
//
// Click a server → opens its `.yaml` virtual document.
// Click an endpoint → no-op for now (Phase 4 will jump into the
// per-endpoint editor; Phase 3 ships the read-only tree).
// =============================================================================

export type MockNode =
  | { kind: 'server'; id: string }
  | { kind: 'endpoint'; serverId: string; endpointId: string };

export class MockView extends BaseTreeView<MockNode> {
  readonly viewId = 'apicircle.mock';

  constructor(private readonly bridge: VsCodeBridge) {
    super();
  }

  async getTreeItem(node: MockNode): Promise<vscode.TreeItem> {
    const active = this.bridge.activeWorkspace();
    if (!active) return new vscode.TreeItem('No workspace');
    const state = await active.read();

    if (node.kind === 'server') {
      const server = state.synced.mockServers[node.id];
      if (!server) return new vscode.TreeItem('(deleted mock)');
      const runtime = state.local.mockRuntime.active[node.id];
      const item = new vscode.TreeItem(server.name, vscode.TreeItemCollapsibleState.Collapsed);
      if (runtime) {
        item.description = `▶ :${runtime.port} · ${server.endpoints.length} endpoints`;
        item.iconPath = new vscode.ThemeIcon('play-circle', new vscode.ThemeColor('charts.green'));
        item.contextValue = 'mock-running';
        item.tooltip = `${server.name}\nRunning on port ${runtime.port}\n${server.endpoints.length} endpoints\nStarted: ${runtime.startedAt}`;
      } else {
        item.description = `${server.endpoints.length} endpoints`;
        item.iconPath = new vscode.ThemeIcon('circle-outline');
        item.contextValue = 'mock-idle';
        item.tooltip = `${server.name}\nNot running\n${server.endpoints.length} endpoints`;
      }
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [ApicircleFsProvider.mockUri(active.workspace.id, server)],
      };
      return item;
    }

    // endpoint
    const server = state.synced.mockServers[node.serverId];
    if (!server) return new vscode.TreeItem('(deleted)');
    const ep = server.endpoints.find((e) => e.id === node.endpointId);
    if (!ep) return new vscode.TreeItem('(deleted endpoint)');
    const item = new vscode.TreeItem(
      `${ep.method} ${ep.pathPattern}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = ep.name;
    item.tooltip = new vscode.MarkdownString(
      `**${ep.method}** \`${ep.pathPattern}\`` +
        (ep.description ? `\n\n${ep.description}` : '') +
        `\n\n**Default response:** \`${ep.defaultResponse.status}\` · body type \`${ep.defaultResponse.body.type}\`` +
        `\n\n_Click the ✎ pencil to edit method / path / status / body in a form, or open the mock YAML for full control._`,
    );
    item.iconPath = new vscode.ThemeIcon('symbol-method');
    item.contextValue = 'mock-endpoint';
    // Click opens the per-endpoint YAML file — same editing experience as
    // request YAML, driven by CodeLens. The webview form editor stays
    // reachable via the right-click context menu for users who prefer
    // the GUI form for quick edits.
    item.command = {
      command: 'vscode.open',
      title: 'Open Endpoint YAML',
      arguments: [ApicircleFsProvider.endpointUri(active.workspace.id, server, ep)],
    };
    return item;
  }

  async getChildren(element?: MockNode): Promise<MockNode[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];
    const state = await active.read();
    const servers = state.synced.mockServers;

    if (!element) {
      // Empty array → viewsWelcome fires.
      const ids = Object.values(servers)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((s) => s.id);
      return ids.map((id) => ({ kind: 'server' as const, id }));
    }
    if (element.kind === 'endpoint') return [];

    const server = servers[element.id];
    if (!server) return [];
    return server.endpoints.map((ep) => ({
      kind: 'endpoint' as const,
      serverId: server.id,
      endpointId: ep.id,
    }));
  }
}
