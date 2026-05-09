import { useMemo } from 'react';
import { AlertTriangle, Variable } from 'lucide-react';
import type { Request as ApiRequest, RequestBody } from '@apicircle/shared';
import { collectVariableSuggestions, type ResolutionScope } from '@apicircle/core';
import { cn } from '../primitives/cn';
import { useWorkspaceStore } from '../store/workspaceStore';

const PLACEHOLDER = /\{\{\s*([A-Za-z_][\w.-]*)\s*\}\}/g;

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

interface VariableHintsProps {
  /**
   * Optional. When present, the trigger surfaces an "unresolved references"
   * warning chip for any `{{name}}` used by this request that the scope
   * doesn't define. Omit for global / non-request triggers — only the
   * count + dock-open trigger renders.
   */
  request?: ApiRequest;
  scope: ResolutionScope;
  /** Optional label override for the trigger button when there's no request context. */
  triggerLabel?: string;
}

/**
 * Inline trigger that opens the right-side dock on the Variables tab. The
 * trigger itself is context-aware: it shows the available variable count
 * for the supplied scope, and (when a `request` is present) flags any
 * `{{name}}` references the scope doesn't resolve.
 */
export function VariableHints({ request, scope, triggerLabel }: VariableHintsProps) {
  const openDockTab = useWorkspaceStore((s) => s.openRightDockTab);
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);

  const suggestions = useMemo(() => collectVariableSuggestions(scope), [scope]);
  const referenced = useMemo(() => (request ? collectReferencedNames(request) : []), [request]);
  const knownNames = useMemo(() => new Set(suggestions.map((s) => s.key)), [suggestions]);
  const unresolved = referenced.filter((n) => !knownNames.has(n));

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center gap-2">
        <button
          type="button"
          onClick={() => openDockTab('variables')}
          className={cn(
            'inline-flex h-7 items-center gap-1 rounded-sm border px-2 text-[11px] transition-colors',
            'border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary',
          )}
          aria-label="Show available variables in the right dock"
          aria-haspopup="dialog"
        >
          <Variable size={12} />
          {triggerLabel ??
            `${suggestions.length} variable${suggestions.length === 1 ? '' : 's'} available`}
        </button>
        {unresolved.length > 0 && (
          <button
            type="button"
            onClick={() => setActivePanel('env')}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-amber/40 bg-amber/10 px-2 text-[11px] text-amber hover:bg-amber/20"
            aria-label="Open Environments to fix unresolved variables"
            title="Click to open Environments and define these variables"
          >
            <AlertTriangle size={12} />
            {unresolved.length} unresolved: {unresolved.slice(0, 3).join(', ')}
            {unresolved.length > 3 ? `, +${unresolved.length - 3}` : ''}
          </button>
        )}
      </div>
    </div>
  );
}
