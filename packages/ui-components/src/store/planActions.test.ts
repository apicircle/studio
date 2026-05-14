import { describe, expect, it } from 'vitest';
import type { EnvPriorityRef, WorkspaceSynced } from '@apicircle/shared';
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

const baseSynced = (): WorkspaceSynced => ({
  schemaVersion: 1,
  workspaceId: 'ws-1',
  collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
  environments: { items: {}, activeName: null, priorityOrder: [] },
  linkedWorkspaces: {},
  linkedOverrides: { requests: {}, environmentVars: {} },
  releases: { self: null, perLink: {} },
  globalAssets: { schemas: {}, graphql: {} },
  mockServers: {},
  executionPlans: {},
  meta: { createdAt: 't', updatedAt: 't', appVersion: '0.1.0' },
});

describe('addPlan', () => {
  it('inserts a fresh plan with a generated id and trimmed name', () => {
    const { synced, plan } = addPlan(baseSynced(), '  Smoke checks  ');
    expect(plan.name).toBe('Smoke checks');
    expect(plan.steps).toEqual([]);
    expect(synced.executionPlans?.[plan.id]).toBe(plan);
  });

  it('falls back to "Untitled plan" when no name supplied', () => {
    const { plan } = addPlan(baseSynced());
    expect(plan.name).toBe('Untitled plan');
  });
});

describe('removePlan', () => {
  it('drops the plan from synced.executionPlans', () => {
    const { synced: a, plan } = addPlan(baseSynced(), 'X');
    const next = removePlan(a, plan.id);
    expect(next.executionPlans?.[plan.id]).toBeUndefined();
    // Plan-run history cleanup is a separate concern handled by the
    // store wrapper (it lives on WorkspaceLocal). The pure reducer
    // here just drops the plan record.
  });

  it('returns the same reference when the id is unknown', () => {
    const synced = baseSynced();
    expect(removePlan(synced, 'nope')).toBe(synced);
  });
});

describe('renamePlan', () => {
  it('updates the name and ignores empty / unchanged input', () => {
    const { synced: a, plan } = addPlan(baseSynced(), 'Old');
    const next = renamePlan(a, plan.id, 'New');
    expect(next.executionPlans?.[plan.id].name).toBe('New');
    expect(next.executionPlans?.[plan.id]).not.toBe(plan);

    expect(renamePlan(a, plan.id, '   ')).toBe(a);
    expect(renamePlan(a, plan.id, 'Old')).toBe(a);
  });
});

describe('addPlanStep + removePlanStep + reorderPlanSteps', () => {
  it('appends steps in order, removes by index, and reorders without losing data', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    let next = addPlanStep(a, plan.id, 'r1');
    next = addPlanStep(next, plan.id, 'r2');
    next = addPlanStep(next, plan.id, 'r3');
    expect(next.executionPlans?.[plan.id].steps.map((s) => s.requestId)).toEqual([
      'r1',
      'r2',
      'r3',
    ]);

    const removed = removePlanStep(next, plan.id, 1);
    expect(removed.executionPlans?.[plan.id].steps.map((s) => s.requestId)).toEqual(['r1', 'r3']);

    const reordered = reorderPlanSteps(next, plan.id, 0, 2);
    expect(reordered.executionPlans?.[plan.id].steps.map((s) => s.requestId)).toEqual([
      'r2',
      'r3',
      'r1',
    ]);
  });

  it('addPlanStep records linkedWorkspaceId on the step when supplied', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    const next = addPlanStep(a, plan.id, 'r-from-link', 'lw-1');
    expect(next.executionPlans?.[plan.id].steps[0]).toEqual({
      requestId: 'r-from-link',
      linkedWorkspaceId: 'lw-1',
    });
  });

  it('rejects out-of-range remove / reorder indices by returning the same reference', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    const withStep = addPlanStep(a, plan.id, 'r1');
    expect(removePlanStep(withStep, plan.id, 99)).toBe(withStep);
    expect(reorderPlanSteps(withStep, plan.id, 0, 99)).toBe(withStep);
    expect(reorderPlanSteps(withStep, plan.id, 0, 0)).toBe(withStep);
  });
});

describe('setPlanEnvPriority', () => {
  it('replaces the array verbatim (copy, not reference)', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    const order: EnvPriorityRef[] = [
      { kind: 'local', name: 'prod' },
      { kind: 'local', name: 'dev' },
    ];
    const next = setPlanEnvPriority(a, plan.id, order);
    expect(next.executionPlans?.[plan.id].envPriorityOrder).toEqual([
      { kind: 'local', name: 'prod' },
      { kind: 'local', name: 'dev' },
    ]);
    expect(next.executionPlans?.[plan.id].envPriorityOrder).not.toBe(order);
  });
});

