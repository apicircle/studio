import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 4 / spec 4-runs-channel: APICircle Runs OutputChannel discoverability.
//
// The consolidated "APICircle Runs" channel replaces the per-feature ad-hoc
// channels Phase 3 had ("APICircle Mock"). After invoking showRunsChannel
// the picker should expose it. The channel is created lazily — discoverability
// is the load-bearing claim.
// =============================================================================

suite('Phase 4 — 4-runs-channel: APICircle Runs OutputChannel', () => {
  test('showRunsChannel command resolves', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    assert.ok(all.includes('apicircle.showRunsChannel'));
  });

  test('invoking showRunsChannel creates the OutputChannel (no error)', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.showRunsChannel');
    });
  });
});
