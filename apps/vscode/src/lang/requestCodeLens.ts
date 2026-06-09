import * as vscode from 'vscode';

// =============================================================================
// CodeLens provider for apicircle:// request YAML documents.
//
// Renders above the `name:` line:
//   ▶ Send · 📋 Copy as cURL · 📝 Generate Code
//
// Phase 1 day-1 only ships the `▶ Send` lens. The other two lenses are
// deferred to a Phase 6+ language-services follow-up — they need a cURL
// serializer for the apicircle: virtual document and integration with the
// MCP `generate.code` tool (the catalog landed in Phase 5; the in-editor
// invocation is a separate UX surface).
// =============================================================================

const NAME_LINE_RE = /^name:\s/;

export class RequestCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.req.yaml')) return [];

    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (NAME_LINE_RE.test(text)) {
        const range = new vscode.Range(line, 0, line, text.length);
        lenses.push(
          new vscode.CodeLens(range, {
            title: '▶ Send',
            command: 'apicircle.sendRequest',
            arguments: [document.uri],
          }),
        );
        break; // Only the first `name:` line gets the lens
      }
    }
    return lenses;
  }

  refresh(): void {
    this._onDidChangeCodeLenses.fire();
  }

  dispose(): void {
    this._onDidChangeCodeLenses.dispose();
  }
}
