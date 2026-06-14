import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CodeLens provider for apicircle:// folder YAML documents.
//
// Folders carry two editable fields — `name` and `auth`. The lenses surface
// the same affordances the request YAML has, scaled down to what makes sense
// for a folder:
//
//   Above `name:`   ✚ New request in this folder · 🔑 Switch auth type…
//                    (the second swaps to "✚ Add auth" when no auth: block
//                     exists yet)
//   Above `auth:`   🔑 Switch auth type… (with the current type in the title)
//
// The auth-switch lens reuses the existing `apicircle.switchRequestAuthType`
// command — the underlying `switchSection` helper handles both request and
// folder .yaml. The "New request in this folder" lens dispatches the existing
// `apicircle.newRequestInFolder` command with the folder id parsed from the
// URI's `?id=` query so the wizard scaffolds directly inside this folder.
// =============================================================================

const NAME_LINE_RE = /^name:\s/;
const AUTH_LINE_RE = /^auth:\s*$/;
const SECTION_TYPE_RE = /^\s+type:\s*['"]?([A-Za-z0-9-]+)['"]?/;

const OAUTH2_GRANT_TYPES: ReadonlySet<string> = new Set([
  'oauth2-client-credentials',
  'oauth2-auth-code',
  'oauth2-pkce',
  'oauth2-password',
  'oauth2-implicit',
  'oauth2-device',
]);

export class FolderCodeLensProvider implements vscode.CodeLensProvider {
  private readonly _onDidChangeCodeLenses = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChangeCodeLenses.event;

  provideCodeLenses(document: vscode.TextDocument): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (uriEntityKind(document.uri) !== 'folder') return [];

    const lenses: vscode.CodeLens[] = [];
    let nameLine = -1;
    let authLine = -1;
    let authType: string | null = null;

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      if (nameLine === -1 && NAME_LINE_RE.test(text)) {
        nameLine = line;
      } else if (authLine === -1 && AUTH_LINE_RE.test(text)) {
        authLine = line;
        authType = readNestedType(document, line);
      }
    }

    const folderId = new URLSearchParams(document.uri.query || '').get('id') ?? '';

    if (nameLine !== -1) {
      const range = lineRange(document, nameLine);
      lenses.push(
        new vscode.CodeLens(range, {
          title: '✚ New request in this folder',
          tooltip:
            'Scaffold a new request directly inside this folder (skips the folder-pick step of APICircle: New Request).',
          command: 'apicircle.newRequestInFolder',
          arguments: [{ kind: 'folder', id: folderId }],
        }),
        new vscode.CodeLens(range, {
          title: authLine === -1 ? '🔑 Add auth' : '🔑 Switch auth type…',
          tooltip:
            authLine === -1
              ? 'Insert an `auth:` block so descendant requests with `auth: inherit` resolve to this folder.'
              : 'Switch the folder-level auth scheme. Replaces the existing auth: block with a fresh scaffold.',
          command: 'apicircle.switchRequestAuthType',
          arguments: [document.uri],
        }),
      );
    }

    if (authLine !== -1) {
      const range = lineRange(document, authLine);
      lenses.push(
        new vscode.CodeLens(range, {
          title: `🔑 Switch auth type${authType ? ` (current: ${authType})` : ''}…`,
          tooltip:
            'Switch the folder-level auth scheme. Replaces the existing auth: block with a fresh scaffold.',
          command: 'apicircle.switchRequestAuthType',
          arguments: [document.uri],
        }),
      );
      // Parity with request YAML: any folder carrying an OAuth2 grant gets a
      // Get-token lens. Folder-level OAuth2 is unusual but legitimate — it
      // means every descendant `inherit` request reuses the same token.
      if (authType && OAUTH2_GRANT_TYPES.has(authType)) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '🔑 Get token',
            tooltip:
              'Fetch an OAuth2 access token from the configured token URL and write accessToken / refreshToken / expiresAt back into the auth: block. The token then applies to every descendant request that inherits this auth.',
            command: 'apicircle.fetchOAuth2Token',
            arguments: [document.uri],
          }),
        );
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

function lineRange(document: vscode.TextDocument, line: number): vscode.Range {
  const text = document.lineAt(line).text;
  return new vscode.Range(line, 0, line, text.length);
}

function readNestedType(document: vscode.TextDocument, headerLine: number): string | null {
  for (let i = headerLine + 1; i < document.lineCount; i++) {
    const text = document.lineAt(i).text;
    if (/^[A-Za-z]/.test(text)) break;
    const match = SECTION_TYPE_RE.exec(text);
    if (match) return match[1];
  }
  return null;
}
