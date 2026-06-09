import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 5 / spec 5-mcp: MCP host integration command IDs + view focus.
//
// The actual snippet copy + clipboard flow is exercised at the
// integration tier (apps/vscode/test/integration/mcpRoundTrip.test.ts).
// This E2E spec just proves the host-side surfaces VS Code itself owns:
//   • The four Phase 5 commands resolve via getCommands.
//   • The MCP view container can be focused without throwing.
// =============================================================================

suite('Phase 5 — 5-mcp: command IDs + view focus', () => {
  test('Phase 5 MCP commands all resolve', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    for (const id of [
      'apicircle.copyMcpConfig',
      'apicircle.openMcpConfigFile',
      'apicircle.openMcpConnectGuide',
      'apicircle.revealMcpBinaryInfo',
    ]) {
      assert.ok(all.includes(id), `Command ${id} is not registered`);
    }
  });

  test('revealMcpBinaryInfo on an empty workspace does not throw', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.revealMcpBinaryInfo');
    });
  });

  test('mcp view container can be focused on a workspace with no .apicircle dir', async function () {
    this.timeout(10_000);
    await vscode.commands.executeCommand('apicircle.mcp.focus');
    // No workspace = idle header. Should not throw.
  });
});
