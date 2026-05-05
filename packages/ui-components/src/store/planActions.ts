import type { ExecutionPlan, WorkspaceLocal } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';

// Pure reducers for ExecutionPlan CRUD on WorkspaceLocal.executionPlans.
// Plans are local-only (never pushed to Git) — they're per-user playbooks
// against the synced collections, not part of the workspace's released
// shape (plan §6 P6).

export function addPlan(
  local: WorkspaceLocal,
  name?: string,
): {
  local: WorkspaceLocal;
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
    local: {
      ...local,
      executionPlans: { ...local.executionPlans, [id]: plan },
    },
    plan,
  };
}

export function removePlan(local: WorkspaceLocal, id: string): WorkspaceLocal {
  if (!local.executionPlans[id]) return local;
  const next = { ...local.executionPlans };
  delete next[id];
  // Drop any plan-run history rows for this plan too — they reference an
  // id that no longer resolves.
  const planRuns = local.history.planRuns.filter((r) => r.planId !== id);
  return {
    ...local,
    executionPlans: next,
    history: { ...local.history, planRuns },
  };
}

export function renamePlan(local: WorkspaceLocal, id: string, name: string): WorkspaceLocal {
  const plan = local.executionPlans[id];
  if (!plan) return local;
  const trimmed = name.trim();
  if (!trimmed || trimmed === plan.name) return local;
  return updatePlan(local, id, { name: trimmed });
}

export function addPlanStep(
  local: WorkspaceLocal,
  planId: string,
  requestId: string,
  linkedWorkspaceId?: string,
): WorkspaceLocal {
  const plan = local.executionPlans[planId];
  if (!plan) return local;
  const step = linkedWorkspaceId ? { requestId, linkedWorkspaceId } : { requestId };
  return updatePlan(local, planId, { steps: [...plan.steps, step] });
}

export function removePlanStep(
  local: WorkspaceLocal,
  planId: string,
  stepIndex: number,
): WorkspaceLocal {
  const plan = local.executionPlans[planId];
  if (!plan || stepIndex < 0 || stepIndex >= plan.steps.length) return local;
  return updatePlan(local, planId, {
    steps: plan.steps.filter((_, i) => i !== stepIndex),
  });
}

export function reorderPlanSteps(
  local: WorkspaceLocal,
  planId: string,
  fromIndex: number,
  toIndex: number,
): WorkspaceLocal {
  const plan = local.executionPlans[planId];
  if (!plan) return local;
  if (fromIndex === toIndex) return local;
  if (fromIndex < 0 || fromIndex >= plan.steps.length) return local;
  if (toIndex < 0 || toIndex >= plan.steps.length) return local;
  const steps = [...plan.steps];
  const [moved] = steps.splice(fromIndex, 1);
  steps.splice(toIndex, 0, moved);
  return updatePlan(local, planId, { steps });
}

/**
 * Toggle a step's `enabled` flag. Disabled steps stay in the plan but
 * are skipped by `runPlan`. Default is `true` (enabled) when the field
 * is missing on older persisted plans.
 */
export function setPlanStepEnabled(
  local: WorkspaceLocal,
  planId: string,
  stepIndex: number,
  enabled: boolean,
): WorkspaceLocal {
  const plan = local.executionPlans[planId];
  if (!plan || stepIndex < 0 || stepIndex >= plan.steps.length) return local;
  const cur = plan.steps[stepIndex];
  // Treat undefined as true; only update when the effective value flips.
  const curEnabled = cur.enabled !== false;
  if (curEnabled === enabled) return local;
  const steps = plan.steps.map((s, i) => (i === stepIndex ? { ...s, enabled } : s));
  return updatePlan(local, planId, { steps });
}

/**
 * Set the plan's `stopOnAssertionFailure` flag. Only honored by runPlan
 * when launched `withAssertions`.
 */
export function setPlanStopOnFailure(
  local: WorkspaceLocal,
  planId: string,
  stopOnAssertionFailure: boolean,
): WorkspaceLocal {
  const plan = local.executionPlans[planId];
  if (!plan) return local;
  if ((plan.stopOnAssertionFailure ?? false) === stopOnAssertionFailure) return local;
  return updatePlan(local, planId, { stopOnAssertionFailure });
}

/**
 * Replace the plan's variable list. Plan vars sit between context vars
 * and the env priority list in the resolver chain.
 */
export function setPlanVariables(
  local: WorkspaceLocal,
  planId: string,
  variables: ReadonlyArray<{ key: string; value: string }>,
): WorkspaceLocal {
  const plan = local.executionPlans[planId];
  if (!plan) return local;
  return updatePlan(local, planId, { variables: variables.map((v) => ({ ...v })) });
}

/**
 * Clone a plan under "<name> (copy)" with the same steps + envPriorityOrder
 * + variables + stopOnAssertionFailure. The clone gets a fresh id and
 * timestamps so plan-run history rows stay scoped to their original plan.
 */
export function duplicatePlan(
  local: WorkspaceLocal,
  planId: string,
): {
  local: WorkspaceLocal;
  plan: ExecutionPlan | null;
} {
  const src = local.executionPlans[planId];
  if (!src) return { local, plan: null };
  // Pick the first non-colliding "(copy)" / "(copy 2)" / ... — same
  // algorithm as duplicateEnvironment / duplicateRequest.
  const existingNames = new Set(Object.values(local.executionPlans).map((p) => p.name));
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
    local: {
      ...local,
      executionPlans: { ...local.executionPlans, [id]: plan },
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
  local: WorkspaceLocal,
  planId: string,
  envPriorityOrder: readonly string[],
): WorkspaceLocal {
  const plan = local.executionPlans[planId];
  if (!plan) return local;
  return updatePlan(local, planId, { envPriorityOrder: [...envPriorityOrder] });
}

function updatePlan(
  local: WorkspaceLocal,
  id: string,
  patch: Partial<ExecutionPlan>,
): WorkspaceLocal {
  const plan = local.executionPlans[id];
  if (!plan) return local;
  const updated: ExecutionPlan = {
    ...plan,
    ...patch,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...local,
    executionPlans: { ...local.executionPlans, [id]: updated },
  };
}
