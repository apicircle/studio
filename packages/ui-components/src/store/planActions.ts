import type { EnvPriorityRef, ExecutionPlan, WorkspaceSynced } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';

// Pure reducers for ExecutionPlan CRUD on WorkspaceSynced.executionPlans.
//
// Plans live in `WorkspaceSynced` (not `WorkspaceLocal`) so they
// round-trip through Git — collaborators on the same workspace share
// the same plan definitions. Plan **runs** (history) stay in
// `WorkspaceLocal.history.planRuns` because they're per-device.
//
// Pre-migration these lived in `WorkspaceLocal.executionPlans`; the
// hydration normalizer `liftLegacyExecutionPlansToSynced` lifts those
// into `synced.executionPlans` on first load. Code MUST NOT read or
// write `local.executionPlans` after migration.

function plansOf(synced: WorkspaceSynced): Record<string, ExecutionPlan> {
  return synced.executionPlans ?? {};
}

export function addPlan(
  synced: WorkspaceSynced,
  name?: string,
): {
  synced: WorkspaceSynced;
  plan: ExecutionPlan;
} {
  const id = generateId();
  const now = new Date().toISOString();
  const plan: ExecutionPlan = {
    id,
    name: name?.trim() || 'Untitled plan',
    steps: [],
    envPriorityOrder: [],
    createdAt: now,
    updatedAt: now,
  };
  return {
    synced: {
      ...synced,
      executionPlans: { ...plansOf(synced), [id]: plan },
    },
    plan,
  };
}

export function removePlan(synced: WorkspaceSynced, id: string): WorkspaceSynced {
  const plans = plansOf(synced);
  if (!plans[id]) return synced;
  const next = { ...plans };
  delete next[id];
  return {
    ...synced,
    executionPlans: next,
  };
}

export function renamePlan(synced: WorkspaceSynced, id: string, name: string): WorkspaceSynced {
  const plan = plansOf(synced)[id];
  if (!plan) return synced;
  const trimmed = name.trim();
  if (!trimmed || trimmed === plan.name) return synced;
  return updatePlan(synced, id, { name: trimmed });
}

export function addPlanStep(
  synced: WorkspaceSynced,
  planId: string,
  requestId: string,
  linkedWorkspaceId?: string,
): WorkspaceSynced {
  const plan = plansOf(synced)[planId];
  if (!plan) return synced;
  const step = linkedWorkspaceId ? { requestId, linkedWorkspaceId } : { requestId };
  return updatePlan(synced, planId, { steps: [...plan.steps, step] });
}

export function removePlanStep(
  synced: WorkspaceSynced,
  planId: string,
  stepIndex: number,
): WorkspaceSynced {
  const plan = plansOf(synced)[planId];
  if (!plan || stepIndex < 0 || stepIndex >= plan.steps.length) return synced;
  return updatePlan(synced, planId, {
    steps: plan.steps.filter((_, i) => i !== stepIndex),
  });
}

export function reorderPlanSteps(
  synced: WorkspaceSynced,
  planId: string,
  fromIndex: number,
  toIndex: number,
): WorkspaceSynced {
  const plan = plansOf(synced)[planId];
  if (!plan) return synced;
  if (fromIndex === toIndex) return synced;
  if (fromIndex < 0 || fromIndex >= plan.steps.length) return synced;
  if (toIndex < 0 || toIndex >= plan.steps.length) return synced;
  const steps = [...plan.steps];
  const [moved] = steps.splice(fromIndex, 1);
  steps.splice(toIndex, 0, moved);
  return updatePlan(synced, planId, { steps });
}

/**
 * Toggle a step's `enabled` flag. Disabled steps stay in the plan but
 * are skipped by `runPlan`. Default is `true` (enabled) when the field
 * is missing on older persisted plans.
 */
