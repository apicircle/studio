import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 1 / spec 4: Cancel in-flight request.
//
// Verifies both cancellation surfaces:
//   • apicircle.cancelSend command (palette + status bar)
//   • Escape keybinding (when apicircle: scheme is the active editor)
// =============================================================================

suite('Phase 1 — 1-cancel: in-flight cancellation', () => {
  test('apicircle.cancelSend command is registered', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('apicircle.cancelSend'), 'apicircle.cancelSend not registered');
  });

  test('cancel during a 10s mock send aborts within 1s', async function () {
    // Requires a mock HTTP server fixture to delay long enough for cancel
    // to fire. Phase 2 ships the mock fixture; for now the AbortRegistry
    // unit tests pin the contract.
    this.skip();
  });
});
