import { useMemo, useState } from 'react';
import {
  ArrowDown,
  ArrowUp,
  Copy,
  Download,
  FileDown,
  GripVertical,
  Link2,
  Plus,
  Search,
  Trash2,
} from 'lucide-react';
import type { EnvPriorityRef } from '@apicircle/shared';
import { envPriorityKey, envPriorityRefEqual } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { KebabMenu, type KebabMenuItem } from '../../primitives/KebabMenu';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
// Phase 12: lazy wrapper — see editor/ImportModalLazy.tsx for the
// rationale (parser bundle defer).
import { ImportModalLazy as ImportModal } from '../editor/ImportModalLazy';

/**
 * One row in the sidebar's flat env list. Mixes local + linked envs under
 * a single concept so the user can interleave them in the priority order.
 * Linked rows can be toggled into / reordered within the priority list,
 * but they can't be renamed / deleted / duplicated from here — those
 * operations target the linked workspace's source. The kebab menu is
 * suppressed for linked rows accordingly.
 */
type EnvRow =
  | { ref: EnvPriorityRef; kind: 'local'; name: string; varCount: number }
  | {
      ref: EnvPriorityRef;
      kind: 'linked';
      linkedWorkspaceId: string;
      envName: string;
      linkName: string;
      varCount: number;
    };

