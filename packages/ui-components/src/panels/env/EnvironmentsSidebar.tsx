import { useState } from 'react';
import { Download, GripVertical, Plus, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { ImportModal } from '../editor/ImportModal';

export function EnvironmentsSidebar() {
  const items = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const priorityOrder = useWorkspaceStore((s) => s.synced?.environments.priorityOrder ?? []);
  const setPriorityOrder = useWorkspaceStore((s) => s.setPriorityOrder);
  const addEnvironment = useWorkspaceStore((s) => s.addEnvironment);
  const removeEnvironment = useWorkspaceStore((s) => s.removeEnvironment);
  const envFocus = useWorkspaceStore((s) => s.envFocus);
  const setEnvFocus = useWorkspaceStore((s) => s.setEnvFocus);

  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');
  const [dragName, setDragName] = useState<string | null>(null);
  const [dropTarget, setDropTarget] = useState<string | null>(null);
  const [importOpen, setImportOpen] = useState(false);

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
  const orderedNames = [...prioritized, ...unprioritized];

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
      <div className="flex gap-1">
        <button
          type="button"
          onClick={() => setAdding(true)}
          className="inline-flex h-7 flex-1 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
          aria-label="New environment"
        >
          <Plus size={12} />
          New environment
        </button>
        <button
          type="button"
          onClick={() => setImportOpen(true)}
          className="inline-flex h-7 items-center justify-center rounded-sm border border-border bg-surface px-2 text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
          aria-label="Import environment"
          title="Import a Postman environment"
        >
          <Download size={12} />
        </button>
      </div>
      <ImportModal open={importOpen} onClose={() => setImportOpen(false)} />

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
        {allNames.length === 0 && (
          <li className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[11px] text-text-dim">
            No environments yet.
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
                  style={{ accentColor: 'var(--purple)' }}
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
                <button
                  type="button"
                  onClick={() => onDelete(name)}
                  className="inline-flex h-5 w-5 items-center justify-center rounded-sm text-text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100 focus:opacity-100"
                  aria-label={`Delete ${name}`}
                  title={`Delete ${name}`}
                >
                  <Trash2 size={12} />
                </button>
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
