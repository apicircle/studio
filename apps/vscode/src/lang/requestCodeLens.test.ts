import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { RequestCodeLensProvider } from './requestCodeLens';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {
  isCancellationRequested: false,
  onCancellationRequested: () => ({ dispose: () => undefined }),
} as unknown as vscode.CancellationToken;

describe('RequestCodeLensProvider', () => {
  const provider = new RequestCodeLensProvider();

  it('returns [] for non-apicircle documents', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('file:///foo.yaml'), ['name: x', 'method: GET']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] for apicircle URIs that are not .req.yaml', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/responses/r.run.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('emits a Send lens at the name: line', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        '# comment',
        'name: Get user',
        'method: GET',
        'url: https://x.com',
      ]),
      fakeToken,
    );
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toBe('▶ Send');
    expect(lenses[0].command?.command).toBe('apicircle.sendRequest');
    // The lens range targets line 1 (where `name:` lives)
    expect(lenses[0].range.start.line).toBe(1);
  });

  it('only emits one lens even if name: appears in comments or strings later', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), [
        'name: x',
        'description: "the name: in this comment shouldn\'t fire"',
        'name: nope',
      ]),
      fakeToken,
    );
    expect(lenses).toHaveLength(1);
    expect(lenses[0].range.start.line).toBe(0);
  });

  it('returns [] when no name: line is present', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/abc.req.yaml'), ['# no name field']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('refresh() fires the onDidChangeCodeLenses event', () => {
    const p = new RequestCodeLensProvider();
    let fired = false;
    p.onDidChangeCodeLenses(() => (fired = true));
    p.refresh();
    expect(fired).toBe(true);
    p.dispose();
  });
});
