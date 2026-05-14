import { memo, useState } from 'react';
import type { Assertion, Request as ApiRequest } from '@apicircle/shared';
import { generateId, validateRegex, validateJsonPath } from '@apicircle/shared';
import { CheckCircle2, Crosshair, Plus, Trash2, XCircle } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useLatestRunForRequest } from '../../store/useLatestRunForRequest';
import { JsonPathPicker } from './JsonPathPicker';
import { Select } from '../../primitives/Select';
import { cn } from '../../primitives/cn';
import { useRowKeyboardNav } from './useRowKeyboardNav';

interface AssertionsTabProps {
  request: ApiRequest;
}

const KINDS: Array<{ id: Assertion['kind']; label: string; needsTarget: boolean }> = [
  { id: 'status', label: 'Status', needsTarget: false },
  { id: 'duration', label: 'Duration (ms)', needsTarget: false },
  { id: 'header', label: 'Header', needsTarget: true },
  { id: 'json-path', label: 'JSON path', needsTarget: true },
];

const OPS: Array<{ id: Assertion['op']; label: string }> = [
  { id: 'equals', label: '=' },
  { id: 'not-equals', label: '≠' },
  { id: 'contains', label: 'contains' },
  { id: 'matches', label: 'matches' },
  { id: 'lt', label: '<' },
  { id: 'gt', label: '>' },
];

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
      return (
        !a ||
        ((a.target === undefined || a.target === '') && (a.expected === '' || a.expected === 0))
      );
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
        return (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            <Select
              value={a.kind}
              onChange={(e) => update(i, { kind: e.target.value as Assertion['kind'] })}
              onKeyDown={(e) => onKeyDown(e, i, 'kind')}
              aria-label={`Assertion ${i + 1} kind`}
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </Select>
            {def.needsTarget && (
              <div className="flex flex-[1.5] items-center gap-1">
                <input
                  type="text"
                  value={a.target ?? ''}
                  onChange={(e) => update(i, { target: e.target.value })}
                  onKeyDown={(e) => onKeyDown(e, i, 'target')}
                  placeholder={a.kind === 'header' ? 'Header name' : 'JSON path'}
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
            )}
            <Select
              value={a.op}
              onChange={(e) => update(i, { op: e.target.value as Assertion['op'] })}
              onKeyDown={(e) => onKeyDown(e, i, 'op')}
              aria-label={`Assertion ${i + 1} op`}
            >
              {OPS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </Select>
            <ExpectedInput
              assertion={a}
              index={i}
              onChange={(patch) => update(i, patch)}
              onKeyDown={(e) => onKeyDown(e, i, 'expected')}
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-text-faint hover:text-danger"
              aria-label={`Remove assertion ${i + 1}`}
            >
              <Trash2 size={12} />
            </button>
            {verdict && (
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
            )}
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
 * Expected-value input with op-aware inline validation. Three modes:
 *   - `matches` op: validate as a JS regex; surface compile errors at edit time.
 *   - `lt` / `gt`: require a finite number so the comparison isn't nonsense.
 *   - everything else: free-form string/number (legacy behaviour).
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
  onKeyDown: (e: React.KeyboardEvent<HTMLInputElement>) => void;
}) {
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
