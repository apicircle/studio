import * as vscode from 'vscode';
import type { ChangeSubscription, VsCodeMockController } from '../host/vscodeMockController';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CodeLens provider for apicircle-mock YAML documents.
//
// The mock.yaml file owns top-level mock metadata only — `name`, `defaultPort`,
// `cors`, plus a read-only endpoint summary list. Per-endpoint editing lives
// in the per-endpoint YAML (`mocks/<mockId>/<endpointId>.yaml`),
// reachable from the Mock sidebar's pencil icon, the row's click action, or
// the right-click context menu.
//
// The lenses on this file are:
//
//   Above `name:`        ▶ Start Mock           (when not running)
//                        ■ Stop Mock · ↻ Restart (when running)
//   Above each endpoint  ↗ Open endpoint        (opens the per-endpoint
//   `- id:` row            `<endpointId>.yaml` where method / path /
//                          rules / multiplier are edited)
//
// Mock id is read from the URI query (`?id=<mockId>`) — the path basename is
// the name slug, not the id. The lifecycle
// commands receive a `{ kind: 'server', id }` arg so they skip the QuickPick
// that would otherwise prompt for which mock; the open-endpoint lens passes
// `{ kind: 'endpoint', serverId, endpointId }` (the MockView node shape).
// =============================================================================

const NAME_LINE_RE = /^name:\s*(.+)$/;
const ENDPOINTS_RE = /^endpoints\s*:/;
// Endpoint summary rows are projected as `  - id: <epId>` directly under the
// top-level `endpoints:` key (two-space outer indent).
const ENDPOINT_ID_RE = /^\s+-\s+id:\s*['"]?([A-Za-z0-9_-]+)['"]?/;
const TOP_LEVEL_KEY_RE = /^[A-Za-z]/;

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
    if (uriEntityKind(document.uri) !== 'mock') return [];

    const mockId = extractMockId(document.uri);
    if (!mockId) return [];

    const lenses: vscode.CodeLens[] = [];
    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (!NAME_LINE_RE.exec(text)) continue;
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

    // Per-endpoint "Open" links. The endpoints: block is read-only in this
    // projection, but each row gets a lens that opens the editable
    // per-endpoint YAML — so users don't have to round-trip through the
    // sidebar to edit one endpoint they're looking at here.
    let endpointsLine = -1;
    for (let line = 0; line < document.lineCount; line++) {
      if (ENDPOINTS_RE.test(document.lineAt(line).text)) {
        endpointsLine = line;
        break;
      }
    }
    if (endpointsLine !== -1) {
      for (let line = endpointsLine + 1; line < document.lineCount; line++) {
        const text = document.lineAt(line).text;
        if (TOP_LEVEL_KEY_RE.test(text)) break; // next top-level key ends the block
        const idMatch = ENDPOINT_ID_RE.exec(text);
        if (!idMatch) continue;
        const endpointId = idMatch[1];
        lenses.push(
          new vscode.CodeLens(new vscode.Range(line, 0, line, text.length), {
            title: '↗ Open endpoint',
            tooltip:
              "Open this endpoint's editable YAML (method, path, request validation, response rules, default response, multiplier).",
            command: 'apicircle.openMockEndpointYaml',
            arguments: [{ kind: 'endpoint', serverId: mockId, endpointId }],
          }),
        );
      }
    }

    return lenses;
  }

  refresh(): void {
    this._onDidChange.fire();
  }
}

// The mock id rides in the URI query (`?id=<mockId>`) — the path basename is
// the human-readable name slug (`/mocks/<slug>.yaml`), NOT the id, so
// reading the id from the path would hand lifecycle + open-endpoint commands a
// slug that misses `synced.mockServers[id]`. Fall back to the legacy path shape
// only when no query id is present (older URIs).
function extractMockId(uri: vscode.Uri): string | undefined {
  const fromQuery = new URLSearchParams(uri.query).get('id');
  if (fromQuery) return fromQuery;
  const m = /\/mocks\/([^/]+)\.yaml$/.exec(uri.path);
  return m ? m[1] : undefined;
}