export function EnvironmentsSidebar() {
  const items = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const linkedWorkspaces = useWorkspaceStore((s) => s.synced?.linkedWorkspaces ?? {});
  const linkedCollections = useWorkspaceStore((s) => s.local?.linkedCollections ?? {});
  const priorityOrder = useWorkspaceStore((s) => s.synced?.environments.priorityOrder ?? []);
  const setPriorityOrder = useWorkspaceStore((s) => s.setPriorityOrder);
  const addEnvironment = useWorkspaceStore((s) => s.addEnvironment);
  const removeEnvironment = useWorkspaceStore((s) => s.removeEnvironment);
  const duplicateEnvironment = useWorkspaceStore((s) => s.duplicateEnvironment);
  const exportEnvironment = useWorkspaceStore((s) => s.exportEnvironment);
  const envFocus = useWorkspaceStore((s) => s.envFocus);
  const setEnvFocus = useWorkspaceStore((s) => s.setEnvFocus);

  const adding = useWorkspaceStore((s) => s.envAdding);
  const setAdding = useWorkspaceStore((s) => s.setEnvAdding);
  const importOpen = useWorkspaceStore((s) => s.importModalOpen);
  const closeImport = useWorkspaceStore((s) => s.closeImportModal);
  const [draftName, setDraftName] = useState('');
  const [dragKey, setDragKey] = useState<string | null>(null);
  const [dropTargetKey, setDropTargetKey] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  // Pending env delete — captured at click time so the confirm copy can
  // name the env even after the kebab menu closes.
  const [pendingDelete, setPendingDelete] = useState<string | null>(null);

  const submitAdd = () => {
    const name = draftName.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    addEnvironment(name);
    setEnvFocus(name);
    setDraftName('');
    setAdding(false);
  };

  // Build a flat list of every env (local + linked) the user can pick from.
  // Priorityized rows come first in their stored order; the rest follow,
  // sorted by name within each origin.
  const allRows = useMemo<EnvRow[]>(() => {
    const rows: EnvRow[] = [];
    for (const env of Object.values(items)) {
      rows.push({
        ref: { kind: 'local', name: env.name },
        kind: 'local',
        name: env.name,
        varCount: env.variables.length,
      });
    }
    for (const link of Object.values(linkedWorkspaces)) {
      const snapshot = linkedCollections[link.id];
      if (!snapshot) continue;
      for (const env of Object.values(snapshot.environments.items)) {
        rows.push({
          ref: { kind: 'linked', linkedWorkspaceId: link.id, envName: env.name },
          kind: 'linked',
          linkedWorkspaceId: link.id,
          envName: env.name,
          linkName: link.name,
          varCount: env.variables.length,
        });
      }
    }
    return rows;
  }, [items, linkedWorkspaces, linkedCollections]);

  const rowsByKey = useMemo(() => {
    const m = new Map<string, EnvRow>();
    for (const r of allRows) m.set(envPriorityKey(r.ref), r);
    return m;
  }, [allRows]);

  // Resolve the priorityOrder against actual rows. Stale linked refs
  // (snapshot dropped, link unlinked) are filtered out — the source of
  // truth stays in `priorityOrder` until the user reorders, but they
  // don't render here. Memoized so unrelated store mutations don't
  // reshape these arrays on every render (which would defeat
  // `orderedRows`'s own useMemo via fresh `fullOrderedRows` references).
  const prioritized = useMemo<EnvRow[]>(
    () =>
      priorityOrder
        .map((ref) => rowsByKey.get(envPriorityKey(ref)))
        .filter((r): r is EnvRow => r !== undefined),
    [priorityOrder, rowsByKey],
  );
  const selectedKeys = useMemo(
    () => new Set(prioritized.map((r) => envPriorityKey(r.ref))),
    [prioritized],
  );

  // Unprioritized: everything not yet in the priority list, sorted with
  // local before linked, then by name within each.
  const unprioritized = useMemo<EnvRow[]>(
    () =>
      allRows
        .filter((r) => !selectedKeys.has(envPriorityKey(r.ref)))
        .sort((a, b) => {
          if (a.kind !== b.kind) return a.kind === 'local' ? -1 : 1;
          const aName = a.kind === 'local' ? a.name : a.envName;
          const bName = b.kind === 'local' ? b.name : b.envName;
          return aName.localeCompare(bName, undefined, { sensitivity: 'base' });
        }),
    [allRows, selectedKeys],
  );
  const fullOrderedRows = useMemo(
    () => [...prioritized, ...unprioritized],
    [prioritized, unprioritized],
  );
  const orderedRows = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return fullOrderedRows;
    return fullOrderedRows.filter((r) => {
      const name = r.kind === 'local' ? r.name : r.envName;
      const link = r.kind === 'linked' ? r.linkName : '';
      return name.toLowerCase().includes(q) || link.toLowerCase().includes(q);
    });
  }, [fullOrderedRows, searchQuery]);

  const toggleSelected = (ref: EnvPriorityRef) => {
    const key = envPriorityKey(ref);
    if (selectedKeys.has(key)) {
      setPriorityOrder(priorityOrder.filter((r) => envPriorityKey(r) !== key));
    } else {
      setPriorityOrder([...priorityOrder.filter((r) => envPriorityKey(r) !== key), ref]);
    }
  };

  const onDelete = (name: string) => setPendingDelete(name);

  /**
   * Keyboard-accessible alternative to drag-to-reorder. Walks the current
   * priority list, finds `key`, and swaps it with the neighbour at
   * `direction` (`-1` up, `+1` down). No-op when at the edge or when the
   * row isn't priorityized — checkbox selection puts it at the tail
   * first; Move Up then walks it back through the list.
   */
  const moveByPosition = (key: string, direction: -1 | 1): void => {
    const current = priorityOrder.findIndex((r) => envPriorityKey(r) === key);
    if (current < 0) return;
    const target = current + direction;
    if (target < 0 || target >= priorityOrder.length) return;
    const next = [...priorityOrder];
    const [moved] = next.splice(current, 1);
    next.splice(target, 0, moved);
    setPriorityOrder(next);
  };

  const onExport = (name: string) => {
    const json = exportEnvironment(name);
    if (!json) return;
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `${name.replace(/[^a-z0-9-_]+/gi, '_')}.apicircle-env.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onDragStart = (key: string) => (e: React.DragEvent<HTMLLIElement>) => {
    setDragKey(key);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', key);
      } catch {
        // jsdom (and a few browsers) don't implement DataTransfer fully
      }
    }
  };

  const onDragOver = (key: string) => (e: React.DragEvent<HTMLLIElement>) => {
    if (!dragKey || !selectedKeys.has(key) || key === dragKey) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dropTargetKey !== key) setDropTargetKey(key);
  };

  const onDragLeave = (key: string) => () => {
    if (dropTargetKey === key) setDropTargetKey(null);
  };

  const onDrop = (key: string) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    const source = dragKey;
    setDragKey(null);
    setDropTargetKey(null);
    if (!source || source === key || !selectedKeys.has(key)) return;
    const nextRefs = priorityOrder.filter((r) => envPriorityKey(r) !== source);
    const targetIdx = nextRefs.findIndex((r) => envPriorityKey(r) === key);
    if (targetIdx < 0) return;
    const sourceRef = priorityOrder.find((r) => envPriorityKey(r) === source);
    if (!sourceRef) return;
    nextRefs.splice(targetIdx, 0, sourceRef);
    setPriorityOrder(nextRefs);
  };

  const onDragEnd = () => {
    setDragKey(null);
    setDropTargetKey(null);
  };

  return (
    <div className="flex h-full flex-col gap-2">
      <ImportModal open={importOpen} onClose={closeImport} />

      <div className="relative">
        <Search
          size={11}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
        />
        <input
          value={searchQuery}
          onChange={(e) => setSearchQuery(e.target.value)}
          placeholder="Search environments…"
          aria-label="Search environments"
          className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-[0.6875rem] text-text-primary focus:border-accent focus:outline-none"
        />
      </div>

      {adding && (
        <input
          autoFocus
          value={draftName}
          onChange={(e) => setDraftName(e.target.value)}
          onBlur={submitAdd}
          onKeyDown={(e) => {
            if (e.key === 'Enter') submitAdd();
            if (e.key === 'Escape') {
              setDraftName('');
              setAdding(false);
            }
          }}
          placeholder="Environment name"
          aria-label="Environment name"
          className="h-7 rounded-sm border border-accent bg-card px-2 text-xs text-text-primary focus:outline-none focus:ring-2 focus:ring-accent/30"
        />
      )}

      <ul role="list" aria-label="Environments" className="flex flex-col gap-0.5">
        {orderedRows.length === 0 && (
          <li className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[0.6875rem] text-text-dim">
            {searchQuery ? 'No matching environments.' : 'No environments yet.'}
          </li>
        )}
        {orderedRows.map((row) => {
          const key = envPriorityKey(row.ref);
          const isSelected = selectedKeys.has(key);
          const isFocused = row.kind === 'local' && envFocus !== null && envFocus === row.name;
          const isDragging = dragKey === key;
          const isDropTarget = dropTargetKey === key;
          const displayName = row.kind === 'local' ? row.name : row.envName;
          return (
            <li
              key={key}
              draggable={isSelected}
              onDragStart={isSelected ? onDragStart(key) : undefined}
              onDragOver={isSelected ? onDragOver(key) : undefined}
              onDragLeave={isSelected ? onDragLeave(key) : undefined}
              onDrop={isSelected ? onDrop(key) : undefined}
              onDragEnd={onDragEnd}
              data-env-key={key}
            >
              <div
                className={cn(
                  'group flex h-7 items-center gap-1.5 rounded-sm border px-1.5 text-xs transition-colors',
                  isFocused
                    ? 'border-accent/60 bg-accent/15 text-text-primary'
                    : isSelected
                      ? 'border-accent/40 bg-accent/5 text-text-primary'
                      : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
                  isDragging && 'opacity-50',
                  isDropTarget && 'border-accent',
                )}
              >
                {isSelected ? (
                  // The drag handle is a visual affordance, not an
                  // interactive control with its own accessible name —
                  // dragging itself is not keyboard-accessible (axe a11y
                  // wouldn't report it either way), and the row's
                  // checkbox + name button already announce the row.
                  // Adding aria-label without role triggers axe
                  // `aria-prohibited-attr`; keep the tooltip via title only.
                  <span
                    className="flex h-4 w-4 cursor-grab items-center justify-center text-text-faint hover:text-text-primary active:cursor-grabbing"
                    title={`Drag ${displayName} to reorder priority`}
                    aria-hidden="true"
                  >
                    <GripVertical size={12} />
                  </span>
                ) : (
                  <span aria-hidden className="h-4 w-4" />
                )}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelected(row.ref)}
                  aria-label={`${isSelected ? 'Remove' : 'Add'} ${displayName} ${
                    row.kind === 'linked' ? `(linked from ${row.linkName}) ` : ''
                  }from global environment layer`}
                  className="h-3 w-3 cursor-pointer"
                  style={{ accentColor: 'rgb(var(--accent))' }}
                />
                {row.kind === 'local' ? (
                  <button
                    type="button"
                    onClick={() => setEnvFocus(row.name)}
                    className="flex flex-1 items-center gap-2 truncate text-left"
                    aria-label={`Edit variables in ${row.name}`}
                    aria-pressed={isFocused}
                  >
                    <span className="truncate">{row.name}</span>
                  </button>
                ) : (
                  // Linked envs are read-only from this surface — clicking
                  // a row no-ops. The user edits override values from the
                  // LinkedEnvironmentsSection in the env editor pane.
                  <div
                    className="flex flex-1 items-center gap-1.5 truncate"
                    title={`From linked workspace ${row.linkName}`}
                    aria-label={`Linked env ${row.envName} from ${row.linkName}`}
                  >
                    <Link2 size={10} aria-hidden="true" className="shrink-0 text-text-faint" />
                    <span className="truncate">{row.envName}</span>
                    <span className="shrink-0 rounded-sm border border-border bg-card px-1 py-0.5 text-[0.5625rem] text-text-dim">
                      {row.linkName}
                    </span>
                  </div>
                )}
                <span className="text-[0.625rem] text-text-dim">{row.varCount}</span>
                {row.kind === 'local' ? (
                  <KebabMenu
                    ariaLabel={`Environment actions for ${row.name}`}
                    size="sm"
                    items={[
                      // Move-up / Move-down — keyboard-accessible reorder.
                      // Drag is mouse-only; without these, screen-reader and
                      // keyboard users had no way to change priority order
                      // (audit gap A13).
                      ...(isSelected
                        ? [
                            {
                              id: 'move-up',
                              label: 'Move up in priority',
                              icon: <ArrowUp size={12} aria-hidden="true" />,
                              onSelect: () => moveByPosition(key, -1),
                            },
                            {
                              id: 'move-down',
                              label: 'Move down in priority',
                              icon: <ArrowDown size={12} aria-hidden="true" />,
                              onSelect: () => moveByPosition(key, 1),
                            },
                          ]
                        : []),
                      {
                        id: 'duplicate',
                        label: 'Duplicate',
                        icon: <Copy size={12} aria-hidden="true" />,
                        onSelect: () => duplicateEnvironment(row.name),
                      },
                      {
                        id: 'export',
                        label: 'Export as JSON',
                        icon: <FileDown size={12} aria-hidden="true" />,
                        onSelect: () => onExport(row.name),
                      },
                      {
                        id: 'delete',
                        label: 'Delete',
                        icon: <Trash2 size={12} aria-hidden="true" />,
                        tone: 'danger',
                        onSelect: () => onDelete(row.name),
                      },
                    ]}
                  />
                ) : (
                  // Symmetry padding for the kebab slot so linked rows
                  // line up with local rows visually.
                  <span aria-hidden className="h-5 w-5" />
                )}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-auto rounded-sm border border-dashed border-border-subtle p-2 text-[0.6875rem] leading-snug text-text-dim">
        Tick to include in the global priority layer (resolves <code>{'{{NAME}}'}</code> at send
        time). Drag the handle to reorder. Click a local env to edit its variables; linked envs edit
        through their <em>Linked environments</em> section.
      </p>

      <ConfirmDialog
        open={pendingDelete !== null}
        title={`Delete environment "${pendingDelete ?? ''}"?`}
        description={
          <p>
            Removes the environment and any variables defined inside it. Linked environments and
            other workspaces are not affected. This cannot be undone.
          </p>
        }
        confirmLabel="Delete environment"
        tone="danger"
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) removeEnvironment(pendingDelete);
          setPendingDelete(null);
        }}
      />
    </div>
  );
}

// Suppress lint on `envPriorityRefEqual` import — we reach for it elsewhere
// (planner, tests). Keeping the import local to this file would scatter the
// helpers; module re-exports are kept lean intentionally.
void envPriorityRefEqual;

/**
 * Kebab menu rendered next to the "ENVIRONMENTS" label in the shared sidebar
 * header. Replaces the previous CTA row above the environment list.
 */
export function EnvironmentsSidebarActions() {
  const setAdding = useWorkspaceStore((s) => s.setEnvAdding);
  const openImport = useWorkspaceStore((s) => s.openImportModal);

  const items: KebabMenuItem[] = [
    {
      id: 'new-environment',
      label: 'New Environment',
      icon: <Plus size={12} aria-hidden="true" />,
      onSelect: () => setAdding(true),
    },
    {
      id: 'import',
      label: 'Import',
      icon: <Download size={12} aria-hidden="true" />,
      onSelect: openImport,
      title: 'Import a Postman or API Circle environment',
    },
  ];

  return <KebabMenu items={items} ariaLabel="Environments actions" size="sm" alwaysVisible />;
}
