import * as vscode from 'vscode';
import type { EnvPriorityRef, ExecutionPlan } from '@apicircle/shared';
import { envPriorityKey } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import {
  refreshPlanEditor,
  ensurePlanEditorSaved,
  type PlanEditorRefresher,
} from './planEditorRefresh';

// =============================================================================
// `API Circle: Set Plan Environments` command.
//
// A plan can override the workspace-wide env priority order for its own runs
// (`ExecutionPlan.envPriorityOrder`). Empty list = inherit the workspace order.
// This is the discoverable, interactive counterpart to hand-editing the plan
// YAML's `envPriorityOrder:` block — it reuses the same two-step pattern as the
// workspace-level `setEnvPriorityOrderCommand`:
//   1. Multi-select which envs (local + linked) participate, pre-checked with
//      the plan's current overlay.
//   2. Order the chosen envs one-by-one (highest precedence first).
// Picking nothing clears the overlay (the plan falls back to the workspace
// order). Persists through the canonical `plan.upsert` mutation, so the YAML +
// Execution view + run command all reflect the change immediately.
// =============================================================================

export interface SetPlanEnvPriorityDeps {
  bridge: VsCodeBridge;
  /** When present, the open plan YAML editor is reloaded after the mutation. */
  fsProvider?: PlanEditorRefresher;
}

interface PlanNode {
  kind: 'plan';
  id: string;
}

export async function setPlanEnvPriorityCommand(
  deps: SetPlanEnvPriorityDeps,
  node?: PlanNode,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }

  const state = await active.read();
  const plans = state.synced.executionPlans ?? {};

  // Resolve which plan to edit — from the invoking node (CodeLens / tree), else
  // a QuickPick over all plans.
  let planId = node?.id;
  if (!planId) {
    const planList = Object.values(plans);
    if (planList.length === 0) {
      await vscode.window.showInformationMessage(
        'No execution plans defined. Run "API Circle: New Plan…" first.',
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      [...planList]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ label: p.name, description: `${p.steps.length} step(s)`, id: p.id })),
      { placeHolder: 'Pick a plan to set environments for' },
    );
    if (!picked) return;
    planId = picked.id;
  }

  const plan = plans[planId];
  if (!plan) {
    await vscode.window.showErrorMessage(`Plan ${planId} no longer exists.`);
    return;
  }
  if (!(await ensurePlanEditorSaved(planId))) return;

  // Collect every selectable env across local + every linked workspace — same
  // candidate set as the workspace-level priority picker.
  const candidates: Array<{ ref: EnvPriorityRef; label: string; description: string }> = [];
  for (const e of Object.values(state.synced.environments.items)) {
    candidates.push({
      ref: { kind: 'local', name: e.name },
      label: e.name,
      description: `local · ${e.variables.length} var(s)`,
    });
  }
  for (const [linkId, snapshot] of Object.entries(state.local.linkedCollections)) {
    const linkName = state.synced.linkedWorkspaces[linkId]?.name ?? linkId;
    for (const env of Object.values(snapshot.environments.items)) {
      candidates.push({
        ref: { kind: 'linked', linkedWorkspaceId: linkId, envName: env.name },
        label: `${env.name}  (linked: ${linkName})`,
        description: `linked · ${env.variables.length} var(s)`,
      });
    }
  }
  if (candidates.length === 0) {
    await vscode.window.showInformationMessage(
      'No environments to choose. Run "API Circle: New Environment" first, or link a workspace.',
    );
    return;
  }

  const currentKeys = new Set(plan.envPriorityOrder.map(envPriorityKey));
  const byLabel = new Map(candidates.map((c) => [c.label, c.ref]));

  // Step 1: Multi-select which envs participate (pre-checked = current overlay).
  const inclusionPicks = await vscode.window.showQuickPick(
    candidates.map((c) => ({
      label: c.label,
      description: c.description,
      picked: currentKeys.has(envPriorityKey(c.ref)),
    })),
    {
      placeHolder: `Step 1 of 2 — Environments for plan "${plan.name}" (pick none to inherit the workspace order)`,
      canPickMany: true,
    },
  );
  if (!inclusionPicks) return;
  if (inclusionPicks.length === 0) {
    const cleared: ExecutionPlan = {
      ...plan,
      envPriorityOrder: [],
      updatedAt: new Date().toISOString(),
    };
    await active.apply({ kind: 'plan.upsert', plan: cleared });
    refreshPlanEditor(deps.fsProvider, active.workspace.id, cleared);
    await vscode.window.showInformationMessage(
      `Plan "${plan.name}" now inherits the workspace environment order.`,
    );
    return;
  }

  // Step 2: order them by repeatedly asking "What's next?" (highest first).
  const remaining = new Map(inclusionPicks.map((p) => [p.label, byLabel.get(p.label)!]));
  const orderedRefs: EnvPriorityRef[] = [];
  while (remaining.size > 0) {
    if (remaining.size === 1) {
      const [label, ref] = [...remaining.entries()][0];
      orderedRefs.push(ref);
      remaining.delete(label);
      break;
    }
    const stepNum = orderedRefs.length + 1;
    const total = inclusionPicks.length;
    const next = await vscode.window.showQuickPick(
      [...remaining.keys()].sort().map((label) => ({ label })),
      {
        placeHolder: `Step 2 of 2 — Priority position ${stepNum} of ${total} (highest precedence first)`,
      },
    );
    if (!next) return;
    orderedRefs.push(remaining.get(next.label)!);
    remaining.delete(next.label);
  }

  const updated: ExecutionPlan = {
    ...plan,
    envPriorityOrder: orderedRefs,
    updatedAt: new Date().toISOString(),
  };
  await active.apply({ kind: 'plan.upsert', plan: updated });
  refreshPlanEditor(deps.fsProvider, active.workspace.id, updated);
  await vscode.window.showInformationMessage(
    `Plan "${plan.name}" environments set (${orderedRefs.length} ${
      orderedRefs.length === 1 ? 'entry' : 'entries'
    }).`,
  );
}
