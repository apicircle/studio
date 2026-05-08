import { describe, expect, it } from 'vitest';
import type { WorkspaceLocal } from '@apicircle/shared';
import {
  addPlan,
  addPlanStep,
  duplicatePlan,
  removePlan,
  removePlanStep,
  renamePlan,
  reorderPlanSteps,
  setPlanEnvPriority,
  setPlanStepEnabled,
  setPlanStopOnFailure,
  setPlanVariables,
} from './planActions';

const baseLocal = (): WorkspaceLocal => ({
  schemaVersion: 1,
  workspaceId: 'ws-1',
  executionPlans: {},
  history: { requestRuns: [], planRuns: [] },
  secretIndex: { entries: {} },
  sessions: { github: null },
  connectedRepo: null,
  workingBranch: null,
  sync: {
    lastPulledSnapshot: null,
    lastPulledSha: null,
    lastPulledAt: null,
    dirtyKeys: [],
  },
  linkedCollections: {},
  globalContext: {},
  mockRuntime: { active: {} },
  ui: {
    activeRequestId: null,
    sidebarExpandedSections: [],
    themeId: 'studio-dark',
    fontId: 'system-mono',
  },
  settings: { validateOnSend: true, monacoConsumesWheel: false },
  snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
});

describe('addPlan', () => {
  it('inserts a fresh plan with a generated id and trimmed name', () => {
    const { local, plan } = addPlan(baseLocal(), '  Smoke checks  ');
    expect(plan.name).toBe('Smoke checks');
    expect(plan.steps).toEqual([]);
    expect(local.executionPlans[plan.id]).toBe(plan);
  });

  it('falls back to "Untitled plan" when no name supplied', () => {
    const { plan } = addPlan(baseLocal());
    expect(plan.name).toBe('Untitled plan');
  });
});

describe('removePlan', () => {
  it('drops the plan AND its history rows', () => {
    const { local: a, plan } = addPlan(baseLocal(), 'X');
    const withHistory: WorkspaceLocal = {
      ...a,
      history: {
        ...a.history,
        planRuns: [
          {
            id: 'run-1',
            planId: plan.id,
            startedAt: 't',
            durationMs: 0,
            withAssertions: false,
            steps: [],
          },
          {
            id: 'run-2',
            planId: 'other',
            startedAt: 't',
            durationMs: 0,
            withAssertions: false,
            steps: [],
          },
        ],
      },
    };
    const next = removePlan(withHistory, plan.id);
    expect(next.executionPlans[plan.id]).toBeUndefined();
    expect(next.history.planRuns.map((r) => r.id)).toEqual(['run-2']);
  });

  it('returns the same reference when the id is unknown', () => {
    const local = baseLocal();
    expect(removePlan(local, 'nope')).toBe(local);
  });
});

describe('renamePlan', () => {
  it('updates the name and ignores empty / unchanged input', () => {
    const { local: a, plan } = addPlan(baseLocal(), 'Old');
    const next = renamePlan(a, plan.id, 'New');
    expect(next.executionPlans[plan.id].name).toBe('New');
    expect(next.executionPlans[plan.id]).not.toBe(plan);

    expect(renamePlan(a, plan.id, '   ')).toBe(a);
    expect(renamePlan(a, plan.id, 'Old')).toBe(a);
  });
});

describe('addPlanStep + removePlanStep + reorderPlanSteps', () => {
  it('appends steps in order, removes by index, and reorders without losing data', () => {
    const { local: a, plan } = addPlan(baseLocal());
    let next = addPlanStep(a, plan.id, 'r1');
    next = addPlanStep(next, plan.id, 'r2');
    next = addPlanStep(next, plan.id, 'r3');
    expect(next.executionPlans[plan.id].steps.map((s) => s.requestId)).toEqual(['r1', 'r2', 'r3']);

    const removed = removePlanStep(next, plan.id, 1);
    expect(removed.executionPlans[plan.id].steps.map((s) => s.requestId)).toEqual(['r1', 'r3']);

    const reordered = reorderPlanSteps(next, plan.id, 0, 2);
    expect(reordered.executionPlans[plan.id].steps.map((s) => s.requestId)).toEqual([
      'r2',
      'r3',
      'r1',
    ]);
  });

  it('addPlanStep records linkedWorkspaceId on the step when supplied', () => {
    const { local: a, plan } = addPlan(baseLocal());
    const next = addPlanStep(a, plan.id, 'r-from-link', 'lw-1');
    expect(next.executionPlans[plan.id].steps[0]).toEqual({
      requestId: 'r-from-link',
      linkedWorkspaceId: 'lw-1',
    });
  });

  it('rejects out-of-range remove / reorder indices by returning the same reference', () => {
    const { local: a, plan } = addPlan(baseLocal());
    const withStep = addPlanStep(a, plan.id, 'r1');
    expect(removePlanStep(withStep, plan.id, 99)).toBe(withStep);
    expect(reorderPlanSteps(withStep, plan.id, 0, 99)).toBe(withStep);
    expect(reorderPlanSteps(withStep, plan.id, 0, 0)).toBe(withStep);
  });
});

