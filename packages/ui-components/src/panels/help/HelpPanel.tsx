import { useMemo } from 'react';
import { ExternalLink, HelpCircle, Lightbulb } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { replayOnboarding } from '../../onboarding/OnboardingTips';
import { searchHelp, type HelpSection } from './helpContent';

// Right pane of the Help Center. The search input + section list lives in
// `HelpSidebar` and is rendered into the standard resizable shell by
// `Sidebar.tsx`. Keeps the article view at full panel width so longer prose
// has room to breathe; selection state is shared via the workspace store.

export function HelpPanel() {
  const query = useWorkspaceStore((s) => s.helpQuery);
  const selectedId = useWorkspaceStore((s) => s.helpSectionId);

  const filtered = useMemo(() => searchHelp(query), [query]);
  const selected: HelpSection | null = useMemo(() => {
    const matched = filtered.find((s) => s.id === selectedId);
    if (matched) return matched;
    return filtered[0] ?? null;
  }, [filtered, selectedId]);

  return (
    <div className="flex h-full flex-col bg-surface">
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
              <p key={i} className="text-[0.8125rem] leading-relaxed text-text-muted">
                {para}
              </p>
            ))}
          </div>
          <HelpFooter />
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
    </div>
  );
}

/**
 * Footer rendered below every help article. Two affordances:
 *  - Re-launch the onboarding tour (audit gap A16: it was dismiss-once-forever)
 *  - Open an issue / docs link for missing-help feedback
 */
function HelpFooter() {
  return (
    <footer className="mt-8 flex flex-wrap items-center gap-3 border-t border-border-subtle pt-4 text-[0.6875rem] text-text-dim">
      <button
        type="button"
        onClick={replayOnboarding}
        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Lightbulb size={11} aria-hidden="true" />
        Re-launch onboarding tour
      </button>
      <a
        href="https://github.com/apicircle/studio/issues/new"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-card px-2 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary"
      >
        <ExternalLink size={11} aria-hidden="true" />
        Was this helpful? Open an issue
      </a>
    </footer>
  );
}
