import { useMemo, useState } from 'react';
import { Copy, Layers, Plus, Search, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { KebabMenu, type KebabMenuItem } from '../../primitives/KebabMenu';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { cn } from '../../primitives/cn';

/**
 * Header-level kebab rendered next to the "Execution" label in the shared
 * sidebar header. Replaces the previous in-panel "Plans" row + kebab so the
 * sidebar opens straight into the search + plan list.
 */
export function ExecutionSidebarActions() {
  const addPlan = useWorkspaceStore((s) => s.addPlan);
  const items: KebabMenuItem[] = [
    {
      id: 'add-plan',
      label: 'Add plan',
      icon: <Plus size={12} aria-hidden="true" />,
      onSelect: () => addPlan(),
    },
  ];
  return <KebabMenu items={items} ariaLabel="Execution actions" size="sm" alwaysVisible />;
}

export function ExecutionSidebar() {
  const plans = useWorkspaceStore((s) => s.synced?.executionPlans ?? {});
  const activePlanId = useWorkspaceStore((s) => s.activePlanId);
  const setActivePlanId = useWorkspaceStore((s) => s.setActivePlanId);
  const duplicatePlan = useWorkspaceStore((s) => s.duplicatePlan);
  const removePlan = useWorkspaceStore((s) => s.removePlan);

  const [pendingDelete, setPendingDelete] = useState<{ id: string; name: string } | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

  const planArray = useMemo(() => {
    const all = Object.values(plans).sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
    const q = searchQuery.trim().toLowerCase();
    if (!q) return all;
    return all.filter((p) => p.name.toLowerCase().includes(q));
  }, [plans, searchQuery]);

  // Auto-fall-through to the most-recent plan when the explicit selection
  // points at a plan that has been deleted.
  const effectiveActiveId =
    activePlanId && plans[activePlanId] ? activePlanId : (planArray[0]?.id ?? null);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative">
        <Search
          size={11}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
        />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search plans…"
          aria-label="Search plans"
          className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
      {planArray.length === 0 ? (
        <p className="p-3 text-[0.6875rem] text-text-dim">
          {searchQuery ? 'No matching plans.' : 'No plans yet.'}
        </p>
      ) : (
        <ul className="flex flex-1 flex-col gap-1 overflow-y-auto py-1">
          {planArray.map((plan) => {
            const isActive = plan.id === effectiveActiveId;
            const items: KebabMenuItem[] = [
              {
                id: 'duplicate',
                label: 'Duplicate',
                icon: <Copy size={12} aria-hidden="true" />,
                onSelect: () => duplicatePlan(plan.id),
              },
              {
                id: 'delete',
                label: 'Delete',
                icon: <Trash2 size={12} aria-hidden="true" />,
                tone: 'danger',
                onSelect: () => setPendingDelete({ id: plan.id, name: plan.name }),
              },
            ];
            return (
              <li key={plan.id}>
                <div
                  className={cn(
                    'group flex h-7 items-center gap-1 rounded-sm border px-0.5',
                    isActive
                      ? 'border-accent/40 bg-accent/10'
                      : 'border-transparent hover:bg-surface',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActivePlanId(plan.id)}
                    aria-current={isActive ? 'true' : undefined}
                    className={cn(
                      'flex h-full flex-1 items-center gap-2 rounded-sm px-1.5 text-left text-xs transition-colors',
                      isActive ? 'text-accent' : 'text-text-muted hover:text-text-primary',
                    )}
                  >
                    <Layers size={11} aria-hidden="true" />
                    <span className="truncate">{plan.name}</span>
                    <span className="ml-auto text-[0.625rem] text-text-dim">
                      {plan.steps.length}
                    </span>
                  </button>
                  <KebabMenu items={items} ariaLabel={`${plan.name} actions`} size="sm" />
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete ${pendingDelete?.name ?? ''}?`}
        description={<p>This removes the plan and its run history from this workspace.</p>}
        confirmLabel="Delete"
        tone="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removePlan(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}
