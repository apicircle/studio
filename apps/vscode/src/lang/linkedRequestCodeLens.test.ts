import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { LinkedRequestCodeLensProvider } from './linkedRequestCodeLens';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}
const fakeToken = {} as unknown as vscode.CancellationToken;

describe('LinkedRequestCodeLensProvider', () => {
  it('returns [] for non-linked request docs', () => {
    const p = new LinkedRequestCodeLensProvider();
    expect(
      p.provideCodeLenses(
        makeDoc(Uri.parse('apicircle://x/requests/r.yaml?id=1'), ['name: x']),
        fakeToken,
      ),
    ).toEqual([]);
  });

  it('offers ▶ Send + ↺ Reset on the name line with link+id args', () => {
    const p = new LinkedRequestCodeLensProvider();
    const lenses = p.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/linked/Payments/List.yaml?link=lw1&id=req-1'), [
        'name: List pets',
        'method: GET',
      ]),
      fakeToken,
    );
    const titles = lenses.map((l) => l.command?.title);
    expect(titles).toContain('▶ Send');
    expect(titles).toContain('↺ Reset to source');
    const send = lenses.find((l) => l.command?.title === '▶ Send');
    expect(send?.command?.command).toBe('apicircle.sendRequest');
    const reset = lenses.find((l) => l.command?.title === '↺ Reset to source');
    expect(reset?.command?.command).toBe('apicircle.resetLinkedRequest');
    expect(reset?.command?.arguments).toEqual([{ linkId: 'lw1', requestId: 'req-1' }]);
  });

  it('returns [] when link/id query is missing', () => {
    const p = new LinkedRequestCodeLensProvider();
    expect(
      p.provideCodeLenses(
        makeDoc(Uri.parse('apicircle://x/linked/P/L.yaml'), ['name: x']),
        fakeToken,
      ),
    ).toEqual([]);
  });
});
