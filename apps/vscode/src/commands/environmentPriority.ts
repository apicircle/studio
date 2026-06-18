import * as vscode from 'vscode';
import type { EnvPriorityRef } from '@apicircle/shared';
import { envPriorityKey } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// `API Circle: Set Environment Priority Order` command.
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
// Linked-workspace envs (kind: 'linked') are first-class — every linked
// workspace's cached environments appear in the inclusion pick alongside local
// envs, and the resolver layers them per the user-set order.
// =============================================================================

export interface SetPriorityDeps {
  bridge: VsCodeBridge;
}

export async function setEnvPriorityOrderCommand(deps: SetPriorityDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }

  const state = await active.read();

  // Collect every selectable env across local + every linked workspace.
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
      'No environments to order. Run "API Circle: New Environment" first, or link a workspace.',
    );
    return;
  }

  const currentKeys = new Set(state.synced.environments.priorityOrder.map(envPriorityKey));
  const byLabel = new Map(candidates.map((c) => [c.label, c.ref]));

  // Step 1: Multi-select which envs participate.
  const inclusionPicks = await vscode.window.showQuickPick(
    candidates.map((c) => ({
      label: c.label,
      description: c.description,
      picked: currentKeys.has(envPriorityKey(c.ref)),
    })),
    {
      placeHolder: 'Step 1 of 2 — Pick which environments participate in the priority overlay',
      canPickMany: true,
    },
  );
  if (!inclusionPicks) return;
  if (inclusionPicks.length === 0) {
    await active.apply({ kind: 'environment.setPriority', order: [] });
    await vscode.window.showInformationMessage('Priority order cleared.');
    return;
  }

  // Step 2: order them by repeatedly asking "What's next?"
  const remaining = new Map(inclusionPicks.map((p) => [p.label, byLabel.get(p.label)!]));
  const orderedRefs: EnvPriorityRef[] = [];
  while (remaining.size > 0) {
    const stepNum = orderedRefs.length + 1;
    const total = inclusionPicks.length;
    if (remaining.size === 1) {
      const [label, ref] = [...remaining.entries()][0];
      orderedRefs.push(ref);
      remaining.delete(label);
      break;
    }
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

  await active.apply({ kind: 'environment.setPriority', order: orderedRefs });
  await vscode.window.showInformationMessage(`Priority order set (${orderedRefs.length} entries).`);
}
