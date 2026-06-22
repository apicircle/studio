import type { vi } from 'vitest';
import { describe, it, expect, beforeEach } from 'vitest';
import { Uri, window } from '../../test/mocks/vscode';
import { AbortRegistry } from '../execute/abortRegistry';
import { InFlightPlanTracker } from '../execute/inFlightPlanTracker';
import { cancelPlanRunCommand } from './cancelPlanRun';

function makeDeps() {
  return {
    abortRegistry: new AbortRegistry(),
    tracker: new InFlightPlanTracker(),
  };
}

const planUri = Uri.parse('apicircle://w/plans/Smoke.yaml?id=p1');

describe('cancelPlanRunCommand', () => {
  beforeEach(() => {
    (window.showInformationMessage as ReturnType<typeof vi.fn>).mockReset();
    window.activeTextEditor = undefined as unknown;
  });

  it('warns and exits when no URI is supplied and no active editor exists', async () => {
    await cancelPlanRunCommand(makeDeps());
    expect(window.showInformationMessage).toHaveBeenCalledWith('No plan URI in focus to cancel.');
  });

  it('warns when the URI has no in-flight run', async () => {
    const deps = makeDeps();
    await cancelPlanRunCommand(deps, planUri);
    expect(window.showInformationMessage).toHaveBeenCalledWith('No active run for this plan.');
  });

  it('falls back to the active editor URI when no URI argument is supplied', async () => {
    const deps = makeDeps();
    window.activeTextEditor = { document: { uri: planUri } } as unknown;
    deps.tracker.start('p1', 'run-1', 'Smoke');
    deps.abortRegistry.register('run-1');
    await cancelPlanRunCommand(deps);
    expect(deps.abortRegistry.hasActive()).toBe(false);
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });

  it('cancels the matching run via the abort registry on a hit', async () => {
    const deps = makeDeps();
    const signal = deps.abortRegistry.register('run-1');
    deps.tracker.start('p1', 'run-1', 'Smoke');
    await cancelPlanRunCommand(deps, planUri);
    expect(signal.aborted).toBe(true);
    expect(deps.abortRegistry.hasActive()).toBe(false);
  });

  it('clears the tracker when the run already completed (registry race)', async () => {
    const deps = makeDeps();
    deps.tracker.start('p1', 'run-stale', 'Smoke');
    await cancelPlanRunCommand(deps, planUri);
    expect(deps.tracker.isInFlight('p1')).toBe(false);
    expect(window.showInformationMessage).not.toHaveBeenCalled();
  });
});
