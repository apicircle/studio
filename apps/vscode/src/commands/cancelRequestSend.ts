import * as vscode from 'vscode';
import type { AbortRegistry } from '../execute/abortRegistry';
import type { InFlightSendTracker } from '../execute/inFlightTracker';

// =============================================================================
// `apicircle.cancelOneSend` — cancel the in-flight send for a single request
// URI. Wired to the "✖ Cancel" CodeLens that appears while a request is
// executing. Falls back to the active editor's URI when the URI argument is
// missing (palette invocation) and to a no-op message when nothing is in
// flight.
//
// Distinct from `apicircle.cancelSend`, which cancels every in-flight send at
// once (used by the Esc keybinding and the command palette).
// =============================================================================

export interface CancelOneSendDeps {
  abortRegistry: AbortRegistry;
  tracker: InFlightSendTracker;
}

export async function cancelOneSendCommand(
  deps: CancelOneSendDeps,
  uri?: vscode.Uri,
): Promise<void> {
  const targetUri = uri ?? vscode.window.activeTextEditor?.document.uri;
  if (!targetUri) {
    await vscode.window.showInformationMessage('No request URI in focus to cancel.');
    return;
  }
  const entry = deps.tracker.get(targetUri);
  if (!entry) {
    await vscode.window.showInformationMessage('No active send for this request.');
    return;
  }
  const cancelled = deps.abortRegistry.cancel(entry.runId);
  if (!cancelled) {
    // The send finished between the CodeLens render and the click.
    deps.tracker.end(targetUri);
  }
}
