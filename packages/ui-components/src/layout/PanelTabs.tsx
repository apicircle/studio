import { useWorkspaceStore } from '../store/workspaceStore';
import { cn } from '../primitives/cn';
import { PANELS } from './panels';

export function PanelTabs() {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);

  return (
    <nav
      className="flex h-10 shrink-0 items-center gap-1 border-b border-border-subtle bg-card px-2"
      aria-label="Top navigation"
    >
      {PANELS.map(({ id, label, icon: Icon }) => {
        const active = activePanel === id;
        return (
          <button
            key={id}
            type="button"
            onClick={() => setActivePanel(id)}
            className={cn(
              'inline-flex h-7 items-center gap-2 rounded-sm px-3 text-xs font-medium transition-colors',
              active
                ? 'bg-accent/15 text-accent border border-accent/40'
                : 'text-text-muted hover:text-text-primary hover:bg-surface border border-transparent',
            )}
            aria-current={active ? 'page' : undefined}
          >
            <Icon size={14} />
            {label}
          </button>
        );
      })}
    </nav>
  );
}
