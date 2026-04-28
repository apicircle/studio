import { useMemo, useState } from 'react';
import { CheckCircle2, Layers, Send, Trash2, XCircle } from 'lucide-react';
import type { PlanRun, RequestRun } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';

type Tab = 'requests' | 'plans';

export function HistoryPanel() {
  const requestRuns = useWorkspaceStore((s) => s.local?.history.requestRuns ?? []);
  const planRuns = useWorkspaceStore((s) => s.local?.history.planRuns ?? []);
  const [tab, setTab] = useState<Tab>('requests');
  const [filter, setFilter] = useState('');

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <header className="flex items-center gap-3 border-b border-border-subtle px-6 py-3">
        <h1 className="text-lg font-medium text-text-primary">History</h1>
        <p className="text-[11px] text-text-dim">Local-only — never pushed to Git.</p>
        <div className="ml-auto flex items-center gap-2">
          <input
            type="search"
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter…"
            aria-label="Filter history"
            className="h-7 w-44 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        </div>
      </header>
      <div className="flex items-center border-b border-border-subtle px-6">
        <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
          <Send size={11} aria-hidden="true" />
          Requests <span className="ml-1 text-text-dim">({requestRuns.length})</span>
        </TabButton>
        <TabButton active={tab === 'plans'} onClick={() => setTab('plans')}>
          <Layers size={11} aria-hidden="true" />
          Plans <span className="ml-1 text-text-dim">({planRuns.length})</span>
        </TabButton>
        <div className="ml-auto py-2">
          {tab === 'requests' && (
            <ClearRequestsButton
              hasFilter={filter.trim().length > 0}
              runs={requestRuns}
              filter={filter}
            />
          )}
          {tab === 'plans' && (
            <ClearPlansButton
              hasFilter={filter.trim().length > 0}
              runs={planRuns}
              filter={filter}
            />
          )}
        </div>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'requests' ? (
          <RequestRunList runs={requestRuns} filter={filter} />
        ) : (
          <PlanRunList runs={planRuns} filter={filter} />
        )}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={
        'inline-flex items-center gap-2 border-b-2 px-3 py-2 text-xs transition-colors ' +
        (active
          ? 'border-accent text-accent'
          : 'border-transparent text-text-muted hover:text-text-primary')
      }
    >
      {children}
    </button>
  );
}

