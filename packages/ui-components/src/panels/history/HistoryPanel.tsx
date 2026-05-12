import { useMemo } from 'react';
import {
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Download,
  ExternalLink,
  Layers,
  RotateCw,
  Send,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { PlanRun, RequestRun } from '@apicircle/shared';
import { requestRunToExecutionResult } from '@apicircle/core';
import { useWorkspaceStore, type HistoryUiState } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { cn } from '../../primitives/cn';
import { ResponseViewer } from '../editor/ResponseViewer';
import { SnapshotsTimeline } from './SnapshotsTimeline';
import { useState } from 'react';

type StatusBucket = 'ok' | '4xx' | '5xx' | 'error';

function isFilterActive(f: HistoryUiState): boolean {
  return (
    f.search.trim().length > 0 ||
    f.statusBuckets.length > 0 ||
    f.methods.length > 0 ||
    f.fromDate !== null ||
    f.toDate !== null
  );
}

function bucketForStatus(run: RequestRun): StatusBucket {
  if (run.status === null) return 'error';
  if (run.status >= 500) return '5xx';
  if (run.status >= 400) return '4xx';
  return 'ok';
}

/**
 * Bucket label for a run based on its `startedAt` relative to "now":
 *   - Today
 *   - Yesterday
 *   - "Mon, Apr 21" — within the last 7 days
 *   - "April 21" — older but within the same calendar year
 *   - "April 2025" — older / different year
 *
 * Stable: same date always produces the same label, so adjacent runs in
 * the same bucket render under one header.
 */
function dateBucketLabel(iso: string, now: Date = new Date()): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return 'Unknown';
  const startOfDay = (x: Date): Date => new Date(x.getFullYear(), x.getMonth(), x.getDate());
  const today = startOfDay(now).getTime();
  const that = startOfDay(d).getTime();
  const dayMs = 24 * 60 * 60 * 1000;
  const diffDays = Math.round((today - that) / dayMs);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  if (diffDays >= 2 && diffDays <= 7) {
    return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
  }
  if (d.getFullYear() === now.getFullYear()) {
    return d.toLocaleDateString(undefined, { month: 'long', day: 'numeric' });
  }
  return d.toLocaleDateString(undefined, { month: 'long', year: 'numeric' });
}

/**
 * Walk a sorted (newest-first) list of runs and group adjacent entries
 * sharing the same `dateBucketLabel`. Returns a flat array suitable for
 * rendering — header rows interleaved with run rows. Pure: deterministic
 * given the same input + `now`.
 */
interface RunGroupHeader {
  kind: 'header';
  label: string;
  key: string;
}
type RunGroupItem<R> = RunGroupHeader | { kind: 'run'; run: R; key: string };

function groupRunsByDate<R extends { id: string; startedAt: string }>(
  runs: readonly R[],
  now: Date = new Date(),
): RunGroupItem<R>[] {
  const out: RunGroupItem<R>[] = [];
  let lastLabel: string | null = null;
  for (const run of runs) {
    const label = dateBucketLabel(run.startedAt, now);
    if (label !== lastLabel) {
      out.push({ kind: 'header', label, key: `header:${label}` });
      lastLabel = label;
    }
    out.push({ kind: 'run', run, key: run.id });
  }
  return out;
}

