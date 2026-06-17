import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 4 / spec 4-vault: vault command IDs + dispatch shape.
//
// Real WebCrypto + passphrase flow runs in the unit-tier integration test
// `apps/vscode/test/integration/vaultUnlock.test.ts`. This E2E spec proves
// the host-side surfaces VS Code itself owns:
//   • The six Phase 4 commands resolve via getCommands.
//   • lockVault is callable with no active workspace (no-throw smoke).
// =============================================================================

suite('Phase 4 — 4-vault: command IDs + dispatch shape', () => {
  test('unlockVault / lockVault / setupVaultPassphrase / changeVaultPassphrase / openVaultEntry / showRunsChannel all resolve', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    for (const id of [
      'apicircle.unlockVault',
      'apicircle.lockVault',
      'apicircle.setupVaultPassphrase',
      'apicircle.changeVaultPassphrase',
      'apicircle.openVaultEntry',
      'apicircle.showRunsChannel',
    ]) {
      assert.ok(all.includes(id), `Command ${id} is not registered`);
    }
  });

  test('lockVault on an empty workspace does not throw', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.lockVault');
    });
  });

  test('showRunsChannel is callable (creates + reveals the OutputChannel)', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.showRunsChannel');
    });
  });
});
