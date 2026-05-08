import { useMemo } from 'react';
import { Search } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { searchHelp, type HelpSection } from './helpContent';
import { cn } from '../../primitives/cn';

/**
 * Help Center sidebar — search input + filtered section list. Shares
 * state with `HelpPanel` (the right pane) via the workspace store so the
 * two components can sit on either side of the standard resizable shell
 * (`react-resizable-panels` in App.tsx) instead of being co-located in a
 * single fixed-width two-pane layout.
 */
export function HelpSidebar() {
  const query = useWorkspaceStore((s) => s.helpQuery);
  const setQuery = useWorkspaceStore((s) => s.setHelpQuery);
  const selectedId = useWorkspaceStore((s) => s.helpSectionId);
  const setSelectedId = useWorkspaceStore((s) => s.setHelpSectionId);

  const filtered = useMemo(() => searchHelp(query), [query]);
  const selected: HelpSection | null = useMemo(() => {
    const matched = filtered.find((s) => s.id === selectedId);
    if (matched) return matched;
    return filtered[0] ?? null;
  }, [filtered, selectedId]);

  return (
    <div className="flex h-full flex-col gap-2">
      <div className="relative">
        <Search
          size={11}
          aria-hidden="true"
          className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
        />
        <input
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search help…"
          aria-label="Search help"
          className="h-7 w-full rounded-sm border border-border bg-surface pl-7 pr-2 text-[11px] text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
      <nav className="flex-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-2 py-4 text-center text-[11px] text-text-dim">No matching sections.</p>
        ) : (
          <ul className="flex flex-col gap-0.5">
            {filtered.map((section) => {
              const active = section.id === selected?.id;
              return (
                <li key={section.id}>
                  <button
                    type="button"
                    onClick={() => setSelectedId(section.id)}
                    aria-current={active ? 'true' : undefined}
                    className={cn(
                      'w-full rounded-sm px-2 py-1.5 text-left text-[11px] transition-colors',
                      active
                        ? 'border border-accent/40 bg-accent/10 text-accent'
                        : 'border border-transparent text-text-muted hover:border-border-subtle hover:bg-surface hover:text-text-primary',
                    )}
                  >
                    {section.title}
                  </button>
                </li>
              );
            })}
          </ul>
        )}
      </nav>
    </div>
  );
}