export function HistoryPanel() {
  const requestRuns = useWorkspaceStore((s) => s.local?.history.requestRuns ?? []);
  const planRuns = useWorkspaceStore((s) => s.local?.history.planRuns ?? []);
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  const plans = useWorkspaceStore((s) => s.synced?.executionPlans ?? {});
  const ui = useWorkspaceStore((s) => s.historyUi);
  const setUi = useWorkspaceStore((s) => s.setHistoryUi);
  const tab = ui.tab;
  const selectedRunId = ui.selectedRunId;

  const visibleRequestRuns = useMemo(
    () => requestRuns.filter((r) => matchesRequestFilter(r, requests, ui)),
    [ui, requests, requestRuns],
  );
  const visiblePlanRuns = useMemo(
    () => planRuns.filter((r) => matchesPlanFilter(r, plans, ui)),
    [ui, plans, planRuns],
  );

  return (
    <div className="flex h-full overflow-hidden bg-surface">
      <div className="flex min-w-0 flex-1 flex-col">
        <header className="flex items-center gap-3 border-b border-border-subtle px-6 py-3">
          <h1 className="text-lg font-medium text-text-primary">History</h1>
          <p className="text-[0.6875rem] text-text-dim">Local-only — never pushed to Git.</p>
          <div className="ml-auto">
            {
              tab === 'requests' ? (
                <ClearRequestsButton
                  hasFilter={isFilterActive(ui)}
                  runs={requestRuns}
                  visibleIds={visibleRequestRuns.map((r) => r.id)}
                />
              ) : tab === 'plans' ? (
                <ClearPlansButton
                  hasFilter={isFilterActive(ui)}
                  runs={planRuns}
                  visibleIds={visiblePlanRuns.map((r) => r.id)}
                />
              ) : null /* snapshots tab: no clear-all button — each row has its own */
            }
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-6 space-y-4">
          {tab === 'requests' ? (
            <RequestRunList
              runs={visibleRequestRuns}
              totalCount={requestRuns.length}
              filterActive={isFilterActive(ui)}
              selectedRunId={selectedRunId}
              onSelect={(id) => setUi({ selectedRunId: id === selectedRunId ? null : id })}
            />
          ) : tab === 'plans' ? (
            <PlanRunList
              runs={visiblePlanRuns}
              totalCount={planRuns.length}
              filterActive={isFilterActive(ui)}
            />
          ) : (
            <SnapshotsTimeline />
          )}
        </div>
      </div>
    </div>
  );
}

