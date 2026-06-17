import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 8 / spec 8-autoconfigure-vault-device: command IDs + settings shape.
//
// Deep coverage of mcpClientInstall + vaultDeviceMemory lives in their
// co-located unit tests (35 + 8 tests). This E2E spec proves the host-side
// wiring:
//   • Phase 8 commands all resolve via getCommands.
//   • The three new settings exist with the right defaults.
//   • forgetVaultOnDevice on an empty workspace short-circuits cleanly.
// =============================================================================

suite('Phase 8 — 8-autoconfigure-vault-device: commands + settings', () => {
  test('Phase 8 commands all resolve', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    for (const id of [
      'apicircle.installMcpForClient',
      'apicircle.installMcpForAllClients',
      'apicircle.uninstallMcpForClient',
      'apicircle.forgetVaultOnDevice',
    ]) {
      assert.ok(all.includes(id), `Command ${id} is not registered`);
    }
  });

  test('apicircle.mcp.autoConfigureClients setting is a string array (default empty)', () => {
    const value = vscode.workspace
      .getConfiguration('apicircle.mcp')
      .get<readonly string[]>('autoConfigureClients');
    assert.ok(Array.isArray(value), 'autoConfigureClients must be an array');
    assert.strictEqual(value!.length, 0, 'default must be []');
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
