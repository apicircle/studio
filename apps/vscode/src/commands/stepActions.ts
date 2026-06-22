import * as vscode from 'vscode';
import type { ExecutionPlan, Request as ApiRequest, WorkspaceSynced } from '@apicircle/shared';
import type { VsCodeBridge, WorkspaceSurface } from '../host/vscodeBridge';
import {
  refreshPlanEditor,
  ensurePlanEditorSaved,
  type PlanEditorRefresher,
} from './planEditorRefresh';
import { folderPathNames } from '../fs/apicircleFsProvider';

// =============================================================================
// Per-step editing actions for the Execution view + the plan YAML CodeLens.
//
// Steps live inside an ExecutionPlan; the only mutation surface is
// `plan.upsert`, so every action reads the plan, mutates the steps array, and
// re-upserts the whole plan. The applyMutation switch case dedupes identical
// content so the workspace.json diff stays clean.
//
// After mutating, `refreshPlanEditor` reloads any open plan YAML editor so the
// projection (step list, enabled flags) catches up immediately — the TreeView
// already refreshes off the workspace-file watcher.
// =============================================================================

export interface StepActionsDeps {
  bridge: VsCodeBridge;
  /** When present, the open plan YAML editor is reloaded after the mutation. */
  fsProvider?: PlanEditorRefresher;
}

type StepNode = {
  kind: 'step' | 'step-disabled';
  planId: string;
  stepIndex: number;
  /**
   * The requestId the invoking surface believed sat at `stepIndex`. The plan
   * CodeLens passes it (the index is derived from the editor buffer's row
   * position, which can drift from the saved plan when the YAML has unsaved
   * structural edits); the Execution TreeView omits it (its index always
   * reflects the saved plan). `verifyStepIdentity` uses it to refuse acting on
   * the wrong step instead of silently mutating a mismatched index.
   */
  expectedRequestId?: string;
};
type PlanNode = { kind: 'plan'; id: string };

/**
 * Guard against editor-buffer / saved-plan index drift. Returns true when it's
 * safe to act on `stepIndex`. When the caller supplied an `expectedRequestId`
 * that doesn't match the saved step at that index, it warns the user to save
 * first and returns false — so a stale CodeLens click never mutates the wrong
 * step. Omitting `expectedRequestId` (the TreeView path) always passes.
 */
async function verifyStepIdentity(
  plan: ExecutionPlan,
  stepIndex: number,
  expectedRequestId: string | undefined,
): Promise<boolean> {
  if (expectedRequestId === undefined) return true;
  if (plan.steps[stepIndex]?.requestId === expectedRequestId) return true;
  await vscode.window.showWarningMessage(
    'This plan has unsaved edits that no longer match its saved steps — save the plan (Ctrl+S) first, then use the step action.',
  );
  return false;
}

async function loadPlan(
  deps: StepActionsDeps,
  planId: string,
  notFoundMsg = 'Plan no longer exists.',
): Promise<{ active: WorkspaceSurface; plan: ExecutionPlan } | null> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return null;
  }
  const state = await active.read();
  const plan = (state.synced.executionPlans ?? {})[planId];
  if (!plan) {
    await vscode.window.showWarningMessage(notFoundMsg);
    return null;
  }
  return { active, plan };
}

async function commitPlan(
  deps: StepActionsDeps,
  active: WorkspaceSurface,
  plan: ExecutionPlan,
  nextSteps: ExecutionPlan['steps'],
): Promise<void> {
  const next: ExecutionPlan = { ...plan, steps: nextSteps, updatedAt: new Date().toISOString() };
  await active.apply({ kind: 'plan.upsert', plan: next });
  refreshPlanEditor(deps.fsProvider, active.workspace.id, next);
}

