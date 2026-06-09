import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 10 / spec 10-embedded-mcp: Embedded MCP host commands + settings.
//
// Deep coverage of the host's security guards (loopback bind, bearer token,
// DNS rebinding) lives in apps/vscode/src/host/embeddedMcpHost.test.ts (22
// tests). This E2E spec proves the wiring:
//   • Phase 10 commands all resolve.
//   • The three new settings exist with the right defaults.
//   • copyEmbeddedMcpUrl on a not-started host short-circuits cleanly.
// =============================================================================

suite('Phase 10 — 10-embedded-mcp: commands + settings', () => {
  test('Phase 10 commands all resolve', async function () {
    this.timeout(10_000);
    const all = await vscode.commands.getCommands(true);
    for (const id of [
      'apicircle.startEmbeddedMcp',
      'apicircle.stopEmbeddedMcp',
      'apicircle.restartEmbeddedMcp',
      'apicircle.copyEmbeddedMcpUrl',
    ]) {
      assert.ok(all.includes(id), `Command ${id} is not registered`);
    }
  });

  test('embeddedHost.enabled defaults to false (opt-in)', () => {
    const value = vscode.workspace
      .getConfiguration('apicircle.mcp.embeddedHost')
      .get<boolean>('enabled');
    assert.strictEqual(value, false, 'embedded host must be off by default');
  });

  test('embeddedHost.port defaults to 0 (OS auto-pick)', () => {
    const value = vscode.workspace
      .getConfiguration('apicircle.mcp.embeddedHost')
      .get<number>('port');
    assert.strictEqual(value, 0);
  });

  test('embeddedHost.bindHost defaults to 127.0.0.1 (loopback)', () => {
    const value = vscode.workspace
      .getConfiguration('apicircle.mcp.embeddedHost')
      .get<string>('bindHost');
    assert.strictEqual(value, '127.0.0.1');
  });

  test('copyEmbeddedMcpUrl on a not-running host short-circuits cleanly', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.copyEmbeddedMcpUrl');
    });
  });

  test('stopEmbeddedMcp on a not-running host short-circuits cleanly', async function () {
    this.timeout(10_000);
    await assert.doesNotReject(async () => {
      await vscode.commands.executeCommand('apicircle.stopEmbeddedMcp');
    });
  });
});
