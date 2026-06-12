import * as vscode from 'vscode';
import type { Folder, Request as ApiRequest } from '@apicircle/shared';
import { BaseTreeView } from './BaseTreeView';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// EditorView — workspace folder + request tree backed by the active workspace's
// collections.tree.
//
// Layout discipline (mirrors desktop EditorSidebar):
//   • Root level: `synced.collections.tree.children`
//   • Nested folder children derived from folders[].parentId and requests[].folderId
//   • Alphabetical sort, interleaved folders + requests
//   • Click a request → opens its apicircle:// virtual YAML
//   • Method-color icons via ThemeColor (charts.green for GET,
//     charts.orange for POST, etc.)
// =============================================================================

export type EditorNode = { kind: 'folder'; id: string } | { kind: 'request'; id: string };

const METHOD_COLOR_MAP: Record<string, string> = {
  GET: 'charts.green',
  POST: 'charts.orange',
  PUT: 'charts.blue',
  PATCH: 'charts.yellow',
  DELETE: 'charts.red',
  HEAD: 'charts.purple',
  OPTIONS: 'charts.purple',
};

export class EditorView extends BaseTreeView<EditorNode> {
  readonly viewId = 'apicircle.editor';

  constructor(private readonly bridge: VsCodeBridge) {
    super();
  }

  async getTreeItem(element: EditorNode): Promise<vscode.TreeItem> {
    const active = this.bridge.activeWorkspace();
    if (!active) {
      return new vscode.TreeItem('No workspace');
    }
    const state = await active.read();

    if (element.kind === 'folder') {
      const folder = state.synced.collections.folders[element.id];
      const childCount = folder
        ? countFolderChildren(folder.id, state.synced.collections)
        : { folders: 0, requests: 0 };
      const item = new vscode.TreeItem(
        folder?.name ?? '(deleted folder)',
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon('folder');
      item.contextValue = 'folder';
      if (folder) {
        const total = childCount.folders + childCount.requests;
        item.description = total === 0 ? 'empty' : `${total} item${total === 1 ? '' : 's'}`;
        item.tooltip = new vscode.MarkdownString(
          `**${folder.name}**\n\n${childCount.requests} request${childCount.requests === 1 ? '' : 's'}, ${childCount.folders} folder${childCount.folders === 1 ? '' : 's'}\n\n_Click the + icon to add a request to this folder._`,
        );
      }
      return item;
    }

    const request = state.synced.collections.requests[element.id];
    if (!request) {
      return new vscode.TreeItem('(deleted request)');
    }
    const item = new vscode.TreeItem(request.name, vscode.TreeItemCollapsibleState.None);
    item.description = `${request.method} ${describeUrl(request.url)}`;
    item.iconPath = methodIcon(request.method);
    item.contextValue = 'request';
    item.tooltip = new vscode.MarkdownString(
      `**${request.name}**\n\n\`${request.method}\` ${request.url}` +
        (request.auth.type !== 'none' ? `\n\nAuth: \`${request.auth.type}\`` : '') +
        (request.body.type !== 'none' ? `\n\nBody: \`${request.body.type}\`` : '') +
        `\n\n_Click ▶ to send, or open to edit._`,
    );
    const uri = ApicircleFsProvider.requestUri(
      active.workspace.id,
      request,
      state.synced.collections.folders,
      state.synced.collections.requests,
    );
    item.command = {
      command: 'vscode.open',
      title: 'Open',
      arguments: [uri],
    };
    item.resourceUri = uri;
    return item;
  }

  async getChildren(element?: EditorNode): Promise<EditorNode[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];
    const state = await active.read();

    if (!element) {
      // Root children come from the canonical FolderNode.children list
      return [...state.synced.collections.tree.children];
    }
    if (element.kind === 'request') return [];

    // Folder children: scan folders.parentId and requests.folderId
    const out: EditorNode[] = [];
    for (const f of Object.values(state.synced.collections.folders)) {
      if (f.parentId === element.id) out.push({ kind: 'folder', id: f.id });
    }
    for (const r of Object.values(state.synced.collections.requests)) {
      if (r.folderId === element.id) out.push({ kind: 'request', id: r.id });
    }
    return sortNodes(out, state.synced.collections.folders, state.synced.collections.requests);
  }
}

function countFolderChildren(
  folderId: string,
  collections: { folders: Record<string, Folder>; requests: Record<string, ApiRequest> },
): { folders: number; requests: number } {
  let folders = 0;
  let requests = 0;
  for (const f of Object.values(collections.folders)) {
    if (f.parentId === folderId) folders += 1;
  }
  for (const r of Object.values(collections.requests)) {
    if (r.folderId === folderId) requests += 1;
  }
  return { folders, requests };
}

function methodIcon(method: string): vscode.ThemeIcon {
  const colorId = METHOD_COLOR_MAP[method.toUpperCase()] ?? 'foreground';
  return new vscode.ThemeIcon('circle-filled', new vscode.ThemeColor(colorId));
}

function describeUrl(url: string): string {
  // Strip scheme + host for compact display: "/users/:id"
  try {
    const parsed = new URL(url);
    return parsed.pathname + parsed.search;
  } catch {
    return url;
  }
}

function sortNodes(
  nodes: EditorNode[],
  folders: Record<string, Folder>,
  requests: Record<string, ApiRequest>,
): EditorNode[] {
  return [...nodes].sort((a, b) => {
    const aName = a.kind === 'folder' ? (folders[a.id]?.name ?? '') : (requests[a.id]?.name ?? '');
    const bName = b.kind === 'folder' ? (folders[b.id]?.name ?? '') : (requests[b.id]?.name ?? '');
    return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
  });
}
