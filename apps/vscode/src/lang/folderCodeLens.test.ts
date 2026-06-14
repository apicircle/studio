import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { FolderCodeLensProvider } from './folderCodeLens';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

describe('FolderCodeLensProvider', () => {
  const provider = new FolderCodeLensProvider();

  it('returns [] for non-apicircle documents', () => {
    expect(provider.provideCodeLenses(makeDoc(Uri.parse('file:///x.yaml'), ['name: A']))).toEqual(
      [],
    );
  });

  it('returns [] for apicircle URIs that are not .yaml', () => {
    expect(
      provider.provideCodeLenses(
        makeDoc(Uri.parse('apicircle://x/requests/abc.yaml'), ['name: A']),
      ),
    ).toEqual([]);
  });

  it('emits ✚ New request in folder + 🔑 Add auth when no auth: block exists', () => {
    const uri = Uri.parse('apicircle://x/folders/auth.yaml?id=fA');
    const lenses = provider.provideCodeLenses(makeDoc(uri, ['name: Auth']));
    const titles = lenses.map((l) => l.command?.title);
    expect(titles).toContain('✚ New request in this folder');
    expect(titles).toContain('🔑 Add auth');
    const newReq = lenses.find((l) => l.command?.command === 'apicircle.newRequestInFolder');
    expect(newReq?.command?.arguments?.[0]).toEqual({ kind: 'folder', id: 'fA' });
  });

  it('emits 🔑 Switch auth type (with current) when auth: block is present', () => {
    const uri = Uri.parse('apicircle://x/folders/auth.yaml?id=fA');
    const lenses = provider.provideCodeLenses(
      makeDoc(uri, ['name: Auth', 'auth:', '  type: bearer', '  token: t']),
    );
    const switchLens = lenses.find(
      (l) => l.command?.command === 'apicircle.switchRequestAuthType' && l.range.start.line === 1,
    );
    expect(switchLens?.command?.title).toBe('🔑 Switch auth type (current: bearer)…');
  });

  it('also emits the switch lens on the name: row when auth exists, without the Add affordance', () => {
    const uri = Uri.parse('apicircle://x/folders/auth.yaml?id=fA');
    const lenses = provider.provideCodeLenses(
      makeDoc(uri, ['name: Auth', 'auth:', '  type: bearer', '  token: t']),
    );
    const nameRowSwitch = lenses.find(
      (l) => l.range.start.line === 0 && l.command?.command === 'apicircle.switchRequestAuthType',
    );
    expect(nameRowSwitch?.command?.title).toBe('🔑 Switch auth type…');
    expect(lenses.find((l) => l.command?.title === '🔑 Add auth')).toBeUndefined();
  });

  it('emits 🔑 Get token when auth.type is an OAuth2 grant', () => {
    const uri = Uri.parse('apicircle://x/folders/auth.yaml?id=fA');
    const lenses = provider.provideCodeLenses(
      makeDoc(uri, [
        'name: Auth',
        'auth:',
        '  type: oauth2-client-credentials',
        '  tokenUrl: https://idp.example.com/oauth/token',
      ]),
    );
    const tokenLens = lenses.find((l) => l.command?.command === 'apicircle.fetchOAuth2Token');
    expect(tokenLens?.command?.title).toBe('🔑 Get token');
    expect(tokenLens?.range.start.line).toBe(1);
  });

  it('does NOT emit Get token for non-OAuth2 auth types', () => {
    const uri = Uri.parse('apicircle://x/folders/auth.yaml?id=fA');
    const lenses = provider.provideCodeLenses(
      makeDoc(uri, ['name: Auth', 'auth:', '  type: bearer', '  token: t']),
    );
    expect(lenses.find((l) => l.command?.command === 'apicircle.fetchOAuth2Token')).toBeUndefined();
  });

  it('refresh() fires the onDidChangeCodeLenses event', () => {
    const p = new FolderCodeLensProvider();
    let fired = false;
    p.onDidChangeCodeLenses(() => (fired = true));
    p.refresh();
    expect(fired).toBe(true);
    p.dispose();
  });
});
