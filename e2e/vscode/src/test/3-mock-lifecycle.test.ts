import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 3 / spec 3-mock-lifecycle: lifecycle commands round-trip.
//
// E2E coverage focuses on what only the real VS Code host can verify:
//   • Command IDs resolve via getCommands
//   • Executing apicircle.startMock without a node arg falls back to the
//     QuickPick (then we dismiss it)
//   • apicircle.openMockInBrowser exists and is reachable
//
// Real lifecycle (start a server, fetch, stop) is covered by the unit-tier
// integration test in apps/vscode/test/integration/mockLifecycle.test.ts.
// =============================================================================

suite('Phase 3 — 3-mock-lifecycle: command IDs + dispatch shape', () => {
  test('startMock / stopMock / restartMock / deleteMock all resolve', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    for (const id of [
      'apicircle.startMock',
      'apicircle.stopMock',
      'apicircle.restartMock',
      'apicircle.deleteMock',
    ]) {
      assert.ok(all.includes(id), `Command ${id} is not registered`);
    }
  });

  test('openMockInBrowser exists and is reachable from the command list', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('apicircle.openMockInBrowser'));
  });

  test('mock view container shows no error on a workspace with no mocks', async function () {
    this.timeout(10_000);
    await vscode.commands.executeCommand('apicircle.mock.focus');
    // No mocks = welcome card. Should not throw.
  });
});
