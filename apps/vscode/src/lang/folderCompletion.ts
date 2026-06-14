import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CompletionItemProvider for apicircle:// folder YAML documents.
//
// Surfaces a single completion: `type: <cursor>` inside an `auth:` block
// enumerates the 17 RequestAuth types so the user doesn't have to remember
// the literal strings.
// =============================================================================

const AUTH_TYPES: ReadonlyArray<{ value: string; label: string; detail: string }> = [
  {
    value: 'none',
    label: 'none',
    detail: 'No auth — descendants fall through to the next ancestor.',
  },
  {
    value: 'inherit',
    label: 'inherit',
    detail: "Equivalent to omitting the folder's auth — the walk continues up.",
  },
  { value: 'bearer', label: 'bearer', detail: 'Authorization: Bearer <token>' },
  { value: 'basic', label: 'basic', detail: 'Authorization: Basic base64(user:pass)' },
  {
    value: 'api-key',
    label: 'api-key',
    detail: 'Inject a key/value pair into header / query / cookie.',
  },
  { value: 'custom-header', label: 'custom-header', detail: 'Set a custom header at apply-time.' },
  {
    value: 'oauth2-client-credentials',
    label: 'oauth2-client-credentials',
    detail: 'OAuth2 — server-to-server (RFC 6749 §4.4).',
  },
  {
    value: 'oauth2-auth-code',
    label: 'oauth2-auth-code',
    detail: 'OAuth2 — authorization code (RFC 6749 §4.1).',
  },
  { value: 'oauth2-pkce', label: 'oauth2-pkce', detail: 'OAuth2 — PKCE (RFC 7636).' },
  {
    value: 'oauth2-password',
    label: 'oauth2-password',
    detail: 'OAuth2 — resource-owner password (RFC 6749 §4.3).',
  },
  {
    value: 'oauth2-implicit',
    label: 'oauth2-implicit',
    detail: 'OAuth2 — implicit, fragment-based (RFC 6749 §4.2).',
  },
  {
    value: 'oauth2-device',
    label: 'oauth2-device',
    detail: 'OAuth2 — device authorization (RFC 8628).',
  },
  {
    value: 'aws-sigv4',
    label: 'aws-sigv4',
    detail: 'AWS Signature V4 — canonical request + HMAC chain.',
  },
  { value: 'digest', label: 'digest', detail: 'RFC 7616 Digest auth — challenge / response.' },
  { value: 'ntlm', label: 'ntlm', detail: 'NTLM v2 3-way handshake.' },
  { value: 'hawk', label: 'hawk', detail: 'Mozilla Hawk MAC + payload hash.' },
  {
    value: 'jwt-bearer',
    label: 'jwt-bearer',
    detail: 'Sign a JWT (HS/RS/ES) and inject as Bearer.',
  },
];

export class FolderCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
  ): vscode.CompletionItem[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (uriEntityKind(document.uri) !== 'folder') return [];
    const line = document.lineAt(position.line).text;

    // `type:` inside an `auth:` block — only fire when the line is indented
    // (so we don't autocomplete a hypothetical top-level `type:` that
    // doesn't exist on Folder).
    if (/^\s+type:\s*\S*$/.test(line)) {
      // Confirm we're inside the auth: section by scanning backward for the
      // nearest top-level key. If it's not `auth:`, skip — folders only have
      // `name` and `auth`, so completions in any other context are wrong.
      for (let l = position.line - 1; l >= 0; l--) {
        const t = document.lineAt(l).text;
        if (/^[A-Za-z]/.test(t)) {
          if (/^auth:\s*$/.test(t)) break;
          return [];
        }
      }
      return AUTH_TYPES.map(({ value, label, detail }) => {
        const item = new vscode.CompletionItem(label, vscode.CompletionItemKind.EnumMember);
        item.detail = detail;
        item.insertText = value;
        return item;
      });
    }

    return [];
  }
}
