import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 6 / spec 6-copilot: VS Code Copilot Chat MCP install command.
//
// The integration test (apps/vscode/test/integration/copilotInstallRoundTrip.test.ts)
// exercises the actual fs round-trip. This E2E proves the host-side
// surface VS Code itself owns:
//   • `apicircle.installCopilotMcpConfig` resolves via getCommands.
//   • Executing it on an empty workspace surfaces a warning rather than
//     throwing (no active APICircle workspace).
// =============================================================================

suite('Phase 6 — 6-copilot: install command', () => {
  test('apicircle.installCopilotMcpConfig is registered', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('apicircle.installCopilotMcpConfig'));
  });

  test('installCopilotMcpConfig on a non-apicircle workspace does not throw', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.installCopilotMcpConfig');
    });
  });
});
