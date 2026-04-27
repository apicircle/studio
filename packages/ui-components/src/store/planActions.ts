import type { ExecutionPlan, WorkspaceLocal } from '@apicircle-v2/shared';
import { generateId } from '@apicircle-v2/shared';

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
