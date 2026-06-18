import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// Per-step TreeView context-menu actions for the Execution view.
//
// Steps live inside an ExecutionPlan; the only mutation surface is
// `plan.upsert`, so both actions read the plan, mutate the steps array,
// and re-upsert the whole plan. The applyMutation switch case dedupes
// identical content so the workspace.json diff stays clean.
// =============================================================================

export interface StepActionsDeps {
  bridge: VsCodeBridge;
}

export async function toggleStepEnabledCommand(
  deps: StepActionsDeps,
  node?: { kind: 'step' | 'step-disabled'; planId: string; stepIndex: number },
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  if (!node) {
    await vscode.window.showWarningMessage(
      'Right-click a step in the Execution view to toggle it.',
    );
    return;
  }
  const state = await active.read();
  const plan = state.local.executionPlans[node.planId];
  if (!plan) {
    await vscode.window.showWarningMessage('Plan no longer exists.');
    return;
  }
  const step = plan.steps[node.stepIndex];
  if (!step) {
    await vscode.window.showWarningMessage('Step no longer exists.');
    return;
  }
  const enabled = step.enabled !== false;
  const nextSteps = plan.steps.map((s, i) =>
    i === node.stepIndex ? { ...s, enabled: !enabled } : s,
  );
  await active.apply({
    kind: 'plan.upsert',
    plan: {
      ...plan,
      steps: nextSteps,
      updatedAt: new Date().toISOString(),
    },
  });
}

export async function removeStepFromPlanCommand(
  deps: StepActionsDeps,
  node?: { kind: 'step' | 'step-disabled'; planId: string; stepIndex: number },
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  if (!node) {
    await vscode.window.showWarningMessage(
      'Right-click a step in the Execution view to remove it.',
    );
    return;
  }
  const state = await active.read();
  const plan = state.local.executionPlans[node.planId];
  if (!plan) {
    await vscode.window.showWarningMessage('Plan no longer exists.');
    return;
  }
  if (!plan.steps[node.stepIndex]) {
    await vscode.window.showWarningMessage('Step no longer exists.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    'Remove this step from the plan? The request itself is not deleted — just dropped from this plan.',
    { modal: true },
    'Remove',
  );
  if (confirm !== 'Remove') return;
  const nextSteps = plan.steps.filter((_, i) => i !== node.stepIndex);
  await active.apply({
    kind: 'plan.upsert',
    plan: {
      ...plan,
      steps: nextSteps,
      updatedAt: new Date().toISOString(),
    },
  });
}
