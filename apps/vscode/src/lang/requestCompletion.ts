import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CompletionItemProvider for apicircle-request YAML documents.
//
// Pragmatic line-context completion (no full YAML parse) — covers the most
// common authoring moments:
//
//   • method: <cursor>           → HTTP method enum
//   • body.type: <cursor>        → body type enum (inferred from indent)
//   • auth.type: <cursor>        → 17 auth schemes
//   • assertions[].kind: <c>     → assertion kind enum
//   • assertions[].op: <cursor>  → comparison op enum
//   • extractions[].source: <c>  → source enum
//
// A Phase 6+ follow-up lifts this to a proper YAML language-server based
// provider with schema-aware path detection. This is the Phase 1 bridge —
// pragmatic line-context completion that doesn't parse the full YAML.
// =============================================================================

const METHODS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const BODY_TYPES = ['none', 'json', 'text', 'form-data', 'urlencoded', 'binary', 'xml', 'graphql'];

const AUTH_TYPES = [
  'none',
  'inherit',
  'bearer',
  'basic',
  'api-key',
  'custom-header',
  'oauth2-client-credentials',
  'oauth2-auth-code',
  'oauth2-pkce',
  'oauth2-password',
  'oauth2-implicit',
  'oauth2-device',
  'aws-sigv4',
  'digest',
  'ntlm',
  'hawk',
  'jwt-bearer',
];

const ASSERTION_KINDS = ['status', 'header', 'json-path', 'duration'];
const ASSERTION_OPS = ['equals', 'not-equals', 'contains', 'lt', 'gt', 'matches'];
const EXTRACTION_SOURCES = ['body', 'header', 'cookie', 'status'];

// The active YAML "branch" — which top-level key the cursor is currently
// nested under. Detected by scanning backward from the cursor line for the
// last non-indented `<key>:` line.
type Branch = 'root' | 'auth' | 'body' | 'assertions' | 'extractions' | 'unknown';

export class RequestCompletionProvider implements vscode.CompletionItemProvider {
  provideCompletionItems(
    document: vscode.TextDocument,
    position: vscode.Position,
    _token: vscode.CancellationToken,
    _context: vscode.CompletionContext,
  ): vscode.CompletionItem[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (uriEntityKind(document.uri) !== 'request') return [];

    const line = document.lineAt(position.line).text;
    const branch = detectBranch(document, position.line);
    const triggers = detectTrigger(line, branch);
    if (!triggers) return [];

    return triggers.values.map((v) => {
      const item = new vscode.CompletionItem(v, vscode.CompletionItemKind.EnumMember);
      item.detail = triggers.detail;
      item.insertText = v;
      return item;
    });
  }
}

interface TriggerMatch {
  values: string[];
  detail: string;
}

function detectTrigger(line: string, branch: Branch): TriggerMatch | null {
  // `method: <cursor>` at root
  if (branch === 'root' && /^\s*method:\s*\S*$/.test(line)) {
    return { values: METHODS, detail: 'HTTP method' };
  }
  // `type: <cursor>` inside auth: block
  if (branch === 'auth' && /^\s*type:\s*\S*$/.test(line)) {
    return { values: AUTH_TYPES, detail: 'Auth scheme' };
  }
  // `type: <cursor>` inside body: block
  if (branch === 'body' && /^\s*type:\s*\S*$/.test(line)) {
    return { values: BODY_TYPES, detail: 'Body type' };
  }
  // `kind: <cursor>` inside assertions[]
  if (branch === 'assertions' && /^\s*-?\s*kind:\s*\S*$/.test(line)) {
    return { values: ASSERTION_KINDS, detail: 'Assertion kind' };
  }
  // `op: <cursor>` inside assertions[]
  if (branch === 'assertions' && /^\s*-?\s*op:\s*\S*$/.test(line)) {
    return { values: ASSERTION_OPS, detail: 'Comparison op' };
  }
  // `source: <cursor>` inside extractions[]
  if (branch === 'extractions' && /^\s*-?\s*source:\s*\S*$/.test(line)) {
    return { values: EXTRACTION_SOURCES, detail: 'Extraction source' };
  }
  return null;
}

function detectBranch(document: vscode.TextDocument, line: number): Branch {
  // Scan backward for the first non-indented key:
  for (let i = line; i >= 0; i--) {
    const text = document.lineAt(i).text;
    const match = /^([a-zA-Z][a-zA-Z0-9_-]*):/.exec(text);
    if (!match) continue;
    if (text.startsWith(' ') || text.startsWith('\t')) continue;
    switch (match[1]) {
      case 'auth':
        return 'auth';
      case 'body':
        return 'body';
      case 'assertions':
        return 'assertions';
      case 'extractions':
        return 'extractions';
      default:
        return 'root';
    }
  }
  return 'unknown';
}