function ClearRequestsButton({
  hasFilter,
  runs,
  visibleIds,
}: {
  hasFilter: boolean;
  runs: readonly RequestRun[];
  visibleIds: readonly string[];
}) {
  const clearRequestRuns = useWorkspaceStore((s) => s.clearRequestRuns);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const visibleCount = visibleIds.length;
  const disabled = runs.length === 0;
  const label = hasFilter ? `Clear matching (${visibleCount})` : 'Clear all';
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-[0.6875rem] text-text-muted hover:text-text-primary disabled:opacity-50"
      >
        <Trash2 size={11} aria-hidden="true" />
        {label}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Clear request runs"
        description={
          hasFilter
            ? `Delete ${visibleCount} request run${visibleCount === 1 ? '' : 's'} matching the current filters? This can't be undone.`
            : `Delete all ${runs.length} request run${runs.length === 1 ? '' : 's'}? This can't be undone.`
        }
        confirmLabel="Clear"
        tone="danger"
        onConfirm={() => {
          if (hasFilter) {
            const ids = new Set(visibleIds);
            // clearRequestRuns predicate semantics: "true to keep".
            clearRequestRuns((r) => !ids.has(r.id));
          } else {
            clearRequestRuns();
          }
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function ClearPlansButton({
  hasFilter,
  runs,
  visibleIds,
}: {
  hasFilter: boolean;
  runs: readonly PlanRun[];
  visibleIds: readonly string[];
}) {
  const clearPlanRuns = useWorkspaceStore((s) => s.clearPlanRuns);
  const [confirmOpen, setConfirmOpen] = useState(false);
  const visibleCount = visibleIds.length;
  const disabled = runs.length === 0;
  const label = hasFilter ? `Clear matching (${visibleCount})` : 'Clear all';
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-[0.6875rem] text-text-muted hover:text-text-primary disabled:opacity-50"
      >
        <Trash2 size={11} aria-hidden="true" />
        {label}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Clear plan runs"
        description={
          hasFilter
            ? `Delete ${visibleCount} plan run${visibleCount === 1 ? '' : 's'} matching the current filters? This can't be undone.`
            : `Delete all ${runs.length} plan run${runs.length === 1 ? '' : 's'}? This can't be undone.`
        }
        confirmLabel="Clear"
        tone="danger"
        onConfirm={() => {
          if (hasFilter) {
            const ids = new Set(visibleIds);
            clearPlanRuns((r) => !ids.has(r.id));
          } else {
            clearPlanRuns();
          }
          setConfirmOpen(false);
        }}
        onCancel={() => setConfirmOpen(false)}
      />
    </>
  );
}

function matchesRequestFilter(
  run: RequestRun,
  requests: Record<string, { name?: string; method?: string }>,
  filter: HistoryUiState,
): boolean {
  const q = filter.search.trim().toLowerCase();
  if (q) {
    const r = requests[run.requestId];
    const haystack = `${r?.name ?? ''} ${run.method} ${run.status ?? ''} ${run.url}`.toLowerCase();
    if (!haystack.includes(q)) return false;
  }
  if (filter.statusBuckets.length > 0 && !filter.statusBuckets.includes(bucketForStatus(run)))
    return false;
  if (filter.methods.length > 0 && !filter.methods.includes(run.method)) return false;
  if (!matchesDateRange(run.startedAt, filter)) return false;
  return true;
}

function matchesPlanFilter(
  run: PlanRun,
  plans: Record<string, { name?: string }>,
  filter: HistoryUiState,
): boolean {
  const q = filter.search.trim().toLowerCase();
  if (q) {
    const planName = plans[run.planId]?.name ?? '';
    if (!planName.toLowerCase().includes(q)) return false;
  }
  if (!matchesDateRange(run.startedAt, filter)) return false;
  return true;
}

function matchesDateRange(iso: string, filter: HistoryUiState): boolean {
  if (!filter.fromDate && !filter.toDate) return true;
  const t = new Date(iso).getTime();
  if (filter.fromDate) {
    const fromT = new Date(`${filter.fromDate}T00:00:00`).getTime();
    if (t < fromT) return false;
  }
  if (filter.toDate) {
    const toT = new Date(`${filter.toDate}T23:59:59.999`).getTime();
    if (t > toT) return false;
  }
  return true;
}

function RequestRunList({
  runs,
  totalCount,
  filterActive,
  selectedRunId,
  onSelect,
}: {
  runs: readonly RequestRun[];
  totalCount: number;
  filterActive: boolean;
  selectedRunId: string | null;
  onSelect: (id: string) => void;
}) {
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  const removeRequestRun = useWorkspaceStore((s) => s.removeRequestRun);
  const replayRequestRun = useWorkspaceStore((s) => s.replayRequestRun);
  const setActiveRequestId = useWorkspaceStore((s) => s.setActiveRequestId);
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);

  if (totalCount === 0) {
    return (
      <EmptyHistory
        icon={<Send size={28} aria-hidden="true" />}
        message="No request runs yet."
        hint="Send a request from the Editor panel — it'll show up here, newest first."
      />
    );
  }
  if (runs.length === 0) {
    return (
      <p className="pt-6 text-center text-xs text-text-dim">
        {filterActive ? 'No runs match the current filters.' : 'No runs to show.'}
      </p>
    );
  }
  const grouped = groupRunsByDate(runs);
  return (
    <ul className="space-y-1.5">
      {grouped.map((item) => {
        if (item.kind === 'header') {
          return (
            <li
              key={item.key}
              role="presentation"
              className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-surface px-1 py-1 text-[0.625rem] font-medium uppercase tracking-wider text-text-dim"
            >
              <span>{item.label}</span>
              <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
            </li>
          );
        }
        const run = item.run;
        const r = requests[run.requestId];
        const passedAssertions = run.assertions.filter((a) => a.passed).length;
        const isSelected = run.id === selectedRunId;
        return (
          <li
            key={run.id}
            className={cn(
              'overflow-hidden rounded-sm border bg-card transition-colors',
              isSelected ? 'border-accent/60' : 'border-border hover:bg-surface',
            )}
          >
            {/*
              Row layout: a flex container with a clickable disclosure
              region (chevron + status + method + name + meta chips) and
              sibling action buttons. The disclosure region is a button;
              the action buttons are real buttons too — siblings, not
              children. Nesting role="button" spans inside the outer
              disclosure trips React's event delegation in some
              configurations and the action click leaks to the
              disclosure handler. Sibling layout avoids that entirely.
            */}
            <div className="flex w-full items-center gap-2 px-3 py-2">
              <button
                type="button"
                onClick={() => onSelect(run.id)}
                aria-expanded={isSelected}
                aria-label={`${r?.name ?? 'deleted request'} run details`}
                className="flex flex-1 items-center gap-2 text-left"
              >
                {isSelected ? (
                  <ChevronDown size={11} className="shrink-0 text-text-faint" />
                ) : (
                  <ChevronRight size={11} className="shrink-0 text-text-faint" />
                )}
                <StatusIcon ok={run.ok} />
                <span className="text-[0.625rem] uppercase text-text-dim">{run.method}</span>
                <span className="flex-1 truncate text-xs text-text-primary">
                  {r?.name ?? <em className="text-text-dim">deleted request</em>}
                </span>
                {run.status !== null && (
                  <span className="font-mono text-[0.6875rem] text-text-muted">{run.status}</span>
                )}
                <span className="font-mono text-[0.625rem] text-text-dim">{run.durationMs} ms</span>
                {run.assertions.length > 0 && (
                  <span
                    className={cn(
                      'rounded-sm border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider',
                      passedAssertions === run.assertions.length
                        ? 'border-success/40 bg-success/10 text-success'
                        : 'border-warning/40 bg-warning/10 text-warning',
                    )}
                  >
                    {passedAssertions}/{run.assertions.length}
                  </span>
                )}
                <span className="text-[0.625rem] text-text-dim">
                  {new Date(run.startedAt).toLocaleTimeString()}
                </span>
              </button>
              <button
                type="button"
                onClick={() => void replayRequestRun(run.id)}
                disabled={!r}
                aria-label={`Replay request run from ${new Date(run.startedAt).toLocaleString()}`}
                title={
                  r
                    ? 'Replay this request — re-fires the source request as it exists today'
                    : 'Source request deleted — cannot replay'
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-dim"
              >
                <RotateCw size={11} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => {
                  if (!r) return;
                  setActiveRequestId(run.requestId);
                  setActivePanel('editor');
                }}
                disabled={!r}
                aria-label="Open source request in Editor"
                title={
                  r
                    ? `Open ${r.name ?? 'source request'} in the Editor`
                    : 'Source request deleted — cannot open in Editor'
                }
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:bg-accent/10 hover:text-accent disabled:cursor-not-allowed disabled:opacity-30 disabled:hover:bg-transparent disabled:hover:text-text-dim"
              >
                <ExternalLink size={11} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => removeRequestRun(run.id)}
                aria-label={`Delete request run from ${new Date(run.startedAt).toLocaleString()}`}
                title="Delete this run"
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:bg-danger/10 hover:text-danger"
              >
                <Trash2 size={11} aria-hidden="true" />
              </button>
            </div>
            {isSelected && <RequestRunDetail run={run} />}
          </li>
        );
      })}
    </ul>
  );
}

