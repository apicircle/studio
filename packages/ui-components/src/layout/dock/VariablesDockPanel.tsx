// Variables tab content for the right-side dock. Read-mostly reference
// list — the user filters by name/value and copies `{{name}}` tokens into
// whatever editor surface they're typing in. Active-panel-aware via
// `useActiveVariableScope`: editor shows request-bound vars, execution
// shows plan-bound, etc.

import { useEffect, useMemo, useRef, useState } from 'react';
import { AlertTriangle, Copy, Variable } from 'lucide-react';
import type { Request as ApiRequest, RequestBody } from '@apicircle/shared';
import { collectVariableSuggestions, type VariableSuggestion } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useActiveVariableScope } from '../../editors/useVariableScope';

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

const SOURCE_LABEL: Record<VariableSuggestion['source'], string> = {
  context: 'Context vars',
  'active-env': 'Active env',
  'priority-env': 'Global layer',
  secret: 'Vault secrets',
};

const SOURCE_HINT: Record<VariableSuggestion['source'], string> = {
  context: 'Per-request, pushed to Git via the Context tab.',
  'active-env': 'From the legacy active environment (deprecated).',
  'priority-env': 'From the prioritized environment layer (sidebar order wins).',
  secret: 'Names from your local Secret Vault — values stay local.',
};

function bodyText(body: RequestBody): string {
  if (
    body.type === 'json' ||
    body.type === 'text' ||
    body.type === 'xml' ||
    body.type === 'graphql' ||
    body.type === 'urlencoded'
  ) {
    return body.content ?? '';
  }
  return '';
}

function collectReferencedNames(request: ApiRequest): string[] {
  const sources: string[] = [request.url];
  for (const h of request.headers) sources.push(h.key, h.value);
  for (const q of request.query) sources.push(q.key, q.value);
  sources.push(bodyText(request.body));
  const found = new Set<string>();
  for (const text of sources) {
    if (!text) continue;
    PLACEHOLDER.lastIndex = 0;
    let match: RegExpExecArray | null;
    while ((match = PLACEHOLDER.exec(text)) !== null) {
      found.add(match[1]);
    }
  }
  return [...found];
}

