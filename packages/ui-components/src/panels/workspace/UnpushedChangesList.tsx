import { useState } from 'react';
import type { UnpushedChange } from '@apicircle/core';

/**
 * The list of Studio's unpushed changes — one expandable row per entity, with
 * its before/after JSON. Rendered by the working-branch card's preview, and
 * exported so an edition's own review of the branch shows Studio's changes the
 * same way.
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
        <span className="text-[0.625rem] text-text-dim">{open ? '−' : '+'}</span>
      </button>
      {open && (
        <div className="grid grid-cols-2 gap-2 border-t border-border-subtle p-2 text-[0.625rem]">
          <div>
            <p className="mb-1 text-text-dim">Before (last pull)</p>
            <pre className="max-h-40 overflow-y-auto rounded-sm border border-border bg-card p-1.5 font-mono text-text-muted">
              {change.base === undefined
                ? '— (did not exist)'
                : JSON.stringify(change.base, null, 2)}
            </pre>
          </div>
          <div>
            <p className="mb-1 text-text-dim">After (current)</p>
            <pre className="max-h-40 overflow-y-auto rounded-sm border border-border bg-card p-1.5 font-mono text-text-primary">
              {change.local === undefined ? '— (deleted)' : JSON.stringify(change.local, null, 2)}
            </pre>
          </div>
        </div>
      )}
    </li>
  );
}
