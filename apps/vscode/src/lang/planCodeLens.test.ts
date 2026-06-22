import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { Uri } from '../../test/mocks/vscode';
import { PlanCodeLensProvider } from './planCodeLens';
import { InFlightPlanTracker } from '../execute/inFlightPlanTracker';

function makeDoc(uri: unknown, lines: string[]): vscode.TextDocument {
  return {
    uri,
    lineCount: lines.length,
    lineAt: (line: number) => ({ text: lines[line] ?? '' }),
  } as unknown as vscode.TextDocument;
}

const fakeToken = {} as unknown as vscode.CancellationToken;
const PLAN_URI = 'apicircle://x/plans/Smoke.yaml?id=p-42';

describe('PlanCodeLensProvider', () => {
  it('returns [] for non-apicircle scheme', () => {
    const provider = new PlanCodeLensProvider();
    expect(
      provider.provideCodeLenses(makeDoc(Uri.parse('file:///foo.yaml'), ['name: x']), fakeToken),
    ).toEqual([]);
  });

  it('returns [] for non-plan apicircle URIs', () => {
    const provider = new PlanCodeLensProvider();
    expect(
      provider.provideCodeLenses(
        makeDoc(Uri.parse('apicircle://x/requests/r.yaml?id=r1'), ['name: x']),
        fakeToken,
      ),
    ).toEqual([]);
  });

  it('emits Run with assertions + Run + Plan environments above name:, keyed by ?id', () => {
    const provider = new PlanCodeLensProvider();
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse(PLAN_URI), ['# header', 'name: Smoke']),
      fakeToken,
    );
    expect(lenses).toHaveLength(3);
    expect(lenses[0].command?.title).toBe('▶ Run with assertions');
    expect(lenses[0].command?.command).toBe('apicircle.runPlan');
    expect(lenses[0].command?.arguments).toEqual([
      { kind: 'plan', id: 'p-42', withAssertions: true },
    ]);
    expect(lenses[1].command?.title).toBe('▶ Run');
    expect(lenses[1].command?.arguments).toEqual([
      { kind: 'plan', id: 'p-42', withAssertions: false },
    ]);
    expect(lenses[2].command?.title).toBe('◆ Plan environments…');
    expect(lenses[2].command?.command).toBe('apicircle.setPlanEnvPriority');
    expect(lenses[2].command?.arguments).toEqual([{ kind: 'plan', id: 'p-42' }]);
  });

  it('returns [] when the plan URI has no ?id query (identity unknown)', () => {
    const provider = new PlanCodeLensProvider();
    expect(
      provider.provideCodeLenses(
        makeDoc(Uri.parse('apicircle://x/plans/Smoke.yaml'), ['name: Smoke']),
        fakeToken,
      ),
    ).toEqual([]);
  });

  it('returns [] when no name / steps present', () => {
    const provider = new PlanCodeLensProvider();
    expect(provider.provideCodeLenses(makeDoc(Uri.parse(PLAN_URI), ['# nope']), fakeToken)).toEqual(
      [],
    );
  });

  it('emits ✚ Add step on the steps: line', () => {
    const provider = new PlanCodeLensProvider();
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse(PLAN_URI), ['name: Smoke', 'steps:']),
      fakeToken,
    );
    const add = lenses.find((l) => l.command?.command === 'apicircle.addStepToPlan');
    expect(add?.command?.title).toBe('✚ Add step…');
    expect(add?.command?.arguments).toEqual([{ kind: 'plan', id: 'p-42' }]);
  });

  it('emits NO per-step lenses (those live on the Execution TreeView)', () => {
    const provider = new PlanCodeLensProvider();
    const lenses = provider.provideCodeLenses(
      makeDoc(Uri.parse(PLAN_URI), [
        'name: Smoke',
        'steps:',
        '  # Login · POST',
        '  - requestId: r1',
        '  - requestId: r2',
      ]),
      fakeToken,
    );
    const commands = lenses.map((l) => l.command?.command);
    expect(commands).not.toContain('apicircle.openPlanStepRequest');
    expect(commands).not.toContain('apicircle.toggleStepEnabled');
    expect(commands).not.toContain('apicircle.changeStepRequest');
    expect(commands).not.toContain('apicircle.removeStepFromPlan');
    // Only the plan-level lenses remain (run ×2, env, add step).
    expect(commands).toEqual([
      'apicircle.runPlan',
      'apicircle.runPlan',
      'apicircle.setPlanEnvPriority',
      'apicircle.addStepToPlan',
    ]);
  });

  it('swaps to Running… + Cancel while a run is in flight', () => {
    const tracker = new InFlightPlanTracker();
    const uri = Uri.parse(PLAN_URI);
    tracker.start('p-42', 'run-1', 'Smoke'); // keyed by plan id (from ?id=p-42)
    const provider = new PlanCodeLensProvider(tracker);
    const lenses = provider.provideCodeLenses(
      makeDoc(uri, ['name: Smoke', 'steps:', '  - requestId: r1']),
      fakeToken,
    );
    const titles = lenses.map((l) => l.command?.title);
    expect(titles.some((t) => t?.startsWith('⏳ Running…'))).toBe(true);
    expect(titles).toContain('✖ Cancel');
    expect(titles).not.toContain('▶ Run with assertions');
    const cancel = lenses.find((l) => l.command?.title === '✖ Cancel');
    expect(cancel?.command?.command).toBe('apicircle.cancelPlanRun');
    expect(cancel?.command?.arguments).toEqual([uri]);
    tracker.dispose();
  });

  it('refresh() fires the change event', () => {
    const p = new PlanCodeLensProvider();
    let fired = false;
    p.onDidChangeCodeLenses(() => (fired = true));
    p.refresh();
    expect(fired).toBe(true);
  });
});
