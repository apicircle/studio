import * as vscode from 'vscode';
import { executeRequest, runAssertions, mergeRequestOverride } from '@apicircle/core';
import { generateId } from '@apicircle/shared';
import type { Request as ApiRequest } from '@apicircle/shared';
import type { AssertionResult, ExecutionResult, WorkspaceState } from '@apicircle/core';
import type { VsCodeBridge } from '../host/vscodeBridge';
import type { VsCodeVaultManager } from '../host/vaultManager';
import { buildResolvedRequest, buildLinkedAttachmentResolver } from './buildSendScope';
import type { AbortRegistry } from './abortRegistry';
import type { InFlightSendTracker } from './inFlightTracker';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import type { PreSendDiagnostics } from '../diagnostics/preSendDiagnostics';
import {
  formatResponseDocument,
  formatPendingResponseDocument,
  formatCancelledResponseDocument,
  formatFailedResponseDocument,
} from './responseDocument';
import { persistRequestRun } from './persistHistory';

// =============================================================================
// `APICircle: Send Request` command.
//
// Flow:
//   1. Determine the target request — from the active text editor (if it's an
//      apicircle:// URI) or via a QuickPick over the active workspace.
//   2. Register an AbortController with the bridge's AbortRegistry.
//   3. Open the response tab BESIDE the request editor with a "Sending…"
//      placeholder so the user gets immediate visual confirmation of the
//      click — no more 1-2s of silence between ▶ Send and the response.
//   4. Call executeRequest from @apicircle/core (wrapped in
//      `vscode.window.withProgress({ location: Window })` so the status-bar
//      spinner appears too).
//   5. On terminal state (success / cancel / error) the placeholder content
//      is replaced in the FS provider's responseStore and `fireChangedExternal`
//      tells VS Code to re-read the doc — the already-open tab swaps from
//      the "Sending…" placeholder to the response without flickering.
//
// Pre-send validation runs separately via DiagnosticCollection (Task 14); the
// send command itself does not duplicate that check — it would block on
// blockers if `apicircle.validation.validateOnSend` is true and the active
// workspace's Problems panel has blockers.
// =============================================================================

export interface SendRequestDeps {
  bridge: VsCodeBridge;
  abortRegistry: AbortRegistry;
  /** Tracks URI → runId so the request CodeLens can swap to ⏳ Sending… · ✖ Cancel. */
  tracker?: InFlightSendTracker;
  /** When present, response YAML is stashed here and opened via the FS provider URI. */
  fsProvider?: ApicircleFsProvider;
  /** When present, sendRequest refuses to execute if hasBlocker() is true AND validateOnSend is on. */
  diagnostics?: PreSendDiagnostics;
  /** When present, decrypts encrypted env-vars before send. Null = no decryption (encrypted vars become "missing"). */
  vault?: VsCodeVaultManager | null;
  /** SecretStorage for linked-secret values + dedicated tokens. */
  secrets?: vscode.SecretStorage;
  /** Test-only override hook for the executor (defaults to core's executeRequest). */
  execute?: typeof executeRequest;
  /** Test-only override hook for the response-viewer open. */
  openResponse?: (uri: vscode.Uri, content: string) => Promise<void>;
  /** Test-only override hook for the withProgress wrapper. Defaults to vscode.window.withProgress. */
  withProgress?: typeof vscode.window.withProgress;
}

