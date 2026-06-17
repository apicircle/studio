import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { VsCodeBridge } from '../host/vscodeBridge';

export type WorkspaceNode =
  | { kind: 'active' }
  | { kind: 'stat'; label: string; value: string; icon: string };

export class WorkspaceView extends BaseTreeView<WorkspaceNode> {
  readonly viewId = 'apicircle.workspace';

  constructor(private readonly bridge: VsCodeBridge) {
    super();
  }

  async getTreeItem(element: WorkspaceNode): Promise<vscode.TreeItem> {
    if (element.kind === 'active') {
      const active = this.bridge.activeWorkspace();
      if (!active) {
        const item = new vscode.TreeItem(
          'No active workspace',
          vscode.TreeItemCollapsibleState.None,
        );
        item.iconPath = new vscode.ThemeIcon('warning');
        item.description = 'Create or open a workspace to get started';
        item.contextValue = 'workspace-empty';
        return item;
      }

      const ws = active.workspace;
      const state = await active.read();
      const reqCount = Object.keys(state.synced.collections.requests).length;
      const folderCount = Object.keys(state.synced.collections.folders).length;
      const envCount = Object.keys(state.synced.environments.items).length;
      const mockCount = Object.keys(state.synced.mockServers).length;
      const parts = [
        `${reqCount} request${reqCount !== 1 ? 's' : ''}`,
        `${folderCount} folder${folderCount !== 1 ? 's' : ''}`,
        `${envCount} env${envCount !== 1 ? 's' : ''}`,
      ];
      if (mockCount > 0) {
        parts.push(`${mockCount} mock${mockCount !== 1 ? 's' : ''}`);
      }

      const item = new vscode.TreeItem(ws.label, vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('briefcase');
      item.description = parts.join(' · ');
      item.contextValue = 'workspace-active';
      item.tooltip = new vscode.MarkdownString(
        `**${ws.label}**\n\n` +
          `Source: \`${ws.source}\`\n\n` +
          `Path: \`${ws.apicircleDir}\`\n\n` +
          `${reqCount} requests · ${folderCount} folders · ${envCount} environments · ${mockCount} mocks`,
      );
      return item;
    }

    const item = new vscode.TreeItem(element.label, vscode.TreeItemCollapsibleState.None);
    item.description = element.value;
    item.iconPath = new vscode.ThemeIcon(element.icon);
    return item;
  }

  async getChildren(element?: WorkspaceNode): Promise<WorkspaceNode[]> {
    if (!element) {
      return [{ kind: 'active' }];
    }

    if (element.kind === 'active') {
      const active = this.bridge.activeWorkspace();
      if (!active) return [];

      const ws = active.workspace;
      const state = await active.read();
      const reqCount = Object.keys(state.synced.collections.requests).length;
      const folderCount = Object.keys(state.synced.collections.folders).length;
      const envCount = Object.keys(state.synced.environments.items).length;
      const mockCount = Object.keys(state.synced.mockServers).length;
      const planCount = Object.keys(state.synced.executionPlans ?? {}).length;

      const children: WorkspaceNode[] = [
        { kind: 'stat', label: 'Source', value: ws.source, icon: 'git-branch' },
        { kind: 'stat', label: 'Path', value: ws.apicircleDir, icon: 'folder-opened' },
        { kind: 'stat', label: 'Requests', value: String(reqCount), icon: 'send' },
        { kind: 'stat', label: 'Folders', value: String(folderCount), icon: 'folder' },
        { kind: 'stat', label: 'Environments', value: String(envCount), icon: 'symbol-variable' },
        { kind: 'stat', label: 'Mocks', value: String(mockCount), icon: 'server' },
        { kind: 'stat', label: 'Plans', value: String(planCount), icon: 'checklist' },
      ];

      const allWs = this.bridge.listWorkspaces();
      if (allWs.length > 1) {
        children.push({
          kind: 'stat',
          label: 'Available workspaces',
          value: String(allWs.length),
          icon: 'library',
        });
      }

      return children;
    }

    return [];
  }
}
