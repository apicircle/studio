import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 11 / spec 11-continue-mock-editor: Mock editor host wiring.
//
// Studio no longer owns Continue/MCP auto-configuration. Lens owns current MCP
// client onboarding. This spec stays focused on the mock editor command and
// verifies Studio does not reintroduce the old MCP setting.
// =============================================================================

suite('Phase 11 — 11-continue-mock-editor: commands + integration', () => {
  test('Phase 11 commands all resolve', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('apicircle.editMockEndpoint'));
  });

  test('editMockEndpoint without a node arg short-circuits cleanly', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.editMockEndpoint');
    });
  });

  test('Studio does not expose Continue MCP auto-configuration', () => {
    const value = vscode.workspace
      .getConfiguration('apicircle.mcp')
      .get<readonly string[]>('autoConfigureClients');
    assert.strictEqual(value, undefined);
  });
});
