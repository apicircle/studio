import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CodeLens provider for apicircle-plan YAML documents.
//
// Renders above the `name:` line:
//   ▶ Run Plan   ◆ Plan environments…
//
// Pulls the plan id out of the URI's `?id=` query so `apicircle.runPlan` /
// `apicircle.setPlanEnvPriority` can target the exact plan without a QuickPick.
// (The path basename is a human-readable name slug — identity rides in the
// query so it survives renames, matching `ApicircleFsProvider.planUri`.)
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
    if (uriEntityKind(document.uri) !== 'plan') return [];

    const planId = extractPlanId(document.uri);
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
          new vscode.CodeLens(range, {
            title: '◆ Plan environments…',
            command: 'apicircle.setPlanEnvPriority',
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

function extractPlanId(uri: vscode.Uri): string | undefined {
  // Identity lives in the `?id=<planId>` query (see ApicircleFsProvider.planUri).
  const id = new URLSearchParams(uri.query || '').get('id');
  return id ?? undefined;
}
