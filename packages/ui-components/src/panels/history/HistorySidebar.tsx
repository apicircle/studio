// Sidebar for the History panel. Hosts: tab toggle (Requests/Plans),
// search, status + method filter chips, date range, "clear older than N
// days" buttons, and a live storage-size readout for the local history.
//
// Filter state lives on the workspace store (`historyUi` slice) so the
// main HistoryPanel area can read+drive it without prop-drilling. None of
// it is persisted — fresh tab opens to defaults.

import { useMemo, useState } from 'react';
import { formatBytes } from '@apicircle/shared';
import { CalendarRange, Camera, Filter, HardDrive, Layers, Send, Trash2 } from 'lucide-react';
import type { PlanRun, RequestRun } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { cn } from '../../primitives/cn';

type StatusBucket = 'ok' | '4xx' | '5xx' | 'error';
const STATUS_BUCKETS: Array<{ id: StatusBucket; label: string }> = [
  { id: 'ok', label: '2xx / 3xx' },
  { id: '4xx', label: '4xx' },
  { id: '5xx', label: '5xx' },
  { id: 'error', label: 'Network error' },
];

const METHOD_OPTIONS = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'] as const;

const PRESET_DAYS: Array<{ days: number; label: string }> = [
  { days: 7, label: '> 7 days' },
  { days: 30, label: '> 30 days' },
  { days: 90, label: '> 90 days' },
];

