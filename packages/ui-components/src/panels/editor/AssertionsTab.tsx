import { memo, useMemo, useState } from 'react';
import type { Assertion, Request as ApiRequest } from '@apicircle/shared';
import { generateId, validateRegex, validateJsonPath } from '@apicircle/shared';
import { CheckCircle2, Crosshair, Maximize2, Plus, Sparkles, Trash2, XCircle } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useLatestRunForRequest } from '../../store/useLatestRunForRequest';
import { JsonPathPicker } from './JsonPathPicker';
import { Select } from '../../primitives/Select';
import { FullscreenOverlay } from '../../primitives/FullscreenOverlay';
import { MonacoEditorBase } from '../../editors/MonacoEditorBase';
import { cn } from '../../primitives/cn';
import { useRowKeyboardNav } from './useRowKeyboardNav';
import { JSON_TYPES, opChangePatch, kindChangePatch } from './assertionOps';

interface AssertionsTabProps {
  request: ApiRequest;
}

const KINDS: Array<{ id: Assertion['kind']; label: string; needsTarget: boolean }> = [
  { id: 'status', label: 'Status', needsTarget: false },
  { id: 'duration', label: 'Duration (ms)', needsTarget: false },
  { id: 'header', label: 'Header', needsTarget: true },
  { id: 'json-path', label: 'JSON path', needsTarget: true },
  { id: 'json-schema', label: 'JSON schema', needsTarget: true },
];

const OPS: Array<{ id: Assertion['op']; label: string }> = [
  { id: 'equals', label: '=' },
  { id: 'not-equals', label: '≠' },
  { id: 'contains', label: 'contains' },
  { id: 'matches', label: 'matches' },
  { id: 'lt', label: '<' },
  { id: 'gt', label: '>' },
  { id: 'exists', label: 'exists' },
  { id: 'type', label: 'is type' },
];

/** The `json-schema` kind has exactly one op (whole-value validation); every other kind offers the
 *  scalar comparison ops. Keeping `matches-schema` off the general list stops it being picked for a
 *  kind that can't run it. */
const SCHEMA_OPS: Array<{ id: Assertion['op']; label: string }> = [
  { id: 'matches-schema', label: 'matches schema' },
];
function opsForKind(kind: Assertion['kind']): Array<{ id: Assertion['op']; label: string }> {
  return kind === 'json-schema' ? SCHEMA_OPS : OPS;
}

function newAssertion(): Assertion {
  return { id: generateId(), kind: 'status', op: 'equals', expected: 200 };
}

