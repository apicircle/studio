import { useMemo, useState } from 'react';
import { ChevronDown, ChevronRight } from 'lucide-react';
import type { UnpushedChange } from '@apicircle/core';
import { cn } from '../../primitives/cn';
import {
  MAX_DRAWN_LINES,
  capHunks,
  countChangedLines,
  diffLines,
  toHunks,
  type DiffLine,
} from './lineDiff';

/**
 * The list of Studio's unpushed changes — one row per entity, which opens to
 * the change as a unified diff of its JSON: the lines the push removes and the
 * lines it adds, with a few unchanged lines around them. Rendered by the
 * working-branch card's preview, and exported so an edition's own review of
 * the branch shows Studio's changes the same way.
 */
export function UnpushedChangesList({ changes }: { changes: readonly UnpushedChange[] }) {
  return (
    <ul className="max-h-96 space-y-1 overflow-y-auto" aria-label="Unpushed changes">
      {changes.map((c) => (
        <UnpushedChangeRow key={`${c.bucket}:${c.key}`} change={c} />
      ))}
    </ul>
  );
}

/**
 * One side of a change as the lines of its JSON. A side that does not exist —
 * the entry was added, or it was removed — has no lines, so the diff reads as
 * all added or all removed.
 */
function jsonLines(value: unknown): string[] {
  if (value === undefined || value === null) return [];
  return JSON.stringify(value, null, 2).split('\n');
}

/**
 * Pull a method/URL pair out of whichever side of the diff entry has data,
 * so the row can show enough information to tell two similarly-named
 * entries apart. Falls back gracefully when the change isn't a request
 * (mockServer endpoints, plans, etc. have their own identity that the
 * `label` column already covers).
 */
function getDisambiguation(change: UnpushedChange): { method?: string; url?: string } | null {
  if (change.bucket !== 'request') return null;
  const source = (change.local ?? change.base) as
    | { method?: string; url?: string }
    | null
    | undefined;
  if (!source || typeof source !== 'object') return null;
  return {
    method: typeof source.method === 'string' ? source.method : undefined,
    url: typeof source.url === 'string' ? source.url : undefined,
  };
}

function UnpushedChangeRow({ change }: { change: UnpushedChange }) {
  const [open, setOpen] = useState(false);
  // Worked out for every row, open or not: the row says how many lines the
  // change adds and removes before it is opened.
  const lines = useMemo(
    () => diffLines(jsonLines(change.base), jsonLines(change.local)),
    [change.base, change.local],
  );
  const { additions, deletions } = countChangedLines(lines);
  const tone =
    change.kind === 'added'
      ? 'border-success/40 bg-success/5 text-success'
      : change.kind === 'modified'
        ? 'border-warning/40 bg-warning/5 text-warning'
        : 'border-danger/40 bg-danger/5 text-danger';
  // Disambiguate similarly-named entries (multiple "Sample: GET /anything"
  // requests, two folders named "v1", etc.) by surfacing the data that
  // makes them unique: method + URL for requests, plus a short id badge
  // anchored to the entry's id. Without these, the only column shown was
  // `label` and the user had no way to tell which entry the diff meant.
  const disambig = getDisambiguation(change);
  const shortId = change.key ? change.key.slice(0, 8) : null;
  const Chevron = open ? ChevronDown : ChevronRight;
  return (
    <li className="rounded-sm border border-border bg-surface">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center gap-2 px-2 py-1 text-left text-xs"
        aria-expanded={open}
        aria-label={`Toggle ${change.kind} ${change.label}`}
      >
        <span
          className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider ${tone}`}
        >
          {change.kind}
        </span>
        <span className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-[0.625rem] text-text-dim">
          {change.bucket}
        </span>
        {disambig?.method && (
          <span className="shrink-0 rounded-sm border border-accent/30 bg-accent/5 px-1.5 py-0.5 text-[0.625rem] font-mono text-accent">
            {disambig.method}
          </span>
        )}
        <code className="flex-1 truncate text-text-primary">{change.label}</code>
        {disambig?.url && (
          <code
            className="hidden max-w-[20rem] shrink-0 truncate text-[0.625rem] text-text-muted md:inline"
            title={disambig.url}
          >
            {disambig.url}
          </code>
        )}
        {shortId && (
          <code
            className="shrink-0 rounded-sm bg-card px-1 py-0.5 font-mono text-[0.625rem] text-text-faint"
            title={`Entry id: ${change.key}`}
          >
            {shortId}
          </code>
        )}
        <span
          className="shrink-0 font-mono text-[0.625rem]"
          title="Lines of JSON this change adds and removes"
        >
          <span className="text-success">+{additions}</span>{' '}
          <span className="text-danger">−{deletions}</span>
        </span>
        <span className="inline-flex shrink-0 items-center gap-0.5 text-[0.625rem] text-text-dim">
          <Chevron size={11} aria-hidden="true" />
          Diff
        </span>
      </button>
      {open && <ChangeDiff label={change.label} lines={lines} />}
    </li>
  );
}

const LINE_TONE: Record<DiffLine['kind'], string> = {
  add: 'bg-success/10',
  del: 'bg-danger/10',
  context: '',
};
const LINE_MARKER: Record<DiffLine['kind'], string> = { add: '+', del: '−', context: ' ' };

/**
 * One change as a unified diff, under its row: against the last pull, what the
 * push takes out (−) and what it puts in (+). Each line is numbered by the
 * side it is on — a removed line by the old text, the others by the new.
 */
function ChangeDiff({ label, lines }: { label: string; lines: readonly DiffLine[] }) {
  const { hunks, hidden } = capHunks(toHunks(lines), MAX_DRAWN_LINES);
  return (
    <div
      role="region"
      aria-label={`Change to ${label}`}
      // Focusable, so the keyboard can scroll a diff taller or wider than its box.
      tabIndex={0}
      className="max-h-72 overflow-auto border-t border-border-subtle font-mono text-[0.6875rem] leading-relaxed focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-accent/70"
    >
      {hunks.length === 0 ? (
        <p className="p-2 font-sans text-text-dim">No difference to show.</p>
      ) : (
        hunks.map((hunk) => (
          <div key={hunk.header}>
            <div className="bg-card px-2 py-0.5 text-text-dim">{hunk.header}</div>
            {hunk.lines.map((line) => {
              const number = line.kind === 'del' ? line.oldLine : line.newLine;
              return (
                <div
                  key={`${line.kind}:${number}`}
                  className={cn('flex items-start gap-2 px-2', LINE_TONE[line.kind])}
                >
                  <span className="w-8 shrink-0 select-none text-right text-text-dim">
                    {number}
                  </span>
                  <span className="whitespace-pre text-text-primary">
                    {LINE_MARKER[line.kind]}
                    {line.text}
                  </span>
                </div>
              );
            })}
          </div>
        ))
      )}
      {hidden > 0 && (
        <p className="px-2 py-1 font-sans text-text-dim">
          {hidden} more {hidden === 1 ? 'line' : 'lines'} not shown.
        </p>
      )}
    </div>
  );
}