function RequestRunDetail({ run }: { run: RequestRun }) {
  return (
    <div className="border-t border-border-subtle bg-surface p-3 text-xs">
      <DetailGrid>
        <DetailRow label="When">{new Date(run.startedAt).toLocaleString()}</DetailRow>
        <DetailRow label="URL">
          <code className="break-all font-mono">{run.url || '—'}</code>
        </DetailRow>
        {run.error && (
          <DetailRow label="Error">
            <code className="font-mono text-danger">{run.error}</code>
          </DetailRow>
        )}
      </DetailGrid>

      <div className="mt-3 space-y-3">
        <DetailColumn title="Request">
          <DetailGrid>
            <DetailRow label="Method">
              <code className="font-mono">{run.method}</code>
            </DetailRow>
            <DetailRow label="Headers">
              <HeaderTable headers={run.requestHeaders} />
            </DetailRow>
          </DetailGrid>
          <DetailColumnBody label="Body" empty={run.requestBodyPreview === null}>
            {run.requestBodyPreview && <BodyPreview text={run.requestBodyPreview} />}
          </DetailColumnBody>
        </DetailColumn>
        <DetailColumn title={`Response${run.responseTruncated ? ' (body truncated)' : ''}`}>
          <div className="flex justify-end">
            {run.responseBodyPreview && <DownloadResponseButton run={run} />}
          </div>
          <div className="h-96">
            <ResponseViewer
              result={requestRunToExecutionResult(run)}
              assertions={run.assertions}
              isExecuting={false}
            />
          </div>
        </DetailColumn>
      </div>
    </div>
  );
}

function DetailGrid({ children }: { children: React.ReactNode }) {
  return <dl className="grid grid-cols-[100px_1fr] gap-x-3 gap-y-1">{children}</dl>;
}

function DetailRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <>
      <dt className="text-[0.625rem] uppercase tracking-wider text-text-dim">{label}</dt>
      <dd className="min-w-0 text-text-muted">{children}</dd>
    </>
  );
}

function DetailColumn({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="flex flex-col gap-2 rounded-sm border border-border-subtle bg-card p-3">
      <h3 className="text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
        {title}
      </h3>
      {children}
    </section>
  );
}

function DetailColumnBody({
  label,
  empty,
  children,
  actions,
}: {
  label: string;
  empty: boolean;
  children?: React.ReactNode;
  actions?: React.ReactNode;
}) {
  return (
    <div>
      <div className="mb-1 flex items-center justify-between">
        <p className="text-[0.625rem] uppercase tracking-wider text-text-dim">{label}</p>
        {actions}
      </div>
      {empty ? (
        <p className="rounded-sm border border-dashed border-border-subtle p-2 text-[0.6875rem] text-text-dim">
          (empty)
        </p>
      ) : (
        children
      )}
    </div>
  );
}

function DownloadResponseButton({ run }: { run: RequestRun }) {
  const onClick = () => {
    // Pick a best-effort filename + extension from the bodyKind + the
    // Content-Type header. A fallback to `.txt` keeps the file readable.
    const extension = pickExtension(run.responseBodyKind, run.responseHeaders);
    const safeStamp = run.startedAt.replace(/[:.]/g, '-');
    const filename = `apicircle-${run.method.toLowerCase()}-${safeStamp}.${extension}`;
    const blob = new Blob([run.responseBodyPreview], {
      type: run.responseHeaders['content-type'] ?? 'text/plain',
    });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    a.remove();
    URL.revokeObjectURL(url);
  };
  return (
    <button
      type="button"
      onClick={onClick}
      title={
        run.responseTruncated
          ? 'Body was truncated for storage — download what we kept'
          : 'Download the response body to a file'
      }
      aria-label="Download response body"
      className="inline-flex h-5 items-center gap-1 rounded-sm border border-border bg-surface px-1.5 text-[0.625rem] text-text-muted hover:border-accent hover:text-text-primary"
    >
      <Download size={10} />
      Download
    </button>
  );
}

function pickExtension(
  kind: RequestRun['responseBodyKind'],
  headers: Record<string, string>,
): string {
  if (kind === 'json') return 'json';
  if (kind === 'binary') return 'bin';
  const ct = headers['content-type'] ?? '';
  if (ct.includes('xml')) return 'xml';
  if (ct.includes('html')) return 'html';
  if (ct.includes('csv')) return 'csv';
  if (ct.includes('javascript')) return 'js';
  if (ct.includes('yaml')) return 'yaml';
  return 'txt';
}

function HeaderTable({ headers }: { headers: Record<string, string> }) {
  const entries = Object.entries(headers);
  if (entries.length === 0) return <span className="text-text-dim">(none)</span>;
  return (
    <ul className="flex flex-col gap-0.5">
      {entries.map(([k, v]) => (
        <li key={k} className="grid grid-cols-[140px_1fr] gap-1 font-mono text-[0.625rem]">
          <span className="truncate text-text-muted">{k}</span>
          <span className="break-all text-text-primary" title={v}>
            {v}
          </span>
        </li>
      ))}
    </ul>
  );
}

function BodyPreview({ text }: { text: string }) {
  return (
    <pre className="max-h-64 overflow-auto rounded-sm border border-border bg-surface p-2 font-mono text-[0.625rem] text-text-primary">
      {text}
    </pre>
  );
}

