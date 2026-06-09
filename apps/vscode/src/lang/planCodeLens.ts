import * as vscode from 'vscode';

// =============================================================================
// CodeLens provider for apicircle-plan YAML documents.
//
// Renders above the `name:` line:
//   ▶ Run Plan
//
// Pulls the plan id out of the URI path so `apicircle.runPlan` can target
// the exact plan without a QuickPick.
// =============================================================================

const NAME_LINE_RE = /^name:\s*(.+)$/;

export class PlanCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.plan.yaml')) return [];

    const planId = extractPlanId(document.uri.path);
    if (!planId) return [];

    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (NAME_LINE_RE.exec(text)) {
        const range = new vscode.Range(line, 0, line, text.length);
        lenses.push(
          new vscode.CodeLens(range, {
            title: '▶ Run Plan',
            command: 'apicircle.runPlan',
            arguments: [{ kind: 'plan', id: planId }],
          }),
        );
        break; // only the first name: line
      }
    }
    return lenses;
  }

  refresh(): void {
    this._onDidChange.fire();
  }
}

function extractPlanId(uriPath: string): string | undefined {
  // /plans/<id>.plan.yaml
  const m = /\/plans\/([^/]+)\.plan\.yaml$/.exec(uriPath);
  return m ? m[1] : undefined;
}
