import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { AiClient } from '@apicircle/mcp-server';
import { MCP_PROMPTS, MCP_PROMPT_CATEGORIES, type McpPromptCategory } from '@apicircle/mcp-server';
import { aiClientDisplayName, type VsCodeMcpManager } from '../host/mcpManager';
import { INSTALLABLE_CLIENTS, type InstallableClient } from '../host/mcpClientInstall';

// =============================================================================
// McpView — surfaces the MCP tool catalog + per-AI-client config file links
// + curated starter prompts grouped by category.
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
//   ▸ Prompts
//       Workspaces (3)                     ← click = open catalog in editor
//       Collections (4)
//       Environments (3)
//       Execution (3)
//       Mocks (3)
//       Auth (2)
//       Imports (2)
//   ▸ Open Connect Guide                  (footer command row)
//
// Clicking a client row opens its config file directly (creating it with
// the apicircle snippet pre-populated when the file doesn't exist yet).
// Inline icons show Install (when absent/stale) or Uninstall (when installed).
// Clicking a prompt category opens a read-only Markdown document listing every
// prompt in that category with its description, an explanation, and the MCP
// tools it drives — copy any single prompt via the ⧉ Copy prompt CodeLens.
// =============================================================================

export type McpNode =
  | { kind: 'header' }
  | { kind: 'clients-section' }
  | { kind: 'client'; client: AiClient }
  | { kind: 'prompts-section' }
  | { kind: 'prompt-category'; category: McpPromptCategory; label: string }
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
          `Open a folder containing an API Circle workspace (\`.apicircle/\`) to surface MCP config snippets.`,
        );
      }
      item.contextValue = paths.hasActiveWorkspace ? 'mcp-header-active' : 'mcp-header-idle';
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
      return this.renderClientRow(node);
    }

    if (node.kind === 'prompts-section') {
      const item = new vscode.TreeItem('Prompts', vscode.TreeItemCollapsibleState.Collapsed);
      item.iconPath = new vscode.ThemeIcon('sparkle');
      item.contextValue = 'mcp-prompts-section';
      item.tooltip = new vscode.MarkdownString(
        `Curated starter prompts you can copy and paste into any MCP-connected AI client to drive this workspace.`,
      );
      return item;
    }

    if (node.kind === 'prompt-category') {
      const count = MCP_PROMPTS.filter((p) => p.category === node.category).length;
      // Leaf row: clicking opens the category's prompts as a read-only Markdown
      // document instead of expanding inline — the document carries each
      // prompt's description, an explanation, and per-prompt copy lenses.
      const item = new vscode.TreeItem(node.label, vscode.TreeItemCollapsibleState.None);
      item.description = `${count}`;
      item.iconPath = new vscode.ThemeIcon('book');
      item.contextValue = 'mcp-prompt-category';
      item.tooltip = new vscode.MarkdownString(
        `Open the **${node.label}** starter prompts in the editor — ${count} prompt${count === 1 ? '' : 's'} with descriptions you can copy into any MCP-connected AI client.`,
      );
      item.command = {
        command: 'apicircle.openMcpPromptCategory',
        title: 'Open Prompts',
        arguments: [{ category: node.category, label: node.label }],
      };
      return item;
    }

    // connect-guide
    return this.renderConnectGuideRow();
  }

  private renderClientRow(node: { kind: 'client'; client: AiClient }): vscode.TreeItem {
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

  private renderConnectGuideRow(): vscode.TreeItem {
    const item = new vscode.TreeItem('Open Connect Guide', vscode.TreeItemCollapsibleState.None);
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
      if (!this.mcp.resolvePaths().hasActiveWorkspace) return [];
      return [
        { kind: 'header' },
        { kind: 'clients-section' },
        { kind: 'prompts-section' },
        { kind: 'connect-guide' },
      ];
    }
    if (node.kind === 'clients-section') {
      return this.mcp.supportedClients().map((c) => ({ kind: 'client' as const, client: c }));
    }
    if (node.kind === 'prompts-section') {
      return MCP_PROMPT_CATEGORIES.map((c) => ({
        kind: 'prompt-category' as const,
        category: c.id,
        label: c.label,
      }));
    }
    // prompt-category rows are leaves now — clicking opens the catalog document
    // (apicircle.openMcpPromptCategory) rather than expanding inline.
    return [];
  }
}
