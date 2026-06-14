import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { ReleasesCodeLensProvider } from './releasesCodeLens';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const RELEASES_URI = Uri.parse('apicircle://x/releases/releases.yaml');

describe('ReleasesCodeLensProvider', () => {
  it('returns [] for non-apicircle scheme', () => {
    const p = new ReleasesCodeLensProvider();
    expect(
      p.provideCodeLenses(
        makeDoc(Uri.parse('file:///releases.yaml'), ['currentVersion: 1']),
        fakeToken,
      ),
    ).toEqual([]);
  });

  it('returns [] for apicircle URIs that are not releases.yaml', () => {
    const p = new ReleasesCodeLensProvider();
    expect(
      p.provideCodeLenses(
        makeDoc(Uri.parse('apicircle://x/mocks/m.yaml'), ['currentVersion: 1']),
        fakeToken,
      ),
    ).toEqual([]);
  });

  it('offers ▶ Publish on the currentVersion line', () => {
    const p = new ReleasesCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(RELEASES_URI, ['currentVersion: null', 'versions: []']),
      fakeToken,
    );
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toBe('▶ Publish release…');
    expect(lenses[0].command?.command).toBe('apicircle.publishRelease');
  });

  it('offers Deprecate + Withdraw on a published version', () => {
    const p = new ReleasesCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(RELEASES_URI, [
        'currentVersion: 1.0.0',
        'versions:',
        '  - version: 1.0.0',
        '    status: published',
      ]),
      fakeToken,
    );
    const titles = lenses.map((l) => l.command?.title);
    expect(titles).toContain('▶ Publish release…');
    expect(titles).toContain('⚠ Deprecate');
    expect(titles).toContain('⛔ Withdraw');
    const deprecate = lenses.find((l) => l.command?.title === '⚠ Deprecate');
    expect(deprecate?.command?.command).toBe('apicircle.deprecateRelease');
    expect(deprecate?.command?.arguments).toEqual([{ version: '1.0.0' }]);
  });

  it('hides Deprecate when already deprecated', () => {
    const p = new ReleasesCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(RELEASES_URI, [
        'currentVersion: 1.0.0',
        'versions:',
        '  - version: 1.0.0',
        '    status: deprecated',
      ]),
      fakeToken,
    );
    const titles = lenses.map((l) => l.command?.title);
    expect(titles).not.toContain('⚠ Deprecate');
    expect(titles).toContain('⛔ Withdraw');
  });

  it('hides both Deprecate and Withdraw when already deprecated+withdrawn', () => {
    const p = new ReleasesCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(RELEASES_URI, [
        'currentVersion: 1.0.0',
        'versions:',
        '  - version: 1.0.0',
        '    status: deprecated+withdrawn',
      ]),
      fakeToken,
    );
    const titles = lenses.map((l) => l.command?.title);
    expect(titles).not.toContain('⚠ Deprecate');
    expect(titles).not.toContain('⛔ Withdraw');
  });

  it('handles multiple versions independently', () => {
    const p = new ReleasesCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(RELEASES_URI, [
        'currentVersion: 1.2.0',
        'versions:',
        '  - version: 1.2.0',
        '    status: published',
        '  - version: 1.0.0',
        '    status: withdrawn',
      ]),
      fakeToken,
    );
    const withdrawArgs = lenses
      .filter((l) => l.command?.title === '⛔ Withdraw')
      .map((l) => l.command?.arguments);
    // Only v1.2.0 is still withdrawable; v1.0.0 already withdrawn.
    expect(withdrawArgs).toEqual([[{ version: '1.2.0' }]]);
  });
});
