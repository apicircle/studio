import { useMemo, useState } from 'react';
import { Sparkles } from 'lucide-react';
import {
  TRANSFORM_FORMAT_LABELS,
  computeTransformSavings,
  type TransformCandidate,
  type TransformFormat,
} from '@apicircle/core';
import { formatBytes } from '@apicircle/shared';
import { cn } from '../../primitives/cn';
import { FullscreenOverlay } from '../../primitives/FullscreenOverlay';
import { MonacoResponseViewer } from '../../editors/MonacoResponseViewer';

interface ResponseSizeHintProps {
  body: string;
  contentType?: string;
}

/**
 * Inline badge: "1.2 KB · ⚡ 22% smaller as TOON" (savings measured
 * against the wire baseline — minified JSON — not against the
 * pretty-printed body the editor happens to be rendering).
 *
 * Tooltip on the size badge explains the baseline so the user can see
 * exactly what's being compared. Click any candidate to open the
 * fullscreen preview with the transformed payload — preview switcher
 * lets them flip between TOON / YAML / CSV without leaving the dialog.
 */
export function ResponseSizeHint({ body, contentType }: ResponseSizeHintProps) {
  const savings = useMemo(() => computeTransformSavings(body, contentType), [body, contentType]);
  const [openCandidate, setOpenCandidate] = useState<TransformCandidate | null>(null);

  const best = savings.candidates[0];
  const sizeLabel = formatBytes(savings.originalBytes);
  const minifiedLabel = formatBytes(savings.minifiedBytes);
  const isPrettyPrinted =
    savings.minifiedBytes > 0 && savings.minifiedBytes < savings.originalBytes;

  return (
    <>
      <span
        className="inline-flex items-center gap-1 text-text-muted"
        title={describeBaseline(savings.originalBytes, savings.minifiedBytes, isPrettyPrinted)}
      >
        {sizeLabel}
        {isPrettyPrinted && <span className="text-text-dim">· {minifiedLabel} on wire</span>}
      </span>
      {best && (
        <button
          type="button"
          onClick={() => setOpenCandidate(best)}
          className={cn(
            'inline-flex items-center gap-1 rounded-sm border border-accent/30 bg-accent/5 px-1.5 py-0.5',
            'text-[11px] text-accent hover:bg-accent/15 focus:outline-none focus:ring-2 focus:ring-accent/50',
          )}
          aria-label={`Preview as ${TRANSFORM_FORMAT_LABELS[best.format]} — ${best.percentSaved}% smaller than minified JSON`}
          title={describeAllCandidates(savings.candidates)}
        >
          <Sparkles size={10} aria-hidden="true" />
          {best.percentSaved}% smaller as {TRANSFORM_FORMAT_LABELS[best.format]}
        </button>
      )}

      {openCandidate && (
        <FullscreenOverlay
          open
          onClose={() => setOpenCandidate(null)}
          title={`Response as ${TRANSFORM_FORMAT_LABELS[openCandidate.format]} — ${formatBytes(openCandidate.bytes)} (${openCandidate.percentSaved}% smaller than minified JSON)`}
        >
          <div className="flex h-full flex-col">
            <div className="flex flex-wrap items-center gap-3 border-b border-border-subtle px-3 py-2 text-[11px] text-text-muted">
              <span title="Body as the API actually sent it">Wire body: {sizeLabel}</span>
              {isPrettyPrinted && (
                <span title="The same body with JSON whitespace stripped — fair baseline for measuring transformation savings">
                  · minified: {minifiedLabel}
                </span>
              )}
              <span>→</span>
              <span className="text-text-primary">
                {TRANSFORM_FORMAT_LABELS[openCandidate.format]}: {formatBytes(openCandidate.bytes)}
              </span>
              <span className="text-success">{openCandidate.percentSaved}% saved vs minified</span>
              <CandidateSwitcher
                candidates={savings.candidates}
                active={openCandidate.format}
                onSelect={setOpenCandidate}
              />
            </div>
            <div className="min-h-0 flex-1">
              <MonacoResponseViewer
                value={openCandidate.preview}
                contentType={contentTypeForFormat(openCandidate.format)}
                ariaLabel={`Transformed response (${openCandidate.format})`}
                height="100%"
              />
            </div>
          </div>
        </FullscreenOverlay>
      )}
    </>
  );
}

function describeBaseline(originalBytes: number, minifiedBytes: number, isPretty: boolean): string {
  const parts = [
    `Body as received: ${formatBytes(originalBytes)} (${originalBytes.toLocaleString()} bytes)`,
  ];
  if (isPretty) {
    parts.push(
      `Same JSON minified: ${formatBytes(minifiedBytes)} (${minifiedBytes.toLocaleString()} bytes) — this is what most APIs actually send. Transformation savings below are measured against this wire baseline, not the pretty-printed view above.`,
    );
  } else {
    parts.push('Already compact — no whitespace to strip.');
  }
  return parts.join('\n');
}

function describeAllCandidates(candidates: TransformCandidate[]): string {
  if (candidates.length === 0) return '';
  return candidates
    .map(
      (c) =>
        `${TRANSFORM_FORMAT_LABELS[c.format]}: ${formatBytes(c.bytes)} (${c.percentSaved}% smaller than minified JSON)`,
    )
    .join('\n');
}

function contentTypeForFormat(format: TransformFormat): string {
  switch (format) {
    case 'csv':
      return 'text/csv';
    case 'toon':
    case 'yaml':
      // TOON's syntax is a tabular superset of compact YAML — Monaco's
      // YAML highlighter renders both correctly enough to scan visually.
      return 'application/x-yaml';
  }
}

function CandidateSwitcher({
  candidates,
  active,
  onSelect,
}: {
  candidates: TransformCandidate[];
  active: TransformCandidate['format'];
  onSelect: (c: TransformCandidate) => void;
}) {
  if (candidates.length < 2) return null;
  return (
    <div className="ml-auto flex items-center gap-1">
      {candidates.map((c) => (
        <button
          key={c.format}
          type="button"
          onClick={() => onSelect(c)}
          className={cn(
            'rounded-sm border px-2 py-0.5 text-[10px]',
            c.format === active
              ? 'border-accent bg-accent/15 text-accent'
              : 'border-border bg-surface text-text-muted hover:text-text-primary',
          )}
        >
          {TRANSFORM_FORMAT_LABELS[c.format]}
        </button>
      ))}
    </div>
  );
}
