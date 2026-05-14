import { useEffect, useMemo, useRef, useState } from 'react';
import { Cookie, GitBranch, Link2, RotateCcw, Send, Square, X } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { HttpMethod, Request as ApiRequest, RequestOverridePatch } from '@apicircle/shared';
import { validateUrl } from '@apicircle/shared';
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
import { Select } from '../../primitives/Select';
import { ParamsTab } from './ParamsTab';
import { HeadersTab } from './HeadersTab';
import { BodyTab } from './BodyTab';
import { AssertionsTab } from './AssertionsTab';
import { AuthTab } from './AuthTab';
import { ContextTab } from './ContextTab';
import { ResponseViewer } from './ResponseViewer';
import { VariableAutocompleteField } from '../../editors/VariableAutocompleteField';
import { useVariableScope } from '../../editors/useVariableScope';
import { useActiveRequestView, type ActiveRequestView } from '../../editors/useActiveRequestView';
import { PreSendPanel, usePreSendValidation } from './PreSendPanel';
import { useLatestRunForRequest } from '../../store/useLatestRunForRequest';

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
    <div className="flex flex-col gap-0.5 rounded-sm border border-border-subtle bg-card px-2 py-1.5 font-mono text-[0.6875rem] text-text-muted">
      {urlChanged && (
        <div className="flex items-center gap-2">
          <span className="shrink-0 text-[0.625rem] uppercase tracking-wider text-text-dim">
            Effective URL
          </span>
          <span className="truncate text-accent" title={effectiveUrl}>
            {effectiveUrl}
          </span>
        </div>
      )}
      {cookieValue && (
        <div className="flex items-center gap-2">
          <Cookie size={11} className="shrink-0 text-text-dim" />
          <span className="shrink-0 text-[0.625rem] uppercase tracking-wider text-text-dim">
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
  // Unified view: returns the workspace request, OR the linked source's
  // request merged with the consumer's override patch. Editor renders the
  // same UI in both cases — the setRequest* actions internally route to
  // setLinkedRequestOverride when a linked request is active.
  const view = useActiveRequestView();
  const request = view?.request ?? null;
  const activeRequestId = request?.id ?? null;
  const isLinked = view?.source === 'linked';
  const setRequestMethod = useWorkspaceStore((s) => s.setRequestMethod);
  const setRequestUrl = useWorkspaceStore((s) => s.setRequestUrl);
  const setRequestQuery = useWorkspaceStore((s) => s.setRequestQuery);
  const executeActiveRequest = useWorkspaceStore((s) => s.executeActiveRequest);
  const executeLinkedActiveRequest = useWorkspaceStore((s) => s.executeLinkedActiveRequest);
  const cancelExecuteRequest = useWorkspaceStore((s) => s.cancelExecuteRequest);
  const isExecuting = useWorkspaceStore((s) =>
    activeRequestId ? (s.isExecuting[activeRequestId] ?? false) : false,
  );
  const lastRun = useWorkspaceStore((s) =>
    activeRequestId ? (s.lastRun[activeRequestId] ?? null) : null,
  );
  // O(1) lookup via the shared `useLatestRunForRequest` index — multiple
  // subscribers (this panel, AssertionsTab, ResponseViewer) read the same
  // RequestRun without each re-scanning the history array.
  const lastHistoryRun = useLatestRunForRequest(activeRequestId);

  const [tab, setTab] = useState<Tab>('params');
  // Surfaced when the user pastes a `curl …` blob into the URL bar — they
  // can confirm or dismiss before it overwrites the request.
  const [pendingCurlPaste, setPendingCurlPaste] = useState<string | null>(null);
  const addRequestFromCurl = useWorkspaceStore((s) => s.addRequestFromCurl);
  const scope = useVariableScope(request);

  // Pre-send validation — gated by user setting. Returns warnings (yellow,
  // non-blocking) and blockers (red, Send disabled until resolved). Hidden
  // entirely when the toggle is off. The same result is passed down to
  // `PreSendPanel` so the validation runs ONCE per render instead of twice
  // (the panel used to call usePreSendValidation again internally).
  const validateOnSend = useWorkspaceStore((s) => s.local?.settings?.validateOnSend ?? true);
  const validation = usePreSendValidation(request, scope, validateOnSend);
  const sendBlocked = validation.blockers.length > 0;

  // The composed URL is read at three sites in this component (the URL
  // input value, the cURL-paste detector's length-delta, and the inline
  // validator). Recomputing it three times per render is wasteful — keep
  // it in a memo keyed on the two source fields.
  const composedUrl = useMemo(
    () => composeUrlWithQuery(request?.url ?? '', request?.query ?? []),
    [request?.url, request?.query],
  );

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
          <Select
            size="lg"
            value={request.method}
            onChange={(e) => setRequestMethod(request.id, e.target.value as HttpMethod)}
            aria-label="HTTP method"
            className={cn('font-medium', METHOD_COLOR[request.method])}
          >
            {METHODS.map((m) => (
              <option key={m} value={m} style={{ color: METHOD_OPTION_COLOR[m] }}>
                {m}
              </option>
            ))}
          </Select>
          <div className="flex flex-1 flex-col">
            <VariableAutocompleteField
              value={composedUrl}
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
                  trimmed.length - composedUrl.length > 10
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
            <UrlInlineValidation url={composedUrl} />
          </div>
          {isExecuting ? (
            // Same slot as the Send button — swap to a Cancel control while
            // the request is in flight so the user can abort hung requests
            // without waiting for them to time out. Linked-source requests
            // run through the same isExecuting flag keyed on `request.id`,
            // so the same cancelExecuteRequest path stops both.
            <button
              type="button"
              onClick={() => cancelExecuteRequest(request.id)}
              title="Abort the in-flight request"
              aria-label="Cancel request"
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-danger/40 bg-danger/15 px-4 text-xs font-medium text-danger transition-colors hover:bg-danger/25"
            >
              <Square size={14} />
              Cancel
            </button>
          ) : (
            <button
              type="button"
              onClick={() =>
                void (isLinked ? executeLinkedActiveRequest() : executeActiveRequest())
              }
              disabled={sendBlocked}
              title={
                sendBlocked
                  ? 'Resolve the validation blockers above before sending.'
                  : 'Sends with the active environment + secrets resolved (Ctrl/Cmd+Enter).'
              }
              className="inline-flex h-9 items-center gap-2 rounded-sm border border-accent/40 bg-accent/15 px-4 text-xs font-medium text-accent transition-colors hover:bg-accent/25 disabled:opacity-50"
            >
              <Send size={14} />
              Send
            </button>
          )}
        </div>
        {view?.source === 'linked' && <LinkedSourceBanner view={view} />}
        <EffectiveRequestPreview request={request} scope={scope} />
        <PreSendPanel request={request} enabled={validateOnSend} validation={validation} />
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
                  onRetry={() =>
                    void (isLinked ? executeLinkedActiveRequest() : executeActiveRequest())
                  }
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
/**
 * Inline validation cue below the URL field. Renders nothing when the URL
 * is valid (the field already shows valid state). On invalid input,
 * renders a `role="alert"` line with the reason. PreSendPanel keeps its
 * Send-time blocker — this just gives the user the cue earlier, while typing.
 */
function UrlInlineValidation({ url }: { url: string }) {
  // Empty URL is rejected at Send time by PreSendPanel — the inline cue
  // would feel preachy ("URL is required" on the empty state). Only show
  // for actual garbage input.
  if (url.trim() === '') return null;
  const result = validateUrl(url);
  if (result.ok) return null;
  return (
    <p role="alert" className="mt-1 text-[0.6875rem] text-warning">
      {result.reason}
    </p>
  );
}

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
      className="flex items-center gap-2 rounded-sm border border-accent/40 bg-accent/5 px-2 py-1.5 text-[0.6875rem]"
    >
      <span className="text-text-primary">Looks like a cURL command</span>
      <code className="ml-1 flex-1 truncate font-mono text-text-muted" title={curl}>
        {preview}
      </code>
      <button
        type="button"
        onClick={onConfirm}
        className="inline-flex h-6 items-center rounded-sm border border-accent/40 bg-accent/15 px-2 text-[0.6875rem] text-accent hover:bg-accent/25"
      >
        Import as new request
      </button>
      <button
        type="button"
        onClick={onDismiss}
        className="inline-flex h-6 items-center rounded-sm border border-border bg-surface px-2 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary"
      >
        Dismiss
      </button>
    </div>
  );
}

