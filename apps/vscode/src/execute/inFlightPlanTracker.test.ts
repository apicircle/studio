import { describe, it, expect } from 'vitest';
import { InFlightPlanTracker } from './inFlightPlanTracker';

const PLAN_ID = 'p1';

describe('InFlightPlanTracker', () => {
  it('tracks a run start → get → end and fires onDidChange', () => {
    const t = new InFlightPlanTracker();
    let fires = 0;
    t.onDidChange(() => (fires += 1));
    expect(t.hasAny()).toBe(false);
    t.start(PLAN_ID, 'run-1', 'Smoke');
    expect(t.hasAny()).toBe(true);
    expect(t.isInFlight(PLAN_ID)).toBe(true);
    expect(t.get(PLAN_ID)).toMatchObject({ runId: 'run-1', planName: 'Smoke' });
    expect(fires).toBe(1);
    t.end(PLAN_ID);
    expect(t.hasAny()).toBe(false);
    expect(fires).toBe(2);
    t.dispose();
  });

  it('end() on an unknown plan id does not fire onDidChange', () => {
    const t = new InFlightPlanTracker();
    let fires = 0;
    t.onDidChange(() => (fires += 1));
    t.end(PLAN_ID);
    expect(fires).toBe(0);
    t.dispose();
  });

  it('snapshot reflects the current entries', () => {
    const t = new InFlightPlanTracker();
    t.start(PLAN_ID, 'run-1', 'Smoke');
    expect(t.snapshot().size).toBe(1);
    t.end(PLAN_ID);
    expect(t.snapshot().size).toBe(0);
    t.dispose();
  });
});
