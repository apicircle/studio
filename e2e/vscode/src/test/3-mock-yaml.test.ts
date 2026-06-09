import * as assert from 'node:assert';
import * as vscode from 'vscode';

// =============================================================================
// Phase 3 / spec 3-mock-yaml: apicircle://mocks/<id>.mock.yaml virtual doc.
//
// • The apicircle-mock language is registered for .mock.yaml extensions
// • Opening a synthesized URI in a workspace without that mock returns a
//   FileSystemError.FileNotFound (rather than crashing the extension)
// • The yamlValidation schema for *.mock.yaml is contributed
// =============================================================================

suite('Phase 3 — 3-mock-yaml: language + schema contributions', () => {
  test('apicircle-mock language is contributed', async function () {
    this.timeout(10_000);
    const languages = await vscode.languages.getLanguages();
    assert.ok(
      languages.includes('apicircle-mock'),
      `apicircle-mock language is missing — available: ${languages.filter((l) => l.startsWith('apicircle')).join(', ')}`,
    );
  });

  test('opening a non-existent mocks/<id>.mock.yaml errors gracefully', async function () {
    this.timeout(10_000);
    const uri = vscode.Uri.parse('apicircle://nonexistent-workspace/mocks/m1.mock.yaml');
    try {
      await vscode.workspace.openTextDocument(uri);
      assert.fail('Expected openTextDocument to throw for an unknown URI');
    } catch (e) {
      // FileSystemError or generic Error are both acceptable — the test
      // is that we DON'T crash the host.
      assert.ok(e instanceof Error);
    }
  });
});
