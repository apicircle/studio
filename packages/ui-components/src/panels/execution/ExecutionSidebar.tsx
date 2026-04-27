import { useMemo } from 'react';
import { Layers, Plus } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';

export function ExecutionSidebar() {
  const plans = useWorkspaceStore((s) => s.local?.executionPlans ?? {});
  const activePlanId = useWorkspaceStore((s) => s.activePlanId);
  const setActivePlanId = useWorkspaceStore((s) => s.setActivePlanId);
  const addPlan = useWorkspaceStore((s) => s.addPlan);

  const planArray = useMemo(
    () => Object.values(plans).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt)),
    [plans],
  );

  // Auto-fall-through to the most-recent plan when the explicit selection
  // points at a plan that has been deleted.
  const effectiveActiveId =
    activePlanId && plans[activePlanId] ? activePlanId : (planArray[0]?.id ?? null);

  return (
    <div className="flex h-full flex-col">
      <div className="flex items-center justify-between border-b border-border-subtle px-3 py-2">
        <h2 className="text-[11px] font-medium uppercase tracking-wider text-text-dim">Plans</h2>
        <button
          type="button"
          onClick={() => addPlan()}
          aria-label="Create plan"
          className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-accent/40 bg-accent/10 text-accent hover:bg-accent/20"
        >
          <Plus size={11} />
        </button>
      </div>
      {planArray.length === 0 ? (
        <p className="p-3 text-[11px] text-text-dim">No plans yet.</p>
      ) : (
        <ul className="flex-1 overflow-y-auto py-1">
          {planArray.map((plan) => {
            const isActive = plan.id === effectiveActiveId;
            return (
              <li key={plan.id}>
                <button
                  type="button"
                  onClick={() => setActivePlanId(plan.id)}
                  aria-current={isActive ? 'true' : undefined}
                  className={
                    'flex w-full items-center gap-2 px-3 py-1.5 text-left text-xs transition-colors ' +
                    (isActive
                      ? 'bg-accent/10 text-accent'
                      : 'text-text-muted hover:bg-surface hover:text-text-primary')
                  }
                >
                  <Layers size={11} aria-hidden="true" />
                  <span className="truncate">{plan.name}</span>
                  <span className="ml-auto text-[10px] text-text-dim">{plan.steps.length}</span>
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}
