import { useEffect, useMemo, useRef, useState } from 'react';
import { Cookie, Send } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { HttpMethod, Request as ApiRequest } from '@apicircle/shared';
import {
  applyPathParams,
  composeCookieHeader,
  composeUrl,
  composeUrlWithQuery,
  parseUrlQuery,
  type ResolutionScope,
  resolveString,
} from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { ParamsTab } from './ParamsTab';
import { HeadersTab } from './HeadersTab';
import { BodyTab } from './BodyTab';
import { AssertionsTab } from './AssertionsTab';
import { AuthTab } from './AuthTab';
import { ContextTab } from './ContextTab';
import { ResponseViewer } from './ResponseViewer';
import { VariableAutocompleteField } from '../../editors/VariableAutocompleteField';
import { useVariableScope } from '../../editors/useVariableScope';

const METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];
const METHOD_COLOR: Record<HttpMethod, string> = {
  GET: 'text-http-get',
  POST: 'text-http-post',
  PUT: 'text-http-put',
  PATCH: 'text-http-patch',
  DELETE: 'text-http-delete',
  HEAD: 'text-http-head',
  OPTIONS: 'text-http-options',
};
// Native <option> elements ignore Tailwind text-* classes (they render outside
// the React tree under OS shell control), so we drive colors via inline style.
// CSS vars hold raw RGB triples (`103 212 138`) so they can carry alpha into
// Tailwind's `rgb(var(--x) / <alpha>)`; the inline style needs the rgb() wrap.
const METHOD_OPTION_COLOR: Record<HttpMethod, string> = {
  GET: 'rgb(var(--http-get))',
  POST: 'rgb(var(--http-post))',
  PUT: 'rgb(var(--http-put))',
  PATCH: 'rgb(var(--http-patch))',
  DELETE: 'rgb(var(--http-delete))',
  HEAD: 'rgb(var(--http-head))',
  OPTIONS: 'rgb(var(--http-options))',
};

type Tab = 'params' | 'headers' | 'auth' | 'body' | 'context' | 'assertions';

function paramsTotalForRequest(req: {
  query: ReadonlyArray<unknown>;
  pathParams?: Record<string, string>;
  cookies?: ReadonlyArray<unknown>;
}): number {
  return req.query.length + Object.keys(req.pathParams ?? {}).length + (req.cookies?.length ?? 0);
}

/**
 * Read-only one-line preview of the assembled URL + Cookie header. Updates
 * live as the user edits Query / Path / Cookie sub-tabs and as variables
 * change. We resolve `{{NAME}}` against the same scope used by autocomplete:
 * context vars, prioritized environment layer, and vault secret labels (the
 * latter shown as `••••` since the popup never has plaintext).
 *
 * The preview is best-effort — it doesn't perform the full async decrypt
 * that runs at send time. What you see here matches what `resolveRequest`
 * would produce for the public surface.
 */
function EffectiveRequestPreview({
  request,
  scope,
}: {
  request: ApiRequest;
  scope: ResolutionScope;
}) {
  // Resolve nested values: pathParams, query rows, cookie rows, and the URL
  // itself. Anything that fails to resolve falls back to the literal token —
  // resolveString already does that, so unresolved {{X}} stays visible.
  const effectiveUrl = useMemo(() => {
    const resolvedRaw = resolveString(request.url, scope).value;
    const resolvedPathParams: Record<string, string> = {};
    for (const [k, v] of Object.entries(request.pathParams ?? {})) {
      resolvedPathParams[k] = resolveString(v, scope).value;
    }
    const withPath = applyPathParams(resolvedRaw, resolvedPathParams);
    const resolvedQuery = request.query.map((q) => ({
      ...q,
      key: resolveString(q.key, scope).value,
      value: resolveString(q.value, scope).value,
    }));
    return composeUrl(withPath, resolvedQuery);
  }, [request.url, request.pathParams, request.query, scope]);

  const cookieValue = useMemo(() => {
    const resolved = (request.cookies ?? []).map((c) => ({
      ...c,
      key: resolveString(c.key, scope).value,
      value: resolveString(c.value, scope).value,
    }));
    return composeCookieHeader(resolved);
  }, [request.cookies, scope]);

  const urlChanged = effectiveUrl !== request.url;
  if (!urlChanged && !cookieValue) return null;

  return (
    <div className="flex flex-col gap-0.5 rounded-sm border border-border-subtle bg-card px-2 py-1.5 font-mono text-[11px] text-text-muted">
      {urlChanged && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-dim">
            Effective URL
          </span>
          <span className="truncate" title={effectiveUrl}>
            {effectiveUrl}
          </span>
        </div>
      )}
      {cookieValue && (
        <div className="flex items-center gap-2">
          <Cookie size={11} className="shrink-0 text-text-dim" />
          <span className="shrink-0 text-[10px] uppercase tracking-wider text-text-dim">
            Cookie
          </span>
          <span className="truncate" title={cookieValue}>
            {cookieValue}
          </span>
        </div>
      )}
    </div>
  );
}

