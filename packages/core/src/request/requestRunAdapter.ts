import type { RequestRun } from '@apicircle/shared';
import type { ExecutionResult } from './executeRequest';

/**
 * Adapt a stored `RequestRun` into the `ExecutionResult` shape that
 * `ResponseViewer` consumes. `RequestRun` is the persisted, post-mortem
 * record (kept on `WorkspaceLocal.history` and capped); `ExecutionResult`
 * is the live in-flight value the editor receives. Both expose the same
 * conceptual fields, so the History and Execution detail views can lean
 * on the same renderer instead of forking the layout.
 *
 * The body is `responseBodyPreview` (already capped by
 * `RUN_BODY_PREVIEW_LIMIT`); the editor will show a truncation hint when
 * `RequestRun.responseTruncated` is true.
 */
export function requestRunToExecutionResult(run: RequestRun): ExecutionResult {
  return {
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    status: run.status,
    ok: run.ok,
    statusText: run.statusText,
    headers: run.responseHeaders,
    body: run.responseBodyPreview,
    bodyKind: run.responseBodyKind,
    error: run.error,
    url: run.url,
    method: run.method,
    // Historical runs predate the auth-warnings feature; surfacing an
    // empty list is the honest answer (we don't know if there were
    // warnings at the time).
    authWarnings: [],
  };
}
