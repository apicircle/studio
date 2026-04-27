import { useState } from 'react';
import { Send } from 'lucide-react';
import type { HttpMethod } from '@apicircle-v2/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { ParamsTab } from './ParamsTab';
import { HeadersTab } from './HeadersTab';
import { BodyTab } from './BodyTab';
import { AssertionsTab } from './AssertionsTab';
import { ResponseViewer } from './ResponseViewer';

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

type Tab = 'params' | 'headers' | 'body' | 'assertions';

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
          <input
            value={request.url}
            onChange={(e) => setRequestUrl(request.id, e.target.value)}
            placeholder="https://api.example.com/v1"
            aria-label="Request URL"
            className="h-9 flex-1 rounded-sm border border-border bg-card px-3 text-sm text-text-primary focus:border-accent focus:outline-none focus:ring-2 focus:ring-accent/30"
          />
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
        {(['params', 'headers', 'body', 'assertions'] as const).map((t) => (
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
            {t === 'body' && 'Body'}
            {t === 'assertions' &&
              `Assertions${request.assertions.length ? ` (${request.assertions.length})` : ''}`}
          </button>
        ))}
      </div>

      <div className="grid flex-1 grid-rows-2 overflow-hidden">
        <div className="overflow-auto p-3">
          {tab === 'params' && <ParamsTab request={request} />}
          {tab === 'headers' && <HeadersTab request={request} />}
          {tab === 'body' && <BodyTab request={request} />}
          {tab === 'assertions' && <AssertionsTab request={request} />}
        </div>
        <div className="overflow-hidden border-t border-border-subtle">
          <ResponseViewer result={lastRun} lastRun={lastHistoryRun} isExecuting={isExecuting} />
        </div>
      </div>
    </div>
  );
}
