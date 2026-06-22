import * as vscode from 'vscode';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// `apicircle.openPlanStepRequest` — open the request editor for a plan step.
//
// Clicking a step in the Execution TreeView (or the 📩 <name> CodeLens on a
// step row in the plan YAML) opens the underlying request's YAML, exactly the
// way clicking a request in the Editor view does. Local steps resolve against
// `synced.collections.requests`; linked steps resolve against the cached
// linked snapshot and open the read-only linked-request projection.
// =============================================================================

export interface OpenPlanStepRequestDeps {
  bridge: VsCodeBridge;
}

export interface PlanStepRef {
  planId: string;
  stepIndex: number;
  /**
   * The request the invoking surface believed this step points at. The plan
   * CodeLens passes it (with `linkedWorkspaceId`) so the editor opens exactly
   * the request shown on the clicked row even if the editor buffer's step
   * order has drifted from the saved plan. The TreeView omits it and the
   * command falls back to resolving `plan.steps[stepIndex]`.
   */
  requestId?: string;
  linkedWorkspaceId?: string;
}

export async function openPlanStepRequestCommand(
  deps: OpenPlanStepRequestDeps,
  node?: PlanStepRef,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  if (!node) {
    await vscode.window.showWarningMessage('No plan step to open.');
    return;
  }

  const state = await active.read();
  const plan = (state.synced.executionPlans ?? {})[node.planId];
  if (!plan) {
    await vscode.window.showWarningMessage('Plan no longer exists.');
    return;
  }

  // Prefer the identity the caller passed (the clicked row); fall back to the
  // saved step at `stepIndex` (the TreeView path, where the index is reliable).
  let requestId = node.requestId;
  let linkedWorkspaceId = node.linkedWorkspaceId;
  if (requestId === undefined) {
    const step = plan.steps[node.stepIndex];
    if (!step) {
      await vscode.window.showWarningMessage('Step no longer exists.');
      return;
    }
    requestId = step.requestId;
    linkedWorkspaceId = step.linkedWorkspaceId;
  }

  // Linked step — open the read-only linked-request projection.
  if (linkedWorkspaceId) {
    const link = state.synced.linkedWorkspaces[linkedWorkspaceId];
    const request =
      state.local.linkedCollections[linkedWorkspaceId]?.collections.requests[requestId];
    if (!link || !request) {
      await vscode.window.showWarningMessage(
        'This step references a linked request that is not cached — refresh the linked workspace.',
      );
      return;
    }
    await vscode.commands.executeCommand(
      'vscode.open',
      ApicircleFsProvider.linkedRequestUri(active.workspace.id, link, request),
    );
    return;
  }

  // Local step.
  const request = state.synced.collections.requests[requestId];
  if (!request) {
    await vscode.window.showWarningMessage(
      `This step references a request (${requestId}) that no longer exists in the workspace.`,
    );
    return;
  }
  await vscode.commands.executeCommand(
    'vscode.open',
    ApicircleFsProvider.requestUri(
      active.workspace.id,
      request,
      state.synced.collections.folders,
      state.synced.collections.requests,
    ),
  );
}
