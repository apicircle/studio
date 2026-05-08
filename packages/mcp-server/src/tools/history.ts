import { z } from 'zod';
import type { AnyToolDef } from './types';

// =============================================================================
// History tools — list / get / delete / purge over the local request-run +
// plan-run buffers. History lives in `WorkspaceLocal`, never pushed to git,
// so these are local-only mutations.
// =============================================================================

export const historyListRunsTool: AnyToolDef = {
  name: 'history.list_runs',
  description:
    'List request-run history rows in reverse-chronological order. Filter by `requestId`, `ok` (success/failure), or `since`/`until` ISO timestamps. `limit` caps the result set; default 100.',
  inputSchema: z.object({
    requestId: z.string().optional(),
    ok: z.boolean().optional(),
    since: z.string().optional(),
    until: z.string().optional(),
    limit: z.number().int().positive().max(500).default(100),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const sinceMs = input.since ? Date.parse(input.since) : -Infinity;
    const untilMs = input.until ? Date.parse(input.until) : Infinity;
    const filtered = state.local.history.requestRuns.filter((r) => {
      if (input.requestId && r.requestId !== input.requestId) return false;
      if (input.ok !== undefined && r.ok !== input.ok) return false;
      const t = Date.parse(r.startedAt);
      if (!Number.isFinite(t)) return true;
      return t >= sinceMs && t <= untilMs;
    });
    // Already stored newest-last in the circular buffer; reverse for display.
    const sorted = [...filtered].sort((a, b) => b.startedAt.localeCompare(a.startedAt));
    const limited = sorted.slice(0, input.limit);
    return {
      total: filtered.length,
      returned: limited.length,
      runs: limited.map((r) => ({
        id: r.id,
        requestId: r.requestId,
        method: r.method,
        url: r.url,
        status: r.status,
        ok: r.ok,
        startedAt: r.startedAt,
        durationMs: r.durationMs,
      })),
    };
  },
};

export const historyGetRunTool: AnyToolDef = {
  name: 'history.get_run',
  description: 'Fetch a single history row in full (headers, body preview, assertion results).',
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const run = state.local.history.requestRuns.find((r) => r.id === input.id);
    if (!run) return { found: false as const };
    return { found: true as const, run };
  },
};

export const historyDeleteRunTool: AnyToolDef = {
  name: 'history.delete_run',
  description: 'Delete a single request-run row by id.',
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    const out = await ctx.workspace.apply({ kind: 'history.delete_run', runId: input.id });
    return { deleted: out.changedIds.length, changedIds: out.changedIds };
  },
};

export const historyPurgeTool: AnyToolDef = {
  name: 'history.purge_by_age',
  description:
    'Drop every request-run + plan-run older than `olderThanDays` days. Pass 0 to clear all history.',
  inputSchema: z.object({
    olderThanDays: z.number().nonnegative(),
  }),
  async handler(input, ctx) {
    const olderThanMs = input.olderThanDays * 24 * 60 * 60 * 1000;
    const out = await ctx.workspace.apply({ kind: 'history.purge', olderThanMs });
    return { purgedCount: out.changedIds.length, changedIds: out.changedIds };
  },
};