describe('setPlanEnvPriority', () => {
  it('replaces the array verbatim (copy, not reference)', () => {
    const { local: a, plan } = addPlan(baseLocal());
    const order = ['prod', 'dev'];
    const next = setPlanEnvPriority(a, plan.id, order);
    expect(next.executionPlans[plan.id].envPriorityOrder).toEqual(['prod', 'dev']);
    expect(next.executionPlans[plan.id].envPriorityOrder).not.toBe(order);
  });
});

describe('setPlanStepEnabled', () => {
  it('flips a step from enabled (default) to disabled and back', () => {
    const { local: a, plan } = addPlan(baseLocal());
    const withStep = addPlanStep(a, plan.id, 'r1');
    const disabled = setPlanStepEnabled(withStep, plan.id, 0, false);
    expect(disabled.executionPlans[plan.id].steps[0].enabled).toBe(false);
    const reenabled = setPlanStepEnabled(disabled, plan.id, 0, true);
    expect(reenabled.executionPlans[plan.id].steps[0].enabled).toBe(true);
  });

  it('treats undefined as enabled — no-op when toggling enabled=true on a fresh step', () => {
    const { local: a, plan } = addPlan(baseLocal());
    const withStep = addPlanStep(a, plan.id, 'r1');
    // step.enabled is undefined; setPlanStepEnabled(true) is a no-op.
    expect(setPlanStepEnabled(withStep, plan.id, 0, true)).toBe(withStep);
  });

  it('rejects out-of-range step indices', () => {
    const { local: a, plan } = addPlan(baseLocal());
    expect(setPlanStepEnabled(a, plan.id, 0, false)).toBe(a);
  });
});

describe('setPlanStopOnFailure', () => {
  it('toggles the flag', () => {
    const { local: a, plan } = addPlan(baseLocal());
    const on = setPlanStopOnFailure(a, plan.id, true);
    expect(on.executionPlans[plan.id].stopOnAssertionFailure).toBe(true);
    const off = setPlanStopOnFailure(on, plan.id, false);
    expect(off.executionPlans[plan.id].stopOnAssertionFailure).toBe(false);
  });

  it('is a no-op when the value is unchanged', () => {
    const { local: a, plan } = addPlan(baseLocal());
    expect(setPlanStopOnFailure(a, plan.id, false)).toBe(a);
  });
});

describe('setPlanVariables', () => {
  it('replaces the variables array (deep-copy, not reference)', () => {
    const { local: a, plan } = addPlan(baseLocal());
    const vars = [
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ];
    const next = setPlanVariables(a, plan.id, vars);
    expect(next.executionPlans[plan.id].variables).toEqual(vars);
    expect(next.executionPlans[plan.id].variables).not.toBe(vars);
  });

  it('is a no-op for unknown plan ids', () => {
    const local = baseLocal();
    expect(setPlanVariables(local, 'nope', [])).toBe(local);
  });
});

describe('duplicatePlan', () => {
  it('clones steps + envPriorityOrder + variables + stopOnAssertionFailure', () => {
    const { local: a, plan } = addPlan(baseLocal(), 'Smoke');
    let withStuff = addPlanStep(a, plan.id, 'r1');
    withStuff = addPlanStep(withStuff, plan.id, 'r2');
    withStuff = setPlanEnvPriority(withStuff, plan.id, ['prod']);
    withStuff = setPlanVariables(withStuff, plan.id, [{ key: 'TOK', value: 'x' }]);
    withStuff = setPlanStopOnFailure(withStuff, plan.id, true);

    const { local: dupLocal, plan: cloned } = duplicatePlan(withStuff, plan.id);
    expect(cloned).not.toBeNull();
    expect(cloned!.name).toBe('Smoke (copy)');
    expect(cloned!.steps).toEqual(withStuff.executionPlans[plan.id].steps);
    expect(cloned!.steps).not.toBe(withStuff.executionPlans[plan.id].steps);
    expect(cloned!.envPriorityOrder).toEqual(['prod']);
    expect(cloned!.variables).toEqual([{ key: 'TOK', value: 'x' }]);
    expect(cloned!.stopOnAssertionFailure).toBe(true);
    expect(dupLocal.executionPlans[cloned!.id]).toBe(cloned);
  });

  it('avoids name collisions: "(copy 2)", "(copy 3)" on repeated dupes', () => {
    const { local: a, plan } = addPlan(baseLocal(), 'P');
    const { local: b } = duplicatePlan(a, plan.id); // P (copy)
    const { local: c, plan: c2 } = duplicatePlan(b, plan.id); // P (copy 2)
    expect(c2!.name).toBe('P (copy 2)');
    const { plan: c3 } = duplicatePlan(c, plan.id);
    expect(c3!.name).toBe('P (copy 3)');
  });

  it('returns null + same local when the source is unknown', () => {
    const local = baseLocal();
    const { local: next, plan } = duplicatePlan(local, 'nope');
    expect(plan).toBeNull();
    expect(next).toBe(local);
  });
});
