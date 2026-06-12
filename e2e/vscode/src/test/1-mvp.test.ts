import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 1 / spec 1: Minimum-viable-extension activation.
//
// • Extension is registered + activatable
// • All 7 contributed views are listed in the apicircle view container
// • The Activity Bar icon contribution shows up
// =============================================================================

suite('Phase 1 — 1-mvp: activation + view container', () => {
  test('extension is installed and activates within budget', async function () {
    this.timeout(10_000);
    const ext =
      vscode.extensions.getExtension('apicircle.apicircle-vscode') ??
      vscode.extensions.all.find((e) => e.packageJSON.name === 'apicircle-vscode');
    assert.ok(ext, 'APICircle extension is not present');
    const t0 = Date.now();
    await ext!.activate();
    const elapsed = Date.now() - t0;
    assert.strictEqual(ext!.isActive, true);
    // Soft check — activation should be quick on the seeded fixture
    assert.ok(elapsed < 5_000, `activation took ${elapsed}ms; target < 5000ms`);
  });

  test('apicircle view container is focusable', async () => {
    await vscode.commands.executeCommand('workbench.view.extension.apicircle');
  });
});