function authBadge(type: string): string {
  switch (type) {
    case 'bearer':
      return 'Bearer';
    case 'basic':
      return 'Basic';
    case 'api-key':
      return 'API Key';
    case 'custom-header':
      return 'Header';
    case 'aws-sigv4':
      return 'SigV4';
    case 'jwt-bearer':
      return 'JWT';
    case 'inherit':
      return 'Inherit';
    case 'digest':
    case 'ntlm':
    case 'hawk':
      return type.toUpperCase();
    default:
      if (type.startsWith('oauth2-')) return 'OAuth2';
      return '';
  }
}

export function EditorPanel() {
  const activeRequestId = useWorkspaceStore((s) => s.local?.ui.activeRequestId ?? null);
  const request = useWorkspaceStore((s) =>
    activeRequestId ? (s.synced?.collections.requests[activeRequestId] ?? null) : null,
  );
  const setRequestMethod = useWorkspaceStore((s) => s.setRequestMethod);
  const setRequestUrl = useWorkspaceStore((s) => s.setRequestUrl);
  const setRequestQuery = useWorkspaceStore((s) => s.setRequestQuery);
  const executeActiveRequest = useWorkspaceStore((s) => s.executeActiveRequest);
  const isExecuting = useWorkspaceStore((s) =>
    activeRequestId ? (s.isExecuting[activeRequestId] ?? false) : false,
  );
  const lastRun = useWorkspaceStore((s) =>
    activeRequestId ? (s.lastRun[activeRequestId] ?? null) : null,
  );
  const lastHistoryRun = useWorkspaceStore(
    (s) => s.local?.history.requestRuns.find((r) => r.requestId === activeRequestId) ?? null,
  );

  const [tab, setTab] = useState<Tab>('params');
  // Surfaced when the user pastes a `curl …` blob into the URL bar — they
  // can confirm or dismiss before it overwrites the request.
  const [pendingCurlPaste, setPendingCurlPaste] = useState<string | null>(null);
  const addRequestFromCurl = useWorkspaceStore((s) => s.addRequestFromCurl);
  const scope = useVariableScope(request);

  // One-shot reconciliation when a request opens whose URL still contains a
  // `?key=val` portion. The two-way URL↔Query sync stores the *base* in
  // `request.url` and rows in `request.query`, so on first observation we
  // split any embedded query into the structured field and trim the URL.
  // Idempotent: subsequent renders see no `?` in `request.url` and skip.
  useEffect(() => {
    if (!request) return;
    if (!request.url.includes('?')) return;
    const { base, query } = parseUrlQuery(request.url);
    if (base === request.url) return;
    const disabled = request.query.filter((r) => !r.enabled);
    setRequestUrl(request.id, base);
    setRequestQuery(request.id, [...query, ...disabled]);
    // Run only when the active request id changes — re-running on every URL
    // mutation would loop with the setRequestUrl call above.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [request?.id]);

  if (!request) {
    return (
      <div className="flex h-full items-center justify-center text-sm text-text-muted">
        Select a request from the sidebar, or create a new one.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col">
      <header className="flex flex-col gap-2 border-b border-border-subtle p-3">
        <RequestNameInput requestId={request.id} initial={request.name} />
        <div className="flex items-center gap-2">
          <select
            value={request.method}
            onChange={(e) => setRequestMethod(request.id, e.target.value as HttpMethod)}
            aria-label="HTTP method"
            className={cn(
              'h-9 rounded-sm border border-border bg-card px-2 text-xs font-medium',
              METHOD_COLOR[request.method],
            )}
          >
            {METHODS.map((m) => (
              <option key={m} value={m} style={{ color: METHOD_OPTION_COLOR[m] }}>
                {m}
              </option>
            ))}
          </select>
          <div className="flex-1">
            <VariableAutocompleteField
              value={composeUrlWithQuery(request.url, request.query)}
              onChange={(v) => {
                // Quick paste-cURL detection: if the user pastes a string
                // starting with `curl `, route through the cURL importer
                // instead of trying to parse it as a URL. The pasted string
                // becomes a fresh request created in the active folder.
                const trimmed = v.trim();
                if (
                  trimmed.length > 5 &&
                  /^curl\s/i.test(trimmed) &&
                  // Only when this is a paste, not a slow-typed `curl `: the
                  // length jumped past a threshold in one onChange.
                  trimmed.length - composeUrlWithQuery(request.url, request.query).length > 10
                ) {
                  setPendingCurlPaste(trimmed);
                  return;
                }
                // Two-way URL ↔ Query Params sync. The URL field shows the
                // composed URL (base + query). When the user edits it, we
                // re-split: anything before `?` lands in `request.url`, and
                // anything after becomes `request.query` rows. Disabled rows
                // present in the previous state are preserved at the tail —
                // the URL is the source of truth for *enabled* rows only.
                const { base, query } = parseUrlQuery(v);
                const disabledRows = request.query.filter((r) => !r.enabled);
                setRequestUrl(request.id, base);
                setRequestQuery(request.id, [...query, ...disabledRows]);
              }}
              scope={scope}
              ariaLabel="Request URL"
              placeholder="https://api.example.com/v1"
              className="h-9 px-3 text-sm focus:ring-2"
            />
          </div>
          <button
            type="button"
            onClick={() => void executeActiveRequest()}
            disabled={isExecuting}
            title="Sends with the active environment + secrets resolved (Ctrl/Cmd+Enter)."
            className="inline-flex h-9 items-center gap-2 rounded-sm border border-accent/40 bg-accent/15 px-4 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
          >
            <Send size={14} />
            {isExecuting ? 'Sending…' : 'Send'}
          </button>
        </div>
        <EffectiveRequestPreview request={request} scope={scope} />
        {pendingCurlPaste && (
          <CurlPasteConfirm
            curl={pendingCurlPaste}
            onConfirm={() => {
              addRequestFromCurl(pendingCurlPaste, request.folderId);
              setPendingCurlPaste(null);
            }}
            onDismiss={() => setPendingCurlPaste(null)}
          />
        )}
      </header>

      <div className="flex border-b border-border-subtle px-2">
        {(['params', 'headers', 'auth', 'body', 'context', 'assertions'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'h-9 border-b-2 px-3 text-xs transition-colors',
              tab === t
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary',
            )}
            aria-current={tab === t ? 'page' : undefined}
          >
            {t === 'params' &&
              `Params${
                paramsTotalForRequest(request) > 0 ? ` (${paramsTotalForRequest(request)})` : ''
              }`}
            {t === 'headers' &&
              `Headers${request.headers.length ? ` (${request.headers.length})` : ''}`}
            {t === 'auth' &&
              `Auth${request.auth && request.auth.type !== 'none' ? ` · ${authBadge(request.auth.type)}` : ''}`}
            {t === 'body' && 'Body'}
            {t === 'context' &&
              `Context${request.contextVars.length + request.extractions.length > 0 ? ` (${request.contextVars.length + request.extractions.length})` : ''}`}
            {t === 'assertions' &&
              `Assertions${request.assertions.length ? ` (${request.assertions.length})` : ''}`}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {/*
         * Response pane only mounts once a request has actually been
         * executed (or is currently executing). Switching to a different
         * request hides it again until the user hits Send. The user's
         * drag position persists via autoSaveId, so re-opening the panel
         * (Send on any request) restores their preferred ratio.
         */}
        {!lastRun && !isExecuting ? (
          <div
            className={cn(
              'flex h-full min-h-0 flex-col p-3',
              tab === 'body' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden',
            )}
          >
            {tab === 'params' && <ParamsTab request={request} />}
            {tab === 'headers' && <HeadersTab request={request} />}
            {tab === 'auth' && <AuthTab request={request} />}
            {tab === 'body' && <BodyTab request={request} />}
            {tab === 'context' && <ContextTab request={request} />}
            {tab === 'assertions' && <AssertionsTab request={request} />}
          </div>
        ) : (
          <PanelGroup direction="vertical" autoSaveId="apicircle:editor:request-response:v3">
            <Panel defaultSize={75} minSize={20} className="min-h-0">
              <div
                className={cn(
                  'flex h-full min-h-0 flex-col p-3',
                  tab === 'body' ? 'overflow-hidden' : 'overflow-y-auto overflow-x-hidden',
                )}
              >
                {tab === 'params' && <ParamsTab request={request} />}
                {tab === 'headers' && <HeadersTab request={request} />}
                {tab === 'auth' && <AuthTab request={request} />}
                {tab === 'body' && <BodyTab request={request} />}
                {tab === 'context' && <ContextTab request={request} />}
                {tab === 'assertions' && <AssertionsTab request={request} />}
              </div>
            </Panel>
            <PanelResizeHandle
              aria-label="Resize request and response"
              className="group flex h-1.5 cursor-row-resize items-center justify-center border-y border-border-subtle bg-surface hover:bg-accent/20"
            >
              <span className="h-0.5 w-8 rounded-full bg-border group-hover:bg-accent" />
            </PanelResizeHandle>
            <Panel defaultSize={25} minSize={15}>
              <div className="h-full overflow-hidden">
                <ResponseViewer
                  result={lastRun}
                  assertions={lastHistoryRun?.assertions ?? []}
                  isExecuting={isExecuting}
                />
              </div>
            </Panel>
          </PanelGroup>
        )}
      </div>
    </div>
  );
}

/**
 * Inline confirmation row that appears when the user pastes a `curl …` blob
 * into the URL bar. They can convert it to a new request (the standard cURL
 * importer creates a sibling in the same folder) or dismiss to keep typing.
 */
function CurlPasteConfirm({
  curl,
  onConfirm,
  onDismiss,
}: {
  curl: string;
  onConfirm: () => void;
  onDismiss: () => void;
}) {
  const preview = curl.length > 80 ? `${curl.slice(0, 77)}…` : curl;
  return (
    <div
      role="status"
      aria-label="cURL paste detected"
      className="flex items-center gap-2 rounded-sm border border-accent/40 bg-accent/5 px-2 py-1.5 text-[11px]"
    >
      <span className="text-text-primary">Looks like a cURL command</span>
      <code className="ml-1 flex-1 truncate font-mono text-text-muted" title={curl}>
        {preview}
      </code>
      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex h-6 items-center rounded-sm border border-accent/40 bg-accent/15 px-2 text-[11px] text-accent hover:bg-accent/25"
      >
        Import as new request
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex h-6 items-center rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * Buffered request-name input. Live-typing keeps a local draft so the rename
 * action's duplicate-name guard doesn't reject intermediate strings (which
 * would yank the controlled value back during typing). Commits on blur or
 * Enter; if the rename is rejected (duplicate or empty), reverts to the
 * persisted name.
 */
function RequestNameInput({ requestId, initial }: { requestId: string; initial: string }) {
  const renameRequest = useWorkspaceStore((s) => s.renameRequest);
  const [draft, setDraft] = useState(initial);
  // Keep the draft in sync when the store-side name changes from outside
  // (e.g. another tab, or reverted after a rejected commit).
  const lastSeen = useRef(initial);
  useEffect(() => {
    if (initial !== lastSeen.current) {
      setDraft(initial);
      lastSeen.current = initial;
    }
  }, [initial]);

  const commit = () => {
    const trimmed = draft.trim();
    if (!trimmed || trimmed === initial) {
      setDraft(initial);
      return;
    }
    renameRequest(requestId, trimmed);
    // The store will reject on duplicate/empty; the effect above pulls us
    // back to `initial` on the next render either way.
  };

  return (
    <input
      value={draft}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === 'Enter') {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          setDraft(initial);
          (e.target as HTMLInputElement).blur();
        }
      }}
      aria-label="Request name"
      className="w-full bg-transparent text-base font-medium text-text-primary focus:outline-none"
    />
  );
}
