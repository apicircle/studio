import * as vscode from 'vscode';
import type { ChangeSubscription, VsCodeMockController } from '../host/vscodeMockController';

// =============================================================================
// CodeLens provider for apicircle-mock YAML documents.
//
// Above the `name:` line, renders the lifecycle controls:
//   • ▶ Start Mock          (when not running)
//   • ■ Stop Mock ↻ Restart (when running)
//
// Mock id is extracted from the URI path (mocks/<id>.mock.yaml). The
// commands receive a `{ kind: 'server', id }` arg so they skip the
// QuickPick that would otherwise prompt for which mock.
//
// F-G12: subscribes to the controller's onChange so the lens flips
// from ▶ Start ↔ ■ Stop instantly when the user starts/stops the mock,
// without waiting for VS Code's periodic CodeLens refresh tick.
// =============================================================================

const NAME_LINE_RE = /^name:\s*(.+)$/;

export class MockCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;
  private controllerSub: ChangeSubscription | null = null;

  constructor(private readonly controller: VsCodeMockController) {
    this.controllerSub = controller.onChange(() => this._onDidChange.fire());
  }

  dispose(): void {
    this.controllerSub?.dispose();
    this.controllerSub = null;
    this._onDidChange.dispose();
  }

  async provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): Promise<vscode.CodeLens[]> {
    if (document.uri.scheme !== 'apicircle') return [];
    if (!document.uri.path.endsWith('.mock.yaml')) return [];

    const mockId = extractMockId(document.uri.path);
    if (!mockId) return [];

    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (NAME_LINE_RE.exec(text)) {
        const range = new vscode.Range(line, 0, line, text.length);
        const arg = { kind: 'server' as const, id: mockId };
        const running = await this.controller.isRunning(mockId);
        if (running) {
          const rt = await this.controller.runtime(mockId);
          lenses.push(
            new vscode.CodeLens(range, {
              title: `■ Stop Mock${rt ? ` (:${rt.port})` : ''}`,
              command: 'apicircle.stopMock',
              arguments: [arg],
            }),
          );
          lenses.push(
            new vscode.CodeLens(range, {
              title: '↻ Restart',
              command: 'apicircle.restartMock',
              arguments: [arg],
            }),
          );
        } else {
          lenses.push(
            new vscode.CodeLens(range, {
              title: '▶ Start Mock',
              command: 'apicircle.startMock',
              arguments: [arg],
            }),
          );
        }
        break; // only the first name: line
      }
    }
    return lenses;
  }

  refresh(): void {
    this._onDidChange.fire();
  }
}

function extractMockId(uriPath: string): string | undefined {
  const m = /\/mocks\/([^/]+)\.mock\.yaml$/.exec(uriPath);
  return m ? m[1] : undefined;
}
