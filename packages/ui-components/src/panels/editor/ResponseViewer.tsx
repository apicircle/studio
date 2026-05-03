import type { ExecutionResult } from '@apicircle/core';
import { useState } from 'react';
import { CheckCircle2, Maximize2, XCircle } from 'lucide-react';
import { cn } from '../../primitives/cn';
import { FullscreenOverlay } from '../../primitives/FullscreenOverlay';
import { MonacoResponseViewer } from '../../editors/MonacoResponseViewer';
import { ResponseSizeHint } from './ResponseSizeHint';

/**
 * Minimal assertion shape ResponseViewer needs to render. Both
 * `RequestRun.assertions[]` (persisted, snapshotted) and `AssertionResult[]`
 * (live, returned from `runAssertions`) satisfy this — we don't need the
 * extra fields here, so a thin contract keeps callers from feeling
 * coupled to the persisted shape.
 */
export interface ResponseAssertion {
  assertionId: string;
  passed: boolean;
  detail?: string;
}

interface ResponseViewerProps {
  result: ExecutionResult | null;
  assertions: readonly ResponseAssertion[];
  isExecuting: boolean;
}

type ResponseTab = 'body' | 'headers' | 'assertions';

function findResponseContentType(headers: Record<string, string>): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type') return v;
  }
  return undefined;
}

export function ResponseViewer({ result, assertions, isExecuting }: ResponseViewerProps) {
  const [tab, setTab] = useState<ResponseTab>('body');
  const [fullscreen, setFullscreen] = useState(false);

  if (isExecuting) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-muted">
        Sending…
      </div>
    );
  }

  if (!result) {
    return (
      <div className="flex h-full items-center justify-center text-xs text-text-dim">
        Click <span className="mx-1 text-text-muted">Send</span> to run this request.
      </div>
    );
  }

  const statusBadgeClass = result.error
    ? 'border-danger/40 bg-danger/10 text-danger'
    : result.ok
      ? 'border-success/40 bg-success/10 text-success'
      : 'border-warning/40 bg-warning/10 text-warning';

  const responseContentType = findResponseContentType(result.headers);

  const bodyEditor = (
    <MonacoResponseViewer
      value={result.body.length === 0 ? '(empty body)' : result.body}
      contentType={responseContentType}
      ariaLabel="Response body"
      height="100%"
    />
  );

  const panelContent = (
    <div className="flex h-full flex-col">
      <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-2 text-xs">
        <span
          className={cn(
            'inline-flex h-6 items-center rounded-sm border px-2 font-medium',
            statusBadgeClass,
          )}
        >
          {result.error ? 'ERR' : `${result.status ?? '—'} ${result.statusText}`.trim()}
        </span>
        <span className="text-text-muted">{result.durationMs} ms</span>
        <ResponseSizeHint body={result.body} contentType={responseContentType} />
        {result.error && (
          <span className="truncate text-danger" title={result.error}>
            {result.error}
          </span>
        )}
        {!fullscreen && (
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label="Fullscreen response panel"
            title="Fullscreen (Esc to exit)"
            className="ml-auto inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:text-text-primary"
          >
            <Maximize2 size={12} />
          </button>
        )}
      </div>

      <div className="flex border-b border-border-subtle px-2">
        {(['body', 'headers', 'assertions'] as const).map((t) => (
          <button
            key={t}
            type="button"
            onClick={() => setTab(t)}
            className={cn(
              'h-8 border-b-2 px-3 text-xs transition-colors',
              tab === t
                ? 'border-accent text-text-primary'
                : 'border-transparent text-text-muted hover:text-text-primary',
            )}
            aria-current={tab === t ? 'page' : undefined}
          >
            {t === 'assertions' && assertions.length > 0
              ? `Assertions (${assertions.filter((a) => a.passed).length}/${assertions.length})`
              : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'body' && <div className="h-full w-full">{bodyEditor}</div>}
        {tab === 'headers' && (
          <div className="h-full overflow-auto p-3">
            <table className="w-full font-mono text-[11px]">
              <tbody>
                {Object.entries(result.headers).map(([key, value]) => (
                  <tr key={key} className="border-b border-border-subtle/60">
                    <td className="py-1 pr-3 text-text-muted">{key}</td>
                    <td className="py-1 text-text-primary">{value}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        {tab === 'assertions' && (
          <div className="h-full overflow-auto p-3">
            <ul className="flex flex-col gap-1.5">
              {assertions.length === 0 && (
                <li className="text-xs text-text-dim">No assertions defined for this request.</li>
              )}
              {assertions.map((a) => (
                <li
                  key={a.assertionId}
                  className={cn(
                    'flex items-start gap-2 rounded-sm border px-2 py-1.5 text-xs',
                    a.passed
                      ? 'border-success/30 bg-success/5 text-text-primary'
                      : 'border-danger/30 bg-danger/5 text-text-primary',
                  )}
                >
                  {a.passed ? (
                    <CheckCircle2 size={14} className="mt-0.5 shrink-0 text-success" />
                  ) : (
                    <XCircle size={14} className="mt-0.5 shrink-0 text-danger" />
                  )}
                  <span>{a.detail ?? (a.passed ? 'Passed' : 'Failed')}</span>
                </li>
              ))}
            </ul>
          </div>
        )}
      </div>
    </div>
  );

  return (
    <>
      {!fullscreen && panelContent}
      <FullscreenOverlay open={fullscreen} onClose={() => setFullscreen(false)} title="Response">
        <div className="h-full w-full">{panelContent}</div>
      </FullscreenOverlay>
    </>
  );
}
