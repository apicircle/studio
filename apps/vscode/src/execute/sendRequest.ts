import * as vscode from 'vscode';
import { executeRequest, runAssertions } from '@apicircle/core';
import { generateId } from '@apicircle/shared';
import type { Request as ApiRequest } from '@apicircle/shared';
import type { AssertionResult } from '@apicircle/core';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { AbortRegistry } from './abortRegistry';
import type { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import type { PreSendDiagnostics } from '../diagnostics/preSendDiagnostics';
import { formatResponseDocument } from './responseDocument';
import { persistRequestRun } from './persistHistory';

// =============================================================================
// `APICircle: Send Request` command.
//
// Flow:
//   1. Determine the target request — from the active text editor (if it's an
//      apicircle:// URI) or via a QuickPick over the active workspace.
//   2. Register an AbortController with the bridge's AbortRegistry.
//   3. Call executeRequest from @apicircle/core.
//   4. Open the response as a virtual apicircle://.../responses/<runId>.run.yaml
//      document beside the source.
//   5. On cancel: AbortSignal propagates, status bar clears, response viewer
//      shows the partial result with an error note.
//
// Pre-send validation runs separately via DiagnosticCollection (Task 14); the
// send command itself does not duplicate that check — it would block on
// blockers if `apicircle.validation.validateOnSend` is true and the active
// workspace's Problems panel has blockers.
// =============================================================================

export interface SendRequestDeps {
  bridge: VsCodeBridge;
  abortRegistry: AbortRegistry;
  /** When present, response YAML is stashed here and opened via the FS provider URI. */
  fsProvider?: ApicircleFsProvider;
  /** When present, sendRequest refuses to execute if hasBlocker() is true AND validateOnSend is on. */
  diagnostics?: PreSendDiagnostics;
  /** Test-only override hook for the executor (defaults to core's executeRequest). */
  execute?: typeof executeRequest;
  /** Test-only override hook for the response-viewer open. */
  openResponse?: (uri: vscode.Uri, content: string) => Promise<void>;
}

export async function sendRequestCommand(deps: SendRequestDeps): Promise<void> {
  const { bridge, abortRegistry } = deps;
  const execute = deps.execute ?? executeRequest;

  const active = bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }

  const { request, uri: requestUri } = await resolveRequest(active);
  if (!request) return;

  // Gap #3 — enforce validateOnSend setting. If the user has blockers in the
  // Problems panel and the validateOnSend setting is on (the default), refuse
  // to send. Warnings still allow the send.
  if (deps.diagnostics && requestUri) {
    const validateOnSend = vscode.workspace
      .getConfiguration('apicircle')
      .get<boolean>('validation.validateOnSend', true);
    if (validateOnSend && deps.diagnostics.hasBlocker(requestUri)) {
      await vscode.window.showErrorMessage(
        `Send blocked: "${request.name}" has validation errors. See Problems panel.`,
      );
      return;
    }
  }

  const runId = generateId();
  const signal = abortRegistry.register(runId);

  // Resolve user-overridable execution settings up-front so every code path
  // (try / catch / persist) sees consistent values.
  const cfg = vscode.workspace.getConfiguration('apicircle');
  const timeoutMs = cfg.get<number>('execution.timeoutMs', 30000);
  const executionHost = cfg.get<'remote' | 'local'>('execution.host', 'remote');

  // Surface a hint when the user has flipped to "local" but is executing
  // in a non-Remote context. The actual port-forwarding wiring lands in
  // Phase 7 (mock-server proxy). For Phase 2 we just gate against
  // `vscode.env.remoteName` so the choice isn't silently a no-op.
  if (executionHost === 'local' && !vscode.env.remoteName) {
    void vscode.window.showWarningMessage(
      'apicircle.execution.host = "local" only takes effect in Remote-SSH / Codespaces. ' +
        'Sending against the local extension host as a fallback.',
    );
  }

  try {
    const result = await execute(request, { signal, timeoutMs });
    abortRegistry.complete(runId);

    let verdicts: AssertionResult[] | undefined;
    if (request.assertions.length > 0) {
      verdicts = runAssertions(request.assertions, result);
    }

    // Persist the run to WorkspaceLocal.history so the HistoryView surfaces it.
    try {
      const maxEntries = cfg.get<number>('history.maxEntriesPerWorkspace', 500);
      const retentionDays = cfg.get<number>('history.retentionDays', 30);
      await persistRequestRun({
        surface: active,
        request,
        result,
        assertionVerdicts: verdicts,
        maxEntries,
        retentionDays,
      });
    } catch (persistErr) {
      // History persistence failure is non-fatal — log but don't block the
      // user from seeing the response.
      void persistErr;
    }

    const uri = makeResponseUri(active.workspace.id, runId);
    const content = formatResponseDocument({
      requestName: request.name,
      result,
      assertionVerdicts: verdicts,
    });

    if (deps.openResponse) {
      await deps.openResponse(uri, content);
    } else if (deps.fsProvider) {
      // Gap #2 — open the response THROUGH the FS provider so the URI is
      // navigable, persists across the session, and is available for the
      // Phase 6+ transformations follow-up (TOON / YAML / CSV / minify
      // CodeLens — desktop has these; the extension defers them).
      deps.fsProvider.storeResponse(runId, content);
      const doc = await vscode.workspace.openTextDocument(uri);
      await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
    } else {
      await openInUntitledEditor(uri, content);
    }
  } catch (e) {
    abortRegistry.complete(runId);
    if (signal.aborted) {
      await vscode.window.showInformationMessage(`Send "${request.name}" was cancelled.`);
      return;
    }
    await vscode.window.showErrorMessage(
      `Send failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

async function resolveRequest(surface: {
  read: () => Promise<{ synced: { collections: { requests: Record<string, ApiRequest> } } }>;
}): Promise<{ request: ApiRequest | null; uri: vscode.Uri | null }> {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'apicircle') {
    const requestId = extractRequestId(editor.document.uri);
    if (requestId) {
      const state = await surface.read();
      const req = state.synced.collections.requests[requestId];
      if (req) return { request: req, uri: editor.document.uri };
    }
  }

  // Fallback: QuickPick over the workspace's requests
  const state = await surface.read();
  const requests = Object.values(state.synced.collections.requests);
  if (requests.length === 0) {
    await vscode.window.showWarningMessage('No requests in the active workspace.');
    return { request: null, uri: null };
  }
  const picked = await vscode.window.showQuickPick(
    requests.map((r) => ({
      label: r.name,
      description: `${r.method} ${describePath(r.url)}`,
      request: r,
    })),
    { placeHolder: 'Pick a request to send' },
  );
  return { request: picked?.request ?? null, uri: null };
}

function extractRequestId(uri: vscode.Uri): string | null {
  // apicircle://<authority>/requests/<id>.req.yaml
  const segments = uri.path.split('/').filter(Boolean);
  if (segments.length !== 2 || segments[0] !== 'requests') return null;
  return segments[1].replace(/\.req\.yaml$/, '').replace(/\.yaml$/, '');
}

function describePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function makeResponseUri(workspaceId: string, runId: string): vscode.Uri {
  const authority = Buffer.from(workspaceId, 'utf8').toString('base64url');
  return vscode.Uri.from({
    scheme: 'apicircle',
    authority,
    path: `/responses/${runId}.run.yaml`,
  });
}

async function openInUntitledEditor(uri: vscode.Uri, content: string): Promise<void> {
  // Phase 1 fallback: response docs are untitled (read-only feel via the YAML
  // language), opened side-by-side with the source. The mainline path above
  // routes through the FS provider for backed URIs; this branch only fires
  // when the caller passes no fsProvider — kept for unit-test setups that
  // run the send command in isolation.
  void uri;
  const doc = await vscode.workspace.openTextDocument({ language: 'yaml', content });
  await vscode.window.showTextDocument(doc, vscode.ViewColumn.Beside);
}