// memo'd — see ParamsTab for the rationale.
export const AssertionsTab = memo(function AssertionsTab({ request }: AssertionsTabProps) {
  const setRequestAssertions = useWorkspaceStore((s) => s.setRequestAssertions);
  const lastRunBody = useWorkspaceStore((s) => s.lastRun[request.id]?.body ?? '');
  const lastRunBodyKind = useWorkspaceStore((s) => s.lastRun[request.id]?.bodyKind ?? null);
  // Most-recent run for this request from history. Source of truth for the
  // per-row assertion verdict — `lastRun` (ExecutionResult) doesn't carry
  // assertion verdicts, but `RequestRun.assertions` does and is authoritative.
  // O(1) lookup via the shared latest-run index.
  const lastRun = useLatestRunForRequest(request.id);
  const lastRunAssertions = lastRun?.assertions ?? null;
  const verdictById = new Map<string, { passed: boolean; detail?: string }>();
  if (lastRunAssertions) {
    for (const a of lastRunAssertions) {
      verdictById.set(a.assertionId, { passed: a.passed, detail: a.detail });
    }
  }
  const [pickerForAssertionId, setPickerForAssertionId] = useState<string | null>(null);

  const update = (index: number, patch: Partial<Assertion>) => {
    setRequestAssertions(
      request.id,
      request.assertions.map((a, i) => (i === index ? { ...a, ...patch } : a)),
    );
  };
  const add = () => setRequestAssertions(request.id, [...request.assertions, newAssertion()]);
  const remove = (index: number) =>
    setRequestAssertions(
      request.id,
      request.assertions.filter((_, i) => i !== index),
    );

  // Enter on the last row's "expected" field appends a new assertion;
  // Backspace on an empty assertion removes it; Arrow Up/Down move focus
  // between rows on the same column.
  const { onKeyDown } = useRowKeyboardNav({
    ariaPrefix: 'Assertion',
    fields: ['kind', 'target', 'op', 'expected'],
    rowCount: request.assertions.length,
    isRowEmpty: (index) => {
      const a = request.assertions[index];
      // `exists` / `type` are complete assertions even with an empty `expected` —
      // never treat them as a blank row the keyboard nav can Backspace away.
      if (a.op === 'exists' || a.op === 'type') return false;
      return (a.target === undefined || a.target === '') && (a.expected === '' || a.expected === 0);
    },
    onAdd: add,
    onRemove: remove,
  });

  return (
    <div role="group" aria-label="Assertions" className="flex flex-col gap-2">
      {request.assertions.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No assertions yet. Add one to validate responses.
        </p>
      )}
      {request.assertions.map((a, i) => {
        const def = KINDS.find((k) => k.id === a.kind)!;
        const verdict = verdictById.get(a.id);

        // Control-line pieces shared by both row shapes. The `json-schema` kind
        // renders them above a full-width editor; every other kind keeps them
        // inline with a scalar value input.
        const kindSelect = (
          <Select
            value={a.kind}
            onChange={(e) => update(i, kindChangePatch(a, e.target.value as Assertion['kind']))}
            onKeyDown={(e) => onKeyDown(e, i, 'kind')}
            aria-label={`Assertion ${i + 1} kind`}
          >
            {KINDS.map((k) => (
              <option key={k.id} value={k.id}>
                {k.label}
              </option>
            ))}
          </Select>
        );
        const targetBlock = def.needsTarget ? (
          <div className="flex flex-[1.5] items-center gap-1">
            <input
              type="text"
              value={a.target ?? ''}
              onChange={(e) => update(i, { target: e.target.value })}
              onKeyDown={(e) => onKeyDown(e, i, 'target')}
              placeholder={
                a.kind === 'header'
                  ? 'Header name'
                  : a.kind === 'json-schema'
                    ? 'JSON path (whole body if empty)'
                    : 'JSON path'
              }
              aria-label={`Assertion ${i + 1} target`}
              className="h-7 flex-1 rounded-sm border border-border bg-card px-2 text-xs"
            />
            {a.kind === 'json-path' && (
              <button
                type="button"
                onClick={() => setPickerForAssertionId(a.id)}
                disabled={!lastRunBody || lastRunBodyKind !== 'json'}
                aria-label={`Pick JSON path for assertion ${i + 1}`}
                title={
                  !lastRunBody
                    ? 'Send the request first to capture a response'
                    : lastRunBodyKind !== 'json'
                      ? 'Last response is not JSON'
                      : 'Pick a JSON path from the last response'
                }
                className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-sm border border-border bg-surface text-text-muted hover:border-accent hover:text-text-primary disabled:opacity-30"
              >
                <Crosshair size={12} />
              </button>
            )}
          </div>
        ) : null;
        const opSelect = (
          <Select
            value={a.op}
            onChange={(e) => update(i, opChangePatch(a, e.target.value as Assertion['op']))}
            onKeyDown={(e) => onKeyDown(e, i, 'op')}
            aria-label={`Assertion ${i + 1} op`}
          >
            {opsForKind(a.kind).map((o) => (
              <option key={o.id} value={o.id}>
                {o.label}
              </option>
            ))}
          </Select>
        );
        const removeButton = (
          <button
            type="button"
            onClick={() => remove(i)}
            className="text-text-faint hover:text-danger"
            aria-label={`Remove assertion ${i + 1}`}
          >
            <Trash2 size={12} />
          </button>
        );
        const verdictBadge = verdict ? (
          <span
            role="status"
            aria-live="polite"
            aria-label={`Last run: assertion ${verdict.passed ? 'passed' : 'failed'}`}
            title={verdict.detail ?? (verdict.passed ? 'passed' : 'failed')}
            className={cn(
              'inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider',
              verdict.passed
                ? 'border-success/40 bg-success/10 text-success'
                : 'border-danger/40 bg-danger/10 text-danger',
            )}
          >
            {verdict.passed ? (
              <CheckCircle2 size={10} aria-hidden="true" />
            ) : (
              <XCircle size={10} aria-hidden="true" />
            )}
            {verdict.passed ? 'Pass' : 'Fail'}
          </span>
        ) : null;

        // `json-schema` is a whole-value editor, not a scalar comparison, so it
        // gets a framed block: the control line above a full-width JSON editor.
        // This stops the tall editor from vertically centering the dropdowns
        // (which left a large empty gutter beside a cramped textarea).
        if (a.kind === 'json-schema') {
          return (
            <div
              key={a.id}
              className="flex flex-col gap-2 rounded-md border border-border-subtle bg-surface/40 p-2"
            >
              <div className="flex flex-wrap items-center gap-2">
                {kindSelect}
                {targetBlock}
                {opSelect}
                {removeButton}
                {verdictBadge}
              </div>
              <SchemaAssertionEditor
                assertion={a}
                index={i}
                onChange={(patch) => update(i, patch)}
              />
            </div>
          );
        }

        return (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            {kindSelect}
            {targetBlock}
            {opSelect}
            <ExpectedInput
              assertion={a}
              index={i}
              onChange={(patch) => update(i, patch)}
              onKeyDown={(e) => onKeyDown(e, i, 'expected')}
            />
            {removeButton}
            {verdictBadge}
          </div>
        );
      })}
      <button
        type="button"
        onClick={add}
        className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Plus size={12} />
        Add assertion
      </button>
      {pickerForAssertionId && (
        <JsonPathPicker
          jsonText={lastRunBody}
          title={request.name}
          onClose={() => setPickerForAssertionId(null)}
          onPick={(path) => {
            const idx = request.assertions.findIndex((a) => a.id === pickerForAssertionId);
            if (idx >= 0) update(idx, { target: path });
          }}
        />
      )}
    </div>
  );
});

