import * as vscode from 'vscode';
import type { AbortRegistry } from '../execute/abortRegistry';
import type { InFlightPlanTracker } from '../execute/inFlightPlanTracker';

// =============================================================================
// `apicircle.cancelPlanRun` — cancel the in-flight run for a single plan URI.
// Wired to the "✖ Cancel" CodeLens that appears while a plan is executing.
// Falls back to the active editor's URI when the URI argument is missing
// (palette invocation) and to a no-op message when nothing is in flight.
//
// The plan-side mirror of `apicircle.cancelOneSend`. `runPlan` already threads
// the AbortSignal into each step's `executeRequest` and checks it between
// steps, so cancelling aborts both the in-flight request and the remaining
// steps.
// =============================================================================

export interface CancelPlanRunDeps {
  abortRegistry: AbortRegistry;
  tracker: InFlightPlanTracker;
}

export async function cancelPlanRunCommand(
  deps: CancelPlanRunDeps,
  uri?: vscode.Uri,
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showInformationMessage('No plan URI in focus to cancel.');
    return;
  }
  // The tracker is keyed by the stable plan id, which rides in the plan URI's
  // `?id=` query (the CodeLens passes its own document URI).
  const planId = new URLSearchParams(targetUri.query || '').get('id');
  const entry = planId ? deps.tracker.get(planId) : undefined;
  if (!planId || !entry) {
    await vscode.window.showInformationMessage('No active run for this plan.');
    return;
  }
  const cancelled = deps.abortRegistry.cancel(entry.runId);
  if (!cancelled) {
    // The run finished between the CodeLens render and the click.
    deps.tracker.end(planId);
  }
}
