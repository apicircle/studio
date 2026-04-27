import type { ExecutionResult } from '@apicircle-v2/core';
import type { RequestRun } from '@apicircle-v2/shared';
import { useState } from 'react';
import { CheckCircle2, XCircle } from 'lucide-react';
import { cn } from '../../primitives/cn';

interface ResponseViewerProps {
  result: ExecutionResult | null;
  lastRun: RequestRun | null;
  isExecuting: boolean;
}

type ResponseTab = 'body' | 'headers' | 'assertions';

export function ResponseViewer({ result, lastRun, isExecuting }: ResponseViewerProps) {
  const [tab, setTab] = useState<ResponseTab>('body');

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

  const formattedBody = formatBody(result);

  return (
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
        {result.error && (
          <span className="truncate text-danger" title={result.error}>
            {result.error}
          </span>
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
            {t === 'assertions' && lastRun
              ? `Assertions (${lastRun.assertions.filter((a) => a.passed).length}/${lastRun.assertions.length})`
              : t.charAt(0).toUpperCase() + t.slice(1)}
          </button>
        ))}
      </div>

      <div className="flex-1 overflow-auto p-3">
        {tab === 'body' && (
          <pre className="whitespace-pre-wrap break-words font-mono text-[11px] text-text-primary">
            {formattedBody}
          </pre>
        )}
        {tab === 'headers' && (
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
        )}
        {tab === 'assertions' && (
          <ul className="flex flex-col gap-1.5">
            {(lastRun?.assertions ?? []).length === 0 && (
              <li className="text-xs text-text-dim">No assertions defined for this request.</li>
            )}
            {lastRun?.assertions.map((a) => (
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
        )}
      </div>
    </div>
  );
}

function formatBody(result: ExecutionResult): string {
  if (result.body.length === 0) return '(empty body)';
  if (result.bodyKind === 'json') {
    try {
      return JSON.stringify(JSON.parse(result.body), null, 2);
    } catch {
      return result.body;
    }
  }
  return result.body;
}