function PlanRunList({
  runs,
  totalCount,
  filterActive,
}: {
  runs: readonly PlanRun[];
  totalCount: number;
  filterActive: boolean;
}) {
  const plans = useWorkspaceStore((s) => s.synced?.executionPlans ?? {});
  const requestRuns = useWorkspaceStore((s) => s.local?.history.requestRuns ?? []);
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  const removePlanRun = useWorkspaceStore((s) => s.removePlanRun);
  const [openId, setOpenId] = useState<string | null>(null);

  if (totalCount === 0) {
    return (
      <EmptyHistory
        icon={<Layers size={28} aria-hidden="true" />}
        message="No plan runs yet."
        hint="Run a plan from the Execution panel — its summary will land here."
      />
    );
  }
  if (runs.length === 0) {
    return (
      <p className="pt-6 text-center text-xs text-text-dim">
        {filterActive ? 'No plan runs match the current filters.' : 'No plan runs to show.'}
      </p>
    );
  }
  // Index request runs by id once for the per-step lookups.
  const runsById = new Map(requestRuns.map((r) => [r.id, r]));

  const grouped = groupRunsByDate(runs);
  return (
    <ul className="space-y-1.5">
      {grouped.map((item) => {
        if (item.kind === 'header') {
          return (
            <li
              key={item.key}
              role="presentation"
              className="sticky top-0 z-10 -mx-1 flex items-center gap-2 bg-surface px-1 py-1 text-[0.625rem] font-medium uppercase tracking-wider text-text-dim"
            >
              <span>{item.label}</span>
              <span className="h-px flex-1 bg-border-subtle" aria-hidden="true" />
            </li>
          );
        }
        const run = item.run;
        const isOpen = run.id === openId;
        return (
          <PlanRunRow
            key={run.id}
            run={run}
            isOpen={isOpen}
            planName={plans[run.planId]?.name}
            onToggle={() => setOpenId(isOpen ? null : run.id)}
            onDelete={() => removePlanRun(run.id)}
            requests={requests}
            runsById={runsById}
          />
        );
      })}
    </ul>
  );
}

function PlanRunRow({
  run,
  isOpen,
  planName,
  onToggle,
  onDelete,
  requests,
  runsById,
}: {
  run: PlanRun;
  isOpen: boolean;
  planName?: string;
  onToggle: () => void;
  onDelete: () => void;
  requests: Record<string, { name?: string; method?: string }>;
  runsById: Map<string, RequestRun>;
}) {
  const okCount = run.steps.filter((s) => s.passed).length;
  const total = run.steps.length;
  const allPassed = okCount === total;
  // Aggregate assertion verdicts across all child request runs. Steps whose
  // RequestRun has rolled out of the buffer contribute 0/0 to the totals —
  // not strictly accurate, but the alternative (hiding the chip) hides
  // signal from runs that the user can still partially inspect.
  let assertionsPassed = 0;
  let assertionsTotal = 0;
  for (const step of run.steps) {
    const child = runsById.get(step.requestRunId);
    if (!child) continue;
    for (const a of child.assertions) {
      assertionsTotal++;
      if (a.passed) assertionsPassed++;
    }
  }
  const assertionsAllPassed = assertionsPassed === assertionsTotal;
  return (
    <li className="overflow-hidden rounded-sm border border-border bg-card">
      <button
        type="button"
        onClick={onToggle}
        aria-expanded={isOpen}
        className="flex w-full items-center gap-2 px-3 py-2 text-left hover:bg-surface"
      >
        {isOpen ? (
          <ChevronDown size={11} className="shrink-0 text-text-faint" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-text-faint" />
        )}
        <StatusIcon ok={allPassed} />
        <Layers size={12} className="text-accent" aria-hidden="true" />
        <span className="flex-1 truncate text-xs text-text-primary">
          {planName ?? <em className="text-text-dim">deleted plan</em>}
        </span>
        <span
          aria-label={`${okCount} of ${total} requests succeeded`}
          title={`${okCount}/${total} requests succeeded`}
          className={cn(
            'rounded-sm border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider',
            allPassed
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-warning/40 bg-warning/10 text-warning',
          )}
        >
          {okCount}/{total} req
        </span>
        {run.withAssertions && (
          <span
            aria-label={`${assertionsPassed} of ${assertionsTotal} assertions passed`}
            title={`${assertionsPassed}/${assertionsTotal} assertions passed`}
            className={cn(
              'rounded-sm border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider',
              assertionsAllPassed
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-warning/40 bg-warning/10 text-warning',
            )}
          >
            {assertionsPassed}/{assertionsTotal} ✓
          </span>
        )}
        <span className="font-mono text-[0.625rem] text-text-dim">{run.durationMs} ms</span>
        <span className="text-[0.625rem] text-text-dim">
          {new Date(run.startedAt).toLocaleString()}
        </span>
        <span
          role="button"
          tabIndex={0}
          onClick={(e) => {
            e.stopPropagation();
            onDelete();
          }}
          onKeyDown={(e) => {
            if (e.key === 'Enter' || e.key === ' ') {
              e.preventDefault();
              e.stopPropagation();
              onDelete();
            }
          }}
          aria-label={`Delete plan run from ${new Date(run.startedAt).toLocaleString()}`}
          title="Delete this run"
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={11} aria-hidden="true" />
        </span>
      </button>
      {isOpen && (
        <div className="border-t border-border-subtle bg-surface p-3 text-xs">
          <h4 className="mb-1.5 text-[0.625rem] uppercase tracking-wider text-text-dim">
            Per-step results ({total})
          </h4>
          <ul className="flex flex-col gap-1.5">
            {run.steps.map((step, i) => {
              const childRun = runsById.get(step.requestRunId);
              const reqMeta = childRun ? requests[childRun.requestId] : null;
              return (
                <PlanRunStep
                  key={`${step.requestRunId}-${i}`}
                  index={i}
                  passed={step.passed}
                  childRun={childRun}
                  requestName={reqMeta?.name}
                />
              );
            })}
          </ul>
        </div>
      )}
    </li>
  );
}

