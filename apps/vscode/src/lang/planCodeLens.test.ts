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
      makeDoc(Uri.parse('file:///foo.plan.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('returns [] for apicircle URIs not ending in .plan.yaml', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/requests/r.req.yaml'), ['name: x']),
      fakeToken,
    );
    expect(lenses).toEqual([]);
  });

  it('emits ▶ Run Plan above the name: line with planId arg', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/plans/p-42.plan.yaml'), ['# header', 'name: Smoke']),
      fakeToken,
    );
    expect(lenses).toHaveLength(1);
    expect(lenses[0].command?.title).toBe('▶ Run Plan');
    expect(lenses[0].command?.command).toBe('apicircle.runPlan');
    expect(lenses[0].command?.arguments).toEqual([{ kind: 'plan', id: 'p-42' }]);
  });

  it('returns [] when no name: line present', () => {
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse('apicircle://x/plans/p1.plan.yaml'), ['# nope']),
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
