// Shared per-request "latest run from history" lookup.
//
// Why: EditorPanel + AssertionsTab + ResponseViewer + the request-tree
// status pill all want "the most recent RequestRun for THIS request id".
// Naively that's `runs.find((r) => r.requestId === id)` — O(n) per
// component subscriber per store mutation. With Phase 4's `useShallow`
// keeping the runs array reference stable across unrelated mutations
// this is microseconds, but it scales with N×subscribers, and a real
// workspace with 50 active request rows × 200-entry capped history
// already exceeds the budget on every Send.
//
// This hook builds a Map<requestId, RequestRun> ONCE per unique runs
// array reference, cached in a module-scope WeakMap. Subsequent subscribers
// reading the same array hit the cache. The WeakMap's key is the runs
// array itself — when the array reference changes (a new run lands, a
// trim happens, the workspace is switched), the old map drops off via
// GC and we re-build on the next access.

import { useWorkspaceStore } from './workspaceStore';
import type { RequestRun } from '@apicircle/shared';

const cache = new WeakMap<readonly RequestRun[], Map<string, RequestRun>>();
const EMPTY_RUNS: readonly RequestRun[] = [];

function indexFor(runs: readonly RequestRun[]): Map<string, RequestRun> {
  const cached = cache.get(runs);
  if (cached) return cached;
  // The history array is maintained newest-first (the execute paths prepend
  // with `[run, ...trimmed]`), so the FIRST occurrence of a requestId is
  // the latest run for that request. `Map.set` would overwrite that with
  // older entries — use `if (!m.has(...))` to lock in the newest.
  const m = new Map<string, RequestRun>();
  for (const run of runs) {
    if (!m.has(run.requestId)) m.set(run.requestId, run);
  }
  cache.set(runs, m);
  return m;
}

/**
 * Return the most recent `RequestRun` for the given request id, or `null`
 * when none exists. `null` is also returned when `requestId` is null
 * (caller convenience — the editor often has no active request).
 *
 * The lookup is O(1) per call after the index has been built for the
 * current runs array. Building the index is O(n) but amortises across
 * every subscriber that reads the same array reference within a render
 * cycle.
 */
export function useLatestRunForRequest(requestId: string | null): RequestRun | null {
  // Subscribe to the history array reference (not its contents) — useShallow
  // semantics are NOT required because the array reference is what changes
  // on prepend/trim, and our index is keyed on that reference.
  const runs = useWorkspaceStore((s) => s.local?.history.requestRuns ?? EMPTY_RUNS);
  if (!requestId) return null;
  return indexFor(runs).get(requestId) ?? null;
}
