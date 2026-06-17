import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 1 / spec 2: APICircle.newRequest QuickPick wizard.
//
// Exercises the multi-step QuickPick flow:
//   1. Pick method
//   2. Enter URL
//   3. Pick folder
//   4. Pick auth type
//   5. Confirm name
//
// Asserts: a new request appears in workspace.json + its apicircle://
// virtual YAML opens automatically.
// =============================================================================

suite('Phase 1 — 1-new-request: wizard end-to-end', () => {
  test('command is registered and reachable from palette', async () => {
    const cmds = await vscode.commands.getCommands(true);
    assert.ok(cmds.includes('apicircle.newRequest'), 'apicircle.newRequest not registered');
  });

  test('full wizard creates a request and opens its YAML', async function () {
    // Phase 1 placeholder: actual wizard driving requires the showQuickPick
    // mocking pattern used in unit tests. Live wizard interaction lands when
    // the test-electron harness is upgraded to drive QuickPicks (Phase 2).
    this.skip();
  });
});
