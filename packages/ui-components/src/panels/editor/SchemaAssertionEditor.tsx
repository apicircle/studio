import { useMemo, useState } from 'react';
import { Maximize2, Sparkles } from 'lucide-react';
import { FullscreenOverlay } from '../../primitives/FullscreenOverlay';
import { MonacoEditorBase } from '../../editors/MonacoEditorBase';

/** Parse status of the schema text — drives the validity pill, the Format button, and the hint. */
type SchemaValidity = { status: 'empty' } | { status: 'ok' } | { status: 'error'; message: string };

function schemaValidity(raw: string): SchemaValidity {
  const trimmed = raw.trim();
  if (trimmed === '') return { status: 'empty' };
  try {
    JSON.parse(trimmed);
    return { status: 'ok' };
  } catch (e) {
    // `String(e)` (not `e.message`) avoids a defensively-dead `instanceof` branch
    // while still surfacing the parser's message in the pill tooltip.
    return { status: 'error', message: String(e) };
  }
}

export interface SchemaAssertionEditorProps {
  /** The JSON Schema text — the assertion's `expected`, stringified. */
  value: string;
  /** Called with the next schema text on each edit and on Format. */
  onChange: (schema: string) => void;
  /**
   * Human descriptor for the row this editor belongs to, e.g. `assertion 1` or
   * `override assertion 1`. Drives every aria-label and the fullscreen title; the
   * editor's own label capitalizes it (`Assertion 1 schema`).
   */
  descriptor: string;
  /** Unique, stable Monaco model path (key it by the assertion id so models never collide). */
  modelPath: string;
}

/**
 * The `matches-schema` value editor, shared by the request editor's Assertions tab
 * and the linked-workspace override editor. Unlike the scalar ops, a JSON Schema is a
 * multi-line document, so it gets a full-width Monaco JSON editor (syntax highlighting,
 * folding, and inline diagnostics — consistent with the request-body editor) framed by
 * a slim toolbar:
 *   - a validity pill (parseable JSON or not) for an at-a-glance status,
 *   - Format (pretty-print) — enabled only when the JSON parses,
 *   - Expand — pops the editor to a fullscreen overlay for large schemas.
 *
 * Only one editor instance is mounted at a time (inline OR fullscreen), so the shared
 * `modelPath` / aria-label never collide.
 */
export function SchemaAssertionEditor({
  value,
  onChange,
  descriptor,
  modelPath,
}: SchemaAssertionEditorProps) {
  const [fullscreen, setFullscreen] = useState(false);
  const validity = useMemo(() => schemaValidity(value), [value]);
  const editorLabel = `${descriptor.charAt(0).toUpperCase()}${descriptor.slice(1)} schema`;

  // Pretty-print. Safe to parse unguarded: the Format button is disabled unless
  // `validity.status === 'ok'`, and a disabled button can't fire this handler.
  const format = () => {
    onChange(JSON.stringify(JSON.parse(value), null, 2));
  };

  const editorElement = (
    <MonacoEditorBase
      value={value}
      language="json"
      onChange={onChange}
      ariaLabel={editorLabel}
      height="100%"
      minHeight={140}
      modelPath={modelPath}
    />
  );

  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-[0.6875rem] font-medium uppercase tracking-wide text-text-dim">
          Expected JSON Schema
        </span>
        <div className="flex items-center gap-1.5">
          <SchemaValidityPill validity={validity} />
          <button
            type="button"
            onClick={format}
            disabled={validity.status !== 'ok'}
            aria-label={`Format schema for ${descriptor}`}
            title={
              validity.status === 'ok'
                ? 'Format JSON'
                : validity.status === 'empty'
                  ? 'Nothing to format yet'
                  : 'Fix invalid JSON to format'
            }
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-accent hover:text-text-primary disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Sparkles size={11} aria-hidden="true" />
            Format
          </button>
          <button
            type="button"
            onClick={() => setFullscreen(true)}
            aria-label={`Fullscreen schema for ${descriptor}`}
            title="Fullscreen (Esc to exit)"
            className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary"
          >
            <Maximize2 size={12} aria-hidden="true" />
          </button>
        </div>
      </div>

      {!fullscreen && (
        <div className="h-44 overflow-hidden rounded-sm border border-border">{editorElement}</div>
      )}

      {validity.status === 'error' && (
        <p role="alert" className="text-[0.625rem] text-danger">
          Not valid JSON — fix it for this assertion to run.
        </p>
      )}
      {validity.status === 'empty' && (
        <p className="text-[0.625rem] text-text-dim">
          Empty schema matches anything. Write or paste a JSON Schema to constrain the response.
        </p>
      )}

      <FullscreenOverlay
        open={fullscreen}
        onClose={() => setFullscreen(false)}
        title={`Expected JSON Schema — ${descriptor}`}
      >
        <div className="h-full w-full">{editorElement}</div>
      </FullscreenOverlay>
    </div>
  );
}

/** At-a-glance JSON-parse status shown in the schema editor's toolbar. */
function SchemaValidityPill({ validity }: { validity: SchemaValidity }) {
  if (validity.status === 'ok') {
    return (
      <span
        aria-label="Schema is valid JSON"
        className="inline-flex h-6 items-center rounded-sm border border-success/40 bg-success/10 px-2 text-[0.625rem] uppercase tracking-wider text-success"
      >
        ✓ Valid
      </span>
    );
  }
  if (validity.status === 'error') {
    return (
      <span
        aria-label="Schema is not valid JSON"
        title={validity.message}
        className="inline-flex h-6 items-center rounded-sm border border-danger/40 bg-danger/10 px-2 text-[0.625rem] uppercase tracking-wider text-danger"
      >
        ✗ Invalid
      </span>
    );
  }
  return null;
}