export async function toggleStepEnabledCommand(
  deps: StepActionsDeps,
  node?: StepNode,
): Promise<void> {
  if (!node) {
    await vscode.window.showWarningMessage(
      'Right-click a step in the Execution view (or use the ⊘ Disable / ✓ Enable CodeLens) to toggle it.',
    );
    return;
  }
  const loaded = await loadPlan(deps, node.planId);
  if (!loaded) return;
  const { active, plan } = loaded;
  const step = plan.steps[node.stepIndex];
  if (!step) {
    await vscode.window.showWarningMessage('Step no longer exists.');
    return;
  }
  if (!(await ensurePlanEditorSaved(node.planId))) return;
  if (!(await verifyStepIdentity(plan, node.stepIndex, node.expectedRequestId))) return;
  const enabled = step.enabled !== false;
  const nextSteps = plan.steps.map((s, i) =>
    i === node.stepIndex ? { ...s, enabled: !enabled } : s,
  );
  await commitPlan(deps, active, plan, nextSteps);
}

export async function removeStepFromPlanCommand(
  deps: StepActionsDeps,
  node?: StepNode,
): Promise<void> {
  if (!node) {
    await vscode.window.showWarningMessage(
      'Right-click a step in the Execution view (or use the 🗑 Remove CodeLens) to remove it.',
    );
    return;
  }
  const loaded = await loadPlan(deps, node.planId);
  if (!loaded) return;
  const { active, plan } = loaded;
  if (!plan.steps[node.stepIndex]) {
    await vscode.window.showWarningMessage('Step no longer exists.');
    return;
  }
  if (!(await ensurePlanEditorSaved(node.planId))) return;
  if (!(await verifyStepIdentity(plan, node.stepIndex, node.expectedRequestId))) return;
  const confirm = await vscode.window.showWarningMessage(
    'Remove this step from the plan? The request itself is not deleted — just dropped from this plan.',
    { modal: true },
    'Remove',
  );
  if (confirm !== 'Remove') return;
  const nextSteps = plan.steps.filter((_, i) => i !== node.stepIndex);
  await commitPlan(deps, active, plan, nextSteps);
}

export async function addStepToPlanCommand(deps: StepActionsDeps, node?: PlanNode): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const state = await active.read();

  // Resolve the target plan — from the invoking node, else a QuickPick.
  let planId = node?.id;
  if (!planId) {
    const plans = Object.values(state.synced.executionPlans ?? {});
    if (plans.length === 0) {
      await vscode.window.showInformationMessage(
        'No execution plans defined. Run "API Circle: New Plan…" first.',
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      [...plans]
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ label: p.name, description: `${p.steps.length} step(s)`, id: p.id })),
      { placeHolder: 'Add a step to which plan?' },
    );
    if (!picked) return;
    planId = picked.id;
  }
  const plan = (state.synced.executionPlans ?? {})[planId];
  if (!plan) {
    await vscode.window.showWarningMessage('Plan no longer exists.');
    return;
  }
  if (!(await ensurePlanEditorSaved(planId))) return;

  // Hide requests already present as local steps — the user only sees what they
  // can still add. (Linked steps don't shadow a local request of the same id.)
  const usedLocalIds = new Set(
    plan.steps.filter((s) => !s.linkedWorkspaceId).map((s) => s.requestId),
  );
  const available = sortByFolderThenName(
    Object.values(state.synced.collections.requests).filter((r) => !usedLocalIds.has(r.id)),
    state.synced.collections.folders,
  );
  if (available.length === 0) {
    await vscode.window.showInformationMessage(
      Object.keys(state.synced.collections.requests).length === 0
        ? 'No requests in this workspace. Add one via "API Circle: New Request" first.'
        : `Every request in this workspace is already a step in "${plan.name}".`,
    );
    return;
  }

  // Multi-select picker, plus a "Select all" sentinel so the user can add every
  // remaining request in one go.
  const SELECT_ALL = '__apicircle_select_all__';
  type StepPick = vscode.QuickPickItem & { requestId: string };
  const items: StepPick[] = [
    {
      label: `$(checklist) Select all (${available.length})`,
      description: 'Add every request not already in this plan',
      requestId: SELECT_ALL,
      alwaysShow: true,
    },
    ...available.map(
      (r): StepPick => ({
        label: r.name,
        description: `${r.method}  ·  ${folderPathNames(r.folderId, state.synced.collections.folders) || '(root)'}`,
        requestId: r.id,
      }),
    ),
  ];
  const picks = await vscode.window.showQuickPick(items, {
    placeHolder: `Add steps to "${plan.name}" — pick one or more (already-added requests are hidden)`,
    canPickMany: true,
    matchOnDescription: true,
  });
  if (!picks || picks.length === 0) return;

  const chosen = picks.some((p) => p.requestId === SELECT_ALL)
    ? available.map((r) => r.id)
    : picks.map((p) => p.requestId);
  const nextSteps: ExecutionPlan['steps'] = [
    ...plan.steps,
    ...chosen.map((requestId) => ({ requestId, enabled: true })),
  ];
  await commitPlan(deps, active, plan, nextSteps);
  await vscode.window.showInformationMessage(
    `Added ${chosen.length} step${chosen.length === 1 ? '' : 's'} to "${plan.name}".`,
  );
}