export function VariablesDockPanel() {
  const scope = useActiveVariableScope();
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const activeRequestId = useWorkspaceStore((s) => s.local?.ui.activeRequestId ?? null);
  const activeRequest = useWorkspaceStore((s) =>
    activeRequestId ? (s.synced?.collections.requests[activeRequestId] ?? null) : null,
  );

  // Only highlight unresolved when we're in the editor — that's where a
  // request the user is editing makes the cue actionable.
  const requestForUnresolved = activePanel === 'editor' ? activeRequest : null;

  const [filter, setFilter] = useState('');
  const [copied, setCopied] = useState<string | null>(null);
  const searchRef = useRef<HTMLInputElement | null>(null);

  // Auto-focus the filter when the dock first becomes visible — saves a
  // click, keeps keyboard users in the flow.
  useEffect(() => {
    searchRef.current?.focus();
  }, []);

  const suggestions = useMemo(() => collectVariableSuggestions(scope), [scope]);
  const referenced = useMemo(
    () => (requestForUnresolved ? collectReferencedNames(requestForUnresolved) : []),
    [requestForUnresolved],
  );
  const knownNames = useMemo(() => new Set(suggestions.map((s) => s.key)), [suggestions]);
  const unresolved = referenced.filter((n) => !knownNames.has(n));

  const grouped = useMemo(() => {
    const map = new Map<VariableSuggestion['source'], VariableSuggestion[]>();
    for (const s of suggestions) {
      const list = map.get(s.source) ?? [];
      list.push(s);
      map.set(s.source, list);
    }
    return map;
  }, [suggestions]);

  const filtered = useMemo(() => {
    const q = filter.trim().toLowerCase();
    if (!q) return grouped;
    const out = new Map<VariableSuggestion['source'], VariableSuggestion[]>();
    for (const [src, list] of grouped) {
      const matched = list.filter(
        (s) => s.key.toLowerCase().includes(q) || (s.preview ?? '').toLowerCase().includes(q),
      );
      if (matched.length > 0) out.set(src, matched);
    }
    return out;
  }, [grouped, filter]);

  const totalFiltered = [...filtered.values()].reduce((acc, l) => acc + l.length, 0);

  const copy = async (key: string) => {
    const token = `{{${key}}}`;
    try {
      await navigator.clipboard.writeText(token);
      setCopied(key);
      window.setTimeout(() => setCopied((c) => (c === key ? null : c)), 1200);
    } catch {
      // Clipboard may be unavailable (insecure context); silently ignore.
    }
  };

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="border-b border-border-subtle px-3 py-2">
        <input
          ref={searchRef}
          type="search"
          value={filter}
          onChange={(e) => setFilter(e.target.value)}
          placeholder="Filter by name or value…"
          aria-label="Filter variables"
          className="h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
      </div>

      <div className="min-h-0 flex-1 overflow-y-auto px-3 py-3">
        {suggestions.length === 0 ? (
          <EmptyState onOpenEnvironments={() => setActivePanel('env')} />
        ) : totalFiltered === 0 ? (
          <p className="px-1 py-4 text-center text-xs text-text-dim">
            No variables match &ldquo;{filter}&rdquo;.
          </p>
        ) : (
          <div className="flex flex-col gap-4">
            {(['context', 'priority-env', 'active-env', 'secret'] as const).map((src) => {
              const list = filtered.get(src) ?? [];
              if (list.length === 0) return null;
              return (
                <section key={src} className="flex flex-col gap-1.5">
                  <header className="flex items-baseline justify-between gap-2">
                    <h3 className="text-[10px] font-medium uppercase tracking-wider text-text-dim">
                      {SOURCE_LABEL[src]}
                    </h3>
                    <span className="text-[10px] text-text-faint">{list.length}</span>
                  </header>
                  <p className="text-[10px] text-text-faint">{SOURCE_HINT[src]}</p>
                  <ul className="flex flex-col gap-0.5">
                    {list.map((s) => (
                      <li key={s.key}>
                        <button
                          type="button"
                          onClick={() => void copy(s.key)}
                          aria-label={`Copy {{${s.key}}}`}
                          className="group flex w-full items-center justify-between gap-2 rounded-sm border border-transparent px-2 py-1 text-left hover:border-border-subtle hover:bg-card"
                        >
                          <code className="truncate text-[11px] text-text-primary">{`{{${s.key}}}`}</code>
                          <span
                            className="ml-2 flex-1 truncate text-right text-[10px] text-text-dim"
                            title={s.preview}
                          >
                            {s.preview || '(empty)'}
                          </span>
                          {copied === s.key ? (
                            <span className="text-[10px] text-accent">Copied</span>
                          ) : (
                            <Copy
                              size={11}
                              className="text-text-faint opacity-0 transition-opacity group-hover:opacity-100"
                            />
                          )}
                        </button>
                      </li>
                    ))}
                  </ul>
                </section>
              );
            })}
          </div>
        )}
      </div>

      {unresolved.length > 0 && (
        <footer className="border-t border-border-subtle bg-card px-3 py-2">
          <div className="flex items-start gap-2">
            <AlertTriangle size={14} className="mt-0.5 shrink-0 text-amber" />
            <div className="flex-1">
              <p className="text-[11px] font-medium text-text-primary">
                {unresolved.length} unresolved reference{unresolved.length === 1 ? '' : 's'}
              </p>
              <p className="mt-0.5 break-words text-[10px] text-text-muted">
                {unresolved.slice(0, 6).join(', ')}
                {unresolved.length > 6 ? `, +${unresolved.length - 6} more` : ''}
              </p>
              <button
                type="button"
                onClick={() => setActivePanel('env')}
                className="mt-2 inline-flex h-6 items-center gap-1 rounded-sm border border-amber/40 bg-amber/10 px-2 text-[10px] text-amber hover:bg-amber/20"
              >
                Define in Environments
              </button>
            </div>
          </div>
        </footer>
      )}
    </div>
  );
}

function EmptyState({ onOpenEnvironments }: { onOpenEnvironments: () => void }) {
  return (
    <div className="flex flex-col items-center gap-3 px-2 py-6 text-center">
      <Variable size={20} className="text-text-faint" />
      <p className="text-xs text-text-muted">
        No variables defined yet. Add them in the Context tab, an environment, or the Secret Vault.
      </p>
      <button
        type="button"
        onClick={onOpenEnvironments}
        className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[11px] text-accent hover:bg-accent/20"
      >
        Open Environments
      </button>
    </div>
  );
}
