import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { VsCodeVaultManager } from '../host/vaultManager';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// EnvironmentView — workspace environments + variables tree.
//
// Layout (P4 update):
//   ▾ Secret Vault: 🔓 unlocked    (header row, click → lock/unlock)
//   ▾ production ✓                (active env marked with check)
//      base_url = https://...
//      🔒 api_key  = •••••••       (encrypted; click → reveal flow)
//   ▸ staging
//      ...
//   ▸ Context Globals
//
// Click an environment → opens its .env.yaml virtual document.
// Click an encrypted variable → fires apicircle.openVaultEntry (unlock prompt
// if needed, then Copy / Show options).
// Right-click context menu: Set Active, Rename, Delete (Phase 2 + 4 ship these).
// =============================================================================

export type EnvironmentNode =
  | { kind: 'vault-header' }
  | { kind: 'env'; name: string }
  | { kind: 'variable' | 'variable-encrypted'; envName: string; key: string }
  | { kind: 'context-globals' }
  | { kind: 'global-var'; key: string };

export class EnvironmentView extends BaseTreeView<EnvironmentNode> {
  readonly viewId = 'apicircle.environment';

  constructor(
    private readonly bridge: VsCodeBridge,
    /** Vault is optional so unit tests that don't exercise it can omit it. */
    private readonly vault?: VsCodeVaultManager,
  ) {
    super();
    // Auto-refresh on vault state change so the header + lock icons update
    // the moment the user unlocks / locks / auto-locks.
    if (this.vault) {
      this.vault.onDidChange(() => this.refresh());
    }
  }

  async getTreeItem(element: EnvironmentNode): Promise<vscode.TreeItem> {
    const active = this.bridge.activeWorkspace();
    if (!active) return new vscode.TreeItem('No workspace');

    const state = await active.read();
    const activeEnvName = state.synced.environments.activeName;

    if (element.kind === 'vault-header') {
      const hasVault =
        state.synced.secretCrypto !== null && state.synced.secretCrypto !== undefined;
      const unlocked = this.vault?.isUnlocked(active.workspace.id) ?? false;
      let label: string;
      let icon: string;
      let tooltip: string;
      let contextValue: string;
      let command: vscode.Command;
      if (!hasVault) {
        label = 'Secret Vault: not configured';
        icon = 'gear';
        tooltip =
          'No passphrase set for this workspace. Click to set up a vault and start encrypting secrets.';
        contextValue = 'vault-unconfigured';
        command = {
          command: 'apicircle.setupVaultPassphrase',
          title: 'Set Up Vault Passphrase',
        };
      } else if (unlocked) {
        label = 'Secret Vault: unlocked';
        icon = 'unlock';
        tooltip = 'Vault is unlocked — encrypted variables can be revealed. Click to lock.';
        contextValue = 'vault-unlocked';
        command = { command: 'apicircle.lockVault', title: 'Lock Vault' };
      } else {
        label = 'Secret Vault: locked';
        icon = 'lock';
        tooltip = 'Vault is locked. Click to enter the passphrase.';
        contextValue = 'vault-locked';
        command = { command: 'apicircle.unlockVault', title: 'Unlock Vault' };
      }
      const item = new vscode.TreeItem(label, vscode.TreeItemCollapsibleState.None);
      item.iconPath = new vscode.ThemeIcon(icon);
      item.tooltip = tooltip;
      item.contextValue = contextValue;
      item.command = command;
      return item;
    }

    if (element.kind === 'context-globals') {
      const count = Object.keys(state.local.globalContext).length;
      const item = new vscode.TreeItem(
        'Context Globals',
        count > 0
          ? vscode.TreeItemCollapsibleState.Collapsed
          : vscode.TreeItemCollapsibleState.None,
      );
      item.description = count === 0 ? 'empty' : `${count} var(s)`;
      item.iconPath = new vscode.ThemeIcon('symbol-misc');
      item.tooltip =
        'Variables extracted from response bodies via per-request extractions.\nLocal-only; never pushed to Git.';
      item.contextValue = 'context-globals';
      return item;
    }

    if (element.kind === 'global-var') {
      const value = state.local.globalContext[element.key];
      const item = new vscode.TreeItem(
        `${element.key} = ${value ?? '(deleted)'}`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('symbol-variable');
      item.contextValue = 'global-var';
      return item;
    }

    if (element.kind === 'env') {
      const env = state.synced.environments.items[element.name];
      const isActive = element.name === activeEnvName;
      const item = new vscode.TreeItem(
        env?.name ?? '(deleted env)',
        vscode.TreeItemCollapsibleState.Collapsed,
      );
      item.iconPath = new vscode.ThemeIcon(isActive ? 'check' : 'symbol-namespace');
      item.description = isActive ? 'active' : undefined;
      item.contextValue = isActive ? 'env-active' : 'env';
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [ApicircleFsProvider.environmentUri(active.workspace.id, element.name)],
      };
      return item;
    }

    // variable row
    const env = state.synced.environments.items[element.envName];
    const variable = env?.variables.find((v) => v.key === element.key);
    if (!variable) return new vscode.TreeItem('(deleted variable)');

    const displayValue = variable.encrypted ? maskValue(variable.value) : variable.value;
    const item = new vscode.TreeItem(
      `${variable.key} = ${displayValue}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.iconPath = new vscode.ThemeIcon(variable.encrypted ? 'lock' : 'symbol-variable');
    item.contextValue = variable.encrypted ? 'variable-encrypted' : 'variable';
    item.tooltip = variable.encrypted
      ? `${variable.key} (encrypted, slot: ${variable.secretKeyId ?? '?'}) — click to reveal via vault`
      : `${variable.key} = ${variable.value}`;
    if (variable.encrypted) {
      // Click-to-open on encrypted rows fires the vault entry flow. The
      // command receives the node as its first arg.
      item.command = {
        command: 'apicircle.openVaultEntry',
        title: 'Open Vault Entry',
        arguments: [{ kind: 'variable-encrypted', envName: element.envName, key: element.key }],
      };
    }
    return item;
  }

  async getChildren(element?: EnvironmentNode): Promise<EnvironmentNode[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];
    const state = await active.read();

    if (!element) {
      // Roots: vault header (always present), env nodes, Context Globals.
      const activeEnvName = state.synced.environments.activeName;
      const envs = Object.values(state.synced.environments.items).sort((a, b) => {
        if (a.name === activeEnvName) return -1;
        if (b.name === activeEnvName) return 1;
        return a.name.localeCompare(b.name);
      });
      const out: EnvironmentNode[] = [{ kind: 'vault-header' }];
      out.push(...envs.map((e) => ({ kind: 'env' as const, name: e.name })));
      out.push({ kind: 'context-globals' });
      return out;
    }
    if (element.kind === 'context-globals') {
      return Object.keys(state.local.globalContext)
        .sort()
        .map((key) => ({ kind: 'global-var' as const, key }));
    }

    if (element.kind === 'env') {
      const env = state.synced.environments.items[element.name];
      if (!env) return [];
      const envName = element.name;
      return env.variables.map<EnvironmentNode>((v) => ({
        kind: v.encrypted ? 'variable-encrypted' : 'variable',
        envName,
        key: v.key,
      }));
    }

    // Leaf nodes — vault-header / variable / variable-encrypted / global-var.
    return [];
  }
}

function maskValue(value: string): string {
  if (value.length === 0) return '(empty)';
  // Show last 4 chars if length > 8 so users can recognize the value
  if (value.length > 8) return `••••${value.slice(-4)}`;
  return '••••';
}
