// Interactive JSON-path picker. Opens as a modal anchored to a body
// extraction row; the user expands the response tree, clicks a node, and
// the path string is delivered back to the caller. Path encoding matches
// `readJsonPath` (dot notation + `[n]` for array indices).
//
// Source data: usually the last response body for the request. The hosting
// component supplies the raw JSON text — we parse it here and surface a
// friendly error state if it isn't valid JSON.

import { useEffect, useMemo, useState } from 'react';
import { ChevronDown, ChevronRight, Crosshair, X } from 'lucide-react';

export interface JsonPathPickerProps {
  /** Raw JSON text. Often `lastRun[requestId]?.body`. */
  jsonText: string;
  /** Optional human label for the dialog header (e.g. request name). */
  title?: string;
  onPick: (path: string) => void;
  onClose: () => void;
}

type ParseResult = { ok: true; root: unknown } | { ok: false; error: string };

function parse(jsonText: string): ParseResult {
  if (!jsonText)
    return { ok: false, error: 'No response body to pick from. Send the request first.' };
  try {
    return { ok: true, root: JSON.parse(jsonText) };
  } catch (err) {
    return {
      ok: false,
      error: `Couldn't parse the response as JSON — ${err instanceof Error ? err.message : 'unknown error'}.`,
    };
  }
}

export function JsonPathPicker({ jsonText, title, onPick, onClose }: JsonPathPickerProps) {
  const parsed = useMemo(() => parse(jsonText), [jsonText]);
  const [filter, setFilter] = useState('');

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [onClose]);

  return (
    <>
      <div
        aria-hidden
        onClick={onClose}
        className="fixed inset-0 z-40 bg-black/40 backdrop-blur-[1px]"
      />
      <div
        role="dialog"
        aria-modal="true"
        aria-label="Pick a JSON path"
        className="fixed left-1/2 top-1/2 z-50 flex max-h-[85vh] w-full max-w-2xl -translate-x-1/2 -translate-y-1/2 flex-col rounded-md border border-border bg-surface shadow-2xl"
      >
        <header className="flex items-center justify-between border-b border-border-subtle px-4 py-3">
          <div className="flex items-center gap-2">
            <Crosshair size={14} className="text-accent" />
            <h2 className="text-sm font-medium text-text-primary">
              Pick a JSON path
              {title && <span className="ml-2 text-text-muted">— {title}</span>}
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            title="Close (Esc)"
            className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-muted hover:bg-card hover:text-text-primary"
          >
            <X size={14} />
          </button>
        </header>

        {parsed.ok && (
          <div className="border-b border-border-subtle px-4 py-2">
            <input
              type="search"
              value={filter}
              onChange={(e) => setFilter(e.target.value)}
              placeholder="Filter by key name…"
              aria-label="Filter JSON keys"
              className="h-8 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
            />
          </div>
        )}

        <div className="min-h-0 flex-1 overflow-auto p-3 font-mono text-xs">
          {!parsed.ok ? (
            <div className="rounded-sm border border-dashed border-border-subtle p-4 text-center text-text-dim">
              {parsed.error}
            </div>
          ) : (
            <Tree
              value={parsed.root}
              filter={filter.trim().toLowerCase()}
              onPick={(path) => {
                onPick(path);
                onClose();
              }}
            />
          )}
        </div>

        <footer className="flex items-center justify-between border-t border-border-subtle bg-card px-4 py-2 text-[0.625rem] text-text-dim">
          <span>
            Click a row to copy its path. Use <code className="text-text-muted">$</code> for the
            whole body.
          </span>
          <button
            type="button"
            onClick={() => {
              onPick('$');
              onClose();
            }}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-text-muted hover:border-accent hover:text-text-primary"
          >
            Pick root ($)
          </button>
        </footer>
      </div>
    </>
  );
}

interface TreeProps {
  value: unknown;
  filter: string;
  onPick: (path: string) => void;
}

function Tree({ value, filter, onPick }: TreeProps) {
  return <Node value={value} path="" name="$" filter={filter} onPick={onPick} depth={0} />;
}

interface NodeProps {
  value: unknown;
  path: string;
  name: string;
  filter: string;
  onPick: (path: string) => void;
  depth: number;
}

function joinPath(base: string, segment: string): string {
  if (!base) return segment;
  if (segment.startsWith('[')) return `${base}${segment}`;
  return `${base}.${segment}`;
}

function nameMatchesFilter(name: string, filter: string, value: unknown): boolean {
  if (!filter) return true;
  if (name.toLowerCase().includes(filter)) return true;
  // For primitive values inside an array of strings/numbers, also match on the string form
  // so a filter like "token" can find leaves named by their value.
  if (typeof value !== 'object' || value === null) {
    return String(value).toLowerCase().includes(filter);
  }
  return false;
}

