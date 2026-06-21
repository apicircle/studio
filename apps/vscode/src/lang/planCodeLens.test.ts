import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { PlanCodeLensProvider } from './planCodeLens';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;

describe('PlanCodeLensProvider', () => {
  const provider = new PlanCodeLensProvider();

  it('returns [] for non-apicircle scheme', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('file:///foo.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] for apicircle URIs not ending in .yaml', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/r.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('emits ▶ Run Plan + ◆ Plan environments… above the name: line, keyed by ?id', () => {
    // The path basename is a name slug; identity rides in the ?id= query.
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/plans/Smoke.yaml?id=p-42'), ['# header', 'name: Smoke']),
      fakeToken,
    );
    expect(lenses).toHaveLength(2);
    expect(lenses[0].command?.title).toBe('▶ Run Plan');
    expect(lenses[0].command?.command).toBe('apicircle.runPlan');
    expect(lenses[0].command?.arguments).toEqual([{ kind: 'plan', id: 'p-42' }]);
    expect(lenses[1].command?.title).toBe('◆ Plan environments…');
    expect(lenses[1].command?.command).toBe('apicircle.setPlanEnvPriority');
    expect(lenses[1].command?.arguments).toEqual([{ kind: 'plan', id: 'p-42' }]);
  });

  it('returns [] when the plan URI has no ?id query (identity unknown)', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/plans/Smoke.yaml'), ['name: Smoke']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] when no name: line present', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/plans/Smoke.yaml?id=p1'), ['# nope']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('refresh() fires the change event', () => {
    const p = new PlanCodeLensProvider();
    let fired = false;
    p.onDidChangeCodeLenses(() => (fired = true));
    p.refresh();
    expect(fired).toBe(true);
  });
});