/**
 * Expected-value editor, op-aware:
 *   - `exists`: no value — renders a hint (the op compares presence only).
 *   - `type`: a JSON-type dropdown (string / number / boolean / array / object / null).
 *   - `matches`: validate as a JS regex; surface compile errors at edit time.
 *   - `lt` / `gt`: require a finite number so the comparison isn't nonsense.
 *   - everything else: free-form string/number.
 *
 * (`matches-schema` is handled separately by {@link SchemaAssertionEditor}, which
 * renders a full-width JSON editor rather than a scalar field.)
 *
 * The valid string is always written through to the assertion; we coerce
 * to number only when the parse succeeds. Errors render below the row.
 */
function ExpectedInput({
  assertion,
  index,
  onChange,
  onKeyDown,
}: {
  assertion: Assertion;
  index: number;
  onChange: (patch: Partial<Assertion>) => void;
  onKeyDown: (e: React.KeyboardEvent<HTMLElement>) => void;
}) {
  // `exists` compares nothing — there is no value to enter.
  if (assertion.op === 'exists') {
    return (
      <div
        className="flex flex-1 items-center px-2 text-xs text-text-dim"
        aria-label={`Assertion ${index + 1} expected`}
      >
        no value needed
      </div>
    );
  }
  // `type` picks a JSON type name rather than a free-form value.
  if (assertion.op === 'type') {
    return (
      <Select
        value={String(assertion.expected)}
        onChange={(e) => onChange({ expected: e.target.value })}
        onKeyDown={onKeyDown}
        aria-label={`Assertion ${index + 1} expected`}
        wrapperClassName="flex-1"
      >
        {JSON_TYPES.map((t) => (
          <option key={t} value={t}>
            {t}
          </option>
        ))}
      </Select>
    );
  }
  const raw = String(assertion.expected);
  let error: string | null = null;
  if (raw !== '') {
    if (assertion.op === 'matches') {
      const r = validateRegex(raw);
      if (!r.ok) error = r.reason;
    } else if (assertion.op === 'lt' || assertion.op === 'gt') {
      if (!Number.isFinite(Number(raw))) {
        error = '< and > require a number.';
      }
    }
  }
  // Also surface JSON-path target syntax errors when the assertion targets
  // a JSON path; the picker happy-paths this, but a typed target can break.
  let targetError: string | null = null;
  if (assertion.kind === 'json-path' && typeof assertion.target === 'string' && assertion.target) {
    const r = validateJsonPath(assertion.target);
    if (!r.ok) targetError = r.reason;
  }
  return (
    <div className="flex flex-1 flex-col">
      <input
        type="text"
        value={raw}
        onChange={(e) => {
          const v = e.target.value;
          const asNumber = Number(v);
          onChange({ expected: v !== '' && Number.isFinite(asNumber) ? asNumber : v });
        }}
        onKeyDown={onKeyDown}
        placeholder="Expected"
        aria-label={`Assertion ${index + 1} expected`}
        aria-invalid={error !== null || undefined}
        className={cn(
          'h-7 w-full rounded-sm border bg-card px-2 text-xs',
          error
            ? 'border-danger focus:border-danger focus:outline-none focus:ring-1 focus:ring-danger/40'
            : 'border-border',
        )}
      />
      {(error || targetError) && (
        <p role="alert" className="mt-0.5 text-[0.625rem] text-danger">
          {error ?? targetError}
        </p>
      )}
    </div>
  );
}

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

