import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { LinkCodeLensProvider } from './linkCodeLens';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const LINK_URI = Uri.parse('apicircle://x/links/Payments.link.yaml?id=lw1');

function titles(lenses: vscode.CodeLens[]): string[] {
  return lenses.map((l) => l.command?.title ?? '');
}

describe('LinkCodeLensProvider', () => {
  it('returns [] for non-link documents', () => {
    const p = new LinkCodeLensProvider();
    expect(
      p.provideCodeLenses(
        makeDoc(Uri.parse('apicircle://x/mocks/m.mock.yaml'), ['name: x']),
        fakeToken,
      ),
    ).toEqual([]);
  });

  it('puts lifecycle + ◆ Name lenses on the name line', () => {
    const p = new LinkCodeLensProvider();
    const lenses = p.provideCodeLenses(makeDoc(LINK_URI, ['name: Payments API']), fakeToken);
    const t = titles(lenses);
    expect(t).toContain('⟳ Refresh ledger');
    expect(t).toContain('📓 Changelog');
    expect(t).toContain('⊗ Unlink');
    expect(t).toContain('◆ Name');
    // Args carry the document URI so commands re-derive the link id.
    const unlink = lenses.find((l) => l.command?.title === '⊗ Unlink');
    expect(unlink?.command?.command).toBe('apicircle.unlinkWorkspace');
    expect(unlink?.command?.arguments?.[0]).toBe(LINK_URI);
  });

  it('puts field-editor lenses on their fields', () => {
    const p = new LinkCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(LINK_URI, [
        'name: x',
        'description: hi',
        'pinnedVersion: 1.0.0',
        'scope:',
        '  - collections',
        'sessionMode: workspace',
      ]),
      fakeToken,
    );
    const t = titles(lenses);
    expect(t).toContain('◆ Description');
    expect(t).toContain('◆ Pinned version');
    expect(t).toContain('◆ Scope');
    expect(t).toContain('◆ Session mode');
  });

  it('puts a ✚ Add on requiredSecretKeyIds and ⊘ Remove on each key row', () => {
    const p = new LinkCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(LINK_URI, ['name: x', 'requiredSecretKeyIds:', '  - k1', '  - k2', 'marketplace:']),
      fakeToken,
    );
    expect(titles(lenses)).toContain('✚ Add required key');
    const removes = lenses.filter((l) => l.command?.title === '⊘ Remove');
    expect(removes).toHaveLength(2);
    expect(removes[0].command?.arguments).toEqual([LINK_URI, 'k1']);
    expect(removes[1].command?.arguments).toEqual([LINK_URI, 'k2']);
  });
});