function ClearRequestsButton({
  hasFilter,
  runs,
  filter,
}: {
  hasFilter: boolean;
  runs: readonly RequestRun[];
  filter: string;
}) {
  const clearRequestRuns = useWorkspaceStore((s) => s.clearRequestRuns);
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const filteredCount = useMemo(
    () => runs.filter((r) => matchesRequestFilter(r, requests, filter)).length,
    [filter, requests, runs],
  );
  const disabled = runs.length === 0;
  const label = hasFilter ? `Clear matching (${filteredCount})` : 'Clear all';
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-[11px] text-text-muted hover:text-text-primary disabled:opacity-50"
      >
        <Trash2 size={11} aria-hidden="true" />
        {label}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Clear request runs"
        description={
          hasFilter
            ? `Delete ${filteredCount} request run${filteredCount === 1 ? '' : 's'} matching "${filter}"? This can't be undone.`
            : `Delete all ${runs.length} request run${runs.length === 1 ? '' : 's'}? This can't be undone.`
        }
        confirmLabel="Clear"
        tone="danger"
        onConfirm={() => {
          if (hasFilter) {
            clearRequestRuns((r) => !matchesRequestFilter(r, requests, filter));
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
  filter,
}: {
  hasFilter: boolean;
  runs: readonly PlanRun[];
  filter: string;
}) {
  const clearPlanRuns = useWorkspaceStore((s) => s.clearPlanRuns);
  const plans = useWorkspaceStore((s) => s.local?.executionPlans ?? {});
  const [confirmOpen, setConfirmOpen] = useState(false);
  const filteredCount = useMemo(
    () => runs.filter((r) => matchesPlanFilter(r, plans, filter)).length,
    [filter, plans, runs],
  );
  const disabled = runs.length === 0;
  const label = hasFilter ? `Clear matching (${filteredCount})` : 'Clear all';
  return (
    <>
      <button
        type="button"
        disabled={disabled}
        onClick={() => setConfirmOpen(true)}
        className="inline-flex items-center gap-1.5 rounded-sm border border-border bg-card px-2 py-1 text-[11px] text-text-muted hover:text-text-primary disabled:opacity-50"
      >
        <Trash2 size={11} aria-hidden="true" />
        {label}
      </button>
      <ConfirmDialog
        open={confirmOpen}
        title="Clear plan runs"
        description={
          hasFilter
            ? `Delete ${filteredCount} plan run${filteredCount === 1 ? '' : 's'} matching "${filter}"? This can't be undone.`
            : `Delete all ${runs.length} plan run${runs.length === 1 ? '' : 's'}? This can't be undone.`
        }
        confirmLabel="Clear"
        tone="danger"
        onConfirm={() => {
          if (hasFilter) {
            clearPlanRuns((r) => !matchesPlanFilter(r, plans, filter));
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
  filter: string,
): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  const r = requests[run.requestId];
  const haystack = `${r?.name ?? ''} ${r?.method ?? ''} ${run.status ?? ''}`.toLowerCase();
  return haystack.includes(q);
}

function matchesPlanFilter(
  run: PlanRun,
  plans: Record<string, { name?: string }>,
  filter: string,
): boolean {
  const q = filter.trim().toLowerCase();
  if (!q) return true;
  const planName = plans[run.planId]?.name ?? '';
  return planName.toLowerCase().includes(q);
}

function RequestRunList({ runs, filter }: { runs: readonly RequestRun[]; filter: string }) {
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  const removeRequestRun = useWorkspaceStore((s) => s.removeRequestRun);
  const visible = useMemo(
    () => runs.filter((r) => matchesRequestFilter(r, requests, filter)),
    [filter, requests, runs],
  );

  if (runs.length === 0) {
    return (
      <EmptyHistory
        icon={<Send size={28} aria-hidden="true" />}
        message="No request runs yet."
        hint="Send a request from the Editor panel — it'll show up here, newest first."
      />
    );
  }
  if (visible.length === 0) {
    return (
      <p className="pt-6 text-center text-xs text-text-dim">
        No runs match &ldquo;{filter}&rdquo;.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {visible.map((run) => {
        const r = requests[run.requestId];
        const passedAssertions = run.assertions.filter((a) => a.passed).length;
        return (
          <li
            key={run.id}
            className="flex items-center gap-2 rounded-sm border border-border bg-card px-3 py-2"
          >
            <StatusIcon ok={run.ok} />
            <span className="text-[10px] uppercase text-text-dim">{r?.method ?? '—'}</span>
            <span className="flex-1 truncate text-xs text-text-primary">
              {r?.name ?? <em className="text-text-dim">deleted request</em>}
            </span>
            {run.status !== null && (
              <span className="font-mono text-[11px] text-text-muted">{run.status}</span>
            )}
            <span className="font-mono text-[10px] text-text-dim">{run.durationMs} ms</span>
            {run.assertions.length > 0 && (
              <span
                className={
                  'rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ' +
                  (passedAssertions === run.assertions.length
                    ? 'border-success/40 bg-success/10 text-success'
                    : 'border-warning/40 bg-warning/10 text-warning')
                }
              >
                {passedAssertions}/{run.assertions.length}
              </span>
            )}
            <span className="text-[10px] text-text-dim">
              {new Date(run.startedAt).toLocaleTimeString()}
            </span>
            <button
              type="button"
              onClick={() => removeRequestRun(run.id)}
              aria-label={`Delete request run from ${new Date(run.startedAt).toLocaleString()}`}
              title="Delete this run"
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:bg-danger/10 hover:text-danger"
            >
              <Trash2 size={11} aria-hidden="true" />
            </button>
          </li>
        );
      })}
    </ul>
  );
}

function PlanRunList({ runs, filter }: { runs: readonly PlanRun[]; filter: string }) {
  const plans = useWorkspaceStore((s) => s.local?.executionPlans ?? {});
  const removePlanRun = useWorkspaceStore((s) => s.removePlanRun);
  const visible = useMemo(
    () => runs.filter((r) => matchesPlanFilter(r, plans, filter)),
    [filter, plans, runs],
  );
  if (runs.length === 0) {
    return (
      <EmptyHistory
        icon={<Layers size={28} aria-hidden="true" />}
        message="No plan runs yet."
        hint="Run a plan from the Execution panel — its summary will land here."
      />
    );
  }
  if (visible.length === 0) {
    return (
      <p className="pt-6 text-center text-xs text-text-dim">
        No plan runs match &ldquo;{filter}&rdquo;.
      </p>
    );
  }
  return (
    <ul className="space-y-1.5">
      {visible.map((run) => (
        <PlanRunRow
          key={run.id}
          run={run}
          planName={plans[run.planId]?.name}
          onDelete={() => removePlanRun(run.id)}
        />
      ))}
    </ul>
  );
}

function PlanRunRow({
  run,
  planName,
  onDelete,
}: {
  run: PlanRun;
  planName?: string;
  onDelete: () => void;
}) {
  const okCount = run.steps.filter((s) => s.passed).length;
  const total = run.steps.length;
  const allPassed = okCount === total;
  return (
    <li className="rounded-sm border border-border bg-card px-3 py-2">
      <div className="flex items-center gap-2">
        <StatusIcon ok={allPassed} />
        <Layers size={12} className="text-accent" aria-hidden="true" />
        <span className="flex-1 truncate text-xs text-text-primary">
          {planName ?? <em className="text-text-dim">deleted plan</em>}
        </span>
        <span
          className={
            'rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ' +
            (allPassed
              ? 'border-success/40 bg-success/10 text-success'
              : 'border-warning/40 bg-warning/10 text-warning')
          }
        >
          {okCount}/{total}
        </span>
        {run.withAssertions && (
          <span className="rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
            assertions
          </span>
        )}
        <span className="font-mono text-[10px] text-text-dim">{run.durationMs} ms</span>
        <span className="text-[10px] text-text-dim">
          {new Date(run.startedAt).toLocaleString()}
        </span>
        <button
          type="button"
          onClick={onDelete}
          aria-label={`Delete plan run from ${new Date(run.startedAt).toLocaleString()}`}
          title="Delete this run"
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:bg-danger/10 hover:text-danger"
        >
          <Trash2 size={11} aria-hidden="true" />
        </button>
      </div>
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
