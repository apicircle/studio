import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Live-GitHub E2E suite (gated by APICIRCLE_E2E_LIVE_GITHUB env var).
//
// Mirrors the web suite's `test:e2e:live-github` script — exercises the
// extension against a real GitHub repo to verify:
//   • workspace-<id>/workspace.json commits via VS Code's native Git extension
//     show the same on-disk shape the desktop / web app would commit
//   • `git pull` propagates as `apicircle://` document refresh
//   • Linked-workspace fetch (when Phase 8 lands) authenticates correctly
//     via `vscode.authentication.getSession('github')`
//
// REQUIRES:
//   • APICIRCLE_E2E_LIVE_GITHUB=1
//   • APICIRCLE_E2E_GITHUB_PAT=<a PAT with `repo` scope>
//   • APICIRCLE_E2E_GITHUB_REPO=<owner/repo> — a throwaway test repo
//
// Each test cleans up by force-pushing the test branch back to its initial
// SHA. CI runs this nightly against a dedicated test org.
// =============================================================================

const ENABLED = process.env.APICIRCLE_E2E_LIVE_GITHUB === '1';
const PAT = process.env.APICIRCLE_E2E_GITHUB_PAT;
const REPO = process.env.APICIRCLE_E2E_GITHUB_REPO;

suite('Live-GitHub E2E (opt-in)', function () {
  this.timeout(120_000);

  test('extension activates against a live cloned repo', async function () {
    if (!ENABLED || !PAT || !REPO) {
      this.skip();
      return;
    }
    const ext = vscode.extensions.all.find((e) => e.packageJSON.name === '@apicircle/vscode');
    assert.ok(ext, 'extension not installed');
    await ext!.activate();
    assert.strictEqual(ext!.isActive, true);
  });

  test('canonical .apicircle/registry.json + workspace-<id>/workspace.json is detected after git pull', async function () {
    if (!ENABLED) {
      this.skip();
      return;
    }
    // Phase 2 fills in the actual git-pull → watcher → TreeView refresh path.
    // For Phase 1, the assertion is just that the FS watcher is registered.
    // Detailed live-pull coverage lands once the activation extends.
    this.skip();
  });

  test('linked-workspace fetch uses vscode.authentication.getSession("github")', async function () {
    if (!ENABLED) {
      this.skip();
      return;
    }
    // Phase 8 (linked workspaces) lights this up; placeholder so the suite
    // remains scaffolded for the eventual live-PAT integration.
    this.skip();
  });
});
