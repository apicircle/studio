import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CodeLens provider for apicircle:// response documents
// (URI shape: apicircle://<ws>/responses/<slug>.yaml?runId=<id>).
//
// Provides a single ⟳ Format JSON lens on the body section header when the
// body kind is JSON — mirrors the endpoint YAML's ⟳ Format JSON lens but
// operates on the raw body text below the section comment rather than on a
// YAML `content:` scalar.
// =============================================================================

const BODY_JSON_SECTION_RE = /^# ── body \(json\) ──$/;

export class ResponseCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (uriEntityKind(document.uri) !== 'response') return [];

    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      if (BODY_JSON_SECTION_RE.test(document.lineAt(line).text)) {
        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, document.lineAt(line).text.length), {
            title: '⟳ Format JSON',
            tooltip: 'Pretty-print the JSON response body with 2-space indentation.',
            command: 'apicircle.formatResponseJson',
            arguments: [document.uri, line],
          }),
        );
        break;
      }
    }
    return lenses;
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  dispose(): void {
    this._onDidChange.dispose();
  }
}

// ---------------------------------------------------------------------------
// Command handler
// ---------------------------------------------------------------------------

export async function formatResponseJsonCommand(
  uri?: vscode.Uri,
  sectionLine?: number,
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri || targetUri.scheme !== 'apicircle' || uriEntityKind(targetUri) !== 'response') {
    await vscode.window.showWarningMessage('Open an APICircle response document first.');
    return;
  }
  const document = await vscode.workspace.openTextDocument(targetUri);
  if (typeof sectionLine !== 'number' || sectionLine < 0 || sectionLine >= document.lineCount) {
    await vscode.window.showWarningMessage('The body section no longer exists.');
    return;
  }

  // Collect body lines after the section header until EOF.
  const bodyStart = sectionLine + 1;
  if (bodyStart >= document.lineCount) return;
  const bodyLines: string[] = [];
  for (let l = bodyStart; l < document.lineCount; l++) {
    bodyLines.push(document.lineAt(l).text);
  }
  const raw = bodyLines.join('\n').trim();
  if (raw.length === 0) return;

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    await vscode.window.showWarningMessage('Could not format — the body is not valid JSON.');
    return;
  }
  if (parsed === null || typeof parsed !== 'object') return;

  const pretty = JSON.stringify(parsed, null, 2);
  if (pretty === raw) return; // already formatted

  const range = new vscode.Range(
    new vscode.Position(bodyStart, 0),
    new vscode.Position(
      document.lineCount - 1,
      document.lineAt(document.lineCount - 1).text.length,
    ),
  );
  const edit = new vscode.WorkspaceEdit();
  edit.replace(targetUri, range, pretty + '\n');
  const ok = await vscode.workspace.applyEdit(edit);
  if (!ok) {
    await vscode.window.showErrorMessage('Failed to format the response body.');
    return;
  }
  await document.save();
}
