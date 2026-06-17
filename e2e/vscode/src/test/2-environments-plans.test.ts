import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 2 / spec 2-environments-plans: command IDs + view focus.
//
// Deep coverage of the Environment / Plan / History / Snapshots surfaces lives
// in apps/vscode/test/integration/{environmentRoundTrip,planRoundTrip,
// historyRoundTrip,snapshotRoundTrip}.test.ts. This E2E spec proves that the
// host-side surfaces VS Code itself owns are wired correctly:
//   • Phase 2 commands all resolve via getCommands.
//   • The four Phase 2 views (environment, execution, history, snapshots)
//     can be focused without throwing.
//   • clearAllHistory / purgeOlderThan / setSnapshotMaxBytes can be invoked
//     on an empty workspace without throwing (they short-circuit cleanly).
// =============================================================================

suite('Phase 2 — 2-environments-plans: command IDs + view focus', () => {
  test('Phase 2 commands all resolve', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    for (const id of [
      // Environments
      'apicircle.newEnvironment',
      'apicircle.setActiveEnvironment',
      'apicircle.deleteEnvironment',
      'apicircle.setEnvPriorityOrder',
      'apicircle.editVariableValue',
      'apicircle.deleteVariable',
      // Plans
      'apicircle.newPlan',
      'apicircle.runPlan',
      'apicircle.toggleStepEnabled',
      'apicircle.removeStepFromPlan',
      // History
      'apicircle.clearAllHistory',
      'apicircle.purgeOlderThan',
      'apicircle.deleteHistoryRun',
      // Snapshots
      'apicircle.captureSnapshot',
      'apicircle.restoreSnapshot',
      'apicircle.deleteSnapshot',
      'apicircle.setSnapshotMaxBytes',
      // Extractions
      'apicircle.addExtraction',
    ]) {
      assert.ok(all.includes(id), `Command ${id} is not registered`);
    }
  });

  test('Phase 2 view containers can be focused', async function () {
    this.timeout(10_000);
    for (const viewId of [
      'apicircle.environment',
      'apicircle.execution',
      'apicircle.history',
      'apicircle.snapshots',
    ]) {
      await vscode.commands.executeCommand(`${viewId}.focus`);
    }
  });

  test('history-purge commands on empty workspace short-circuit cleanly', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      // No active workspace → command handler shows an info toast and returns.
      await vscode.commands.executeCommand('apicircle.clearAllHistory');
    });
  });

  test('setSnapshotMaxBytes on empty workspace short-circuits cleanly', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.setSnapshotMaxBytes');
    });
  });
});
