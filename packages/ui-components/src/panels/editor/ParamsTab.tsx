// Params tab — three sub-tabs: Query (?key=value), Path ({foo}/:foo), Cookie.
// Query and Cookie reuse the generic KeyValueRows (no rich autocomplete
// needed); Path uses a custom row layout because the keys are derived from
// URL placeholders and only the value column is editable.

import { memo, useMemo, useState } from 'react';
import { Info } from 'lucide-react';
import type { Request as ApiRequest } from '@apicircle/shared';
import { findPathPlaceholders } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useVariableScope } from '../../editors/useVariableScope';
import { cn } from '../../primitives/cn';
import { DesktopAppLink } from '../../primitives/desktopDownload';
import { KeyValueRows } from './KeyValueRows';

/**
 * Detect at module scope whether we're running in a browser context. The
 * Cookie header is in Fetch's "forbidden header names" list — browsers
 * silently strip it from manually-crafted requests. The desktop (Electron)
 * and CLI runners use a non-restricted fetch impl, so they DO send the
 * Cookie header. We surface this distinction in the Cookie sub-tab.
 */
const IS_BROWSER_RUNTIME = (() => {
  if (typeof window === 'undefined' || typeof navigator === 'undefined') return false;
  // Electron exposes `process` even in renderer; treat that as not-pure-browser.
  const electronProcess = (window as { process?: { versions?: { electron?: string } } }).process;
  return typeof electronProcess?.versions?.electron !== 'string';
})();

interface ParamsTabProps {
  request: ApiRequest;
}

type ParamsSection = 'query' | 'path' | 'cookie';

// memo()'d so an unrelated EditorPanel parent re-render (toast push, theme
// change, etc.) doesn't recompute this tab's render tree when `request` is
// the same reference. The internal useWorkspaceStore subscriptions still
// trigger re-renders when THEIR specific slices change, which is what we
// want.
export const ParamsTab = memo(function ParamsTab({ request }: ParamsTabProps) {
  const setRequestQuery = useWorkspaceStore((s) => s.setRequestQuery);
  const setRequestPathParams = useWorkspaceStore((s) => s.setRequestPathParams);
  const setRequestCookies = useWorkspaceStore((s) => s.setRequestCookies);
  const scope = useVariableScope(request);

  const [section, setSection] = useState<ParamsSection>('query');
  const TAB_IDS = ['query', 'path', 'cookie'] as const;
  const selectedIndex = TAB_IDS.indexOf(section);

  /**
   * WAI-ARIA tablist arrow-key nav. Left/Right (and Up/Down for vertical
   * orientation parity) cycle the selection; Home/End jump to ends. Roving
   * tabindex on the buttons keeps Tab from bouncing through inactive tabs.
   */
  const onTablistKeyDown = (e: React.KeyboardEvent<HTMLDivElement>): void => {
    let next = selectedIndex;
    if (e.key === 'ArrowRight' || e.key === 'ArrowDown')
      next = (selectedIndex + 1) % TAB_IDS.length;
    else if (e.key === 'ArrowLeft' || e.key === 'ArrowUp')
      next = (selectedIndex - 1 + TAB_IDS.length) % TAB_IDS.length;
    else if (e.key === 'Home') next = 0;
    else if (e.key === 'End') next = TAB_IDS.length - 1;
    else return;
    e.preventDefault();
    setSection(TAB_IDS[next]);
    requestAnimationFrame(() => {
      const target = e.currentTarget.querySelector<HTMLElement>(`[data-tab-index="${next}"]`);
      target?.focus();
    });
  };

  const placeholders = useMemo(() => findPathPlaceholders(request.url), [request.url]);
  const pathParams = request.pathParams ?? {};
  const cookies = request.cookies ?? [];

  const counts = {
    query: request.query.length,
    path: placeholders.length,
    cookie: cookies.length,
  } as const;

  return (
    <div className="flex flex-col gap-3">
      <div
        role="tablist"
        aria-label="Param sections"
        className="flex gap-1"
        onKeyDown={onTablistKeyDown}
      >
        {TAB_IDS.map((id, idx) => (
          <button
            key={id}
            type="button"
            role="tab"
            // The visible label sits in a capitalize <span> (+ a count badge),
            // which left the tab with no computed accessible name — a screen
            // reader announced a bare "tab". Name it explicitly, mirroring the
            // visible "Query"/"Path"/"Cookie (n)" (UX audit S-007).
            aria-label={`${id[0].toUpperCase()}${id.slice(1)}${counts[id] > 0 ? ` (${counts[id]})` : ''}`}
            aria-selected={section === id}
            // Roving tabindex — only the selected tab is in the page tab
            // sequence; arrow keys move within the group.
            tabIndex={section === id ? 0 : -1}
            data-tab-index={idx}
            onClick={() => setSection(id)}
            className={cn(
              'inline-flex h-7 items-center gap-1.5 rounded-sm border px-2 text-[0.6875rem] transition-colors',
              section === id
                ? 'border-accent/60 bg-accent/10 text-text-primary'
                : 'border-border bg-surface text-text-muted hover:border-accent/40 hover:text-text-primary',
            )}
          >
            <span className="capitalize">{id}</span>
            {counts[id] > 0 && (
              <span className="inline-flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-card px-1 text-[0.625rem] leading-none tabular-nums text-text-dim">
                {counts[id]}
              </span>
            )}
          </button>
        ))}
      </div>

      {section === 'query' && (
        <KeyValueRows
          ariaLabel="Query"
          rows={request.query}
          onChange={(rows) => setRequestQuery(request.id, rows)}
          keyPlaceholder="Param key"
          valuePlaceholder="Param value"
          valueScope={scope}
        />
      )}

      {section === 'path' && (
        <PathParams
          placeholders={placeholders}
          values={pathParams}
          onChange={(next) => setRequestPathParams(request.id, next)}
        />
      )}

      {section === 'cookie' && (
        <div className="flex flex-col gap-2">
          {IS_BROWSER_RUNTIME && (
            <aside
              role="status"
              aria-label="Cookie browser limitation"
              className="flex items-start gap-2 rounded-sm border border-amber/40 bg-amber/5 px-2.5 py-2 text-[0.6875rem] text-text-muted"
            >
              <Info size={12} className="mt-0.5 shrink-0 text-amber" />
              <div>
                <p className="text-text-primary">
                  The browser strips the <code>Cookie</code> header from web requests (it&rsquo;s a
                  &ldquo;forbidden header name&rdquo; per the Fetch spec).
                </p>
                <p className="mt-1">
                  Cookies you add here are still saved on the request and{' '}
                  <em className="not-italic text-text-primary">will be sent</em> by the{' '}
                  <DesktopAppLink /> and CLI runner. The browser&rsquo;s own cookie jar (e.g.
                  cookies set by a previous response) goes along automatically when the request is{' '}
                  <code>credentials: 'include'</code>.
                </p>
              </div>
            </aside>
          )}
          <KeyValueRows
            ariaLabel="Cookies"
            rows={cookies}
            onChange={(rows) => setRequestCookies(request.id, rows)}
            keyPlaceholder="Cookie name"
            valuePlaceholder="Cookie value"
            valueScope={scope}
          />
        </div>
      )}
    </div>
  );
});

