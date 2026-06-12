import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { AiClient } from '@apicircle/mcp-server';
import { aiClientDisplayName, type VsCodeMcpManager } from '../host/mcpManager';
import {
  INSTALLABLE_CLIENTS,
  CLIENT_LABELS,
  type InstallableClient,
} from '../host/mcpClientInstall';

// `AiClient` is the catalog of all 10 supported clients; `InstallableClient`
// is the Phase 8 subset (5) that auto-install supports. `InstallableClient`
// is structurally assignable to `AiClient`, so the per-row probe accepts
// either without a cast. The import is used by the `McpNode` discriminated
// union below (`client: AiClient`).

/**
 * P6: Optional probe that tells the view whether `.vscode/mcp.json` (or
 * whatever `apicircle.mcp.workspaceConfigPath` resolves to) already has
 * an apicircle entry. The view uses it to render the GitHub Copilot row
 * with one of three states. Injectable so tests can pin the result
 * without filesystem setup.
 */
export type CopilotInstallState = 'absent' | 'installed-current' | 'installed-stale';
export type CopilotInstallProbe = () => CopilotInstallState;

/**
 * P8: parallel probe for the 5 external AI clients (Claude Desktop, Claude
 * Code, Cursor, Windsurf, Zed). Returns the install state of each client's
 * USER-LEVEL config file (e.g. `~/.cursor/mcp.json`), independent of P6's
 * workspace-level `.vscode/mcp.json` state.
 */
export type ClientInstallState = 'absent' | 'installed-current' | 'installed-stale';
export type ClientInstallProbe = (client: InstallableClient) => ClientInstallState;

// =============================================================================
// McpView — surfaces the 79-tool MCP catalog + per-AI-client config snippets.
//
// Layout (Phase 5):
//   ▸ MCP Server                          (header: status + tool count)
//   ▸ Connect an AI client
//     Claude Desktop          📋 Copy / 📂 Open Config
//     Claude Code             📋 Copy
//     Cursor                  📋 Copy / 📂 Open Config
//     Continue                📋 Copy / 📂 Open Config
//     Cline                   📋 Copy
//     Zed                     📋 Copy / 📂 Open Config
//     Windsurf                📋 Copy
//     GitHub Copilot          📋 Copy
//     ChatGPT                 📋 Copy
//     Other (Generic stdio)   📋 Copy
//   ▸ Open Connect Guide                  (footer command row)
//
// External AI clients launch `apicircle-mcp` themselves — VS Code's role
// is purely advisory (provide the snippet, surface the config file).
// =============================================================================

export type McpNode =
  | { kind: 'header' }
  | { kind: 'clients-section' }
  | { kind: 'client'; client: AiClient }
  | { kind: 'connect-guide' };

export class McpView extends BaseTreeView<McpNode> {
  readonly viewId = 'apicircle.mcp';

