import * as vscode from 'vscode';

// =============================================================================
// CodeLens provider for apicircle-environment YAML documents.
//
// Renders above the `name:` line:
//   ▶ Set Active · ✕ Delete
//
// Both lenses dispatch through the existing
// `apicircle.setActiveEnvironment` / `apicircle.deleteEnvironment`
// commands — the env name is passed as an argument so the user doesn't
// re-pick from a QuickPick.
// =============================================================================

const NAME_LINE_RE = /^name:\s*(.+)$/;

export class EnvironmentCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.env.yaml')) return [];

    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      const m = NAME_LINE_RE.exec(text);
      if (m) {
        const envName = m[1].trim();
        const range = new vscode.Range(line, 0, line, text.length);
        lenses.push(
          new vscode.CodeLens(range, {
            title: '▶ Set Active',
            command: 'apicircle.setActiveEnvironment',
            arguments: [envName],
          }),
        );
        lenses.push(
          new vscode.CodeLens(range, {
            title: '✕ Delete',
            command: 'apicircle.deleteEnvironment',
            arguments: [{ kind: 'env', name: envName }],
          }),
        );
        break; // Only the first name: line
      }
    }
    return lenses;
  }

  refresh(): void {
    this._onDidChange.fire();
  }
}
