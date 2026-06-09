import * as vscode from 'vscode';
import type { EnvPriorityRef } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// `APICircle: Set Environment Priority Order` command.
//
// The variable resolver layers environments top-down per
// `environments.priorityOrder`. This command lets the user reorder that list.
//
// Phase 2 round 1 ships a multi-selection pattern that's simple but effective:
//   1. QuickPick (multi-select) over every local environment shows ALL local
//      envs with checkboxes; the user picks/unpicks to include/exclude.
//   2. After multi-select, a second QuickPick lets them reorder one-by-one
//      by repeatedly choosing the next env in priority order.
//
// Linked-workspace envs (kind: 'linked') ship in Phase 8; this command only
// operates on local envs for Phase 2.
// =============================================================================

export interface SetPriorityDeps {
  bridge: VsCodeBridge;
}

export async function setEnvPriorityOrderCommand(deps: SetPriorityDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }

  const state = await active.read();
  const envs = Object.values(state.synced.environments.items);
  if (envs.length === 0) {
    await vscode.window.showInformationMessage(
      'No environments to order. Run "APICircle: New Environment" first.',
    );
    return;
  }

  const currentOrder = state.synced.environments.priorityOrder.filter(
    (p): p is Extract<EnvPriorityRef, { kind: 'local' }> => p.kind === 'local',
  );
  const currentNames = new Set(currentOrder.map((p) => p.name));

  // Step 1: Multi-select which envs to INCLUDE in the priority order
  const inclusionPicks = await vscode.window.showQuickPick(
    envs.map((e) => ({
      label: e.name,
      description: `${e.variables.length} var(s)`,
      picked: currentNames.has(e.name),
    })),
    {
      placeHolder: 'Step 1 of 2 — Pick which environments participate in the priority overlay',
      canPickMany: true,
    },
  );
  if (!inclusionPicks) return;
  if (inclusionPicks.length === 0) {
    // Empty list = no overlay
    await active.apply({ kind: 'environment.setPriority', order: [] });
    await vscode.window.showInformationMessage('Priority order cleared.');
    return;
  }

  // Step 2: Order them by repeatedly asking "What's next?"
  const remaining = new Set(inclusionPicks.map((p) => p.label));
  const ordered: string[] = [];
  while (remaining.size > 0) {
    const stepNum = ordered.length + 1;
    const total = inclusionPicks.length;
    if (remaining.size === 1) {
      ordered.push([...remaining][0]);
      break;
    }
    const next = await vscode.window.showQuickPick(
      [...remaining].sort().map((name) => ({ label: name })),
      {
        placeHolder: `Step 2 of 2 — Priority position ${stepNum} of ${total} (highest precedence first)`,
      },
    );
    if (!next) return; // user cancelled mid-flow — abort without saving
    ordered.push(next.label);
    remaining.delete(next.label);
  }

  const order: EnvPriorityRef[] = ordered.map((name) => ({ kind: 'local', name }));
  await active.apply({ kind: 'environment.setPriority', order });
  await vscode.window.showInformationMessage(`Priority order set: ${ordered.join(' > ')}`);
}
