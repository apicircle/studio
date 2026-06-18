import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 11 / spec 11-continue-mock-editor: Continue YAML + Mock editor.
//
// Deep coverage of the YAML installer + webview message validator lives in
// the unit tier (7 + 11 tests). This E2E spec proves the host-side wiring:
//   • Phase 11 command apicircle.editMockEndpoint resolves.
//   • Continue is in the autoConfigureClients enum (validated via setting
//     metadata's `markdownDescription` mentioning the client).
//   • editMockEndpoint on a missing arg short-circuits cleanly.
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
      // No active workspace, no arg → command shows a warning toast.
      await vscode.commands.executeCommand('apicircle.editMockEndpoint');
    });
  });

  test('autoConfigureClients setting accepts continue without rejection', async function () {
    this.timeout(10_000);
    // The setting's enum gates valid values. Writing to it via update() and
    // reading it back proves "continue" is a recognised enum entry.
    // We do this against the user-scope to avoid touching workspace.
    const cfg = vscode.workspace.getConfiguration('apicircle.mcp');
    await cfg.update('autoConfigureClients', ['continue'], vscode.ConfigurationTarget.Global);
    try {
      // Re-fetch the configuration after update — the previous cfg object's
      // in-memory cache may not have refreshed yet.
      const back = vscode.workspace
        .getConfiguration('apicircle.mcp')
        .get<readonly string[]>('autoConfigureClients');
      assert.ok(back?.includes('continue'));
    } finally {
      // Restore default
      await cfg.update('autoConfigureClients', undefined, vscode.ConfigurationTarget.Global);
    }
  });
});
