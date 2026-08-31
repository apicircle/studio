import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 8 / spec 8-autoconfigure-vault-device: command IDs + settings shape.
//
// Studio no longer registers MCP install commands or MCP settings. Lens owns
// current MCP client onboarding. This E2E spec keeps the Studio host-side vault
// wiring covered while guarding against MCP settings drifting back in.
// =============================================================================

suite('Phase 8 — 8-autoconfigure-vault-device: commands + settings', () => {
  test('Studio registers vault device command but no MCP install commands', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('apicircle.forgetVaultOnDevice'));
    for (const id of [
      'apicircle.installMcpForClient',
      'apicircle.installMcpForAllClients',
      'apicircle.uninstallMcpForClient',
    ]) {
      assert.ok(!all.includes(id), `Command ${id} must not be registered in Studio`);
    }
  });

  test('Studio exposes no apicircle.mcp auto-config setting', () => {
    const value = vscode.workspace
      .getConfiguration('apicircle.mcp')
      .get<readonly string[]>('autoConfigureClients');
    assert.strictEqual(value, undefined);
  });

  test('apicircle.secrets.rememberOnDevice setting defaults to false', () => {
    const value = vscode.workspace
      .getConfiguration('apicircle.secrets')
      .get<boolean>('rememberOnDevice');
    assert.strictEqual(value, false);
  });

  test('forgetVaultOnDevice on empty workspace short-circuits cleanly', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.forgetVaultOnDevice');
    });
  });
});