export async function sendRequestCommand(deps: SendRequestDeps): Promise<void> {
  const { bridge, abortRegistry } = deps;
  const execute = deps.execute ?? executeRequest;

  const active = bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }

  const { request, uri: requestUri, fromLinkId } = await resolveRequest(active);
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

  // Mark the URI as in-flight so the request CodeLens swaps ▶ Send → ⏳ Sending…
  // The URI is the canonical request URI; we fall back to nothing when the
  // send was kicked from a QuickPick with no source URI, since there's no
  // tab to swap a lens on in that case.
  if (deps.tracker && requestUri) {
    deps.tracker.start(requestUri, runId, request.name);
  }

  // Pre-open the response tab beside the request editor so the user sees
  // immediate visual feedback. The placeholder content is rewritten in
  // place when the executor resolves (or rejects / cancels). preserveFocus
  // keeps the cursor in the request YAML so the user can keep editing
  // while the request runs.
  const startedAt = new Date().toISOString();
  const startedAtMs = Date.parse(startedAt);
  const responseUri = makeResponseUri(active.workspace.id, runId, request.name);
  if (deps.fsProvider) {
    const pending = formatPendingResponseDocument({
      requestName: request.name,
      request,
      startedAt,
    });
    deps.fsProvider.storeResponse(runId, pending);
    try {
      const doc = await vscode.workspace.openTextDocument(responseUri);
      await vscode.window.showTextDocument(doc, {
        viewColumn: vscode.ViewColumn.Beside,
        preserveFocus: true,
      });
    } catch {
      // Best-effort — proceed with the send even if the pre-open hiccups.
      // The completion path will still stash content + fire a change event
      // so the user can open the tab manually from the HistoryView.
    }
  }

  const withProgress = deps.withProgress ?? vscode.window.withProgress;

  // Send-time variable / secret resolution. Interpolates `{{var}}` placeholders
  // in url / headers / query / body / auth from environments (local + linked,
  // with linkedOverrides applied) + provisioned linked secrets. If the
  // SecretStorage handle is missing (some test setups) we skip resolution and
  // let the executor see raw placeholders — that's the previous behavior.
  let resolvedRequest = request;
  let missingPlaceholders: string[] = [];
  let stateForExecute: WorkspaceState | null = null;
  if (deps.secrets) {
    try {
      stateForExecute = await active.read();
      const resolved = await buildResolvedRequest({
        state: stateForExecute,
        workspaceId: active.workspace.id,
        request,
        vault: deps.vault ?? null,
        secrets: deps.secrets,
        fromLinkId,
      });
      resolvedRequest = resolved.request;
      missingPlaceholders = resolved.missing;
    } catch (e) {
      void e; // resolution is best-effort; fall back to raw on error
    }
  }
  // Attachment resolver: for linked requests, fetch binary bodies + file rows
  // from the source repo via GitHub. Owned attachments aren't yet wired here
  // (the extension has no IDB), so they'd fall through to the canonical
  // "Attachment X required but not downloaded locally" error.
  const resolveAttachment =
    fromLinkId && deps.secrets && stateForExecute
      ? buildLinkedAttachmentResolver({ state: stateForExecute, secrets: deps.secrets, fromLinkId })
      : undefined;
  if (missingPlaceholders.length > 0) {
    // Non-blocking notice so the user knows why a `{{TOKEN}}` reached the wire.
    void vscode.window.showWarningMessage(
      `Unresolved placeholder${missingPlaceholders.length === 1 ? '' : 's'}: ${missingPlaceholders.join(', ')}`,
    );
  }

  try {
    const result = await withProgress<ExecutionResult>(
      {
        location: vscode.ProgressLocation.Window,
        title: `APICircle · Sending: ${request.name}`,
        cancellable: true,
      },
      async (_progress, token) => {
        // Bridge VS Code's notification-cancel button into our AbortRegistry
        // so the user can hit the X on the status-bar progress and have the
        // executeRequest call see signal.aborted === true.
        const sub = token.onCancellationRequested(() => abortRegistry.cancel(runId));
        try {
          return await execute(resolvedRequest, { signal, timeoutMs, resolveAttachment });
        } finally {
          sub.dispose();
        }
      },
    );
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

    const content = formatResponseDocument({
      requestName: request.name,
      result,
      assertionVerdicts: verdicts,
    });

    if (deps.openResponse) {
      // Test hook — keeps the legacy "called once with the final content"
      // contract for tests that don't wire up an fsProvider.
      await deps.openResponse(responseUri, content);
    } else if (deps.fsProvider) {
      // Swap the pre-opened placeholder for the real response in place.
      deps.fsProvider.storeResponse(runId, content);
      deps.fsProvider.fireChangedExternal(responseUri);
    } else {
      // Final fallback — no FS provider, no openResponse: open an untitled
      // editor with the response content (kept for unit-test setups that
      // run the send command in isolation).
      await openInUntitledEditor(responseUri, content);
    }
  } catch (e) {
    abortRegistry.complete(runId);
    const durationMs = Number.isFinite(startedAtMs) ? Date.now() - startedAtMs : 0;
    if (signal.aborted) {
      // Swap the pre-opened placeholder for a cancel notice so the tab is
      // self-explanatory rather than stuck on "Sending…".
      if (deps.fsProvider) {
        deps.fsProvider.storeResponse(
          runId,
          formatCancelledResponseDocument({
            requestName: request.name,
            request,
            startedAt,
            durationMs,
          }),
        );
        deps.fsProvider.fireChangedExternal(responseUri);
      }
      await vscode.window.showInformationMessage(`Send "${request.name}" was cancelled.`);
      return;
    }
    if (deps.fsProvider) {
      deps.fsProvider.storeResponse(
        runId,
        formatFailedResponseDocument({
          requestName: request.name,
          request,
          startedAt,
          durationMs,
          error: e instanceof Error ? e.message : String(e),
        }),
      );
      deps.fsProvider.fireChangedExternal(responseUri);
    }
    await vscode.window.showErrorMessage(
      `Send failed: ${e instanceof Error ? e.message : String(e)}`,
    );
  } finally {
    // Always release the tracker entry — success / error / cancel all flow
    // through here, so the CodeLens reverts to ▶ Send in a single place.
    if (deps.tracker && requestUri) {
      deps.tracker.end(requestUri);
    }
  }
}

