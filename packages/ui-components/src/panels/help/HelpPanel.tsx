import { useMemo, type ReactNode } from 'react';
import { ExternalLink, HelpCircle, Lightbulb } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { replayOnboarding } from '../../onboarding/OnboardingTour';
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
          <div className="space-y-3">{renderHelpBody(selected.body)}</div>
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
 * Renders a help-section body. The body uses a small markup subset so
 * detailed reference content stays scannable rather than collapsing into
 * walls of prose:
 *  - blank-line-separated blocks
 *  - a block that is a single `## ` line becomes a sub-heading
 *  - a block whose every line starts with `- ` becomes a bullet list
 *  - a block whose every line starts with four spaces becomes a verbatim
 *    code / example block (the indent is stripped; no inline markup)
 *  - inline `**bold**` and `` `code` `` spans
 */
function renderHelpBody(body: string): ReactNode {
  return body.split(/\n\n+/).map((block, i) => {
    const lines = block.split('\n');
    if (lines.every((line) => line.startsWith('    '))) {
      return (
        <pre
          key={i}
          className="overflow-x-auto rounded-sm border border-border-subtle bg-card px-3 py-2 text-[0.75rem] leading-relaxed text-text-primary"
        >
          <code>{lines.map((line) => line.slice(4)).join('\n')}</code>
        </pre>
      );
    }
    if (lines.length === 1 && lines[0].startsWith('## ')) {
      return (
        <h3 key={i} className="pt-2 text-[0.8125rem] font-semibold text-text-primary">
          {renderInline(lines[0].slice(3))}
        </h3>
      );
    }
    if (lines.every((line) => line.startsWith('- '))) {
      return (
        <ul key={i} className="ml-1 list-disc space-y-1.5 pl-4">
          {lines.map((line, j) => (
            <li key={j} className="text-[0.8125rem] leading-relaxed text-text-muted">
              {renderInline(line.slice(2))}
            </li>
          ))}
        </ul>
      );
    }
    return (
      <p key={i} className="text-[0.8125rem] leading-relaxed text-text-muted">
        {renderInline(block)}
      </p>
    );
  });
}

/**
 * Inline span parser for help body text. Turns `**bold**` into a primary-
 * weight emphasis and `` `code` `` into a monospace chip. Anything else is
 * passed through verbatim.
 */
function renderInline(text: string): ReactNode[] {
  const out: ReactNode[] = [];
  const pattern = /\*\*([^*]+)\*\*|`([^`]+)`/g;
  let lastIndex = 0;
  let key = 0;
  let match: RegExpExecArray | null;
  while ((match = pattern.exec(text)) !== null) {
    if (match.index > lastIndex) out.push(text.slice(lastIndex, match.index));
    if (match[1] !== undefined) {
      out.push(
        <strong key={key++} className="font-medium text-text-primary">
          {match[1]}
        </strong>,
      );
    } else if (match[2] !== undefined) {
      out.push(
        <code
          key={key++}
          className="rounded-[3px] bg-card px-1 py-0.5 font-mono text-[0.75rem] text-text-primary"
        >
          {match[2]}
        </code>,
      );
    }
    lastIndex = match.index + match[0].length;
  }
  if (lastIndex < text.length) out.push(text.slice(lastIndex));
  return out;
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
