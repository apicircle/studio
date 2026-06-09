import type { ExecutionResult, AssertionResult } from '@apicircle/core';
import type { Request as ApiRequest, RequestRun } from '@apicircle/shared';
import { generateId, RUN_BODY_PREVIEW_LIMIT } from '@apicircle/shared';
import type { WorkspaceSurface } from '../host/vscodeBridge';

// =============================================================================
// Persist a RequestRun to WorkspaceLocal.history.requestRuns.
//
// Captured at the moment send completes. Truncates request/response body
// previews per RUN_BODY_PREVIEW_LIMIT so 100 history rows can't blow up the
// IDB / disk record.
//
// Note: WorkspacePatch doesn't yet have a `history.append_run` variant —
// we write through `provider.write({ local })` directly. This is the same
// pattern the desktop store uses for history. When a `history.append_run`
// patch lands (next refactor), this swaps to a single applyMutation call.
// =============================================================================

export interface PersistRunArgs {
  surface: WorkspaceSurface;
  request: ApiRequest;
  result: ExecutionResult;
  assertionVerdicts?: AssertionResult[];
  maxEntries?: number;
  /** Drop runs older than this many days before appending. 0 / negative = no time cap. */
  retentionDays?: number;
}

export async function persistRequestRun(args: PersistRunArgs): Promise<RequestRun> {
  const { surface, request, result, assertionVerdicts, maxEntries = 500, retentionDays = 0 } = args;
  const run: RequestRun = {
    id: generateId(),
    requestId: request.id,
    startedAt: result.startedAt,
    durationMs: result.durationMs,
    status: result.status,
    statusText: result.statusText,
    ok: result.ok,
    error: result.error,
    url: result.url,
    method: result.method,
    requestHeaders: pickHeaders(request),
    requestBodyPreview: getBodyPreview(request),
    responseHeaders: result.headers,
    responseBodyPreview: truncate(result.body, RUN_BODY_PREVIEW_LIMIT),
    responseBodyKind: result.bodyKind,
    responseTruncated: result.responseTruncated ?? false,
    assertions: (assertionVerdicts ?? []).map((v) => ({
      assertionId: v.assertionId,
      kind: v.kind,
      op: v.op,
      target: v.target,
      expected: v.expected,
      passed: v.passed,
      detail: v.detail,
    })),
  };

  const state = await surface.read();
  const existing = pruneByRetention(state.local.history.requestRuns, retentionDays);
  const next = [run, ...existing].slice(0, maxEntries);
  await surface.write({
    local: {
      ...state.local,
      history: { ...state.local.history, requestRuns: next },
    },
  });
  return run;
}

/**
 * Drop runs whose `startedAt` is older than `retentionDays` days ago.
 * A `retentionDays` of 0 or less is treated as "no time cap".
 */
function pruneByRetention(runs: ReadonlyArray<RequestRun>, retentionDays: number): RequestRun[] {
  if (!retentionDays || retentionDays <= 0) return [...runs];
  const cutoff = Date.now() - retentionDays * 86_400_000;
  return runs.filter((r) => {
    const t = Date.parse(r.startedAt);
    return Number.isNaN(t) ? true : t >= cutoff;
  });
}

function pickHeaders(request: ApiRequest): Record<string, string> {
  const out: Record<string, string> = {};
  for (const h of request.headers) {
    if (h.enabled && h.key) out[h.key] = h.value;
  }
  return out;
}

function getBodyPreview(request: ApiRequest): string | null {
  if (request.body.type === 'none') return null;
  if (request.body.type === 'binary' || request.body.type === 'form-data') return null;
  return truncate(request.body.content, RUN_BODY_PREVIEW_LIMIT);
}

function truncate(s: string, max: number): string {
  if (s.length <= max) return s;
  return s.slice(0, max);
}
