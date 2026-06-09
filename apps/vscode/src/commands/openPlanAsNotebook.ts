import * as vscode from 'vscode';
import * as fs from 'node:fs';
import * as path from 'node:path';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { buildPayloadFromPlan } from '../notebook/planNotebookSerializer';

// =============================================================================
// `apicircle.openPlanAsNotebook` — Phase 9 entry point that lifts an existing
// `ExecutionPlan` from `synced.executionPlans` into a `.apicircle-plan.json`
// file on disk, then opens it as a notebook.
//
// Discovery: the command picks the plan from a QuickPick driven by the
// active workspace's plan list. If a `planId` arg is supplied (e.g. when
// invoked from the ExecutionView's per-plan context menu), we skip the
// picker and lift that plan directly.
//
// File location: by default, the notebook lives next to the workspace's
// `.apicircle/` directory under a stable filename pattern
// (`<plan-name-slug>.apicircle-plan.json`). Users can rename/move the
// file freely — the serializer reads the planId from the JSON payload's
// `planId` field, not the filename.
//
// Behavior on second open: the command checks for an existing file at
// the target path; if present, just opens it instead of overwriting.
// =============================================================================

export interface OpenPlanAsNotebookDeps {
  bridge: VsCodeBridge;
  log?: (msg: string) => void;
}

interface PlanArg {
  kind?: 'plan';
  planId?: string;
}

function slugifyPlanName(name: string): string {
  const slug = name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug.length > 0 ? slug : 'plan';
}

export async function openPlanAsNotebookCommand(
  deps: OpenPlanAsNotebookDeps,
  arg?: PlanArg,
): Promise<void> {
  const surface = deps.bridge.activeWorkspace();
  if (!surface) {
    await vscode.window.showWarningMessage(
      'No active APICircle workspace. Open a workspace before opening a plan as a notebook.',
    );
    return;
  }
  const state = await surface.read();
  const plans = state.synced.executionPlans ?? {};
  const planIds = Object.keys(plans);
  if (planIds.length === 0) {
    await vscode.window.showInformationMessage(
      'This workspace has no execution plans yet. Run **New Plan** to create one first.',
    );
    return;
  }

  // Resolve plan: arg → direct lookup; otherwise pick.
  let planId = arg?.planId;
  if (!planId || !plans[planId]) {
    const pick = await vscode.window.showQuickPick(
      planIds.map((id) => ({
        label: plans[id].name,
        description: `${plans[id].steps.length} step${plans[id].steps.length === 1 ? '' : 's'}`,
        value: id,
      })),
      { title: 'Open which plan as a notebook?' },
    );
    if (!pick) return;
    planId = pick.value;
  }
  const plan = plans[planId];
  if (!plan) {
    await vscode.window.showErrorMessage(`Plan "${planId}" not found.`);
    return;
  }

  // Resolve the on-disk path next to .apicircle/.
  const apicircleDir = surface.workspace.apicircleDir;
  const filename = `${slugifyPlanName(plan.name)}.apicircle-plan.json`;
  const fullPath = path.join(apicircleDir, '..', filename);
  const fileUri = vscode.Uri.file(fullPath);

  // Don't overwrite an existing file — just open it. Lets users rename the
  // notebook file without it being recreated on every open.
  if (!fs.existsSync(fullPath)) {
    const payload = buildPayloadFromPlan(surface.workspace.id, plan);
    fs.writeFileSync(fullPath, JSON.stringify(payload, null, 2) + '\n');
    deps.log?.(`wrote ${fullPath} (plan=${planId})`);
  } else {
    deps.log?.(`opened existing ${fullPath} (plan=${planId})`);
  }

  // Open as a notebook (VS Code routes via the registered serializer).
  await vscode.commands.executeCommand('vscode.openWith', fileUri, 'apicircle-plan');
}