interface PathParamsProps {
  placeholders: string[];
  values: Record<string, string>;
  onChange: (next: Record<string, string>) => void;
}

function PathParams({ placeholders, values, onChange }: PathParamsProps) {
  const update = (name: string, value: string) => onChange({ ...values, [name]: value });

  if (placeholders.length === 0) {
    return (
      <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
        No path placeholders in the URL. Use <code className="text-text-primary">{':name'}</code> or{' '}
        <code className="text-text-primary">{'{name}'}</code> to declare one.
      </p>
    );
  }

  // Surface stored values that no longer correspond to a placeholder so the
  // user can clean them up (instead of silently retaining stale data).
  const orphans = Object.keys(values).filter((k) => !placeholders.includes(k));

  return (
    <div role="group" aria-label="Path params" className="flex flex-col gap-1">
      {placeholders.map((name) => (
        <div key={name} className="flex items-center gap-2">
          <code className="h-7 flex-1 rounded-sm border border-border-subtle bg-card px-2 py-[5px] font-mono text-xs text-text-primary">
            {`{${name}}`}
          </code>
          <input
            type="text"
            value={values[name] ?? ''}
            onChange={(e) => update(name, e.target.value)}
            placeholder={`Value for ${name}`}
            aria-label={`Path param ${name} value`}
            className="h-7 flex-[2] rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        </div>
      ))}
      {orphans.length > 0 && (
        <aside className="mt-2 rounded-sm border border-amber/30 bg-amber/5 px-3 py-2 text-[0.6875rem]">
          <p className="text-amber">Stored values without a matching placeholder:</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {orphans.map((k) => (
              <button
                key={k}
                type="button"
                onClick={() => {
                  const next = { ...values };
                  delete next[k];
                  onChange(next);
                }}
                className="inline-flex items-center gap-1 rounded-sm border border-border bg-surface px-1.5 py-0.5 text-text-muted hover:border-amber hover:text-text-primary"
                aria-label={`Forget unused path param ${k}`}
                title="Click to forget"
              >
                <code className="text-text-primary">{k}</code>
                <span className="text-text-dim">×</span>
              </button>
            ))}
          </div>
        </aside>
      )}
      <p className="mt-2 text-[0.6875rem] text-text-dim">
        Values are URL-encoded at send time. Variables (<code>{'{{NAME}}'}</code>) are not yet
        expanded inside path placeholders — paste literal values for now.
      </p>
    </div>
  );
}
