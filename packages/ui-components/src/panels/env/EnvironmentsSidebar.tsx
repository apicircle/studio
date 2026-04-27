import { useState } from 'react';
import { Plus, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';

export function EnvironmentsSidebar() {
  const items = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const activeName = useWorkspaceStore((s) => s.synced?.environments.activeName ?? null);
  const expanded = useWorkspaceStore((s) => s.local?.ui.sidebarExpandedSections ?? []);
  const setActiveEnvironment = useWorkspaceStore((s) => s.setActiveEnvironment);
  const addEnvironment = useWorkspaceStore((s) => s.addEnvironment);
  const removeEnvironment = useWorkspaceStore((s) => s.removeEnvironment);
  const toggleSidebarSection = useWorkspaceStore((s) => s.toggleSidebarSection);

  const [adding, setAdding] = useState(false);
  const [draftName, setDraftName] = useState('');

  const submitAdd = () => {
    const name = draftName.trim();
    if (!name) {
      setAdding(false);
      return;
    }
    addEnvironment(name);
    setActiveEnvironment(name);
    setDraftName('');
    setAdding(false);
  };

  const isOpen = expanded.includes('env.list');

  return (
    <div className="flex h-full flex-col gap-2">
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="inline-flex h-7 items-center justify-center gap-1.5 rounded-sm border border-border bg-surface text-xs text-text-muted transition-colors hover:border-accent hover:text-text-primary"
        aria-label="New environment"
      >
        <Plus size={12} />
        New environment
      </button>

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

      <div>
        <button
          type="button"
          onClick={() => toggleSidebarSection('env.list')}
          className="flex w-full items-center justify-between px-1 text-[10px] uppercase tracking-wider text-text-dim hover:text-text-muted"
          aria-expanded={isOpen}
        >
          <span>Environments</span>
          <span>{isOpen ? '–' : '+'}</span>
        </button>
      </div>

      {isOpen !== false && (
        <ul role="list" aria-label="Environments" className="flex flex-col gap-0.5">
          {Object.keys(items).length === 0 && (
            <li className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[11px] text-text-dim">
              No environments yet.
            </li>
          )}
          {Object.values(items).map((env) => {
            const isActive = activeName === env.name;
            return (
              <li key={env.name}>
                <div
                  className={cn(
                    'group flex items-center gap-2 rounded-sm border px-2 py-1.5 text-xs transition-colors',
                    isActive
                      ? 'border-accent/40 bg-accent/10 text-text-primary'
                      : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
                  )}
                >
                  <button
                    type="button"
                    onClick={() => setActiveEnvironment(isActive ? null : env.name)}
                    className="flex flex-1 items-center gap-2 truncate text-left"
                    aria-pressed={isActive}
                    aria-label={`${isActive ? 'Deactivate' : 'Activate'} ${env.name}`}
                  >
                    <span
                      className={cn(
                        'h-1.5 w-1.5 rounded-full',
                        isActive ? 'bg-accent' : 'bg-border-strong',
                      )}
                      aria-hidden="true"
                    />
                    <span className="truncate">{env.name}</span>
                    <span className="ml-auto text-[10px] text-text-dim">
                      {env.variables.length}
                    </span>
                  </button>
                  <button
                    type="button"
                    onClick={() => removeEnvironment(env.name)}
                    className="shrink-0 text-text-faint opacity-0 transition-opacity hover:text-danger group-hover:opacity-100"
                    aria-label={`Delete ${env.name}`}
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="mt-auto rounded-sm border border-dashed border-border-subtle p-2 text-[11px] leading-snug text-text-dim">
        Priority: context vars &gt; active env &gt; priority list. Plan-level priority overrides
        global.
      </p>
    </div>
  );
}
