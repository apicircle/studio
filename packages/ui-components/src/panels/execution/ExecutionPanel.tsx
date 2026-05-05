import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  Eye,
  Layers,
  Play,
  Plus,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { ExecutionPlan, Request as ApiRequest } from '@apicircle/shared';
import { cn } from '../../primitives/cn';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ResponseViewer } from '../editor/ResponseViewer';
import { RequestQuickView } from './RequestQuickView';

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
  const folders = useWorkspaceStore((s) => s.synced?.collections.folders ?? {});
  const envItems = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const linkedWorkspaces = useWorkspaceStore((s) => s.synced?.linkedWorkspaces ?? {});
  const linkedCollections = useWorkspaceStore((s) => s.local?.linkedCollections ?? {});
  const renamePlan = useWorkspaceStore((s) => s.renamePlan);
  const removePlan = useWorkspaceStore((s) => s.removePlan);
  const duplicatePlan = useWorkspaceStore((s) => s.duplicatePlan);
  const addPlanStep = useWorkspaceStore((s) => s.addPlanStep);
  const removePlanStep = useWorkspaceStore((s) => s.removePlanStep);
  const reorderPlanSteps = useWorkspaceStore((s) => s.reorderPlanSteps);
  const setPlanStepEnabled = useWorkspaceStore((s) => s.setPlanStepEnabled);
  const setPlanEnvPriority = useWorkspaceStore((s) => s.setPlanEnvPriority);
  const setPlanStopOnFailure = useWorkspaceStore((s) => s.setPlanStopOnFailure);
  const setPlanVariables = useWorkspaceStore((s) => s.setPlanVariables);
  const runPlan = useWorkspaceStore((s) => s.runPlan);

  const [running, setRunning] = useState(false);
  /**
   * Verdict from the most recent plan run, broken into two independent
   * tallies so the UI can be unambiguous about WHAT passed:
   *
   *  - `httpOkCount / total`: requests that returned a 2xx response (or
   *    completed without error). Always populated.
   *  - `assertionsPassed / assertionsTotal`: assertion verdicts aggregated
   *    across every step. `null` when the run was launched without the
   *    "Run with assertions" button — there's nothing to report and
   *    showing 0/0 would look like a failure.
   */
  const [lastResult, setLastResult] = useState<{
    total: number;
    httpOkCount: number;
    assertionsPassed: number | null;
    assertionsTotal: number | null;
    withAssertions: boolean;
    durationMs: number;
  } | null>(null);
  const [runError, setRunError] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);
  /**
   * State for the quick-view drawer: holds the resolved request + its source
   * label (when linked). Set by the eye button on a PlanStepRow.
   */
  const [quickView, setQuickView] = useState<{
    request: ApiRequest;
    linkedWorkspaceName?: string;
    localOpenable: boolean;
  } | null>(null);

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
          // Source-side folders so the picker breadcrumb walks the correct
          // tree for cross-workspace requests.
          folders: linkedCollections[link.id]?.collections.folders ?? {},
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
      const details = useWorkspaceStore.getState().lastPlanResults[plan.id] ?? [];
      const httpOkCount = details.filter((s) => s.result.ok).length;
      const assertionsTotal = details.reduce((sum, s) => sum + s.assertionResults.length, 0);
      const assertionsPassed = details.reduce(
        (sum, s) => sum + s.assertionResults.filter((a) => a.passed).length,
        0,
      );
      setLastResult({
        total: planRun.steps.length,
        httpOkCount,
        assertionsPassed: withAssertions ? assertionsPassed : null,
        assertionsTotal: withAssertions ? assertionsTotal : null,
        withAssertions,
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
          onClick={() => duplicatePlan(plan.id)}
          aria-label={`Duplicate ${plan.name}`}
          title={`Duplicate ${plan.name}`}
          className="inline-flex h-8 w-8 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary"
        >
          <Copy size={13} />
        </button>
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
          <PlanStepPicker
            requestArray={requestArray}
            localFolders={folders}
            linkedGroups={linkedGroups}
            onClose={() => setPickerOpen(false)}
            onAdd={(picks) => {
              for (const pick of picks) {
                addPlanStep(plan.id, pick.requestId, pick.linkedWorkspaceId);
              }
              setPickerOpen(false);
            }}
          />
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
              const stepRequest = step.linkedWorkspaceId ? linkedRequest : requests[step.requestId];
              // Walk the folder chain so the user can see which collection
              // node a step came from. For linked steps we walk the source
              // workspace's folders (cached in the linked snapshot) — the
              // consumer's tree doesn't know about them.
              const stepFolders = step.linkedWorkspaceId
                ? (linkedCollections[step.linkedWorkspaceId]?.collections.folders ?? {})
                : folders;
              const breadcrumb = stepRequest
                ? buildFolderBreadcrumb(stepRequest.folderId, stepFolders)
                : [];
              return (
                <PlanStepRow
                  key={`${step.requestId}-${i}`}
                  request={stepRequest}
                  linkedName={linkedName}
                  breadcrumb={breadcrumb}
                  index={i}
                  isFirst={i === 0}
                  isLast={i === plan.steps.length - 1}
                  enabled={step.enabled !== false}
                  onRemove={() => removePlanStep(plan.id, i)}
                  onMoveUp={() => reorderPlanSteps(plan.id, i, i - 1)}
                  onMoveDown={() => reorderPlanSteps(plan.id, i, i + 1)}
                  onToggleEnabled={(next) => setPlanStepEnabled(plan.id, i, next)}
                  onQuickView={
                    stepRequest
                      ? () =>
                          setQuickView({
                            request: stepRequest,
                            linkedWorkspaceName: linkedName,
                            localOpenable: !step.linkedWorkspaceId,
                          })
                      : undefined
                  }
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
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          Plan variables
        </h2>
        <p className="mb-2 text-[11px] text-text-dim">
          Bind <code>{'{{NAME}}'}</code> values for this plan only. Plan variables sit between
          extracted globals and the env priority list — per-request context vars still win.
        </p>
        <PlanVariablesEditor plan={plan} onChange={(vars) => setPlanVariables(plan.id, vars)} />
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
          <label className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted">
            <input
              type="checkbox"
              checked={plan.stopOnAssertionFailure ?? false}
              onChange={(e) => setPlanStopOnFailure(plan.id, e.target.checked)}
              aria-label="Stop on assertion failure"
              className="h-3 w-3 cursor-pointer"
              style={{ accentColor: 'var(--purple)' }}
            />
            Stop on assertion failure
          </label>
          {lastResult && <RunVerdict result={lastResult} />}
        </div>
        {runError && (
          <p className="mt-2 text-xs text-danger" role="alert">
            {runError}
          </p>
        )}
      </section>

      <PlanRunDetails planId={plan.id} />

      {quickView && (
        <RequestQuickView
          request={quickView.request}
          linkedWorkspaceName={quickView.linkedWorkspaceName}
          localOpenable={quickView.localOpenable}
          onClose={() => setQuickView(null)}
        />
      )}
    </div>
  );
}

interface RunVerdictData {
  total: number;
  httpOkCount: number;
  assertionsPassed: number | null;
  assertionsTotal: number | null;
  withAssertions: boolean;
  durationMs: number;
}

/**
 * Two-line verdict for the most recent plan run. The previous "X/X passed"
 * label was ambiguous — without assertions enabled, "passed" only meant
 * "got a 2xx" (no validation). Splitting HTTP-success and assertion
 * tallies makes that distinction visible at a glance:
 *
 *   ✓ 3/3 requests succeeded · 245 ms              ← Run (no assertions)
 *   ✓ 3/3 requests succeeded · 5/5 assertions ✓ · 245 ms   ← Run with assertions
 *   ⚠ 2/3 requests succeeded · 4/5 assertions ✓ · 245 ms   ← partial failure
 */
function RunVerdict({ result }: { result: RunVerdictData }) {
  const httpAllOk = result.httpOkCount === result.total;
  const assertionsAllPassed =
    result.assertionsTotal === null || result.assertionsPassed === result.assertionsTotal;
  const overallPassed = httpAllOk && assertionsAllPassed;
  return (
    <span
      className={
        'inline-flex items-center gap-2 text-[11px] ' +
        (overallPassed ? 'text-success' : 'text-danger')
      }
    >
      {overallPassed ? (
        <CheckCircle2 size={11} aria-hidden="true" />
      ) : (
        <XCircle size={11} aria-hidden="true" />
      )}
      <span>
        {result.httpOkCount}/{result.total} requests succeeded
      </span>
      {result.withAssertions && result.assertionsTotal !== null && (
        <span>
          ·{' '}
          {result.assertionsTotal === 0
            ? 'no assertions defined'
            : `${result.assertionsPassed}/${result.assertionsTotal} assertions passed`}
        </span>
      )}
      <span className="text-text-muted">· {result.durationMs} ms</span>
    </span>
  );
}

function PlanRunDetails({ planId }: { planId: string }) {
  const results = useWorkspaceStore((s) => s.lastPlanResults[planId] ?? []);
  const [openIndex, setOpenIndex] = useState<number | null>(0);
  if (results.length === 0) return null;

  return (
    <section aria-label="Per-step run details">
      <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
        Last run · per-step details
      </h2>
      <ul className="space-y-1">
        {results.map((step, i) => {
          const open = openIndex === i;
          return (
            <li key={i} className="rounded-sm border border-border bg-card">
              <button
                type="button"
                onClick={() => setOpenIndex(open ? null : i)}
                aria-expanded={open}
                className="flex w-full items-center gap-2 px-3 py-2 text-left"
              >
                {open ? (
                  <ChevronDown size={11} className="text-text-dim" aria-hidden="true" />
                ) : (
                  <ChevronRight size={11} className="text-text-dim" aria-hidden="true" />
                )}
                <span className="w-6 text-center text-[10px] text-text-dim">{i + 1}.</span>
                <StepStatusBadge passed={step.passed} status={step.result.status} />
                <span className="text-[10px] uppercase text-text-dim">{step.requestMethod}</span>
                <span className="flex-1 truncate text-xs text-text-primary">
                  {step.requestName}
                </span>
                <span className="font-mono text-[10px] text-text-dim">
                  {step.result.durationMs} ms
                </span>
                {step.assertionResults.length > 0 && (
                  <span
                    className={
                      'rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ' +
                      (step.assertionResults.every((a) => a.passed)
                        ? 'border-success/40 bg-success/10 text-success'
                        : 'border-warning/40 bg-warning/10 text-warning')
                    }
                  >
                    {step.assertionResults.filter((a) => a.passed).length}/
                    {step.assertionResults.length}
                  </span>
                )}
              </button>
              {open && (
                <div className="border-t border-border-subtle">
                  <div className="grid grid-cols-[80px_1fr] gap-y-1 px-3 py-2 text-xs">
                    <span className="text-text-dim">URL</span>
                    <code className="truncate font-mono text-text-primary">{step.result.url}</code>
                  </div>
                  <div className="h-80 border-t border-border-subtle">
                    <ResponseViewer
                      result={step.result}
                      assertions={step.assertionResults}
                      isExecuting={false}
                    />
                  </div>
                </div>
              )}
            </li>
          );
        })}
      </ul>
    </section>
  );
}

function StepStatusBadge({ passed, status }: { passed: boolean; status: number | null }) {
  if (status === null) {
    return (
      <span className="inline-flex items-center rounded-sm border border-danger/40 bg-danger/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-danger">
        ERR
      </span>
    );
  }
  return (
    <span
      className={
        'inline-flex items-center rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ' +
        (passed
          ? 'border-success/40 bg-success/10 text-success'
          : 'border-warning/40 bg-warning/10 text-warning')
      }
    >
      {status}
    </span>
  );
}

/**
 * Compact breadcrumb chip used in the Add Step picker. Truncates the middle
 * when the trail is long: `Auth › … › subfolder`.
 */
function BreadcrumbTrail({ trail }: { trail: readonly string[] }) {
  const display = trail.length > 3 ? [trail[0], '…', trail[trail.length - 1]] : trail;
  return (
    <nav
      aria-label="Folder path"
      className="flex items-center gap-0.5 truncate text-[10px] text-text-dim"
    >
      {display.map((name, i) => (
        <span key={`${name}-${i}`} className="flex items-center gap-0.5">
          {i > 0 && <ChevronRight size={8} className="text-text-faint" />}
          <span className="truncate">{name}</span>
        </span>
      ))}
    </nav>
  );
}

/**
 * Walk a request's folder chain back to root, returning the folder names
 * top-down. Defends against parentId cycles (defensive — the data model
 * doesn't allow them today but it's cheap).
 */
function buildFolderBreadcrumb(
  folderId: string | null,
  folders: Record<string, { id: string; name: string; parentId: string | null }>,
): string[] {
  const out: string[] = [];
  let cursor = folderId;
  const visited = new Set<string>();
  while (cursor) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const folder = folders[cursor];
    if (!folder) break;
    out.unshift(folder.name);
    cursor = folder.parentId;
  }
  return out;
}