/**
 * The `matches-schema` value editor. Unlike the scalar ops, a JSON Schema is a
 * multi-line document, so it gets a full-width Monaco JSON editor (syntax
 * highlighting, folding, and inline schema diagnostics — consistent with the
 * request-body editor) framed by a slim toolbar:
 *   - a validity pill (parseable JSON or not) for an at-a-glance status,
 *   - Format (pretty-print) — enabled only when the JSON parses,
 *   - Expand — pops the editor to a fullscreen overlay for large schemas.
 *
 * Only one editor instance is mounted at a time (inline OR fullscreen), so the
 * shared `modelPath` / aria-label never collide.
 */
function SchemaAssertionEditor({
  assertion,
  index,
  onChange,
}: {
  assertion: Assertion;
  index: number;
  onChange: (patch: Partial<Assertion>) => void;
}) {
  const [fullscreen, setFullscreen] = useState(false);
  // `expected` is typed `string | number` and every `matches-schema` seed writes a
  // string, so this is always the schema text.
  const raw = String(assertion.expected);
  const validity = useMemo(() => schemaValidity(raw), [raw]);
  const ariaLabel = `Assertion ${index + 1} schema`;

  // Pretty-print. Safe to parse unguarded: the Format button is disabled unless
  // `validity.status === 'ok'`, and a disabled button can't fire this handler.
  const format = () => {
    onChange({ expected: JSON.stringify(JSON.parse(raw), null, 2) });
  };

  const editorElement = (
    <MonacoEditorBase
      value={raw}
      language="json"
      onChange={(v) => onChange({ expected: v })}
      ariaLabel={ariaLabel}
      height="100%"
      minHeight={140}
      modelPath={`inmemory://apicircle/assertion/${assertion.id}.schema`}
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
            aria-label={`Format schema for assertion ${index + 1}`}
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
            aria-label={`Fullscreen schema for assertion ${index + 1}`}
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
        title={`Expected JSON Schema — assertion ${index + 1}`}
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
