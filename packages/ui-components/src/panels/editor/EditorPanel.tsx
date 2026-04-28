import { useState } from 'react';
import { Send } from 'lucide-react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import type { HttpMethod } from '@apicircle/shared';
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

type Tab = 'params' | 'headers' | 'auth' | 'body' | 'context' | 'assertions';

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
  const renameRequest = useWorkspaceStore((s) => s.renameRequest);
  const setRequestMethod = useWorkspaceStore((s) => s.setRequestMethod);
  const setRequestUrl = useWorkspaceStore((s) => s.setRequestUrl);
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
  const scope = useVariableScope(request);

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
        <input
          value={request.name}
          onChange={(e) => renameRequest(request.id, e.target.value)}
          aria-label="Request name"
          className="w-full bg-transparent text-base font-medium text-text-primary focus:outline-none"
        />
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
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
          <div className="flex-1">
            <VariableAutocompleteField
              value={request.url}
              onChange={(v) => setRequestUrl(request.id, v)}
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
            {t === 'params' && `Params${request.query.length ? ` (${request.query.length})` : ''}`}
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
        <PanelGroup direction="vertical" autoSaveId="apicircle:editor:request-response">
          <Panel defaultSize={50} minSize={20}>
            <div
              className={cn(
                'flex h-full min-h-0 flex-col overflow-hidden',
                tab === 'body' ? 'p-3' : 'overflow-auto p-3',
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
          <Panel defaultSize={50} minSize={20}>
            <div className="h-full overflow-hidden">
              <ResponseViewer result={lastRun} lastRun={lastHistoryRun} isExecuting={isExecuting} />
            </div>
          </Panel>
        </PanelGroup>
      </div>
    </div>
  );
}