interface PickEntry {
  requestId: string;
  /** Undefined for local workspace requests; the link id for cross-workspace. */
  linkedWorkspaceId?: string;
}

interface PickerLinkedGroup {
  link: { id: string; name: string; source: { repoFullName: string; branch: string } };
  requests: ApiRequest[];
  /** Source workspace's folders, for breadcrumb display. */
  folders: Record<string, { id: string; name: string; parentId: string | null }>;
}

/**
 * Multi-select picker for "Add step". Lets the user check several requests
 * — local + linked — across workspaces and add them to the plan in one
 * click. Filter narrows the visible list by name. Each row shows its folder
 * breadcrumb so same-named requests in different folders can be told apart.
 */
function PlanStepPicker({
  requestArray,
  localFolders,
  linkedGroups,
  onAdd,
  onClose,
}: {
  requestArray: ApiRequest[];
  localFolders: Record<string, { id: string; name: string; parentId: string | null }>;
  linkedGroups: PickerLinkedGroup[];
  onAdd: (picks: PickEntry[]) => void;
  onClose: () => void;
}) {
  // Selection key format: `${linkedWorkspaceId ?? 'local'}:${requestId}`.
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();

  const matches = (name: string): boolean => {
    if (!q) return true;
    return name.toLowerCase().includes(q);
  };

  const toggle = (key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const localFiltered = requestArray.filter((r) => matches(r.name));
  const linkedFiltered = linkedGroups
    .map((g) => ({ ...g, requests: g.requests.filter((r) => matches(r.name)) }))
    .filter((g) => g.requests.length > 0);
  const totalVisible =
    localFiltered.length + linkedFiltered.reduce((acc, g) => acc + g.requests.length, 0);

  const allVisibleKeys = useMemo(() => {
    const keys: string[] = [];
    for (const r of localFiltered) keys.push(`local:${r.id}`);
    for (const g of linkedFiltered) for (const r of g.requests) keys.push(`${g.link.id}:${r.id}`);
    return keys;
  }, [localFiltered, linkedFiltered]);
  const allVisibleSelected =
    allVisibleKeys.length > 0 && allVisibleKeys.every((k) => selected.has(k));

  const commit = () => {
    if (selected.size === 0) {
      onClose();
      return;
    }
    const picks: PickEntry[] = [];
    for (const key of selected) {
      const sep = key.indexOf(':');
      const prefix = key.slice(0, sep);
      const requestId = key.slice(sep + 1);
      picks.push({
        requestId,
        linkedWorkspaceId: prefix === 'local' ? undefined : prefix,
      });
    }
    onAdd(picks);
  };

  return (
    <div className="mb-2 flex flex-col rounded-sm border border-border bg-card">
      <header className="flex items-center gap-2 border-b border-border-subtle px-3 py-2">
        <input
          type="search"
          autoFocus
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name…"
          aria-label="Filter requests"
          className="h-7 flex-1 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <button
          type="button"
          disabled={totalVisible === 0}
          onClick={() => {
            setSelected((prev) => {
              const next = new Set(prev);
              if (allVisibleSelected) {
                for (const k of allVisibleKeys) next.delete(k);
              } else {
                for (const k of allVisibleKeys) next.add(k);
              }
              return next;
            });
          }}
          className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary disabled:opacity-30"
        >
          {allVisibleSelected ? 'Clear visible' : 'Select visible'}
        </button>
      </header>

      <div className="max-h-72 overflow-y-auto">
        {totalVisible === 0 ? (
          <p className="px-3 py-4 text-center text-[11px] text-text-dim">
            {q ? `No requests match “${filter}”.` : 'No requests yet.'}
          </p>
        ) : (
          <>
            {localFiltered.length > 0 && (
              <>
                <p className="border-b border-border-subtle px-3 py-1 text-[10px] uppercase tracking-wider text-text-dim">
                  This workspace
                </p>
                <ul>
                  {localFiltered.map((r) => {
                    const key = `local:${r.id}`;
                    const checked = selected.has(key);
                    const breadcrumb = buildFolderBreadcrumb(r.folderId, localFolders);
                    return (
                      <li key={key}>
                        <label className="flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-xs text-text-muted hover:bg-surface hover:text-text-primary">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(key)}
                            aria-label={`Select ${r.name}`}
                            style={{ accentColor: 'var(--purple)' }}
                            className="mt-0.5 h-3 w-3"
                          />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] uppercase text-text-dim">
                                {r.method}
                              </span>
                              <span className="truncate">{r.name}</span>
                            </div>
                            {breadcrumb.length > 0 && <BreadcrumbTrail trail={breadcrumb} />}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </>
            )}
            {linkedFiltered.map((group) => (
              <div key={group.link.id}>
                <p className="border-b border-t border-border-subtle px-3 py-1 text-[10px] uppercase tracking-wider text-text-dim">
                  {group.link.name}
                  <span className="ml-1 text-text-dim normal-case">
                    · {group.link.source.repoFullName}@{group.link.source.branch}
                  </span>
                </p>
                <ul>
                  {group.requests.map((r) => {
                    const key = `${group.link.id}:${r.id}`;
                    const checked = selected.has(key);
                    const breadcrumb = buildFolderBreadcrumb(r.folderId, group.folders);
                    return (
                      <li key={key}>
                        <label className="flex w-full cursor-pointer items-start gap-2 px-3 py-1.5 text-xs text-text-muted hover:bg-surface hover:text-text-primary">
                          <input
                            type="checkbox"
                            checked={checked}
                            onChange={() => toggle(key)}
                            aria-label={`Select ${r.name} from ${group.link.name}`}
                            style={{ accentColor: 'var(--purple)' }}
                            className="mt-0.5 h-3 w-3"
                          />
                          <div className="flex min-w-0 flex-1 flex-col gap-0.5">
                            <div className="flex items-center gap-2">
                              <span className="text-[10px] uppercase text-text-dim">
                                {r.method}
                              </span>
                              <span className="truncate">{r.name}</span>
                            </div>
                            {breadcrumb.length > 0 && <BreadcrumbTrail trail={breadcrumb} />}
                          </div>
                        </label>
                      </li>
                    );
                  })}
                </ul>
              </div>
            ))}
          </>
        )}
      </div>

      <footer className="flex items-center justify-between border-t border-border-subtle px-3 py-2">
        <span className="text-[11px] text-text-dim">
          {selected.size === 0 ? 'Pick one or more' : `${selected.size} selected`}
        </span>
        <div className="flex items-center gap-1">
          <button
            type="button"
            onClick={onClose}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={commit}
            disabled={selected.size === 0}
            className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/15 px-3 text-[11px] text-accent hover:bg-accent/25 disabled:opacity-40"
          >
            {selected.size <= 1 ? 'Add step' : `Add ${selected.size} steps`}
          </button>
        </div>
      </footer>
    </div>
  );
}

function PlanStepRow({
  request,
  linkedName,
  breadcrumb,
  index,
  isFirst,
  isLast,
  enabled,
  onRemove,
  onMoveUp,
  onMoveDown,
  onToggleEnabled,
  onQuickView,
}: {
  request: ApiRequest | undefined;
  linkedName?: string | undefined;
  breadcrumb: string[];
  index: number;
  isFirst: boolean;
  isLast: boolean;
  /** Effective enabled state — `step.enabled !== false`. */
  enabled: boolean;
  onRemove: () => void;
  onMoveUp: () => void;
  onMoveDown: () => void;
  onToggleEnabled: (next: boolean) => void;
  onQuickView?: () => void;
}) {
  return (
    <li
      className={cn(
        'flex flex-col gap-0.5 rounded-sm border border-border bg-card px-2 py-1.5',
        !enabled && 'opacity-60',
      )}
    >
      <div className="flex items-center gap-2">
        <input
          type="checkbox"
          checked={enabled}
          onChange={(e) => onToggleEnabled(e.target.checked)}
          aria-label={`Enable step ${index + 1}`}
          className="h-3 w-3 cursor-pointer"
          style={{ accentColor: 'var(--purple)' }}
        />
        <span className="w-6 text-center text-[10px] text-text-dim">{index + 1}.</span>
        {request ? (
          <>
            <span className="text-[10px] uppercase text-text-dim">{request.method}</span>
            <span
              className={cn(
                'flex-1 truncate text-xs text-text-primary',
                !enabled && 'line-through',
              )}
            >
              {request.name}
            </span>
            {linkedName && (
              <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                from {linkedName}
              </span>
            )}
            {!enabled && (
              <span
                className="rounded-sm border border-text-dim/40 bg-surface px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-dim"
                aria-label={`Step ${index + 1} is disabled`}
              >
                disabled
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
        {onQuickView && (
          <button
            type="button"
            onClick={onQuickView}
            aria-label={`Quick view step ${index + 1}`}
            title="Quick view"
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-dim hover:text-text-primary"
          >
            <Eye size={11} />
          </button>
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
      </div>
      {breadcrumb.length > 0 && (
        <nav
          aria-label={`Folder path for step ${index + 1}`}
          className="ml-6 flex items-center gap-1 text-[10px] text-text-dim"
        >
          {breadcrumb.map((name, i) => (
            <span key={`${name}-${i}`} className="flex items-center gap-1">
              {i > 0 && <ChevronRight size={9} className="text-text-faint" />}
              <span className="truncate">{name}</span>
            </span>
          ))}
        </nav>
      )}
    </li>
  );
}

function PlanVariablesEditor({
  plan,
  onChange,
}: {
  plan: ExecutionPlan;
  onChange: (vars: ReadonlyArray<{ key: string; value: string }>) => void;
}) {
  const vars = plan.variables ?? [];
  return (
    <div className="space-y-1.5 rounded-sm border border-border bg-card p-2">
      {vars.length === 0 && (
        <p className="text-[11px] text-text-dim">
          No plan variables yet — env values resolve as usual.
        </p>
      )}
      {vars.map((v, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            type="text"
            value={v.key}
            onChange={(e) =>
              onChange(vars.map((row, idx) => (idx === i ? { ...row, key: e.target.value } : row)))
            }
            placeholder="VAR_NAME"
            aria-label={`Plan variable key ${i + 1}`}
            className="h-7 flex-1 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <input
            type="text"
            value={v.value}
            onChange={(e) =>
              onChange(
                vars.map((row, idx) => (idx === i ? { ...row, value: e.target.value } : row)),
              )
            }
            placeholder="value"
            aria-label={`Plan variable value ${i + 1}`}
            className="h-7 flex-[2] rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <button
            type="button"
            onClick={() => onChange(vars.filter((_, idx) => idx !== i))}
            aria-label={`Remove plan variable ${i + 1}`}
            className="inline-flex h-7 w-7 items-center justify-center text-text-faint hover:text-danger"
          >
            <Trash2 size={12} />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={() => onChange([...vars, { key: '', value: '' }])}
        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-dashed border-border px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Plus size={11} />
        Add plan variable
      </button>
    </div>
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
