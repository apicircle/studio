import { NOT_SENT_PREFIX, type ExecutionResult } from '@apicircle/core';
import { useEffect, useState } from 'react';
import { AlertCircle, CheckCircle2, Maximize2, RotateCw, XCircle } from 'lucide-react';
import { BrandLoader } from '../../primitives/BrandLoader';
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
function classifyError(error: string): { label: string; hint: string | null } {
  // A request Studio refused to send (it names an encryption key): the
  // reason is the useful part, so it is the hint, not hidden under Details.
  if (isNotSent(error)) {
    return { label: 'Not sent', hint: error.slice(NOT_SENT_PREFIX.length) };
  }
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
  // Nothing to add to the message itself, which the panel shows first.
  return { label: 'Error', hint: null };
}

function isNotSent(error: string): boolean {
  return error.startsWith(NOT_SENT_PREFIX);
}

/**
 * Milliseconds since `active` last turned on, ticking every 100ms while it
 * stays on, and 0 while it is off.
 */
function useElapsedMs(active: boolean): number {
  const [elapsed, setElapsed] = useState(0);
  useEffect(() => {
    if (!active) return;
    const started = Date.now();
    const timer = window.setInterval(() => setElapsed(Date.now() - started), 100);
    return () => {
      window.clearInterval(timer);
      setElapsed(0);
    };
  }, [active]);
  return elapsed;
}

/** "0.4 s" … "59.9 s", then "1 min 05 s". */
function formatElapsed(ms: number): string {
  if (ms < 60_000) return `${(ms / 1000).toFixed(1)} s`;
  const minutes = Math.floor(ms / 60_000);
  const seconds = Math.floor((ms % 60_000) / 1000);
  return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
}

/**
 * "Sending request…" once, as a polite status, with the running time beside
 * it. The time is hidden from assistive tech: re-announcing it ten times a
 * second would drown out everything else.
 */
function SendingStatus({ elapsedMs }: { elapsedMs: number }) {
  return (
    <>
      <span role="status" className="text-text-primary">
        Sending request…
      </span>
      <span
        aria-hidden="true"
        data-testid="response-elapsed"
        className="tabular-nums text-text-dim"
      >
        {formatElapsed(elapsedMs)}
      </span>
    </>
  );
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
  const elapsedMs = useElapsedMs(isExecuting);

  // The first send of this request: nothing to show yet but the wait.
  if (isExecuting && !result) {
    return (
      <div className="flex h-full flex-col items-center justify-center gap-3 text-xs">
        <BrandLoader size="md" />
        <div className="flex flex-col items-center gap-1">
          <SendingStatus elapsedMs={elapsedMs} />
        </div>
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

  const notSent = result.error ? isNotSent(result.error) : false;
  // An error means no HTTP response came back at all, so there is no status to
  // show: the badge says so in words rather than a bare "ERR".
  const statusBadgeLabel = result.error
    ? notSent
      ? 'Not sent'
      : 'No response'
    : `${result.status ?? '—'} ${result.statusText}`.trim();
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
      {isExecuting && (
        // A re-send: the last response stays up, dimmed, until the new one
        // replaces it, so the user can keep reading it instead of a blank pane.
        <div className="flex items-center gap-2 border-b border-accent/30 bg-accent/5 px-3 py-1.5 text-xs">
          <BrandLoader size="xs" />
          <SendingStatus elapsedMs={elapsedMs} />
          <span className="ml-auto truncate text-[0.6875rem] text-text-dim">
            The last response stays here until the new one arrives.
          </span>
        </div>
      )}
      <div
        aria-busy={isExecuting || undefined}
        data-testid="response-content"
        className={cn(
          'flex min-h-0 flex-1 flex-col transition-opacity',
          isExecuting && 'opacity-50',
        )}
      >
        <div className="flex items-center gap-3 border-b border-border-subtle px-3 py-2 text-xs">
          <span
            className={cn(
              'inline-flex h-6 shrink-0 items-center rounded-sm border px-2 font-medium',
              statusBadgeClass,
            )}
          >
            {statusBadgeLabel}
          </span>
          {result.error ? (
            // The message first: it is the one thing that says what went wrong.
            // A request that was never sent took no time, so it shows none.
            <>
              <span className="min-w-0 truncate text-danger" title={result.error}>
                {notSent ? result.error.slice(NOT_SENT_PREFIX.length) : result.error}
              </span>
              {!notSent && <span className="shrink-0 text-text-muted">{result.durationMs} ms</span>}
            </>
          ) : (
            <>
              <span className="text-text-muted">{result.durationMs} ms</span>
              <ResponseSizeHint body={result.body} contentType={responseContentType} />
            </>
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
  // A refusal's reason is already the hint; anything else shows the message
  // itself, verbatim, before the guess at what caused it.
  const showMessage = !isNotSent(errorText);
  return (
    <div className="h-full overflow-auto p-4">
      <div
        role="alert"
        className="space-y-3 rounded-sm border border-danger/30 bg-danger/5 p-4 text-xs"
      >
        <div className="flex items-start gap-2">
          <AlertCircle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
          <div className="min-w-0 flex-1 space-y-1">
            <p className="text-sm font-medium text-danger">{label}</p>
            {showMessage && <p className="break-words font-mono text-text-primary">{errorText}</p>}
            {hint && <p className="text-text-muted">{hint}</p>}
          </div>
        </div>
        <details className="rounded-sm border border-border bg-card p-2 text-text-muted">
          <summary className="cursor-pointer text-text-primary">Request details</summary>
          <dl className="mt-2 grid grid-cols-[80px_1fr] gap-y-1 font-mono text-[0.6875rem]">
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
