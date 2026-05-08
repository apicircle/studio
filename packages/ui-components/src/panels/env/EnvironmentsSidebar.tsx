import { useMemo, useState } from 'react';
import { Copy, Download, FileDown, GripVertical, Plus, Search, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { KebabMenu, type KebabMenuItem } from '../../primitives/KebabMenu';
import { ImportModal } from '../editor/ImportModal';

export function EnvironmentsSidebar() {
  const items = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
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
  const [dragName, setDragName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [searchQuery, setSearchQuery] = useState('');

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

  const allNames = Object.keys(items);
  const prioritized = priorityOrder.filter((n) => items[n]);
  const selectedSet = new Set(prioritized);
  const unprioritized = allNames.filter((n) => !selectedSet.has(n)).sort();
  const fullOrderedNames = [...prioritized, ...unprioritized];
  const orderedNames = useMemo(() => {
    const q = searchQuery.trim().toLowerCase();
    if (!q) return fullOrderedNames;
    return fullOrderedNames.filter((n) => n.toLowerCase().includes(q));
  }, [fullOrderedNames, searchQuery]);

  const toggleSelected = (name: string) => {
    if (selectedSet.has(name)) {
      setPriorityOrder(priorityOrder.filter((n) => n !== name));
    } else {
      setPriorityOrder([...priorityOrder.filter((n) => n !== name), name]);
    }
  };

  const onDelete = (name: string) => {
    if (window.confirm(`Delete environment "${name}"?`)) removeEnvironment(name);
  };

  const onExport = (name: string) => {
    const json = exportEnvironment(name);
    if (!json) return;
    // Browser-only: spawn a download via a transient anchor + Blob URL.
    // Desktop builds also have `window.URL.createObjectURL`, so the
    // same code path works without a desktop bridge dependency.
    const blob = new Blob([json], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    // Use a filesystem-safe slug — the env name can contain spaces.
    a.download = `${name.replace(/[^a-z0-9-_]+/gi, '_')}.apicircle-env.json`;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  };

  const onDragStart = (name: string) => (e: React.DragEvent<HTMLLIElement>) => {
    setDragName(name);
    if (e.dataTransfer) {
      e.dataTransfer.effectAllowed = 'move';
      try {
        e.dataTransfer.setData('text/plain', name);
      } catch {
        // jsdom (and a few browsers) don't implement DataTransfer fully
      }
    }
  };

  const onDragOver = (name: string) => (e: React.DragEvent<HTMLLIElement>) => {
    if (!dragName || !selectedSet.has(name) || name === dragName) return;
    e.preventDefault();
    if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    if (dropTarget !== name) setDropTarget(name);
  };

  const onDragLeave = (name: string) => () => {
    if (dropTarget === name) setDropTarget(null);
  };

  const onDrop = (name: string) => (e: React.DragEvent<HTMLLIElement>) => {
    e.preventDefault();
    const source = dragName;
    setDragName(null);
    setDropTarget(null);
    if (!source || source === name || !selectedSet.has(name)) return;
    const next = prioritized.filter((n) => n !== source);
    const targetIdx = next.indexOf(name);
    if (targetIdx < 0) return;
    next.splice(targetIdx, 0, source);
    setPriorityOrder(next);
  };

  const onDragEnd = () => {
    setDragName(null);
    setDropTarget(null);
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
          className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-[11px] text-text-primary focus:border-accent focus:outline-none"
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
        {orderedNames.length === 0 && (
          <li className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[11px] text-text-dim">
            {searchQuery
              ? 'No matching environments.'
              : allNames.length === 0
                ? 'No environments yet.'
                : 'No environments yet.'}
          </li>
        )}
        {orderedNames.map((name) => {
          const env = items[name];
          if (!env) return null;
          const isSelected = selectedSet.has(name);
          const isFocused = envFocus === name;
          const isDragging = dragName === name;
          const isDropTarget = dropTarget === name;
          return (
            <li
              key={name}
              draggable={isSelected}
              onDragStart={isSelected ? onDragStart(name) : undefined}
              onDragOver={isSelected ? onDragOver(name) : undefined}
              onDragLeave={isSelected ? onDragLeave(name) : undefined}
              onDrop={isSelected ? onDrop(name) : undefined}
              onDragEnd={onDragEnd}
              data-env-name={name}
            >
              <div
                className={cn(
                  'group flex items-center gap-1.5 rounded-sm border px-1.5 py-1.5 text-xs transition-colors',
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
                  <span
                    className="flex h-4 w-4 cursor-grab items-center justify-center text-text-faint hover:text-text-primary active:cursor-grabbing"
                    aria-label={`Drag ${name} to reorder priority`}
                    title="Drag to reorder priority"
                  >
                    <GripVertical size={12} />
                  </span>
                ) : (
                  <span aria-hidden className="h-4 w-4" />
                )}
                <input
                  type="checkbox"
                  checked={isSelected}
                  onChange={() => toggleSelected(name)}
                  aria-label={`${isSelected ? 'Remove' : 'Add'} ${name} from global environment layer`}
                  className="h-3 w-3 cursor-pointer"
                  style={{ accentColor: 'rgb(var(--accent))' }}
                />
                <button
                  type="button"
                  onClick={() => setEnvFocus(name)}
                  className="flex flex-1 items-center gap-2 truncate text-left"
                  aria-label={`Edit variables in ${name}`}
                  aria-pressed={isFocused}
                >
                  <span className="truncate">{name}</span>
                </button>
                <span className="text-[10px] text-text-dim">{env.variables.length}</span>
                <KebabMenu
                  ariaLabel={`Environment actions for ${name}`}
                  size="sm"
                  items={[
                    {
                      id: 'duplicate',
                      label: 'Duplicate',
                      icon: <Copy size={12} aria-hidden="true" />,
                      onSelect: () => duplicateEnvironment(name),
                    },
                    {
                      id: 'export',
                      label: 'Export as JSON',
                      icon: <FileDown size={12} aria-hidden="true" />,
                      onSelect: () => onExport(name),
                    },
                    {
                      id: 'delete',
                      label: 'Delete',
                      icon: <Trash2 size={12} aria-hidden="true" />,
                      tone: 'danger',
                      onSelect: () => onDelete(name),
                    },
                  ]}
                />
                {/* Suppress lint on no-longer-imported icons. The lucide
                    imports stay because they're used inside the KebabMenu
                    items above as icon nodes. */}
              </div>
            </li>
          );
        })}
      </ul>

      <p className="mt-auto rounded-sm border border-dashed border-border-subtle p-2 text-[11px] leading-snug text-text-dim">
        Tick to include in the global layer. Drag the handle to reorder priority. Click a name to
        edit its variables.
      </p>
    </div>
  );
}

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
      title: 'Import a Postman environment',
    },
  ];

  return <KebabMenu items={items} ariaLabel="Environments actions" size="sm" alwaysVisible />;
}