export function setPlanStepEnabled(
  synced: WorkspaceSynced,
  planId: string,
  stepIndex: number,
  enabled: boolean,
): WorkspaceSynced {
  const plan = plansOf(synced)[planId];
  if (!plan || stepIndex < 0 || stepIndex >= plan.steps.length) return synced;
  const cur = plan.steps[stepIndex];
  // Treat undefined as true; only update when the effective value flips.
  const curEnabled = cur.enabled !== false;
  if (curEnabled === enabled) return synced;
  const steps = plan.steps.map((s, i) => (i === stepIndex ? { ...s, enabled } : s));
  return updatePlan(synced, planId, { steps });
}

/**
 * Set the plan's `stopOnAssertionFailure` flag. Only honored by runPlan
 * when launched `withAssertions`.
 */
export function setPlanStopOnFailure(
  synced: WorkspaceSynced,
  planId: string,
  stopOnAssertionFailure: boolean,
): WorkspaceSynced {
  const plan = plansOf(synced)[planId];
  if (!plan) return synced;
  if ((plan.stopOnAssertionFailure ?? false) === stopOnAssertionFailure) return synced;
  return updatePlan(synced, planId, { stopOnAssertionFailure });
}

/**
 * Replace the plan's variable list. Plan vars sit between context vars
 * and the env priority list in the resolver chain.
 */
export function setPlanVariables(
  synced: WorkspaceSynced,
  planId: string,
  variables: ReadonlyArray<{ key: string; value: string }>,
): WorkspaceSynced {
  const plan = plansOf(synced)[planId];
  if (!plan) return synced;
  return updatePlan(synced, planId, { variables: variables.map((v) => ({ ...v })) });
}

/**
 * Clone a plan under "<name> (copy)" with the same steps + envPriorityOrder
 * + variables + stopOnAssertionFailure. The clone gets a fresh id and
 * timestamps so plan-run history rows stay scoped to their original plan.
 */
export function duplicatePlan(
  synced: WorkspaceSynced,
  planId: string,
): {
  synced: WorkspaceSynced;
  plan: ExecutionPlan | null;
} {
  const plans = plansOf(synced);
  const src = plans[planId];
  if (!src) return { synced, plan: null };
  // Pick the first non-colliding "(copy)" / "(copy 2)" / ... — same
  // algorithm as duplicateEnvironment / duplicateRequest.
  const existingNames = new Set(Object.values(plans).map((p) => p.name));
  let candidate = `${src.name} (copy)`;
  let n = 2;
  while (existingNames.has(candidate)) {
    candidate = `${src.name} (copy ${n})`;
    n += 1;
  }
  const id = generateId();
  const now = new Date().toISOString();
  const plan: ExecutionPlan = {
    id,
    name: candidate,
    steps: src.steps.map((s) => ({ ...s })),
    envPriorityOrder: [...src.envPriorityOrder],
    variables: src.variables ? src.variables.map((v) => ({ ...v })) : undefined,
    stopOnAssertionFailure: src.stopOnAssertionFailure,
    createdAt: now,
    updatedAt: now,
  };
  return {
    synced: {
      ...synced,
      executionPlans: { ...plans, [id]: plan },
    },
    plan,
  };
}

/**
 * Plan-level environment priority overrides the workspace's global
 * order during plan runs. Empty array means "no override — fall back to
 * the workspace's order".
 */
export function setPlanEnvPriority(
  synced: WorkspaceSynced,
  planId: string,
  envPriorityOrder: readonly EnvPriorityRef[],
): WorkspaceSynced {
  const plan = plansOf(synced)[planId];
  if (!plan) return synced;
  return updatePlan(synced, planId, { envPriorityOrder: [...envPriorityOrder] });
}

function updatePlan(
  synced: WorkspaceSynced,
  id: string,
  patch: Partial<ExecutionPlan>,
): WorkspaceSynced {
  const plans = plansOf(synced);
  const plan = plans[id];
  if (!plan) return synced;
  const updated: ExecutionPlan = {
    ...plan,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...synced,
    executionPlans: { ...plans, [id]: updated },
  };
}
