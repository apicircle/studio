import { useMemo, useState } from 'react';
import { HelpCircle, Search } from 'lucide-react';
import { HELP_SECTIONS, searchHelp, type HelpSection } from './helpContent';
import { cn } from '../../primitives/cn';

// Two-pane Help Center, mirroring studio v1's layout:
//   • Left rail = section index. Search filters the list; clicking a
//     section selects it.
//   • Right pane = the selected section's full body, rendered at the
//     panel's natural width (not a centered narrow column) so longer
//     prose has room to breathe.
//
// Replaces the v2-original single-scrolling-page layout, which centered
// content at max-w-2xl and pushed users into a search-or-scroll mode that
// hid the section headings under the fold.

export function HelpPanel() {
  const [query, setQuery] = useState('');
  const [selectedId, setSelectedId] = useState<string>(HELP_SECTIONS[0]?.id ?? 'welcome');

  const filtered = useMemo(() => searchHelp(query), [query]);

  // Keep the active section valid as the user filters: if the previous
  // selection drops out of the filtered list, reselect the first match
  // so the right pane never goes blank when there are still matches.
  const selected: HelpSection | null = useMemo(() => {
    const matched = filtered.find((s) => s.id === selectedId);
    if (matched) return matched;
    return filtered[0] ?? null;
  }, [filtered, selectedId]);

  return (
    <div className="flex h-full overflow-hidden bg-surface">
      <aside
        aria-label="Help sections"
        className="flex w-64 shrink-0 flex-col border-r border-border-subtle bg-card"
      >
        <header className="border-b border-border-subtle px-4 py-3">
          <div className="mb-2 flex items-center gap-2">
            <HelpCircle size={14} className="text-accent" aria-hidden="true" />
            <h1 className="text-sm font-medium text-text-primary">Help Center</h1>
          </div>
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
        </header>
        <nav className="flex-1 overflow-y-auto p-2">
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
      </aside>
      <main className="flex min-w-0 flex-1 flex-col">
        {selected ? (
          <article
            tabIndex={0}
            role="region"
            aria-labelledby={`help-${selected.id}-title`}
            className="flex-1 overflow-y-auto px-8 py-6 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
          >
            <header className="mb-4 border-b border-border-subtle pb-3">
              <h2
                id={`help-${selected.id}-title`}
                className="text-base font-medium text-text-primary"
              >
                {selected.title}
              </h2>
            </header>
            <div className="space-y-3">
              {selected.body.split(/\n\n+/).map((para, i) => (
                <p key={i} className="text-[13px] leading-relaxed text-text-muted">
                  {para}
                </p>
              ))}
            </div>
          </article>
        ) : (
          <div className="flex flex-1 items-center justify-center">
            <div className="flex max-w-md flex-col items-center gap-2 text-center text-text-dim">
              <HelpCircle size={28} aria-hidden="true" />
              <p className="text-sm text-text-primary">No matching sections.</p>
              <p className="text-xs text-text-muted">Try a shorter term or clear the search.</p>
            </div>
          </div>
        )}
      </main>
    </div>
  );
}
