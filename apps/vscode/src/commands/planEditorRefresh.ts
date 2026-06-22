import * as vscode from 'vscode';
import type { ExecutionPlan } from '@apicircle/shared';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// refreshPlanEditor — reload any open plan YAML editor after a headless plan
// mutation (env-priority set, step add / remove / toggle / change).
//
// Plan-editing commands write through `plan.upsert`, which mutates the
// workspace but does NOT touch the open `apicircle://…/plans/<slug>.yaml`
// editor buffer — the FS provider only re-serializes a plan on `readFile`
// (open / reload). Without an explicit nudge the editor keeps showing the
// stale projection (this was the "Plan Environments doesn't update the
// envPriorityOrder in the editor" bug). Firing the FS provider's change
// event for the plan URI makes VS Code re-read the (non-dirty) document, so
// the serialized projection catches up immediately — the same mechanism the
// response viewer uses to swap its "Sending…" placeholder for the result.
//
// The plan slug hasn't changed for any of these mutations, so the computed
// URI matches the open tab's URI exactly.
// =============================================================================

export interface PlanEditorRefresher {
  fireChangedExternal(uri: vscode.Uri): void;
}

export function refreshPlanEditor(
  fsProvider: PlanEditorRefresher | undefined,
  workspaceId: string,
  plan: ExecutionPlan,
): void {
  if (!fsProvider) return;
  fsProvider.fireChangedExternal(ApicircleFsProvider.planUri(workspaceId, plan));
}

/**
 * Guard a structured plan mutation (env-priority set, step add / remove /
 * toggle / change) against a dirty plan editor. These commands write straight
 * to the workspace and then `refreshPlanEditor` reloads the projection — but if
 * the user has unsaved edits in the plan YAML, the workspace write would race
 * the buffer: VS Code keeps the dirty buffer (protecting the edits), so the
 * structured change would silently vanish when the user next saves their
 * version. Refuse up front and tell the user to save first; returns false (and
 * warns) when an open plan editor for `planId` is dirty, true otherwise. With
 * no open / no dirty editor (the TreeView / palette path) it always passes.
 */
export async function ensurePlanEditorSaved(planId: string): Promise<boolean> {
  const dirty = (vscode.workspace.textDocuments ?? []).find(
    (doc) =>
      doc.uri.scheme === 'apicircle' &&
      uriEntityKind(doc.uri) === 'plan' &&
      new URLSearchParams(doc.uri.query || '').get('id') === planId &&
      doc.isDirty,
  );
  if (dirty) {
    await vscode.window.showWarningMessage(
      'This plan has unsaved changes in the editor — save (Ctrl+S) or revert them first, then try again.',
    );
    return false;
  }
  return true;
}
