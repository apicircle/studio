import { useState } from 'react';
import type { Assertion, Request as ApiRequest } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import { Crosshair, Plus, Trash2 } from 'lucide-react';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { JsonPathPicker } from './JsonPathPicker';

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

export function AssertionsTab({ request }: AssertionsTabProps) {
  const setRequestAssertions = useWorkspaceStore((s) => s.setRequestAssertions);
  const lastRun = useWorkspaceStore((s) => s.lastRun[request.id] ?? null);
  const lastRunBody = useWorkspaceStore((s) => s.lastRun[request.id]?.body ?? '');
  const lastRunBodyKind = useWorkspaceStore((s) => s.lastRun[request.id]?.bodyKind ?? null);
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

  return (
    <div role="group" aria-label="Assertions" className="flex flex-col gap-2">
      {request.assertions.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No assertions yet. Add one to validate responses.
        </p>
      )}
      {request.assertions.map((a, i) => {
        const def = KINDS.find((k) => k.id === a.kind)!;
        const runResult = lastRun
          ? null // wired below — assertions land on RequestRun history, not lastRun
          : null;
        return (
          <div key={a.id} className="flex flex-wrap items-center gap-2">
            <select
              value={a.kind}
              onChange={(e) => update(i, { kind: e.target.value as Assertion['kind'] })}
              aria-label={`Assertion ${i + 1} kind`}
              className="h-7 rounded-sm border border-border bg-card px-2 text-xs"
            >
              {KINDS.map((k) => (
                <option key={k.id} value={k.id}>
                  {k.label}
                </option>
              ))}
            </select>
            {def.needsTarget && (
              <div className="flex flex-[1.5] items-center gap-1">
                <input
                  type="text"
                  value={a.target ?? ''}
                  onChange={(e) => update(i, { target: e.target.value })}
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
            <select
              value={a.op}
              onChange={(e) => update(i, { op: e.target.value as Assertion['op'] })}
              aria-label={`Assertion ${i + 1} op`}
              className="h-7 rounded-sm border border-border bg-card px-2 text-xs"
            >
              {OPS.map((o) => (
                <option key={o.id} value={o.id}>
                  {o.label}
                </option>
              ))}
            </select>
            <input
              type="text"
              value={String(a.expected)}
              onChange={(e) => {
                const v = e.target.value;
                const asNumber = Number(v);
                update(i, { expected: v !== '' && Number.isFinite(asNumber) ? asNumber : v });
              }}
              placeholder="Expected"
              aria-label={`Assertion ${i + 1} expected`}
              className="h-7 flex-1 rounded-sm border border-border bg-card px-2 text-xs"
            />
            <button
              type="button"
              onClick={() => remove(i)}
              className="text-text-faint hover:text-danger"
              aria-label={`Remove assertion ${i + 1}`}
            >
              <Trash2 size={12} />
            </button>
            {runResult /* placeholder slot for verdict pill */}
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
}
