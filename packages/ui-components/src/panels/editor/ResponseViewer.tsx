import type { ExecutionResult } from '@apicircle/core';
import { useState } from 'react';
import { AlertCircle, CheckCircle2, Maximize2, RotateCw, XCircle } from 'lucide-react';
import { cn } from '../../primitives/cn';
import { FullscreenOverlay } from '../../primitives/FullscreenOverlay';
import { Tabs } from '../../primitives/Tabs';
import { MonacoResponseViewer } from '../../editors/MonacoResponseViewer';
import { ResponseSizeHint } from './ResponseSizeHint';

/**
 * Categorize a result.error string into something the user can act on.
 * Browser fetch errors collapse to "Failed to fetch" / "TypeError" with
 * no further detail; we infer the most common causes from the message.
 */
function classifyError(error: string): { label: string; hint: string } {
  const lower = error.toLowerCase();
  if (lower.includes('aborted') || lower.includes('abort')) {
    return {
      label: 'Aborted',
      hint: 'You cancelled this request before the server responded.',
    };
  }
  if (lower.includes('failed to fetch') || lower.includes('typeerror')) {
    return {
      label: 'Network error',
      hint: 'The browser could not reach the host. Check that the URL resolves, the server is up, and that CORS allows requests from this origin (web build only).',
    };
  }
  if (lower.includes('timeout') || lower.includes('timed out')) {
    return {
      label: 'Timeout',
      hint: 'The server did not respond in time. The request was cancelled.',
    };
  }
  if (lower.includes('certificate') || lower.includes('ssl') || lower.includes('tls')) {
    return {
      label: 'TLS error',
      hint: 'The server certificate could not be validated. Check that the cert chain is valid.',
    };
  }
  return {
    label: 'Error',
    hint: 'See the message below — the executor surfaced this verbatim.',
  };
}

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
  /**
   * Optional retry handler. When provided AND the last result errored,
   * an inline Retry button surfaces in the error panel. The host wires
   * this to `executeActiveRequest` so the user can re-fire without
   * leaving the response pane.
   */
  onRetry?: () => void;
}

type ResponseTab = 'body' | 'headers' | 'assertions';

function findResponseContentType(headers: Record<string, string>): string | undefined {
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === 'content-type') return v;
  }
  return undefined;
}

export function ResponseViewer({ result, assertions, isExecuting, onRetry }: ResponseViewerProps) {
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

  // Empty-body responses render as a dedicated card instead of stuffing
  // the placeholder string into Monaco — the editor styling makes the
  // sentinel look like a real (string) body, which has confused users.
  const bodyEditor =
    result.body.length === 0 ? (
      <div className="flex h-full flex-col items-center justify-center gap-1 p-6 text-center text-xs text-text-dim">
        <p className="font-medium text-text-muted">Empty response body</p>
        <p className="text-[0.6875rem]">
          The server returned no body bytes. Status, headers, and timing are still available above.
        </p>
      </div>
    ) : (
      <MonacoResponseViewer
        value={result.body}
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

      <Tabs
        variant="underline"
        label="Response sections"
        activeId={tab}
        onChange={(id) => setTab(id as ResponseTab)}
        tabs={[
          { id: 'body', label: 'Body' },
          { id: 'headers', label: 'Headers' },
          {
            id: 'assertions',
            label:
              assertions.length > 0
                ? `Assertions (${assertions.filter((a) => a.passed).length}/${assertions.length})`
                : 'Assertions',
          },
        ]}
      />

      <div className="min-h-0 flex-1 overflow-hidden">
        {tab === 'body' && result.error ? <ErrorPanel result={result} onRetry={onRetry} /> : null}
        {tab === 'body' && !result.error && <div className="h-full w-full">{bodyEditor}</div>}
        {tab === 'headers' && (
          <div className="h-full overflow-auto p-3">
            <table className="w-full font-mono text-[0.6875rem]">
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

function ErrorPanel({ result, onRetry }: { result: ExecutionResult; onRetry?: () => void }) {
  const errorText = result.error ?? 'Unknown error';
  const { label, hint } = classifyError(errorText);
  return (
    <div className="h-full overflow-auto p-4">
      <div
        role="alert"
        className="space-y-3 rounded-sm border border-danger/30 bg-danger/5 p-4 text-xs"
      >
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div className="flex-1">
            <p className="text-sm font-medium text-danger">{label}</p>
            <p className="mt-0.5 text-text-muted">{hint}</p>
          </div>
        </div>
        <details className="rounded-sm border border-border bg-card p-2 text-text-muted">
          <summary className="cursor-pointer text-text-primary">Details</summary>
          <dl className="mt-2 grid grid-cols-[80px_1fr] gap-y-1 font-mono text-[0.6875rem]">
            <dt className="text-text-dim">Message</dt>
            <dd className="break-all text-text-primary">{errorText}</dd>
            {result.method && (
              <>
                <dt className="text-text-dim">Method</dt>
                <dd className="text-text-primary">{result.method}</dd>
              </>
            )}
            {result.url && (
              <>
                <dt className="text-text-dim">URL</dt>
                <dd className="break-all text-text-primary">{result.url}</dd>
              </>
            )}
            <dt className="text-text-dim">Duration</dt>
            <dd className="text-text-primary">{result.durationMs} ms</dd>
          </dl>
        </details>
        {onRetry && (
          <div className="flex justify-end">
            <button
              type="button"
              onClick={onRetry}
              className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
            >
              <RotateCw size={11} aria-hidden="true" />
              Retry
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