export function HistorySidebar() {
  const ui = useWorkspaceStore((s) => s.historyUi);
  const setUi = useWorkspaceStore((s) => s.setHistoryUi);
  const requestRuns = useWorkspaceStore((s) => s.local?.history.requestRuns ?? []);
  const planRuns = useWorkspaceStore((s) => s.local?.history.planRuns ?? []);
  const snapshotCount = useWorkspaceStore((s) => s.local?.snapshots.entries.length ?? 0);
  const clearRequestRuns = useWorkspaceStore((s) => s.clearRequestRuns);
  const clearPlanRuns = useWorkspaceStore((s) => s.clearPlanRuns);

  const [confirm, setConfirm] = useState<{
    kind: 'request' | 'plan';
    predicate?: (r: RequestRun | PlanRun) => boolean;
    label: string;
    count: number;
  } | null>(null);

  const storageBytes = useMemo(
    () => estimateHistoryBytes(requestRuns, planRuns),
    [requestRuns, planRuns],
  );

  const toggleStatus = (b: StatusBucket) => {
    const has = ui.statusBuckets.includes(b);
    setUi({
      statusBuckets: has ? ui.statusBuckets.filter((x) => x !== b) : [...ui.statusBuckets, b],
    });
  };
  const toggleMethod = (m: string) => {
    const has = ui.methods.includes(m);
    setUi({
      methods: has ? ui.methods.filter((x) => x !== m) : [...ui.methods, m],
    });
  };

  // Transient "nothing matched" hint shown next to the preset buttons.
  // The clear flow used to silently early-return on zero matches, which
  // looked indistinguishable from a broken button — showing the empty
  // state explicitly tells the user the action ran and there was nothing
  // to clear.
  const [emptyClearHint, setEmptyClearHint] = useState<string | null>(null);
  const clearOlderThan = (days: number) => {
    const cutoff = Date.now() - days * 24 * 60 * 60 * 1000;
    const matchingRequests = requestRuns.filter(
      (r) => new Date(r.startedAt).getTime() < cutoff,
    ).length;
    const matchingPlans = planRuns.filter((r) => new Date(r.startedAt).getTime() < cutoff).length;
    const total = matchingRequests + matchingPlans;
    if (total === 0) {
      setEmptyClearHint(`No runs older than ${days} day${days === 1 ? '' : 's'}.`);
      return;
    }
    setEmptyClearHint(null);
    setConfirm({
      kind: 'request',
      label: `older than ${days} day${days === 1 ? '' : 's'}`,
      count: total,
      predicate: undefined,
    });
    // The confirm dialog calls back; we encode the action via the cutoff.
    setPendingCutoff(cutoff);
  };

  const [pendingCutoff, setPendingCutoff] = useState<number | null>(null);
  const onConfirmCutoff = () => {
    if (pendingCutoff === null) return;
    clearRequestRuns((r) => new Date(r.startedAt).getTime() >= pendingCutoff);
    clearPlanRuns((r) => new Date(r.startedAt).getTime() >= pendingCutoff);
    setPendingCutoff(null);
    setConfirm(null);
  };

  const onClearDateRange = () => {
    if (!ui.fromDate && !ui.toDate) return;
    const fromT = ui.fromDate ? new Date(`${ui.fromDate}T00:00:00`).getTime() : -Infinity;
    const toT = ui.toDate ? new Date(`${ui.toDate}T23:59:59.999`).getTime() : Infinity;
    const matchingRequests = requestRuns.filter((r) => {
      const t = new Date(r.startedAt).getTime();
      return t >= fromT && t <= toT;
    }).length;
    const matchingPlans = planRuns.filter((r) => {
      const t = new Date(r.startedAt).getTime();
      return t >= fromT && t <= toT;
    }).length;
    const total = matchingRequests + matchingPlans;
    if (total === 0) return;
    const range =
      ui.fromDate && ui.toDate
        ? `${ui.fromDate} → ${ui.toDate}`
        : ui.fromDate
          ? `from ${ui.fromDate}`
          : `up to ${ui.toDate}`;
    setConfirm({
      kind: 'request',
      label: `in range (${range})`,
      count: total,
      predicate: undefined,
    });
    setPendingRangeBounds([fromT, toT]);
  };

  const [pendingRangeBounds, setPendingRangeBounds] = useState<[number, number] | null>(null);
  const onConfirmRange = () => {
    if (!pendingRangeBounds) return;
    const [fromT, toT] = pendingRangeBounds;
    clearRequestRuns((r) => {
      const t = new Date(r.startedAt).getTime();
      return t < fromT || t > toT;
    });
    clearPlanRuns((r) => {
      const t = new Date(r.startedAt).getTime();
      return t < fromT || t > toT;
    });
    setPendingRangeBounds(null);
    setConfirm(null);
  };

  return (
    <div className="flex h-full flex-col gap-3 px-1 py-1 text-text-primary">
      {/* Two rows: run-level tabs (Requests / Plans) on the first row,
          Snapshots on its own row below. Snapshots are a different
          mental model — workspace-state captures rather than execution
          runs — so visually separating them keeps the choice clear. */}
      <div role="tablist" aria-label="History tabs" className="flex flex-col gap-1">
        <div className="flex gap-1">
          <SidebarTab
            active={ui.tab === 'requests'}
            onClick={() => setUi({ tab: 'requests', selectedRunId: null })}
            icon={<Send size={11} aria-hidden />}
            label="Requests"
            count={requestRuns.length}
          />
          <SidebarTab
            active={ui.tab === 'plans'}
            onClick={() => setUi({ tab: 'plans', selectedRunId: null })}
            icon={<Layers size={11} aria-hidden />}
            label="Plans"
            count={planRuns.length}
          />
        </div>
        <div className="flex gap-1">
          <SidebarTab
            active={ui.tab === 'snapshots'}
            onClick={() => setUi({ tab: 'snapshots', selectedRunId: null })}
            icon={<Camera size={11} aria-hidden />}
            label="Snapshots"
            count={snapshotCount}
          />
        </div>
      </div>

      <FilterSection title="Search">
        <input
          type="search"
          value={ui.search}
          onChange={(e) => setUi({ search: e.target.value })}
          placeholder="Name, method, status, URL…"
          aria-label="Filter by search"
          className="h-7 w-full rounded-sm border border-border bg-surface px-2 text-xs text-text-primary placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
      </FilterSection>

      {ui.tab === 'requests' && (
        <>
          <FilterSection title="Status" icon={<Filter size={11} aria-hidden />}>
            <div className="flex flex-wrap gap-1">
              {STATUS_BUCKETS.map((b) => {
                const checked = ui.statusBuckets.includes(b.id);
                return (
                  <button
                    key={b.id}
                    type="button"
                    onClick={() => toggleStatus(b.id)}
                    aria-pressed={checked}
                    className={cn(
                      'inline-flex h-6 items-center rounded-sm border px-2 text-[11px] transition-colors',
                      checked
                        ? 'border-accent/60 bg-accent/15 text-accent'
                        : 'border-border bg-surface text-text-muted hover:border-accent/40 hover:text-text-primary',
                    )}
                  >
                    {b.label}
                  </button>
                );
              })}
            </div>
          </FilterSection>

          <FilterSection title="Method">
            <div className="flex flex-wrap gap-1">
              {METHOD_OPTIONS.map((m) => {
                const checked = ui.methods.includes(m);
                return (
                  <button
                    key={m}
                    type="button"
                    onClick={() => toggleMethod(m)}
                    aria-pressed={checked}
                    className={cn(
                      'inline-flex h-6 items-center rounded-sm border px-1.5 text-[10px] font-medium transition-colors',
                      checked
                        ? 'border-accent/60 bg-accent/15 text-accent'
                        : 'border-border bg-surface text-text-muted hover:border-accent/40 hover:text-text-primary',
                    )}
                  >
                    {m}
                  </button>
                );
              })}
            </div>
          </FilterSection>
        </>
      )}

      <FilterSection title="Date range" icon={<CalendarRange size={11} aria-hidden />}>
        <div className="flex flex-col gap-1">
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="w-8 text-right">From</span>
            <input
              type="date"
              value={ui.fromDate ?? ''}
              onChange={(e) => setUi({ fromDate: e.target.value || null })}
              aria-label="Filter from date"
              className="h-7 flex-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </label>
          <label className="flex items-center gap-2 text-[11px] text-text-muted">
            <span className="w-8 text-right">To</span>
            <input
              type="date"
              value={ui.toDate ?? ''}
              onChange={(e) => setUi({ toDate: e.target.value || null })}
              aria-label="Filter to date"
              className="h-7 flex-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </label>
          {(ui.fromDate || ui.toDate) && (
            <button
              type="button"
              onClick={onClearDateRange}
              className="inline-flex h-6 items-center justify-center gap-1 rounded-sm border border-danger/30 bg-danger/5 px-2 text-[10px] text-danger hover:bg-danger/10"
            >
              <Trash2 size={10} />
              Clear runs in this range
            </button>
          )}
        </div>
      </FilterSection>

      <FilterSection title="Quick clear">
        <div className="flex flex-col gap-1">
          {PRESET_DAYS.map((p) => (
            <button
              key={p.days}
              type="button"
              onClick={() => clearOlderThan(p.days)}
              className="inline-flex h-6 items-center justify-between gap-1 rounded-sm border border-border bg-surface px-2 text-[10px] text-text-muted hover:border-danger/40 hover:text-danger"
            >
              <span>{p.label}</span>
              <Trash2 size={10} />
            </button>
          ))}
          {emptyClearHint && (
            <p
              className="rounded-sm bg-card/60 px-2 py-1 text-[10px] text-text-dim"
              role="status"
              aria-live="polite"
            >
              {emptyClearHint}
            </p>
          )}
        </div>
      </FilterSection>

      <FilterSection title="Storage" icon={<HardDrive size={11} aria-hidden />}>
        <div className="rounded-sm border border-border-subtle bg-surface px-2 py-1.5 text-[11px] text-text-muted">
          <p>
            <span className="font-medium text-text-primary">{formatBytes(storageBytes)}</span> in
            local history
          </p>
          <p className="mt-0.5 text-[10px] text-text-dim">
            {requestRuns.length} request run{requestRuns.length === 1 ? '' : 's'} ·{' '}
            {planRuns.length} plan run{planRuns.length === 1 ? '' : 's'}
          </p>
        </div>
      </FilterSection>

      {confirm && (
        <ConfirmDialog
          open
          title="Clear matching runs"
          description={`Delete ${confirm.count} run${confirm.count === 1 ? '' : 's'} ${confirm.label}? This can't be undone.`}
          confirmLabel="Clear"
          tone="danger"
          onConfirm={() => {
            if (pendingCutoff !== null) onConfirmCutoff();
            else if (pendingRangeBounds) onConfirmRange();
            else setConfirm(null);
          }}
          onCancel={() => {
            setPendingCutoff(null);
            setPendingRangeBounds(null);
            setConfirm(null);
          }}
        />
      )}
    </div>
  );
}

