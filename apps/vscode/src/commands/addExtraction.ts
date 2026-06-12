import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { pickJsonPath } from '../execute/extractionPicker';

// =============================================================================
// `APICircle: Add Extraction from Latest Response` command.
//
// Flow:
//   1. QuickPick over the user's requests (or use the active editor's id).
//   2. Look up the most-recent RequestRun for that request in
//      WorkspaceLocal.history.requestRuns.
//   3. JsonPathPicker over the response body — user picks a leaf.
//   4. InputBox for the variable name.
//   5. Patch request.update to append a new ContextExtraction.
// =============================================================================

export interface AddExtractionDeps {
  bridge: VsCodeBridge;
}

export async function addExtractionFromLatestResponseCommand(
  deps: AddExtractionDeps,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const state = await active.read();
  const requests = Object.values(state.synced.collections.requests);
  if (requests.length === 0) {
    await vscode.window.showInformationMessage('No requests in the workspace.');
    return;
  }

  // Resolve target request — prefer active editor, fallback to QuickPick.
  // The canonical apicircle:// request URI now carries the id in the `?id=`
  // query (the path slug is the human-readable name and changes on rename),
  // so we consult the query first; the older slug-as-id pattern is kept as
  // a fallback for tests that mock a bare URI without a query.
  let requestId: string | null = null;
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'apicircle') {
    const query = new URLSearchParams(editor.document.uri.query || '');
    const idFromQuery = query.get('id');
    if (idFromQuery) {
      requestId = idFromQuery;
    } else {
      const m = editor.document.uri.path.match(/\/requests\/([^.]+)/);
      if (m) requestId = m[1];
    }
  }
  if (!requestId) {
    const picked = await vscode.window.showQuickPick(
      requests.map((r) => ({ label: r.name, description: r.method, id: r.id })),
      { placeHolder: 'Pick a request to add an extraction to' },
    );
    if (!picked) return;
    requestId = picked.id;
  }
  const request = state.synced.collections.requests[requestId];
  if (!request) return;

  // Find the most-recent RequestRun for this request.
  const latestRun = state.local.history.requestRuns.find((r) => r.requestId === requestId);
  if (!latestRun) {
    await vscode.window.showInformationMessage(
      `No history for "${request.name}". Send the request once, then re-run this command.`,
    );
    return;
  }
  if (latestRun.responseBodyKind !== 'json') {
    await vscode.window.showWarningMessage(
      `Latest response was ${latestRun.responseBodyKind}, not JSON. Extraction picker requires JSON.`,
    );
    return;
  }

  const path = await pickJsonPath(latestRun.responseBodyPreview);
  if (!path) return;

  const variable = await vscode.window.showInputBox({
    prompt: 'Variable name (referenced as {{name}} in later requests)',
    placeHolder: 'access_token / user_id / order_ref',
    validateInput: (v) => {
      const trimmed = v.trim();
      if (trimmed.length === 0) return 'Variable name is required';
      if (!/^[a-zA-Z_][a-zA-Z0-9_]*$/.test(trimmed))
        return 'Use letters / digits / underscore only';
      return null;
    },
  });
  if (variable === undefined) return;

  const newExtraction = {
    id: generateId(),
    variable: variable.trim(),
    source: 'body' as const,
    path,
    enabled: true,
  };
  const nextExtractions = [...request.extractions, newExtraction];
  await active.apply({
    kind: 'request.update',
    id: requestId,
    patch: { extractions: nextExtractions },
  });
  await vscode.window.showInformationMessage(
    `Extraction "${variable}" added to "${request.name}". Send to populate.`,
  );
}