/**
 * Single step inside an expanded plan run. Mirrors the live Execution panel:
 * a one-line summary that opens into the full ResponseViewer (status badge,
 * size hint, body / headers / assertions tabs) so the history detail view
 * is feature-parity with the live "I just ran this" view. The first request
 * in a plan run frequently fails — being able to inspect the response body
 * and assertion verdicts directly from history is the whole point of
 * keeping the buffer in the first place.
 *
 * When the underlying RequestRun has rolled out of the capped buffer
 * (`childRun === undefined`), we render a non-expandable placeholder
 * instead of a misleading empty disclosure.
 */
function PlanRunStep({
  index,
  passed,
  childRun,
  requestName,
}: {
  index: number;
  passed: boolean;
  childRun: RequestRun | undefined;
  requestName?: string;
}) {
  const [open, setOpen] = useState(false);
  if (!childRun) {
    return (
      <li className="flex items-center gap-2 rounded-sm border border-border-subtle bg-card px-2 py-1 text-[0.6875rem]">
        <span className="w-5 text-center text-text-dim">{index + 1}.</span>
        <StatusIcon ok={passed} />
        <span className="flex-1 italic text-text-dim">
          Step run no longer in history (rolled out of buffer)
        </span>
      </li>
    );
  }
  return (
    <li className="overflow-hidden rounded-sm border border-border-subtle bg-card">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-[0.6875rem] hover:bg-surface"
      >
        {open ? (
          <ChevronDown size={11} className="shrink-0 text-text-faint" />
        ) : (
          <ChevronRight size={11} className="shrink-0 text-text-faint" />
        )}
        <span className="w-5 text-center text-text-dim">{index + 1}.</span>
        <StatusIcon ok={passed} />
        <span className="text-[0.625rem] uppercase text-text-dim">{childRun.method}</span>
        <span className="flex-1 truncate text-text-primary">
          {requestName ?? <em className="text-text-dim">deleted request</em>}
        </span>
        {childRun.status !== null && (
          <span className="font-mono text-text-muted">{childRun.status}</span>
        )}
        <span className="font-mono text-text-dim">{childRun.durationMs} ms</span>
      </button>
      {open && (
        <div className="h-80 border-t border-border-subtle">
          <ResponseViewer
            result={requestRunToExecutionResult(childRun)}
            assertions={childRun.assertions}
            isExecuting={false}
          />
        </div>
      )}
    </li>
  );
}

function StatusIcon({ ok }: { ok: boolean }) {
  return ok ? (
    <CheckCircle2 size={12} className="text-success" aria-hidden="true" />
  ) : (
    <XCircle size={12} className="text-danger" aria-hidden="true" />
  );
}

function EmptyHistory({
  icon,
  message,
  hint,
}: {
  icon: React.ReactNode;
  message: string;
  hint: string;
}) {
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-12 text-center text-text-dim">
      {icon}
      <p className="text-sm text-text-primary">{message}</p>
      <p className="text-xs text-text-muted">{hint}</p>
    </div>
  );
}