describe('setPlanStepEnabled', () => {
  it('flips a step from enabled (default) to disabled and back', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    const withStep = addPlanStep(a, plan.id, 'r1');
    const disabled = setPlanStepEnabled(withStep, plan.id, 0, false);
    expect(disabled.executionPlans?.[plan.id].steps[0].enabled).toBe(false);
    const reenabled = setPlanStepEnabled(disabled, plan.id, 0, true);
    expect(reenabled.executionPlans?.[plan.id].steps[0].enabled).toBe(true);
  });

  it('treats undefined as enabled — no-op when toggling enabled=true on a fresh step', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    const withStep = addPlanStep(a, plan.id, 'r1');
    expect(setPlanStepEnabled(withStep, plan.id, 0, true)).toBe(withStep);
  });

  it('rejects out-of-range step indices', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    expect(setPlanStepEnabled(a, plan.id, 0, false)).toBe(a);
  });
});

describe('setPlanStopOnFailure', () => {
  it('toggles the flag', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    const on = setPlanStopOnFailure(a, plan.id, true);
    expect(on.executionPlans?.[plan.id].stopOnAssertionFailure).toBe(true);
    const off = setPlanStopOnFailure(on, plan.id, false);
    expect(off.executionPlans?.[plan.id].stopOnAssertionFailure).toBe(false);
  });

  it('is a no-op when the value is unchanged', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    expect(setPlanStopOnFailure(a, plan.id, false)).toBe(a);
  });
});

describe('setPlanVariables', () => {
  it('replaces the variables array (deep-copy, not reference)', () => {
    const { synced: a, plan } = addPlan(baseSynced());
    const vars = [
      { key: 'A', value: '1' },
      { key: 'B', value: '2' },
    ];
    const next = setPlanVariables(a, plan.id, vars);
    expect(next.executionPlans?.[plan.id].variables).toEqual(vars);
    expect(next.executionPlans?.[plan.id].variables).not.toBe(vars);
  });

  it('is a no-op for unknown plan ids', () => {
    const synced = baseSynced();
    expect(setPlanVariables(synced, 'nope', [])).toBe(synced);
  });
});

describe('duplicatePlan', () => {
  it('clones steps + envPriorityOrder + variables + stopOnAssertionFailure', () => {
    const { synced: a, plan } = addPlan(baseSynced(), 'Smoke');
    let withStuff = addPlanStep(a, plan.id, 'r1');
    withStuff = addPlanStep(withStuff, plan.id, 'r2');
    withStuff = setPlanEnvPriority(withStuff, plan.id, [{ kind: 'local', name: 'prod' }]);
    withStuff = setPlanVariables(withStuff, plan.id, [{ key: 'TOK', value: 'x' }]);
    withStuff = setPlanStopOnFailure(withStuff, plan.id, true);

    const { synced: dupSynced, plan: cloned } = duplicatePlan(withStuff, plan.id);
    expect(cloned).not.toBeNull();
    expect(cloned!.name).toBe('Smoke (copy)');
    expect(cloned!.steps).toEqual(withStuff.executionPlans?.[plan.id].steps);
    expect(cloned!.steps).not.toBe(withStuff.executionPlans?.[plan.id].steps);
    expect(cloned!.envPriorityOrder).toEqual([{ kind: 'local', name: 'prod' }]);
    expect(cloned!.variables).toEqual([{ key: 'TOK', value: 'x' }]);
    expect(cloned!.stopOnAssertionFailure).toBe(true);
    expect(dupSynced.executionPlans?.[cloned!.id]).toBe(cloned);
  });

  it('avoids name collisions: "(copy 2)", "(copy 3)" on repeated dupes', () => {
    const { synced: a, plan } = addPlan(baseSynced(), 'P');
    const { synced: b } = duplicatePlan(a, plan.id); // P (copy)
    const { synced: c, plan: c2 } = duplicatePlan(b, plan.id); // P (copy 2)
    expect(c2!.name).toBe('P (copy 2)');
    const { plan: c3 } = duplicatePlan(c, plan.id);
    expect(c3!.name).toBe('P (copy 3)');
  });

  it('returns null + same synced when the source is unknown', () => {
    const synced = baseSynced();
    const { synced: next, plan } = duplicatePlan(synced, 'nope');
    expect(plan).toBeNull();
    expect(next).toBe(synced);
  });
});
