// Read-only quick-view of a request, opened from the execution plan step
// rows. Renders a right-side drawer with the same conceptual sections the
// Editor exposes (URL, params, headers, auth, body, context, assertions) but
// flattened and non-editable — the user just wants to see what the step will
// send, not edit it.
//
// Opening this modal does NOT navigate to the editor or change activeRequest.
// To edit, the user clicks "Open in Editor" (jumps + sets active).

import { useEffect, useMemo } from 'react';
import { ExternalLink, Shield, X } from 'lucide-react';
import type { Request as ApiRequest } from '@apicircle/shared';
import { applyPathParams, composeCookieHeader, composeUrl } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';

interface RequestQuickViewProps {
  request: ApiRequest;
  /** Source workspace label for linked steps; absent for local requests. */
  linkedWorkspaceName?: string;
  /** Set when the request belongs to the user's local workspace and clicking
   * "Open in Editor" makes sense. Absent for linked-snapshot requests. */
  localOpenable?: boolean;
  onClose: () => void;
}

const SECTION_TITLE = 'mb-1 text-[10px] font-medium uppercase tracking-wider text-text-dim';
const ROW = 'grid grid-cols-[120px_1fr] gap-2 py-0.5 text-[11px]';
const KEY = 'truncate text-text-muted';
const VALUE = 'truncate font-mono text-text-primary';

export function RequestQuickView({
  request,
  linkedWorkspaceName,
  localOpenable = false,
  onClose,
}: RequestQuickViewProps) {
  const setActivePanel = useWorkspaceStore((s) => s.setActivePanel);
  const setActiveRequestId = useWorkspaceStore((s) => s.setActiveRequestId);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  const effectiveUrl = useMemo(() => {
    const withPath = applyPathParams(request.url, request.pathParams ?? {});
    return composeUrl(withPath, request.query);
  }, [request.url, request.pathParams, request.query]);
  const cookieHeader = useMemo(() => composeCookieHeader(request.cookies ?? []), [request.cookies]);

  const enabledHeaders = request.headers.filter((h) => h.enabled);
  const enabledQuery = request.query.filter((q) => q.enabled);
  const pathEntries = Object.entries(request.pathParams ?? {});
  const enabledCookies = (request.cookies ?? []).filter((c) => c.enabled);

  const goToEditor = () => {
    setActiveRequestId(request.id);
    setActivePanel('editor');
    onClose();
  };

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/30 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label={`Quick view: ${request.name}`}
        className="fixed right-0 top-0 z-50 flex h-full w-full max-w-xl flex-col border-l border-border bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="flex min-w-0 flex-1 items-center gap-2">
            <span className="shrink-0 rounded-sm border border-border bg-card px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
              Quick view
            </span>
            <h2 className="truncate text-sm font-medium text-text-primary">{request.name}</h2>
            {linkedWorkspaceName && (
              <span className="shrink-0 rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] uppercase tracking-wider text-accent">
                from {linkedWorkspaceName}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            {localOpenable && (
              <button
                type="button"
                onClick={goToEditor}
                className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
                title="Open this request in the Editor"
              >
                <ExternalLink size={11} />
                Open in Editor
              </button>
            )}
            <button
              type="button"
              onClick={onClose}
              aria-label="Close"
              title="Close (Esc)"
              className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-card hover:text-text-primary"
            >
              <X size={14} />
            </button>
          </div>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto p-4">
          <Section title="Endpoint">
            <div className={ROW}>
              <span className={KEY}>Method</span>
              <span className={VALUE}>{request.method}</span>
            </div>
            <div className={ROW}>
              <span className={KEY}>URL</span>
              <span className={cn(VALUE, 'whitespace-pre-wrap break-all')}>{request.url}</span>
            </div>
            {effectiveUrl !== request.url && (
              <div className={ROW}>
                <span className={KEY}>Effective URL</span>
                <span className={cn(VALUE, 'whitespace-pre-wrap break-all text-text-muted')}>
                  {effectiveUrl}
                </span>
              </div>
            )}
          </Section>

          {(enabledQuery.length > 0 || pathEntries.length > 0 || enabledCookies.length > 0) && (
            <Section title="Params">
              {enabledQuery.length > 0 && (
                <KvList label="Query" rows={enabledQuery.map((r) => [r.key, r.value])} />
              )}
              {pathEntries.length > 0 && (
                <KvList label="Path" rows={pathEntries.map(([k, v]) => [`{${k}}`, v])} />
              )}
              {enabledCookies.length > 0 && (
                <>
                  <KvList label="Cookies" rows={enabledCookies.map((c) => [c.key, c.value])} />
                  <div className={ROW}>
                    <span className={KEY}>Cookie header</span>
                    <span className={cn(VALUE, 'break-all')}>{cookieHeader}</span>
                  </div>
                </>
              )}
            </Section>
          )}

          {enabledHeaders.length > 0 && (
            <Section title="Headers">
              <KvList rows={enabledHeaders.map((h) => [h.key, h.value])} />
            </Section>
          )}

          <Section title="Auth">
            <div className={ROW}>
              <span className={KEY}>Type</span>
              <span className="flex items-center gap-1 text-[11px]">
                {request.auth.type === 'inherit' && <Shield size={11} className="text-accent" />}
                <span className="font-mono text-text-primary">{request.auth.type}</span>
                {request.auth.type === 'inherit' && (
                  <span className="text-text-dim">(resolved from parent folder at send time)</span>
                )}
              </span>
            </div>
            <AuthSummary auth={request.auth} />
          </Section>

          {request.body.type !== 'none' && (
            <Section title="Body">
              <div className={ROW}>
                <span className={KEY}>Type</span>
                <span className={VALUE}>{request.body.type}</span>
              </div>
              {(request.body.type === 'json' ||
                request.body.type === 'text' ||
                request.body.type === 'xml' ||
                request.body.type === 'graphql' ||
                request.body.type === 'urlencoded') &&
                request.body.content && (
                  <pre className="mt-1 max-h-48 overflow-auto rounded-sm border border-border bg-card p-2 font-mono text-[10px] text-text-primary">
                    {request.body.content}
                  </pre>
                )}
              {request.body.type === 'graphql' && request.body.variables && (
                <>
                  <p className="mt-2 text-[10px] uppercase tracking-wider text-text-dim">
                    Variables
                  </p>
                  <pre className="max-h-32 overflow-auto rounded-sm border border-border bg-card p-2 font-mono text-[10px] text-text-primary">
                    {request.body.variables}
                  </pre>
                </>
              )}
              {request.body.type === 'form-data' && (
                <KvList
                  rows={(request.body.formRows ?? []).map((r) =>
                    r.kind === 'text'
                      ? [r.key, r.value]
                      : [r.key, `(file: slot ${r.slotId ?? '—'})`],
                  )}
                />
              )}
              {request.body.type === 'binary' && (
                <p className="text-[11px] text-text-muted">
                  Binary attachment ({request.body.attachment?.slotId ?? 'none'})
                </p>
              )}
            </Section>
          )}

          {request.contextVars.length > 0 && (
            <Section title="Context vars">
              <KvList rows={request.contextVars.map((v) => [v.key, v.value || '(empty)'])} />
            </Section>
          )}

          {request.extractions.length > 0 && (
            <Section title="Extractions">
              <ul className="flex flex-col gap-0.5">
                {request.extractions.map((ex) => (
                  <li key={ex.id} className="text-[11px]">
                    <code className="text-text-primary">{`{{${ex.variable || '—'}}}`}</code>
                    <span className="ml-1 text-text-dim">←</span>
                    <span className="ml-1 font-mono text-text-muted">
                      {ex.source}
                      {ex.path && `: ${ex.path}`}
                    </span>
                    {!ex.enabled && (
                      <span className="ml-1 text-[10px] text-text-faint">(disabled)</span>
                    )}
                  </li>
                ))}
              </ul>
            </Section>
          )}

          {request.assertions.length > 0 && (
            <Section title="Assertions">
              <ul className="flex flex-col gap-0.5">
                {request.assertions.map((a) => (
                  <li key={a.id} className="text-[11px] font-mono text-text-primary">
                    <span className="text-text-muted">{a.kind}</span>
                    {a.target && <span className="text-text-dim"> · {a.target}</span>}
                    <span className="text-text-dim"> {a.op} </span>
                    <span>{String(a.expected)}</span>
                  </li>
                ))}
              </ul>
            </Section>
          )}
        </div>
      </div>
    </>
  );
}

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="mb-4 rounded-sm border border-border-subtle bg-card p-3">
      <h3 className={SECTION_TITLE}>{title}</h3>
      <div className="flex flex-col">{children}</div>
    </section>
  );
}

