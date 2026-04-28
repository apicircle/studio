import { describe, expect, it } from 'vitest';
import type { WorkspaceLocal } from '@apicircle/shared';
import {
  addPlan,
  addPlanStep,
  removePlan,
  removePlanStep,
  renamePlan,
  reorderPlanSteps,
  setPlanEnvPriority,
} from './planActions';

const baseLocal = (): WorkspaceLocal => ({
  schemaVersion: 1,
  workspaceId: 'ws-1',
  overrides: { items: {} },
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
  },
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
