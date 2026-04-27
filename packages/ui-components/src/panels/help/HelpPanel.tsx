import { useMemo, useState } from 'react';
import { HelpCircle, Search } from 'lucide-react';
import { searchHelp } from './helpContent';

export function HelpPanel() {
  const [query, setQuery] = useState('');
  const sections = useMemo(() => searchHelp(query), [query]);

  return (
    <div className="flex h-full flex-col overflow-hidden bg-surface">
      <header className="flex items-baseline gap-3 border-b border-border-subtle px-6 py-3">
        <h1 className="text-lg font-medium text-text-primary">Help Center</h1>
        <p className="text-[11px] text-text-dim">
          Reference for the workspace model, panels, shortcuts, and recovery flows.
        </p>
      </header>
      <div className="border-b border-border-subtle px-6 py-3">
        <div className="relative max-w-md">
          <Search
            size={12}
            aria-hidden="true"
            className="pointer-events-none absolute left-2 top-1/2 -translate-y-1/2 text-text-dim"
          />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search help (try 'pin', 'yank', 'attachment')…"
            aria-label="Search help"
            className="h-8 w-full rounded-sm border border-border bg-card pl-7 pr-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
      </div>
      <div
        tabIndex={0}
        role="region"
        aria-label="Help sections"
        className="flex-1 overflow-y-auto px-6 py-4 focus:outline-none focus-visible:ring-2 focus-visible:ring-accent/40"
      >
        {sections.length === 0 ? (
          <div className="mx-auto flex max-w-md flex-col items-center gap-2 pt-12 text-center text-text-dim">
            <HelpCircle size={28} aria-hidden="true" />
            <p className="text-sm text-text-primary">No matching sections.</p>
            <p className="text-xs text-text-muted">
              Try a shorter term or browse the full list by clearing the query.
            </p>
          </div>
        ) : (
          <ol className="mx-auto max-w-2xl space-y-5">
            {sections.map((section) => (
              <li key={section.id} id={`help-${section.id}`}>
                <h2 className="mb-1.5 text-sm font-medium text-text-primary">{section.title}</h2>
                {section.body.split(/\n\n+/).map((para, i) => (
                  <p key={i} className="text-xs leading-relaxed text-text-muted">
                    {para}
                  </p>
                ))}
              </li>
            ))}
          </ol>
        )}
      </div>
    </div>
  );
}