/**
 * Linked-source banner shown above the request fields when the user is
 * editing a request from a linked workspace. Surfaces:
 *   - Source repo + branch + pinned version (so the user knows where the
 *     base came from)
 *   - "N field(s) locally modified" badge derived from the override patch
 *   - "Reset overrides" — clears the entire override entry, returning the
 *     request to its source-pinned state
 *
 * Unlike the modal that this replaces, it doesn't gate field editing —
 * every tab below is fully editable; edits route to
 * `setLinkedRequestOverride` via `routeLinkedField` in the store.
 */
function LinkedSourceBanner({ view }: { view: Extract<ActiveRequestView, { source: 'linked' }> }) {
  const clearLinkedRequestOverride = useWorkspaceStore((s) => s.clearLinkedRequestOverride);
  const clearLinkedRequestOverrideField = useWorkspaceStore(
    (s) => s.clearLinkedRequestOverrideField,
  );
  const overriddenFields = view.patch
    ? (Object.keys(view.patch) as Array<keyof RequestOverridePatch>)
    : [];
  const overriddenFieldCount = overriddenFields.length;
  return (
    <div
      role="status"
      aria-label="Linked request source"
      className="flex flex-col gap-1.5 rounded-sm border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.6875rem] text-text-muted"
    >
      <div className="flex flex-wrap items-center gap-2">
        <Link2 size={11} aria-hidden="true" className="shrink-0 text-accent" />
        <span className="text-text-primary">Linked from</span>
        <code className="font-mono text-text-primary">
          <GitBranch size={10} className="mr-1 inline align-text-bottom" aria-hidden="true" />
          {view.link.source.repoFullName}@{view.link.source.branch}
        </code>
        {view.link.pinnedVersion && (
          <span
            className="rounded-sm border border-border bg-surface px-1 py-0.5 font-mono text-[0.625rem] text-text-dim"
            title={`Pinned to v${view.link.pinnedVersion}`}
          >
            v{view.link.pinnedVersion}
          </span>
        )}
        <span className="ml-auto flex items-center gap-2">
          {overriddenFieldCount > 0 ? (
            <>
              <span
                className="rounded-sm border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[0.625rem] text-warning"
                title="Number of request fields you've edited on top of the source"
              >
                {overriddenFieldCount} field{overriddenFieldCount === 1 ? '' : 's'} locally modified
              </span>
              <button
                type="button"
                onClick={() => clearLinkedRequestOverride(view.link.id, view.request.id)}
                aria-label="Reset all local modifications for this linked request"
                className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-danger/40 hover:text-danger"
              >
                <RotateCcw size={10} aria-hidden="true" />
                Reset all to source
              </button>
            </>
          ) : (
            <span className="text-[0.625rem] text-text-dim">Source-clean</span>
          )}
        </span>
      </div>
      {overriddenFieldCount > 0 && (
        <div className="flex flex-wrap items-center gap-1" aria-label="Per-field overrides">
          <span className="text-[0.625rem] uppercase tracking-wider text-text-dim">
            Overridden:
          </span>
          {overriddenFields.map((field) => (
            <button
              key={field}
              type="button"
              onClick={() => clearLinkedRequestOverrideField(view.link.id, view.request.id, field)}
              aria-label={`Reset ${field} to source value`}
              title={`Reset ${field} to source — drops just this field's override`}
              className="group inline-flex h-5 items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 pl-1.5 pr-1 font-mono text-[0.625rem] text-warning hover:border-danger/40 hover:bg-danger/10 hover:text-danger"
            >
              <span>{field}</span>
              <X size={9} aria-hidden="true" className="text-warning/60 group-hover:text-danger" />
            </button>
          ))}
        </div>
      )}
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
      className="w-full rounded-sm border border-transparent bg-transparent px-2 py-1 text-base font-medium text-text-primary hover:border-border focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
    />
  );
}
