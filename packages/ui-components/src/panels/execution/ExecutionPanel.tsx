import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  Layers,
  Play,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { ExecutionPlan, Request as ApiRequest } from '@apicircle-v2/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';

export function ExecutionPanel() {
  const plans = useWorkspaceStore((s) => s.local?.executionPlans ?? {});
  const activePlanId = useWorkspaceStore((s) => s.activePlanId);
  const planArray = useMemo(
    () => Object.values(plans).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [plans],
  );
  const effectivePlan = (activePlanId ? plans[activePlanId] : null) ?? planArray[0] ?? null;

  return (
    <div className="h-full overflow-y-auto bg-surface p-6">
      {effectivePlan ? <PlanEditor plan={effectivePlan} /> : <EmptyState />}
    </div>
  );
}

function EmptyState() {
  const addPlan = useWorkspaceStore((s) => s.addPlan);
  return (
    <div className="mx-auto flex max-w-md flex-col items-center gap-3 pt-12 text-center">
      <Layers size={32} className="text-text-dim" aria-hidden="true" />
      <h2 className="text-base text-text-primary">No execution plans yet</h2>
      <p className="text-xs text-text-muted">
        Plans run a sequence of requests in order. Plan-level env priority overrides the
        workspace&apos;s global priority during the run; context variables stay highest priority.
      </p>
      <button
        type="button"
        onClick={() => addPlan()}
        className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
      >
        <Plus size={13} />
        Create plan
      </button>
    </div>
  );
}

