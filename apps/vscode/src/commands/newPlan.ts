import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import type { ExecutionPlan, Request as ApiRequest } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// `APICircle: New Plan` — multi-step QuickPick wizard.
//
// Steps:
//   1. InputBox: name (non-empty, no duplicate)
//   2. Multi-select QuickPick: which requests to include
//   3. Per-step ordering: same pattern as priority editor — repeat "next?"
//   4. Yes/No: stopOnAssertionFailure
//
// Creates the plan via plan.upsert. The Execution TreeView refreshes via
// the workspace.json watcher.
// =============================================================================

export interface NewPlanDeps {
  bridge: VsCodeBridge;
}

export async function newPlanCommand(deps: NewPlanDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const state = await active.read();
  const allRequests = Object.values(state.synced.collections.requests);
  if (allRequests.length === 0) {
    await vscode.window.showInformationMessage(
      'No requests in this workspace. Add one via "APICircle: New Request" first.',
    );
    return;
  }

  const existingNames = new Set(Object.values(state.local.executionPlans ?? {}).map((p) => p.name));

  // Step 1: Plan name
  const name = await vscode.window.showInputBox({
    prompt: 'Plan name',
    placeHolder: 'Smoke tests / Signup flow / …',
    validateInput: (v) => {
      const trimmed = v.trim();
      if (trimmed.length === 0) return 'Name is required';
      if (existingNames.has(trimmed)) return `Plan "${trimmed}" already exists`;
      return null;
    },
  });
  if (name === undefined) return;

  // Step 2: Multi-select which requests
  const picks = await vscode.window.showQuickPick(
    sortByFolderThenName(allRequests, state.synced.collections.folders).map((r) => ({
      label: r.name,
      description: `${r.method} ${shortPath(r.url)}`,
      requestId: r.id,
    })),
    {
      placeHolder: 'Pick the requests to include — order in step 3',
      canPickMany: true,
    },
  );
  if (!picks || picks.length === 0) return;

  // Step 3: Order
  const ordered: string[] = [];
  if (picks.length === 1) {
    ordered.push(picks[0].requestId);
  } else {
    const remaining = new Set(picks.map((p) => p.requestId));
    while (remaining.size > 1) {
      const stepNum = ordered.length + 1;
      const total = picks.length;
      const next = await vscode.window.showQuickPick(
        picks
          .filter((p) => remaining.has(p.requestId))
          .map((p) => ({ label: p.label, description: p.description, requestId: p.requestId })),
        { placeHolder: `Step position ${stepNum} of ${total} — pick the next step` },
      );
      if (!next) return; // abort
      ordered.push(next.requestId);
      remaining.delete(next.requestId);
    }
    ordered.push([...remaining][0]);
  }

  // Step 4: stopOnAssertionFailure
  const stop = await vscode.window.showQuickPick(
    [
      { label: 'No — run all steps even if assertions fail', value: false },
      { label: 'Yes — halt on first assertion failure', value: true },
    ],
    { placeHolder: 'Stop on assertion failure?' },
  );
  if (!stop) return;

  const now = new Date().toISOString();
  const plan: ExecutionPlan = {
    id: generateId(),
    name: name.trim(),
    steps: ordered.map((requestId) => ({ requestId, enabled: true })),
    envPriorityOrder: [],
    stopOnAssertionFailure: stop.value,
    createdAt: now,
    updatedAt: now,
  };

  await active.apply({ kind: 'plan.upsert', plan });
  await vscode.window.showInformationMessage(
    `Plan "${plan.name}" created with ${plan.steps.length} step(s).`,
  );
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

function shortPath(url: string): string {
  try {
    return new URL(url).pathname;
  } catch {
    return url;
  }
}
