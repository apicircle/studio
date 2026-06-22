import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// ExecutionView — workspace execution plans tree.
//
// Layout:
//   ▾ Signup → Login → Profile         ▶ Run
//      1. Sign up                       (Create user request)
//      2. Log in                        (Login request)
//      3. Get profile                   (Profile fetch)
//   ▾ Smoke tests                       ▶ Run
//      1. Health check
//      ...
//
// Clicking a plan opens it as a `.plan.apicircle-notebook` document via the
// NotebookController (Phase 2.5 — wires the actual Notebook serializer).
// Phase 2 round 1 ships the TreeView + Run command; the Notebook flow is
// the next milestone.
// =============================================================================

export type ExecutionNode =
  | { kind: 'plan'; id: string }
  | { kind: 'step'; planId: string; stepIndex: number };

export class ExecutionView extends BaseTreeView<ExecutionNode> {
  readonly viewId = 'apicircle.execution';

  constructor(private readonly bridge: VsCodeBridge) {
    super();
  }

  async getTreeItem(element: ExecutionNode): Promise<vscode.TreeItem> {
    const active = this.bridge.activeWorkspace();
    if (!active) return new vscode.TreeItem('No workspace');

    const state = await active.read();
    const plans = state.synced.executionPlans ?? {};

    if (element.kind === 'plan') {
      const plan = plans[element.id];
      if (!plan) return new vscode.TreeItem('(deleted plan)');
      const item = new vscode.TreeItem(plan.name, vscode.TreeItemCollapsibleState.Collapsed);
      item.description = `${plan.steps.length} step${plan.steps.length === 1 ? '' : 's'}`;
      item.iconPath = new vscode.ThemeIcon('list-ordered');
      item.contextValue = 'plan';
      item.tooltip = `${plan.name}\n${plan.steps.length} steps\nCreated: ${plan.createdAt}`;
      // P2-E1: click → open the plan as YAML through the FS provider.
      item.command = {
        command: 'vscode.open',
        title: 'Open',
        arguments: [ApicircleFsProvider.planUri(active.workspace.id, plan)],
      };
      return item;
    }

    // step
    const plan = plans[element.planId];
    if (!plan) return new vscode.TreeItem('(deleted)');
    const step = plan.steps[element.stepIndex];
    if (!step) return new vscode.TreeItem('(deleted step)');
    // Resolve the request — local steps from the synced collection, linked
    // steps from the cached linked snapshot — so a perfectly valid linked step
    // doesn't render as "(missing request)".
    const linkedWs = step.linkedWorkspaceId
      ? state.synced.linkedWorkspaces[step.linkedWorkspaceId]
      : undefined;
    const request = step.linkedWorkspaceId
      ? state.local.linkedCollections[step.linkedWorkspaceId]?.collections.requests[step.requestId]
      : state.synced.collections.requests[step.requestId];
    const label = request?.name ?? '(missing request)';
    const enabled = step.enabled !== false; // defaults to true when absent
    const item = new vscode.TreeItem(
      `${element.stepIndex + 1}. ${label}`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = request
      ? step.linkedWorkspaceId
        ? `${request.method} · linked`
        : request.method
      : step.linkedWorkspaceId
        ? 'linked · not cached'
        : 'missing';
    item.iconPath = new vscode.ThemeIcon(
      enabled ? 'circle-small-filled' : 'circle-small-outline',
      enabled ? undefined : new vscode.ThemeColor('disabledForeground'),
    );
    item.contextValue = enabled ? 'step' : 'step-disabled';
    item.tooltip = request
      ? `${request.name}\n${request.method} ${request.url}${
          linkedWs ? `\nLinked workspace: ${linkedWs.name}` : ''
        }\nClick to open the request editor`
      : step.linkedWorkspaceId
        ? `This step's linked request isn't cached — refresh the linked workspace "${linkedWs?.name ?? step.linkedWorkspaceId}".`
        : 'This step references a request that no longer exists.';
    // Clicking a step opens its request editor — the same affordance a
    // request in the Editor view gets. Resolution (local vs linked) happens
    // in the command so a deleted/uncached request surfaces a clear warning.
    item.command = {
      command: 'apicircle.openPlanStepRequest',
      title: 'Open Request',
      arguments: [{ planId: element.planId, stepIndex: element.stepIndex }],
    };
    return item;
  }

  async getChildren(element?: ExecutionNode): Promise<ExecutionNode[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];
    const state = await active.read();
    const plans = state.synced.executionPlans ?? {};

    if (!element) {
      return Object.values(plans)
        .sort((a, b) => a.name.localeCompare(b.name))
        .map((p) => ({ kind: 'plan' as const, id: p.id }));
    }
    if (element.kind === 'step') return [];

    const plan = plans[element.id];
    if (!plan) return [];
    return plan.steps.map((_, i) => ({
      kind: 'step' as const,
      planId: element.id,
      stepIndex: i,
    }));
  }
}
