import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { EnvironmentCodeLensProvider } from './environmentCodeLens';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;

describe('EnvironmentCodeLensProvider', () => {
  const provider = new EnvironmentCodeLensProvider();

  it('returns [] for non-apicircle documents', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('file:///foo.yaml'), ['name: prod']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] for apicircle URIs that are not .yaml', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml'), ['name: prod']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('emits two lenses (Set Active + Delete) at the name: line', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/environments/prod.yaml'), [
        '# comment',
        'name: production',
        'variables: []',
      ]),
      fakeToken,
    );
    expect(lenses).toHaveLength(2);
    expect(lenses[0].command?.title).toBe('▶ Set Active');
    expect(lenses[0].command?.command).toBe('apicircle.setActiveEnvironment');
    expect(lenses[0].command?.arguments).toEqual(['production']);
    expect(lenses[1].command?.title).toBe('✕ Delete');
    expect(lenses[1].command?.command).toBe('apicircle.deleteEnvironment');
    expect(lenses[1].command?.arguments).toEqual([{ kind: 'env', name: 'production' }]);
  });

  it('returns [] when no name: line is present', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/environments/x.yaml'), ['# no name field']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('refresh() fires the change event', () => {
    const p = new EnvironmentCodeLensProvider();
    let fired = false;
    p.onDidChangeCodeLenses(() => (fired = true));
    p.refresh();
    expect(fired).toBe(true);
  });
});
