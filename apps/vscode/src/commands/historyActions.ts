import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// History view toolbar actions (gap #17):
//   • clearAllHistory     — confirmation modal, clears requestRuns + planRuns
//   • purgeOlderThan      — QuickPick over time windows, fires history.purge
//   • deleteHistoryRun    — confirmation, fires history.delete_run
// =============================================================================

export interface HistoryActionsDeps {
  bridge: VsCodeBridge;
}

const DAY_MS = 24 * 60 * 60 * 1000;

export async function clearAllHistoryCommand(deps: HistoryActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const state = await active.read();
  const count = state.local.history.requestRuns.length + state.local.history.planRuns.length;
  if (count === 0) {
    await vscode.window.showInformationMessage('No history to clear.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Clear all history? ${count} run(s) will be removed from this device. Captured response bodies are gone — this only affects your local copy.`,
    { modal: true },
    'Clear',
  );
  if (confirm !== 'Clear') return;
  await active.write({
    local: {
      ...state.local,
      history: { requestRuns: [], planRuns: [] },
    },
  });
}

export async function purgeOlderThanCommand(deps: HistoryActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const picked = await vscode.window.showQuickPick(
    [
      { label: '1 day', ms: 1 * DAY_MS },
      { label: '1 week', ms: 7 * DAY_MS },
      { label: '1 month', ms: 30 * DAY_MS },
      { label: '3 months', ms: 90 * DAY_MS },
    ],
    { placeHolder: 'Purge history older than…' },
  );
  if (!picked) return;
  await active.apply({ kind: 'history.purge', olderThanMs: picked.ms });
}

export async function deleteHistoryRunCommand(
  deps: HistoryActionsDeps,
  node?: { kind: 'request-run' | 'plan-run'; runId: string },
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active || !node) return;
  const confirm = await vscode.window.showWarningMessage(
    `Delete this run from history?`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;
  await active.apply(
    node.kind === 'request-run'
      ? { kind: 'history.delete_run', runId: node.runId }
      : { kind: 'history.delete_plan_run', planRunId: node.runId },
  );
}
