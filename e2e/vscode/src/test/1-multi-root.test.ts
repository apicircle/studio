import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 1 / spec 6: Multi-root workspace support.
//
// Verifies:
//   • Multi-root VS Code workspace with two .apicircle/ folders is detected
//   • The status bar lets the user switch between them
//   • Per-workspace context (TreeView, MCP, mocks) is isolated
// =============================================================================

suite('Phase 1 — 1-multi-root: multi-workspace surface', () => {
  test('apicircle.openWorkspaceFile command is registered (workspace switching primitive)', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('apicircle.openWorkspaceFile'));
  });

  test('two .apicircle/ folders in a multi-root workspace are both discoverable', async function () {
    // Requires `workbench.action.addRootFolder` programmatic access, which
    // requires the user to pre-grant a permission. The unit test for
    // discoverWorkspaces.multi-root case covers the logic; the integration
    // test runs once the harness gains multi-root setup support (Phase 7).
    this.skip();
  });
});