async function resolveRequest(surface: {
  read: () => Promise<WorkspaceState>;
}): Promise<{ request: ApiRequest | null; uri: vscode.Uri | null; fromLinkId?: string }> {
  const editor = vscode.window.activeTextEditor;
  if (editor && editor.document.uri.scheme === 'apicircle') {
    const requestId = extractRequestId(editor.document.uri);
    if (requestId) {
      const state = await surface.read();
      const req = state.synced.collections.requests[requestId];
      if (req) return { request: req, uri: editor.document.uri };
    }
    // Linked request: send the EFFECTIVE request (source snapshot + override).
    const linked = extractLinkedRef(editor.document.uri);
    if (linked) {
      const state = await surface.read();
      const base =
        state.local.linkedCollections[linked.linkId]?.collections.requests[linked.requestId];
      if (base) {
        const ov = state.synced.linkedOverrides.requests[`${linked.linkId}:${linked.requestId}`];
        const effective = ov ? mergeRequestOverride(base, ov.patch) : base;
        return { request: effective, uri: editor.document.uri, fromLinkId: linked.linkId };
      }
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
  // Identity is the `?id=` query — the path slug is display only and changes
  // when the request is renamed. Anything under /requests/* with an id wins.
  const segments = uri.path.split('/').filter(Boolean);
  if (segments.length < 2 || segments[0] !== 'requests') return null;
  const query = new URLSearchParams(uri.query || '');
  return query.get('id');
}

function extractLinkedRef(uri: vscode.Uri): { linkId: string; requestId: string } | null {
  const segments = uri.path.split('/').filter(Boolean);
  if (segments[0] !== 'linked' || !uri.path.endsWith('.req.yaml')) return null;
  const query = new URLSearchParams(uri.query || '');
  const linkId = query.get('link');
  const requestId = query.get('id');
  return linkId && requestId ? { linkId, requestId } : null;
}

function describePath(url: string): string {
  try {
    const u = new URL(url);
    return u.pathname + u.search;
  } catch {
    return url;
  }
}

function makeResponseUri(workspaceId: string, runId: string, requestName: string): vscode.Uri {
  // Defer to the FS provider's canonical builder so the slug + query encoding
  // stays in one place.
  return ApicircleFsProvider.responseUri(workspaceId, runId, requestName);
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
