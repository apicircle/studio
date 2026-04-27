import { useState } from 'react';
import { CheckCircle2, Layers, Send, XCircle } from 'lucide-react';
import type { PlanRun, RequestRun } from '@apicircle-v2/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';

type Tab = 'requests' | 'plans';

export function HistoryPanel() {
  const requestRuns = useWorkspaceStore((s) => s.local?.history.requestRuns ?? []);
  const planRuns = useWorkspaceStore((s) => s.local?.history.planRuns ?? []);
  const [tab, setTab] = useState<Tab>('requests');

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <header className="flex items-baseline gap-3 border-b border-border-subtle px-6 py-3">
        <h1 className="text-lg font-medium text-text-primary">History</h1>
        <p className="text-[11px] text-text-dim">Local-only — never pushed to Git.</p>
      </header>
      <div className="flex border-b border-border-subtle px-6">
        <TabButton active={tab === 'requests'} onClick={() => setTab('requests')}>
          <Send size={11} aria-hidden="true" />
          Requests <span className="ml-1 text-text-dim">({requestRuns.length})</span>
        </TabButton>
        <TabButton active={tab === 'plans'} onClick={() => setTab('plans')}>
          <Layers size={11} aria-hidden="true" />
          Plans <span className="ml-1 text-text-dim">({planRuns.length})</span>
        </TabButton>
      </div>
      <div className="flex-1 overflow-y-auto p-6">
        {tab === 'requests' ? (
          <RequestRunList runs={requestRuns} />
        ) : (
          <PlanRunList runs={planRuns} />
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

function RequestRunList({ runs }: { runs: readonly RequestRun[] }) {
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  if (runs.length === 0) {
    return (
      <EmptyHistory
        icon={<Send size={28} aria-hidden="true" />}
        message="No request runs yet."
        hint="Send a request from the Editor panel — it'll show up here, newest first."
      />
    );
  }
  return (
    <ul className="space-y-1.5">
      {runs.map((run) => {
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
          </li>
        );
      })}
    </ul>
  );
}

function PlanRunList({ runs }: { runs: readonly PlanRun[] }) {
  const plans = useWorkspaceStore((s) => s.local?.executionPlans ?? {});
  if (runs.length === 0) {
    return (
      <EmptyHistory
        icon={<Layers size={28} aria-hidden="true" />}
        message="No plan runs yet."
        hint="Run a plan from the Execution panel — its summary will land here."
      />
    );
  }
  return (
    <ul className="space-y-1.5">
      {runs.map((run) => (
        <PlanRunRow key={run.id} run={run} planName={plans[run.planId]?.name} />
      ))}
    </ul>
  );
}

function PlanRunRow({ run, planName }: { run: PlanRun; planName?: string }) {
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