function KvList({ rows, label }: { rows: Array<[string, string]>; label?: string }) {
  if (rows.length === 0) return null;
  return (
    <div className="flex flex-col">
      {label && <p className="mt-1 text-[10px] uppercase tracking-wider text-text-dim">{label}</p>}
      {rows.map(([k, v], i) => (
        <div key={`${k}-${i}`} className={ROW}>
          <span className={KEY}>{k || '(empty)'}</span>
          <span className={cn(VALUE, 'break-all')}>{v || '(empty)'}</span>
        </div>
      ))}
    </div>
  );
}

function AuthSummary({ auth }: { auth: ApiRequest['auth'] }) {
  // Print non-secret fields so the user can confirm config without unmasking
  // any values. We deliberately don't print tokens / passwords / secret keys.
  const visible: Record<string, string> = {};
  for (const [k, v] of Object.entries(auth)) {
    if (k === 'type') continue;
    if (typeof v !== 'string' || v.length === 0) continue;
    if (
      k === 'token' ||
      k === 'password' ||
      k === 'secretAccessKey' ||
      k === 'secretOrKey' ||
      k === 'codeVerifier' ||
      k === 'accessToken' ||
      k === 'refreshToken' ||
      k === 'hawkKey' ||
      k === 'value' // api-key value column
    ) {
      visible[k] = '••••';
      continue;
    }
    visible[k] = v;
  }
  if (Object.keys(visible).length === 0) return null;
  return (
    <div className="mt-1 flex flex-col">
      {Object.entries(visible).map(([k, v]) => (
        <div key={k} className={ROW}>
          <span className={KEY}>{k}</span>
          <span className={cn(VALUE, 'break-all')}>{v}</span>
        </div>
      ))}
    </div>
  );
}
