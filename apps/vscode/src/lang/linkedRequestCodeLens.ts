import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CodeLens for linked-request documents (`/linked/**/*.yaml`).
//
// The doc shows the EFFECTIVE request (source + the consumer's override). The
// lenses on the `name:` line are:
//
//   ▶ Send             — runs the effective request (same path as owned requests)
//   ↺ Reset to source  — drops the override (when one exists)
//
// `▶ Send` fires the shared `apicircle.sendRequest` command, which detects the
// linked URI and resolves the effective request. `↺ Reset` carries the
// link + request ids parsed from the URI query.
// =============================================================================

const NAME_RE = /^name:/;

export class LinkedRequestCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
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
    if (uriEntityKind(document.uri) !== 'request') {
      return [];
    }
    const query = new URLSearchParams(document.uri.query || '');
    const linkId = query.get('link') ?? undefined;
    const requestId = query.get('id') ?? undefined;
    if (!linkId || !requestId) return [];

    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      if (!NAME_RE.test(document.lineAt(line).text)) continue;
      const range = new vscode.Range(line, 0, line, document.lineAt(line).text.length);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '▶ Send',
          tooltip: 'Send this linked request (source + your overrides).',
          command: 'apicircle.sendRequest',
        }),
        new vscode.CodeLens(range, {
          title: '↺ Reset to source',
          tooltip: 'Drop your local modifications to this request.',
          command: 'apicircle.resetLinkedRequest',
          arguments: [{ linkId, requestId }],
        }),
      );
      break;
    }
    return lenses;
  }
}
