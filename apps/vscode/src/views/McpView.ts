import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { AiClient } from '@apicircle/mcp-server';
import { aiClientDisplayName, type VsCodeMcpManager } from '../host/mcpManager';
import { INSTALLABLE_CLIENTS, type InstallableClient } from '../host/mcpClientInstall';

// =============================================================================
// McpView — surfaces the MCP tool catalog + per-AI-client config file links.
//
// Layout:
//   ▸ MCP Server                          (header: status + tool count)
//   ▸ Connect an AI client
//     Claude Desktop          [Install] or [Uninstall]
//     Claude Code             [Install] or [Uninstall]
//     Codex                   [Install] or [Uninstall]
//     Cursor                  [Install] or [Uninstall]
//     Continue                [Install] or [Uninstall]
//     Cline                   (manual setup)
//     Zed                     [Install] or [Uninstall]
//     Windsurf                [Install] or [Uninstall]
//     GitHub Copilot          📂 Open Config
//     ChatGPT                 (manual setup)
//     Other (Generic stdio)   (manual setup)
//   ▸ Open Connect Guide                  (footer command row)
//
// Clicking a client row opens its config file directly (creating it with
// the apicircle snippet pre-populated when the file doesn't exist yet).
// Inline icons show Install (when absent/stale) or Uninstall (when installed).
// =============================================================================

export type McpNode =
  | { kind: 'header' }
  | { kind: 'clients-section' }
  | { kind: 'client'; client: AiClient }
  | { kind: 'connect-guide' };

/** Probe callback that returns the install state for an installable client. */
export type ClientInstallProbe = (
  client: InstallableClient,
) => 'absent' | 'installed-current' | 'installed-stale';

export class McpView extends BaseTreeView<McpNode> {
  readonly viewId = 'apicircle.mcp';

  constructor(
    private readonly mcp: VsCodeMcpManager,
    private readonly probeClientInstall?: ClientInstallProbe,
  ) {
    super();
  }

  getTreeItem(node: McpNode): vscode.TreeItem {
    if (node.kind === 'header') {
      const paths = this.mcp.resolvePaths();
      const tools = this.mcp.toolCatalog();
      const item = new vscode.TreeItem('MCP Server', vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon('plug');
      if (paths.hasActiveWorkspace) {
        item.description = `${tools.length} tools · binary: ${paths.binary}`;
        item.tooltip = new vscode.MarkdownString(
          `**API Circle MCP** — exposes ${tools.length} tools over stdio.\n\n` +
            `Binary: \`${paths.binary}\`\n\nWorkspace: \`${paths.workspace}\`\n\n` +
            `External AI clients launch the binary themselves. Click a client row below to open its config file.`,
        );
      } else {
        item.description = 'no active workspace';
        item.tooltip = new vscode.MarkdownString(
          `Open a folder containing a \`.apicircle/workspace.json\` to surface MCP config snippets.`,
        );
      }
      item.contextValue = paths.hasActiveWorkspace ? 'mcp-header-active' : 'mcp-header-idle';
      // P5R2-G13: clicking the header row surfaces the binary-info toast
      // (same content as the menu action). Without this, the header looked
      // clickable but did nothing.
      item.command = {
        command: 'apicircle.revealMcpBinaryInfo',
        title: 'Show MCP Binary Info',
      };
      return item;
    }

    if (node.kind === 'clients-section') {
      const item = new vscode.TreeItem(
        'Connect an AI client',
        vscode.TreeItemCollapsibleState.Expanded,
      );
      item.iconPath = new vscode.ThemeIcon('extensions');
      item.contextValue = 'mcp-clients-section';
      return item;
    }

    if (node.kind === 'client') {
      const item = new vscode.TreeItem(
        aiClientDisplayName(node.client),
        vscode.TreeItemCollapsibleState.None,
      );
      const configPath = this.mcp.getConfigPath(node.client);
      if (configPath) {
        const label = aiClientDisplayName(node.client);
        const installState = this.resolveInstallState(node.client);
        if (installState === 'installed-current') {
          item.description = 'installed';
          item.iconPath = new vscode.ThemeIcon('check');
          item.contextValue = 'mcp-client-installed';
        } else if (installState === 'installed-stale') {
          item.description = 'update available';
          item.iconPath = new vscode.ThemeIcon('warning');
          item.contextValue = 'mcp-client-stale';
        } else {
          item.description = 'not installed';
          item.iconPath = new vscode.ThemeIcon('circle-outline');
          item.contextValue = 'mcp-client-absent';
        }
        item.tooltip = new vscode.MarkdownString(
          `Click to open ${label}'s MCP config file.\n\nIf the file doesn't exist yet it will be created with the API Circle snippet pre-populated. Review the config and restart ${label} to activate.\n\nConfig: \`${configPath}\``,
        );
        item.command = {
          command: 'apicircle.openMcpConfigFile',
          title: 'Open Config',
          arguments: [{ kind: 'client', client: node.client }],
        };
      } else {
        item.description = 'manual setup';
        item.iconPath = new vscode.ThemeIcon('symbol-key');
        item.contextValue = 'mcp-client-manual';
        item.tooltip = new vscode.MarkdownString(
          `${aiClientDisplayName(node.client)} doesn't have a fixed MCP config path. Refer to the Connect Guide for setup instructions.`,
        );
        item.command = {
          command: 'apicircle.openMcpConnectGuide',
          title: 'Open Connect Guide',
        };
      }
      return item;
    }

    // connect-guide — see helper below.
    return this.renderConnectGuideRow();
  }

  private renderConnectGuideRow(): vscode.TreeItem {
    const item = new vscode.TreeItem('Open Connect Guide', vscode.TreeItemCollapsibleState.None);
    // P5R2-G6: link-external hints the row opens in an external browser
    // rather than within VS Code (book → was misleading).
    item.iconPath = new vscode.ThemeIcon('link-external');
    item.contextValue = 'mcp-connect-guide';
    item.command = {
      command: 'apicircle.openMcpConnectGuide',
      title: 'Open Connect Guide',
    };
    return item;
  }

  private resolveInstallState(
    client: AiClient,
  ): 'absent' | 'installed-current' | 'installed-stale' {
    if (!this.probeClientInstall) return 'absent';
    if (!(INSTALLABLE_CLIENTS as readonly string[]).includes(client)) return 'absent';
    return this.probeClientInstall(client as InstallableClient);
  }

  getChildren(node?: McpNode): McpNode[] {
    if (!node) {
      return [{ kind: 'header' }, { kind: 'clients-section' }, { kind: 'connect-guide' }];
    }
    if (node.kind === 'clients-section') {
      return this.mcp.supportedClients().map((c) => ({ kind: 'client' as const, client: c }));
    }
    return [];
  }
}
