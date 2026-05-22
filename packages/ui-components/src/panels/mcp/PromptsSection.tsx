import { useMemo, useState } from 'react';
import { Check, Copy, Search } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import {
  MCP_PROMPTS,
  MCP_PROMPT_CATEGORIES,
  type McpPrompt,
  type McpPromptCategory,
} from './mcpPrompts';

// =============================================================================
// PromptsSection — curated starter prompts. Users browse by category, filter
// with the search box, and copy any prompt onto the clipboard with one click.
// The point isn't to enumerate every tool — it's to teach what's possible.
// =============================================================================

export function PromptsSection() {
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  const [query, setQuery] = useState('');
  const [activeCategory, setActiveCategory] = useState<McpPromptCategory | 'all'>('all');

  const visible = useMemo(
    () => filterPrompts(MCP_PROMPTS, query, activeCategory),
    [query, activeCategory],
  );

  return (
    <div className="mx-auto flex w-full max-w-3xl flex-col gap-4">
      <header>
        <h2 className="text-base font-medium text-text-primary">Prompts</h2>
        <p className="mt-1 text-xs text-text-muted">
          Starter prompts you can paste into any MCP-connected AI client to drive this workspace.
          Click any card to copy.
        </p>
      </header>

      <div className="flex flex-col gap-2">
        <div className="relative">
          <Search
            size={12}
            aria-hidden="true"
            className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-text-dim"
          />
          <input
            type="search"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search prompts…"
            aria-label="Search prompts"
            className="w-full rounded-sm border border-border bg-surface py-1.5 pl-7 pr-2 text-xs text-text-primary placeholder:text-text-dim focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        </div>
        <div role="tablist" aria-label="Prompt category" className="flex flex-wrap gap-1.5">
          <CategoryChip
            label="All"
            active={activeCategory === 'all'}
            count={MCP_PROMPTS.length}
            onClick={() => setActiveCategory('all')}
          />
          {MCP_PROMPT_CATEGORIES.map((c) => (
            <CategoryChip
              key={c.id}
              label={c.label}
              active={activeCategory === c.id}
              count={MCP_PROMPTS.filter((p) => p.category === c.id).length}
              onClick={() => setActiveCategory(c.id)}
            />
          ))}
        </div>
      </div>

      {visible.length === 0 ? (
        <div className="rounded-sm border border-dashed border-border-subtle bg-surface px-4 py-8 text-center text-xs text-text-dim">
          No prompts match your filter.
        </div>
      ) : (
        <ul className="flex flex-col gap-2">
          {visible.map((p) => (
            <PromptCard
              key={p.id}
              prompt={p}
              onCopySuccess={() =>
                pushToast({ tone: 'success', title: 'Prompt copied to clipboard' })
              }
            />
          ))}
        </ul>
      )}
    </div>
  );
}

function CategoryChip({
  label,
  active,
  count,
  onClick,
}: {
  label: string;
  active: boolean;
  count: number;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-sm border px-2 py-1 text-[0.6875rem] transition-colors',
        active
          ? 'border-accent/60 bg-accent/10 text-accent'
          : 'border-border-subtle text-text-muted hover:border-accent/40 hover:text-text-primary',
      )}
    >
      <span>{label}</span>
      <span className="text-[0.5625rem] text-text-dim">{count}</span>
    </button>
  );
}

function PromptCard({ prompt, onCopySuccess }: { prompt: McpPrompt; onCopySuccess: () => void }) {
  const [copied, setCopied] = useState(false);
  const handleCopy = async () => {
    if (!navigator.clipboard) return;
    await navigator.clipboard.writeText(prompt.text);
    setCopied(true);
    onCopySuccess();
    setTimeout(() => setCopied(false), 1500);
  };
  return (
    <li>
      <button
        type="button"
        onClick={() => void handleCopy()}
        aria-label={`Copy prompt: ${prompt.text}`}
        className={cn(
          'group flex w-full flex-col gap-1.5 rounded-sm border border-border-subtle bg-card p-3 text-left transition-colors',
          'hover:border-accent/40 hover:bg-accent/5 focus-visible:border-accent focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-accent/30',
        )}
      >
        <div className="flex items-start justify-between gap-3">
          <p className="text-xs text-text-primary">{prompt.text}</p>
          <span
            aria-hidden="true"
            className="inline-flex shrink-0 items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-[0.5625rem] text-text-muted group-hover:border-accent group-hover:text-accent"
          >
            {copied ? <Check size={9} /> : <Copy size={9} />}
            {copied ? 'Copied' : 'Copy'}
          </span>
        </div>
        <p className="text-[0.6875rem] text-text-dim">{prompt.description}</p>
        <div className="flex flex-wrap items-center gap-1">
          <span className="text-[0.5625rem] uppercase tracking-wider text-text-dim">Tools:</span>
          {prompt.tools.map((t) => (
            <code
              key={t}
              className="rounded-sm border border-border-subtle bg-surface px-1 py-0.5 text-[0.5625rem] text-text-muted"
            >
              {t}
            </code>
          ))}
        </div>
      </button>
    </li>
  );
}

function filterPrompts(
  prompts: ReadonlyArray<McpPrompt>,
  query: string,
  category: McpPromptCategory | 'all',
): ReadonlyArray<McpPrompt> {
  const q = query.trim().toLowerCase();
  return prompts.filter((p) => {
    if (category !== 'all' && p.category !== category) return false;
    if (!q) return true;
    return (
      p.text.toLowerCase().includes(q) ||
      p.description.toLowerCase().includes(q) ||
      p.tools.some((t) => t.toLowerCase().includes(q))
    );
  });
}