  constructor(
    private readonly mcp: VsCodeMcpManager,
    /** P6: probe for the github-copilot row's "Install for Copilot Chat"
     * affordance. Optional — without it the row falls back to the
     * generic "paste manually" labelling. */
    private readonly probeCopilotInstall?: CopilotInstallProbe,
    /** P8: probe for the 5 external-AI-client rows' install state. Same
     * three-state semantics as P6 but per-client user-level config files. */
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
          `**APICircle MCP** — exposes ${tools.length} tools over stdio.\n\n` +
            `Binary: \`${paths.binary}\`\n\nWorkspace: \`${paths.workspace}\`\n\n` +
            `External AI clients launch the binary themselves. Use the rows below to copy each client's config snippet.`,
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
      // P6: github-copilot gets a specialised row with install-state
      // detection. The row's click-to-action becomes "Install" or
      // "Update" instead of "Copy" — most users will prefer the
      // one-click flow over hand-pasting the snippet.
      if (node.client === 'github-copilot' && this.probeCopilotInstall) {
        return this.renderGithubCopilotRow(this.probeCopilotInstall());
      }
      // P8: each InstallableClient (Claude Desktop / Code, Cursor, Zed,
      // Windsurf) gets the same three-state install-aware row, pointed at
      // the user-level config file.
      if (
        this.probeClientInstall &&
        (INSTALLABLE_CLIENTS as readonly string[]).includes(node.client)
      ) {
        return this.renderInstallableClientRow(
          node.client as InstallableClient,
          this.probeClientInstall(node.client as InstallableClient),
        );
      }
      const item = new vscode.TreeItem(
        aiClientDisplayName(node.client),
        vscode.TreeItemCollapsibleState.None,
      );
      const path = this.mcp.getConfigPath(node.client);
      item.description = path ? 'config file detected' : 'paste manually';
      item.iconPath = new vscode.ThemeIcon('symbol-key');
      item.contextValue = path ? 'mcp-client-with-path' : 'mcp-client-manual';
      item.tooltip = new vscode.MarkdownString(
        `Click **Copy** to paste this client's MCP snippet into its config.${path ? `\n\nKnown config path: \`${path}\`` : ''}`,
      );
      // Default click-to-action: copy config. The context menu also
      // surfaces explicit Copy + Open Config Path actions.
      item.command = {
        command: 'apicircle.copyMcpConfig',
        title: 'Copy Config',
        arguments: [{ kind: 'client', client: node.client }],
      };
      return item;
    }

    // connect-guide — see helper below.
    return this.renderConnectGuideRow();
  }

  /**
   * P6: GitHub Copilot row with three states + click-to-install action.
   * Extracted so the test can target it directly.
   */
  private renderGithubCopilotRow(state: CopilotInstallState): vscode.TreeItem {
    const item = new vscode.TreeItem(
      aiClientDisplayName('github-copilot'),
      vscode.TreeItemCollapsibleState.None,
    );
    if (state === 'installed-current') {
      item.description = '✓ installed';
      item.iconPath = new vscode.ThemeIcon('check');
      item.contextValue = 'mcp-client-copilot-installed';
      item.tooltip = new vscode.MarkdownString(
        "APICircle MCP is installed in this workspace's `.vscode/mcp.json`. Click to copy the snippet if you also want it in a global config; otherwise just restart Copilot Chat.",
      );
      // Click on an already-installed row falls back to the copy flow
      // (in case the user wants the snippet for a different surface).
      item.command = {
        command: 'apicircle.copyMcpConfig',
        title: 'Copy Config',
        arguments: [{ kind: 'client', client: 'github-copilot' }],
      };
    } else if (state === 'installed-stale') {
      item.description = '⚠ out of date';
      item.iconPath = new vscode.ThemeIcon('refresh');
      item.contextValue = 'mcp-client-copilot-stale';
      item.tooltip = new vscode.MarkdownString(
        'APICircle MCP is installed in `.vscode/mcp.json` but the binary or workspace path is stale. Click to re-install with the current paths.',
      );
      item.command = {
        command: 'apicircle.installCopilotMcpConfig',
        title: 'Update',
      };
    } else {
      item.description = 'click to install';
      item.iconPath = new vscode.ThemeIcon('rocket');
      item.contextValue = 'mcp-client-copilot-absent';
      item.tooltip = new vscode.MarkdownString(
        'Click to write `.vscode/mcp.json` with the apicircle MCP entry — VS Code 1.86+ Copilot Chat picks it up automatically on next restart.',
      );
      item.command = {
        command: 'apicircle.installCopilotMcpConfig',
        title: 'Install',
      };
    }
    return item;
  }

  /**
   * P8: InstallableClient row with three states. Mirrors the Copilot
   * row's UX (click to install / update / re-install) but targets the
   * client's user-level config file (e.g. `~/.cursor/mcp.json`) rather
   * than `.vscode/mcp.json`. The context menu still surfaces Copy +
   * Open Config + Remove actions; the click action is install-aware.
   */
  private renderInstallableClientRow(
    client: InstallableClient,
    state: ClientInstallState,
  ): vscode.TreeItem {
    const label = CLIENT_LABELS[client];
    const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
    // `InstallableClient` is a subset of `AiClient`; the cast is structurally
    // a no-op but ESLint can't prove that from the union/subset relationship,
    // so it flags `as AiClient` as unnecessary. Drop the cast — narrowing
    // happens automatically.
    const configPath = this.mcp.getConfigPath(client);
    if (state === 'installed-current') {
      item.description = '✓ installed';
      item.iconPath = new vscode.ThemeIcon('check');
      item.contextValue = `mcp-client-${client}-installed`;
      item.tooltip = new vscode.MarkdownString(
        `APICircle MCP is installed in ${label}'s config${configPath ? ` (\`${configPath}\`)` : ''}. Click to copy the snippet, or use the context menu to remove it.`,
      );
      item.command = {
        command: 'apicircle.copyMcpConfig',
        title: 'Copy Config',
        arguments: [{ kind: 'client', client }],
      };
    } else if (state === 'installed-stale') {
      item.description = '⚠ out of date';
      item.iconPath = new vscode.ThemeIcon('refresh');
      item.contextValue = `mcp-client-${client}-stale`;
      item.tooltip = new vscode.MarkdownString(
        `APICircle MCP is installed in ${label} but the binary or workspace path is stale. Click to re-install with the current paths.`,
      );
      item.command = {
        command: 'apicircle.installMcpForClient',
        title: 'Update',
        arguments: [client],
      };
    } else {
      item.description = 'click to install';
      item.iconPath = new vscode.ThemeIcon('rocket');
      item.contextValue = `mcp-client-${client}-absent`;
      item.tooltip = new vscode.MarkdownString(
        `Click to write the APICircle MCP entry to ${label}'s config${configPath ? ` (\`${configPath}\`)` : ''}. Restart ${label} after install.`,
      );
      item.command = {
        command: 'apicircle.installMcpForClient',
        title: 'Install',
        arguments: [client],
      };
    }
    return item;
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
