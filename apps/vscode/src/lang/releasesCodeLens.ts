import * as vscode from 'vscode';

// =============================================================================
// CodeLens provider for the apicircle release-ledger document
// (`apicircle://<ws>/releases/releases.yaml`).
//
// The document is read-only (see releasesYaml.ts) — every mutation is a
// CodeLens action:
//
//   Above `currentVersion:`   ▶ Publish release…   (always)
//   Above each `- version:`    ⚠ Deprecate          (when not already deprecated)
//                              ⛔ Withdraw           (when not already withdrawn)
//
// Deprecate / Withdraw read the sibling `status:` line so an action already in
// effect isn't offered again.
// =============================================================================

const CURRENT_VERSION_RE = /^currentVersion\s*:/;
const VERSION_ROW_RE = /^(\s*)-\s+version:\s*['"]?([^'"\s]+)['"]?/;
const STATUS_RE = /^\s*status:\s*['"]?([a-z+]+)['"]?/;
const TOP_LEVEL_KEY_RE = /^[A-Za-z]/;

export class ReleasesCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  dispose(): void {
    this._onDidChange.dispose();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('/releases.yaml')) return [];

    const lenses: vscode.CodeLens[] = [];

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;

      if (CURRENT_VERSION_RE.test(text)) {
        const range = new vscode.Range(line, 0, line, text.length);
        lenses.push(
          new vscode.CodeLens(range, {
            title: '▶ Publish release…',
            tooltip:
              'Cut a new release of this workspace (version + notes). Fingerprinted with a SHA-256 of the workspace contents.',
            command: 'apicircle.publishRelease',
          }),
        );
        continue;
      }

      const versionMatch = VERSION_ROW_RE.exec(text);
      if (!versionMatch) continue;
      const version = versionMatch[2];
      const status = lookAheadStatus(document, line);
      const deprecated = status.includes('deprecated');
      const withdrawn = status.includes('withdrawn');
      const range = new vscode.Range(line, 0, line, text.length);

      if (!deprecated) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '⚠ Deprecate',
            tooltip: `Mark v${version} as deprecated — consumers see a warning but it stays installable.`,
            command: 'apicircle.deprecateRelease',
            arguments: [{ version }],
          }),
        );
      }
      if (!withdrawn) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '⛔ Withdraw',
            tooltip: `Withdraw v${version} — consumers are warned to move off this version.`,
            command: 'apicircle.withdrawRelease',
            arguments: [{ version }],
          }),
        );
      }
    }

    return lenses;
  }
}

/**
 * Read the `status:` value belonging to the version row at `versionLine` —
 * scan forward until the next version row or the next top-level key.
 */
function lookAheadStatus(document: vscode.TextDocument, versionLine: number): string {
  for (let i = versionLine + 1; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (TOP_LEVEL_KEY_RE.test(text)) break;
    if (VERSION_ROW_RE.test(text)) break;
    const m = STATUS_RE.exec(text);
    if (m) return m[1];
  }
  return 'published';
}