function SidebarTab({
  active,
  onClick,
  icon,
  label,
  count,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
  count: number;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border px-2 text-[11px] transition-colors',
        active
          ? 'border-accent/60 bg-accent/15 text-text-primary'
          : 'border-border bg-surface text-text-muted hover:border-accent/40 hover:text-text-primary',
      )}
    >
      {icon}
      {label}
      <span className="text-text-dim">({count})</span>
    </button>
  );
}

function FilterSection({
  title,
  icon,
  children,
}: {
  title: string;
  icon?: React.ReactNode;
  children: React.ReactNode;
}) {
  return (
    <section className="flex flex-col gap-1.5">
      <header className="flex items-center gap-1 text-[10px] font-medium uppercase tracking-wider text-text-dim">
        {icon}
        {title}
      </header>
      {children}
    </section>
  );
}

/**
 * Best-effort estimate of the bytes consumed by the in-memory history.
 * Uses JSON.stringify length × 2 (UTF-16 → UTF-8 isn't 1:1, but most
 * persisted text is ASCII so this is a tight enough upper-bound for the
 * sidebar readout). For the truly persisted size, navigator.storage.estimate()
 * would be better — we'd want that if storage pressure became a real concern.
 */
function estimateHistoryBytes(
  requestRuns: readonly RequestRun[],
  planRuns: readonly PlanRun[],
): number {
  try {
    return JSON.stringify({ requestRuns, planRuns }).length;
  } catch {
    return 0;
  }
}