function PlanEditor({ plan }: { plan: ExecutionPlan }) {
  const requests = useWorkspaceStore((s) => s.synced?.collections.requests ?? {});
  const envItems = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const linkedWorkspaces = useWorkspaceStore((s) => s.synced?.linkedWorkspaces ?? {});
  const linkedCollections = useWorkspaceStore((s) => s.local?.linkedCollections ?? {});
  const renamePlan = useWorkspaceStore((s) => s.renamePlan);
  const removePlan = useWorkspaceStore((s) => s.removePlan);
  const addPlanStep = useWorkspaceStore((s) => s.addPlanStep);
  const removePlanStep = useWorkspaceStore((s) => s.removePlanStep);
  const reorderPlanSteps = useWorkspaceStore((s) => s.reorderPlanSteps);
  const setPlanEnvPriority = useWorkspaceStore((s) => s.setPlanEnvPriority);
  const runPlan = useWorkspaceStore((s) => s.runPlan);

  const [running, setRunning] = useState(false);
  const [lastResult, setLastResult] = useState<{
    passed: boolean;
    total: number;
    okCount: number;
    durationMs: number;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const requestArray = useMemo(() => Object.values(requests), [requests]);
  const envNames = useMemo(() => Object.keys(envItems), [envItems]);
  // Linked workspace request groups for the picker. Skips links whose
  // collections snapshot hasn't been pulled yet (refresh first to
  // populate). Plan §6 §11.1: cross-workspace plan steps.
  const linkedGroups = useMemo(
    () =>
      Object.values(linkedWorkspaces)
        .map((link) => ({
          link,
          requests: Object.values(linkedCollections[link.id]?.collections.requests ?? {}),
        }))
        .filter((g) => g.requests.length > 0),
    [linkedWorkspaces, linkedCollections],
  );

  const onRun = async (withAssertions: boolean) => {
    setRunning(true);
    setRunError(null);
    setLastResult(null);
    try {
      const planRun = await runPlan(plan.id, { withAssertions });
      const okCount = planRun.steps.filter((s) => s.passed).length;
      setLastResult({
        passed: okCount === planRun.steps.length,
        total: planRun.steps.length,
        okCount,
        durationMs: planRun.durationMs,
      });
    } catch (err) {
      setRunError(err instanceof Error ? err.message : 'Run failed');
    } finally {
      setRunning(false);
    }
  };

  return (
    <div className="space-y-6">
      <header className="flex items-center justify-between gap-3">
        <input
          value={plan.name}
          onChange={(e) => renamePlan(plan.id, e.target.value)}
          aria-label="Plan name"
          className="h-9 max-w-md flex-1 rounded-sm border border-transparent bg-card px-3 text-base font-medium text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
        <button
          type="button"
          onClick={() => removePlan(plan.id)}
          aria-label="Delete plan"
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10"
        >
          <Trash2 size={13} />
        </button>
      </header>

      <section>
        <div className="mb-2 flex items-center justify-between">
          <h2 className="text-xs font-medium uppercase tracking-wider text-text-dim">Steps</h2>
          <button
            type="button"
            onClick={() => setPickerOpen((v) => !v)}
            disabled={requestArray.length === 0}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <Plus size={11} />
            Add step
          </button>
        </div>
        {pickerOpen && (
          <div className="mb-2 max-h-60 overflow-y-auto rounded-sm border border-border bg-card">
            <p className="border-b border-border-subtle px-3 py-1 text-[10px] uppercase tracking-wider text-text-dim">
              This workspace
            </p>
            <ul>
              {requestArray.map((r) => (
                <li key={r.id}>
                  <button
                    type="button"
                    onClick={() => {
                      addPlanStep(plan.id, r.id);
                      setPickerOpen(false);
                    }}
                    className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted hover:bg-surface hover:text-text-primary"
                  >
                    <span className="text-[10px] uppercase text-text-dim">{r.method}</span>
                    <span className="truncate">{r.name}</span>
                  </button>
                </li>
              ))}
            </ul>
            {linkedGroups.map((group) => (
              <div key={group.link.id}>
                <p className="border-b border-t border-border-subtle px-3 py-1 text-[10px] uppercase tracking-wider text-text-dim">
                  {group.link.name}
                  <span className="ml-1 text-text-dim normal-case">
                    · {group.link.source.repoFullName}@{group.link.source.branch}
                  </span>
                </p>
                <ul>
                  {group.requests.map((r) => (
                    <li key={`${group.link.id}:${r.id}`}>
                      <button
                        type="button"
                        onClick={() => {
                          addPlanStep(plan.id, r.id, group.link.id);
                          setPickerOpen(false);
                        }}
                        className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs text-text-muted hover:bg-surface hover:text-text-primary"
                      >
                        <span className="text-[10px] uppercase text-text-dim">{r.method}</span>
                        <span className="truncate">{r.name}</span>
                      </button>
                    </li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        )}
        {plan.steps.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border bg-card p-3 text-[11px] text-text-dim">
            No steps yet. Add at least one request before running the plan.
          </p>
        ) : (
          <ul className="space-y-1">
            {plan.steps.map((step, i) => {
              const linkedRequest = step.linkedWorkspaceId
                ? linkedCollections[step.linkedWorkspaceId]?.collections.requests[step.requestId]
                : undefined;
              const linkedName = step.linkedWorkspaceId
                ? linkedWorkspaces[step.linkedWorkspaceId]?.name
                : undefined;
              return (
                <PlanStepRow
                  key={`${step.requestId}-${i}`}
                  request={step.linkedWorkspaceId ? linkedRequest : requests[step.requestId]}
                  linkedName={linkedName}
                  index={i}
                  isFirst={i === 0}
                  isLast={i === plan.steps.length - 1}
                  onRemove={() => removePlanStep(plan.id, i)}
                  onMoveUp={() => reorderPlanSteps(plan.id, i, i - 1)}
                  onMoveDown={() => reorderPlanSteps(plan.id, i, i + 1)}
                />
              );
            })}
          </ul>
        )}
      </section>

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          Plan-level env priority
        </h2>
        <p className="mb-2 text-[11px] text-text-dim">
          Overrides the workspace&apos;s global priority order during runs of this plan. Empty =
          inherit the workspace order.
        </p>
        <PlanEnvPriorityEditor
          plan={plan}
          envNames={envNames}
          onChange={(order) => setPlanEnvPriority(plan.id, order)}
        />
      </section>

      <section>
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">Run</h2>
        <div className="flex flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onRun(false)}
            disabled={running || plan.steps.length === 0}
            className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <Play size={11} />
            {running ? 'Running…' : 'Run'}
          </button>
          <button
            type="button"
            onClick={() => void onRun(true)}
            disabled={running || plan.steps.length === 0}
            className="inline-flex h-8 items-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            <Play size={11} />
            Run with assertions
          </button>
          {lastResult &&
            (lastResult.passed ? (
              <span className="inline-flex items-center gap-1 text-[11px] text-success">
                <CheckCircle2 size={11} aria-hidden="true" />
                {lastResult.okCount}/{lastResult.total} passed · {lastResult.durationMs} ms
              </span>
            ) : (
              <span className="inline-flex items-center gap-1 text-[11px] text-danger">
                <XCircle size={11} aria-hidden="true" />
                {lastResult.okCount}/{lastResult.total} passed · {lastResult.durationMs} ms
              </span>
            ))}
        </div>
        {runError && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {runError}
          </p>
        )}
      </section>
    </div>
  );
}

function PlanStepRow({
  request,
  linkedName,
  index,
  isFirst,
  isLast,
  onRemove,
  onMoveUp,
  onMoveDown,
}: {
  request: ApiRequest | undefined;
  linkedName?: string | undefined;
  index: number;
  isFirst: boolean;
  isLast: boolean;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-sm border border-border bg-card px-2 py-1.5">
      <span className="w-6 text-center text-[10px] text-text-dim">{index + 1}.</span>
      {request ? (
        <>
          <span className="text-[10px] uppercase text-text-dim">{request.method}</span>
          <span className="flex-1 truncate text-xs text-text-primary">{request.name}</span>
          {linkedName && (
            <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
              from {linkedName}
            </span>
          )}
        </>
      ) : (
        <span className="flex-1 truncate text-xs italic text-warning">
          {linkedName
            ? `Request not in cached snapshot of "${linkedName}" — refresh the link`
            : 'Request no longer exists'}
        </span>
      )}
      <button
        type="button"
        onClick={onMoveUp}
        disabled={isFirst}
        aria-label="Move step up"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:text-text-primary disabled:opacity-30"
      >
        <ArrowUp size={11} />
      </button>
      <button
        type="button"
        onClick={onMoveDown}
        disabled={isLast}
        aria-label="Move step down"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:text-text-primary disabled:opacity-30"
      >
        <ArrowDown size={11} />
      </button>
      <button
        type="button"
        onClick={onRemove}
        aria-label="Remove step"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10"
      >
        <Trash2 size={10} />
      </button>
    </li>
  );
}

function PlanEnvPriorityEditor({
  plan,
  envNames,
  onChange,
}: {
  plan: ExecutionPlan;
  envNames: string[];
  onChange: (order: string[]) => void;
}) {
  const inOrder = plan.envPriorityOrder;
  const remaining = envNames.filter((n) => !inOrder.includes(n));

  return (
    <div className="space-y-2 rounded-sm border border-border bg-card p-2">
      {inOrder.length === 0 ? (
        <p className="text-[11px] text-text-dim">
          No plan-level priority — inherits workspace order.
        </p>
      ) : (
        <ol className="space-y-1">
          {inOrder.map((name, i) => (
            <li
              key={name}
              className="flex items-center gap-2 rounded-sm border border-border-subtle bg-surface px-2 py-1"
            >
              <span className="w-5 text-center text-[10px] text-text-dim">{i + 1}.</span>
              <span className="flex-1 text-xs text-text-primary">{name}</span>
              <button
                type="button"
                onClick={() => onChange(swap(inOrder, i, i - 1))}
                disabled={i === 0}
                aria-label={`Move ${name} up`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:text-text-primary disabled:opacity-30"
              >
                <ArrowUp size={10} />
              </button>
              <button
                type="button"
                onClick={() => onChange(swap(inOrder, i, i + 1))}
                disabled={i === inOrder.length - 1}
                aria-label={`Move ${name} down`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:text-text-primary disabled:opacity-30"
              >
                <ArrowDown size={10} />
              </button>
              <button
                type="button"
                onClick={() => onChange(inOrder.filter((n) => n !== name))}
                aria-label={`Remove ${name}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-danger/30 bg-danger/5 text-danger hover:bg-danger/10"
              >
                <Trash2 size={10} />
              </button>
            </li>
          ))}
        </ol>
      )}
      {remaining.length > 0 && (
        <div className="flex flex-wrap gap-1 pt-1">
          {remaining.map((name) => (
            <button
              key={name}
              type="button"
              onClick={() => onChange([...inOrder, name])}
              className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-border-strong hover:text-text-primary"
            >
              <Plus size={9} />
              {name}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}

function swap<T>(arr: readonly T[], a: number, b: number): T[] {
  if (a === b || a < 0 || b < 0 || a >= arr.length || b >= arr.length) return [...arr];
  const next = [...arr];
  const tmp = next[a];
  next[a] = next[b];
  next[b] = tmp;
  return next;
}
