import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { FolderCompletionProvider } from './folderCompletion';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

function position(line: number, character: number): vscode.Position {
  return { line, character } as unknown as vscode.Position;
}

describe('FolderCompletionProvider', () => {
  const provider = new FolderCompletionProvider();

  it('returns [] on non-apicircle documents', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('file:///x.yaml'), ['  type: ']),
      position(0, 8),
    );
    expect(items).toEqual([]);
  });

  it('returns [] on apicircle URIs that are not .yaml', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml'), ['  type: ']),
      position(0, 8),
    );
    expect(items).toEqual([]);
  });

  it('offers all 17 RequestAuth types when typing under auth:', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/folders/f.yaml?id=fA'), ['name: Auth', 'auth:', '  type: ']),
      position(2, 8),
    );
    const labels = items.map((i) => i.label);
    expect(labels).toContain('bearer');
    expect(labels).toContain('inherit');
    expect(labels).toContain('none');
    expect(labels).toContain('oauth2-client-credentials');
    expect(labels).toContain('aws-sigv4');
    expect(labels).toContain('jwt-bearer');
    expect(labels).toHaveLength(17);
  });

  it('does NOT offer auth-type completions outside an auth: block', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/folders/f.yaml?id=fA'), [
        'name: Auth',
        'somethingElse:',
        '  type: ',
      ]),
      position(2, 8),
    );
    expect(items).toEqual([]);
  });

  it('walks backward through `auth:` block contents (e.g. between scopes)', () => {
    const items = provider.provideCompletionItems(
      makeDoc(Uri.parse('apicircle://x/folders/f.yaml?id=fA'), [
        'name: Auth',
        'auth:',
        '  tokenUrl: https://idp',
        '  type: ',
      ]),
      position(3, 8),
    );
    expect(items.length).toBeGreaterThan(0);
  });
});
