import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { AbortRegistry } from '../execute/abortRegistry';
import type { VsCodeVaultManager } from '../host/vaultManager';

// =============================================================================
// Status bar — three persistent items:
//
//   [Left side]  🟣 my-workspace · env: prod   ← workspace + env
//   [Left side]  ⏹ Cancel send (1)              ← only visible during sends
//   [Left side]  🔓 Vault                       ← P4: lock/unlock state for the
//                                                 active workspace, wired to
//                                                 VsCodeVaultManager.
//
// All items refresh on workspace/env/vault change. The Cancel item shows the
// count of in-flight sends; clicking runs `apicircle.cancelSend`. The Vault
// item shows the current state and clicks fire `unlockVault` (locked) or
// `lockVault` (unlocked).
// =============================================================================

export class StatusBar implements vscode.Disposable {
  private readonly workspaceItem: vscode.StatusBarItem;
  private readonly cancelItem: vscode.StatusBarItem;
  private readonly vaultItem: vscode.StatusBarItem;
  private readonly disposables: vscode.Disposable[] = [];
  private cancelPoll?: NodeJS.Timeout;

  constructor(
    private readonly bridge: VsCodeBridge,
    private readonly abortRegistry: AbortRegistry,
    /** Phase 4: vault manager is optional so unit tests that don't exercise
     * the lock state can omit it. Production callers always pass it. */
    private readonly vault?: VsCodeVaultManager,
  ) {
    this.workspaceItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 100);
    this.workspaceItem.command = 'apicircle.openWorkspaceFile';

    this.cancelItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 99);
    this.cancelItem.text = '$(debug-stop) Cancel send';
    this.cancelItem.command = 'apicircle.cancelSend';
    this.cancelItem.tooltip = 'Cancel the active APICircle send';

    // P4 wired: vault state reflects the real VsCodeVaultManager. When the
    // active workspace has no `secretCrypto` blob the item is HIDDEN to
    // avoid noise — the EnvironmentView header already surfaces the
    // "Set Up Vault Passphrase" CTA. When the blob exists the icon shows
    // lock/unlock + clicking dispatches the matching command.
    this.vaultItem = vscode.window.createStatusBarItem(vscode.StatusBarAlignment.Left, 98);

    this.disposables.push(this.workspaceItem, this.cancelItem, this.vaultItem);

    // P4: refresh on vault state change so the icon flips immediately when
    // the user unlocks / locks (and on auto-lock timer fires).
    if (this.vault) {
      this.disposables.push(this.vault.onDidChange(() => this.refresh()));
    }
    // Refresh on workspace change so a multi-root switch updates the
    // vault icon to reflect the new active workspace's state.
    this.disposables.push(this.bridge.onDidChangeActiveWorkspace(() => this.refresh()));

    this.refresh();
    // Poll cheaply for cancel-item visibility — the registry doesn't yet
    // emit events. Replaceable with an event emitter when other features
    // need it.
    this.cancelPoll = setInterval(() => this.refreshCancelItem(), 500);
  }

  refresh(): void {
    const active = this.bridge.activeWorkspace();
    if (!active) {
      this.workspaceItem.text = '$(circle-large-outline) APICircle';
      this.workspaceItem.tooltip = 'No active workspace — create or open one';
      this.workspaceItem.show();
      this.vaultItem.hide();
      return;
    }
    // Read env + secretCrypto asynchronously to avoid blocking the status
    // bar render. The vault item depends on `synced.secretCrypto` being
    // populated AND the manager reporting unlock state for this workspace.
    //
    // Cross-phase guard: read() may resolve AFTER dispose() (the test
    // tier surfaces this regularly — the bridge has been torn down and
    // returns an empty state). Guard the `synced` access so the
    // deferred callback can't throw on a disposed bar.
    void active.read().then((state) => {
      if (!state?.synced?.environments) return;
      const envName = state.synced.environments.activeName ?? '—';
      this.workspaceItem.text = `$(circle-filled) ${active.workspace.label} · env: ${envName}`;
      this.workspaceItem.tooltip = `APICircle workspace ${active.workspace.label}\nActive environment: ${envName}\nClick to open workspace.json`;
      this.workspaceItem.show();
      this.refreshVaultItem(active.workspace.id, state.synced.secretCrypto);
    });
  }

  /** Refresh the vault status-bar icon based on `secretCrypto` presence +
   * the manager's cached-key liveness check (P4 audit-R2-G3). */
  private refreshVaultItem(
    workspaceId: string,
    secretCrypto: { verifier: string } | null | undefined,
  ): void {
    if (!this.vault || !secretCrypto) {
      // No vault manager or no passphrase set yet → hide (EnvironmentView
      // surfaces the setup CTA).
      this.vaultItem.hide();
      return;
    }
    const unlocked = this.vault.isUnlockedAgainst(
      workspaceId,
      secretCrypto as unknown as Parameters<VsCodeVaultManager['isUnlockedAgainst']>[1],
    );
    if (unlocked) {
      this.vaultItem.text = '$(unlock) Vault';
      this.vaultItem.tooltip = 'Vault unlocked — click to lock.';
      this.vaultItem.command = 'apicircle.lockVault';
    } else {
      this.vaultItem.text = '$(lock) Vault';
      this.vaultItem.tooltip = 'Vault locked — click to unlock.';
      this.vaultItem.command = 'apicircle.unlockVault';
    }
    this.vaultItem.show();
  }

  refreshCancelItem(): void {
    if (this.abortRegistry.hasActive()) {
      this.cancelItem.text = `$(debug-stop) Cancel send (${this.abortRegistry.active().length})`;
      this.cancelItem.show();
    } else {
      this.cancelItem.hide();
    }
  }

  dispose(): void {
    if (this.cancelPoll) clearInterval(this.cancelPoll);
    for (const d of this.disposables) d.dispose();
  }
}