function descendantMatchesFilter(value: unknown, filter: string): boolean {
  if (!filter) return true;
  if (typeof value !== 'object' || value === null) {
    return String(value).toLowerCase().includes(filter);
  }
  if (Array.isArray(value)) {
    return value.some((v) => descendantMatchesFilter(v, filter));
  }
  for (const [k, v] of Object.entries(value as Record<string, unknown>)) {
    if (k.toLowerCase().includes(filter)) return true;
    if (descendantMatchesFilter(v, filter)) return true;
  }
  return false;
}

function Node({ value, path, name, filter, onPick, depth }: NodeProps) {
  // Top-level + filtered descendants default to expanded for fast scanning;
  // deep nested objects start collapsed.
  const [open, setOpen] = useState(() => depth < 2 || filter.length > 0);

  const isContainer = typeof value === 'object' && value !== null;
  const isArray = Array.isArray(value);

  // Filtering behavior: if filter doesn't match this node and no descendant
  // matches, hide entirely. Top-level root ($) always renders.
  if (filter && depth > 0) {
    const selfMatch = nameMatchesFilter(name, filter, value);
    if (!selfMatch && !descendantMatchesFilter(value, filter)) return null;
  }

  const fullPath = path; // The path leading to *this* node (already includes name).
  const preview = describe(value);

  const indentPx = depth * 14;

  if (!isContainer) {
    return (
      <div className="flex items-center" style={{ paddingLeft: indentPx }}>
        <button
          type="button"
          onClick={() => onPick(fullPath || '$')}
          className="group flex w-full items-center gap-2 rounded-sm border border-transparent px-2 py-1 text-left hover:border-border-subtle hover:bg-card"
          title={`Pick ${fullPath || '$'}`}
        >
          <span className="w-3 shrink-0" />
          <span className="text-text-muted">{displayName(name)}</span>
          <span className="text-text-dim">:</span>
          <span className={valueClass(value)}>{preview}</span>
          <span className="ml-auto truncate text-[0.625rem] text-text-faint opacity-0 group-hover:opacity-100">
            {fullPath || '$'}
          </span>
        </button>
      </div>
    );
  }

  const entries = isArray
    ? (value as unknown[]).map((v, i) => ({ key: String(i), value: v, isArrayIndex: true }))
    : Object.entries(value as Record<string, unknown>).map(([k, v]) => ({
        key: k,
        value: v,
        isArrayIndex: false,
      }));

  const summary = isArray ? `[${entries.length}]` : `{${entries.length}}`;

  return (
    <div>
      <div className="flex items-center" style={{ paddingLeft: indentPx }}>
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          aria-label={open ? `Collapse ${name}` : `Expand ${name}`}
          className="inline-flex h-5 w-5 shrink-0 items-center justify-center text-text-faint hover:text-text-primary"
        >
          {open ? <ChevronDown size={12} /> : <ChevronRight size={12} />}
        </button>
        <button
          type="button"
          onClick={() => onPick(fullPath || '$')}
          className="group flex flex-1 items-center gap-2 rounded-sm border border-transparent px-2 py-1 text-left hover:border-border-subtle hover:bg-card"
          title={`Pick ${fullPath || '$'}`}
        >
          <span className="text-text-primary">{displayName(name)}</span>
          <span className="text-text-dim">{summary}</span>
          <span className="ml-auto truncate text-[0.625rem] text-text-faint opacity-0 group-hover:opacity-100">
            {fullPath || '$'}
          </span>
        </button>
      </div>
      {open && entries.length > 0 && (
        <div>
          {entries.map((entry) => (
            <Node
              key={entry.key}
              value={entry.value}
              name={entry.isArrayIndex ? `[${entry.key}]` : entry.key}
              path={joinPath(fullPath, entry.isArrayIndex ? `[${entry.key}]` : entry.key)}
              filter={filter}
              onPick={onPick}
              depth={depth + 1}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function displayName(name: string): string {
  // Root is rendered as `$`; array indices keep their square brackets.
  return name;
}

function describe(value: unknown): string {
  if (value === null) return 'null';
  if (typeof value === 'string') {
    if (value.length > 60) return `"${value.slice(0, 57)}…"`;
    return JSON.stringify(value);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function valueClass(value: unknown): string {
  if (value === null) return 'text-text-faint';
  if (typeof value === 'string') return 'text-http-get';
  if (typeof value === 'number') return 'text-http-post';
  if (typeof value === 'boolean') return 'text-http-put';
  return 'text-text-primary';
}
