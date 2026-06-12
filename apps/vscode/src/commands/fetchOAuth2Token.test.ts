import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { parseAuthBlock } from './fetchOAuth2Token';

function makeDoc(lines: string[]): vscode.TextDocument {
  return {
    lineCount: lines.length,
    getText: () => lines.join('\n'),
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: {
        start: { line, character: 0 },
        end: { line, character: (lines[line] ?? '').length },
      },
    }),
  } as unknown as vscode.TextDocument;
}

describe('parseAuthBlock', () => {
  it('returns null when auth: is absent', () => {
    expect(parseAuthBlock(makeDoc(['name: x', 'method: GET']))).toBeNull();
  });

  it('captures every nested key/value with the line number', () => {
    const doc = makeDoc([
      'name: x',
      'auth:',
      '  type: oauth2-client-credentials',
      `  tokenUrl: 'https://idp.example.com/oauth/token'`,
      `  clientId: 'app'`,
      `  clientSecret: 's3cret'`,
      `  scope: 'read write'`,
    ]);
    const parsed = parseAuthBlock(doc);
    expect(parsed).not.toBeNull();
    expect(parsed!.type).toBe('oauth2-client-credentials');
    expect(parsed!.values.tokenUrl).toBe('https://idp.example.com/oauth/token');
    expect(parsed!.values.clientId).toBe('app');
    expect(parsed!.values.scope).toBe('read write');
    expect(parsed!.fieldLines.tokenUrl).toBe(3);
    expect(parsed!.fieldLines.clientSecret).toBe(5);
  });

  it('stops at the next top-level key', () => {
    const doc = makeDoc(['auth:', `  type: 'bearer'`, `  token: 'ABC'`, 'body:', '  type: json']);
    const parsed = parseAuthBlock(doc);
    expect(parsed!.values.token).toBe('ABC');
    // The body section is excluded from the auth parse.
    expect(parsed!.values.type).toBeUndefined();
  });
});