export async function changeStepRequestCommand(
  deps: StepActionsDeps,
  node?: { planId: string; stepIndex: number; expectedRequestId?: string },
): Promise<void> {
  if (!node) {
    await vscode.window.showWarningMessage('No plan step to change.');
    return;
  }
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const state = await active.read();
  const plan = (state.synced.executionPlans ?? {})[node.planId];
  if (!plan) {
    await vscode.window.showWarningMessage('Plan no longer exists.');
    return;
  }
  const step = plan.steps[node.stepIndex];
  if (!step) {
    await vscode.window.showWarningMessage('Step no longer exists.');
    return;
  }
  if (!(await ensurePlanEditorSaved(node.planId))) return;
  if (!(await verifyStepIdentity(plan, node.stepIndex, node.expectedRequestId))) return;

  const requestId = await pickRequest(state.synced, 'Pick the request this step should run');
  if (!requestId) return;

  // Point the step at the chosen local request. A linked step that's
  // repointed at a local request drops its linkedWorkspaceId.
  const nextSteps = plan.steps.map((s, i) =>
    i === node.stepIndex ? { requestId, enabled: s.enabled } : s,
  );
  await commitPlan(deps, active, plan, nextSteps);
}

// ---------------------------------------------------------------------------
// Shared request picker — sorts by folder then name, mirroring `newPlan`.
// ---------------------------------------------------------------------------

async function pickRequest(
  synced: WorkspaceSynced,
  placeHolder: string,
): Promise<string | undefined> {
  const requests = Object.values(synced.collections.requests);
  if (requests.length === 0) {
    await vscode.window.showInformationMessage(
      'No requests in this workspace. Add one via "API Circle: New Request" first.',
    );
    return undefined;
  }
  const picked = await vscode.window.showQuickPick(
    sortByFolderThenName(requests, synced.collections.folders).map((r) => ({
      label: r.name,
      description: `${r.method}  ·  ${folderPathNames(r.folderId, synced.collections.folders) || '(root)'}`,
      requestId: r.id,
    })),
    { placeHolder, matchOnDescription: true },
  );
  return picked?.requestId;
}

function sortByFolderThenName(
  requests: ReadonlyArray<ApiRequest>,
  folders: Record<string, { id: string; name: string }>,
): ApiRequest[] {
  return [...requests].sort((a, b) => {
    const fa = a.folderId ? (folders[a.folderId]?.name ?? '') : '';
    const fb = b.folderId ? (folders[b.folderId]?.name ?? '') : '';
    return fa.localeCompare(fb) || a.name.localeCompare(b.name);
  });
}
