// Modal that opens when the user clicks a request in a linked workspace's
// snapshot. Shows the source request's URL/method/body/auth as read-only,
// then exposes editable override sections for headers, contextVars,
// extractions, and assertions.
//
// Overrides land in `synced.linkedOverrides.requests[`${linkedWorkspaceId}:${itemId}`].patch`
// and round-trip through Git so collaborators see each other's edits.
//
// NOTE: This modal is the pre-A.2 placeholder surface. A.2 replaces it
// with full editing in the main editor panel — these four-field sections
// stay accurate for now; the rest of the request fields will be editable
// once the editor integration lands.

import { useMemo, useState } from 'react';
import { Send, Trash2 } from 'lucide-react';
import type {
  Assertion,
  ContextExtraction,
  HttpMethod,
  Request as ApiRequest,
} from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { KeyValueRows } from '../editor/KeyValueRows';
import { JSON_TYPES, opChangePatch, kindChangePatch } from '../editor/assertionOps';

const HTTP_METHODS: HttpMethod[] = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'];

const labelClass = 'text-[0.6875rem] uppercase tracking-wide text-text-dim';
const inputClass =
  'h-7 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30';

export function LinkedRequestEditor() {
  const active = useWorkspaceStore((s) => s.activeLinkedRequest);
  const close = useWorkspaceStore((s) => s.setActiveLinkedRequest);

  if (!active) return null;
  return (
    <Modal open onClose={() => close(null)} title="Linked request override" className="max-w-3xl">
      <LinkedRequestEditorBody
        linkedWorkspaceId={active.linkedWorkspaceId}
        itemId={active.itemId}
      />
    </Modal>
  );
}

function LinkedRequestEditorBody({
  linkedWorkspaceId,
  itemId,
}: {
  linkedWorkspaceId: string;
  itemId: string;
}) {
  const link = useWorkspaceStore((s) => s.synced?.linkedWorkspaces[linkedWorkspaceId] ?? null);
  const snapshot = useWorkspaceStore((s) => s.local?.linkedCollections[linkedWorkspaceId] ?? null);
  const overrideKey = `${linkedWorkspaceId}:${itemId}`;
  const override = useWorkspaceStore(
    (s) => s.synced?.linkedOverrides.requests[overrideKey] ?? null,
  );
  const setOverride = useWorkspaceStore((s) => s.setLinkedRequestOverride);
  const clearOverride = useWorkspaceStore((s) => s.clearLinkedRequestOverride);
  const executeLinkedActiveRequest = useWorkspaceStore((s) => s.executeLinkedActiveRequest);
  const isExecuting = useWorkspaceStore((s) => Boolean(s.isExecuting[itemId]));
  const lastRun = useWorkspaceStore((s) => s.lastRun[itemId] ?? null);

  const baseRequest: ApiRequest | null = useMemo(() => {
    return snapshot?.collections.requests[itemId] ?? null;
  }, [itemId, snapshot]);

  if (!link || !baseRequest) {
    return (
      <p className="rounded-sm border border-dashed border-border-subtle p-4 text-center text-xs text-text-dim">
        This linked request is no longer available. Refresh the connection card to repull.
      </p>
    );
  }

  const patch = override?.patch ?? {};
  const overrideName = patch.name ?? baseRequest.name;
  const overrideMethod = patch.method ?? baseRequest.method;
  const overrideUrl = patch.url ?? baseRequest.url;
  const overrideBody = patch.body ?? baseRequest.body;
  const overrideHeaders = patch.headers ?? baseRequest.headers;
  const overrideContextVars = patch.contextVars ?? baseRequest.contextVars;
  const overrideAssertions = patch.assertions ?? baseRequest.assertions;
  const overrideExtractions = patch.extractions ?? baseRequest.extractions;

  const updatePatch = (next: Partial<typeof patch>) => {
    setOverride(linkedWorkspaceId, itemId, { ...patch, ...next });
  };

  // Per-field "modified" indicator: a field is overridden iff the patch
  // contains it (regardless of equality with source — the user may have
  // re-typed the same value intentionally and we treat that as a still-
  // overridden field until they explicitly Reset).
  const isModified = (key: keyof typeof patch): boolean => key in patch;
  const fieldDot = (key: keyof typeof patch) =>
    isModified(key) ? (
      <span
        aria-label="modified"
        title="Modified locally"
        className="ml-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent align-middle"
      />
    ) : null;

  return (
    <div className="flex flex-col gap-4">
      <p
        className="rounded-sm border border-accent/30 bg-accent/5 px-2.5 py-1.5 text-[0.6875rem] text-text-muted"
        role="note"
      >
        <strong className="text-text-primary">Local overrides only.</strong> Edits made here are
        stored on your working branch and never propagate back to{' '}
        <span className="font-mono text-text-primary">{link.name}</span> — the source workspace
        stays read-only.
      </p>
      <div className="flex items-start justify-between gap-3 rounded-sm border border-border-subtle bg-surface p-3 text-xs">
        <div className="flex-1">
          <p className="text-text-muted">
            From <strong className="text-text-primary">{link.name}</strong>
            {link.pinnedVersion && (
              <span className="ml-2 rounded-sm border border-border bg-card px-1 py-0.5 font-mono text-[0.625rem] text-text-dim">
                v{link.pinnedVersion}
              </span>
            )}
          </p>
          <p className="mt-1 text-text-dim">
            Edit any field to override for this consumer. Empty / unchanged fields inherit from
            source. Overrides round-trip through Git so collaborators see them on pull.
          </p>
          {lastRun && (
            <p
              className={`mt-1 font-mono text-[0.6875rem] ${
                lastRun.ok ? 'text-success' : 'text-danger'
              }`}
              role="status"
            >
              Last run: {lastRun.status || '—'} {lastRun.statusText} · {lastRun.durationMs}ms
            </p>
          )}
        </div>
        <button
          type="button"
          onClick={() => void executeLinkedActiveRequest()}
          disabled={isExecuting}
          aria-label="Send linked request"
          className="inline-flex h-8 shrink-0 items-center gap-1.5 rounded-sm border border-accent bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
        >
          <Send size={12} />
          {isExecuting ? 'Sending…' : 'Send'}
        </button>
      </div>

      <section>
        <header className="mb-1 flex items-center justify-between">
          <h3 className={labelClass}>
            Name (override)
            {fieldDot('name')}
          </h3>
          {isModified('name') && (
            <ResetFieldButton onClick={() => updatePatch({ name: undefined })} />
          )}
        </header>
        <input
          aria-label="Override name"
          value={overrideName}
          onChange={(e) => updatePatch({ name: e.target.value })}
          className={inputClass}
        />
      </section>

      <section className="grid grid-cols-[120px_1fr] items-end gap-2">
        <div>
          <header className="mb-1">
            <h3 className={labelClass}>
              Method
              {fieldDot('method')}
            </h3>
          </header>
          <select
            aria-label="Override method"
            value={overrideMethod}
            onChange={(e) => updatePatch({ method: e.target.value as HttpMethod })}
            className={inputClass}
          >
            {HTTP_METHODS.map((m) => (
              <option key={m} value={m}>
                {m}
              </option>
            ))}
          </select>
        </div>
        <div>
          <header className="mb-1 flex items-center justify-between">
            <h3 className={labelClass}>
              URL
              {fieldDot('url')}
            </h3>
            {isModified('url') && (
              <ResetFieldButton onClick={() => updatePatch({ url: undefined })} />
            )}
          </header>
          <input
            aria-label="Override URL"
            value={overrideUrl}
            onChange={(e) => updatePatch({ url: e.target.value })}
            className={inputClass}
          />
        </div>
      </section>

      <section>
        <header className="mb-1 flex items-center justify-between">
          <h3 className={labelClass}>
            Body (override · {overrideBody.type}){fieldDot('body')}
          </h3>
          {isModified('body') && (
            <ResetFieldButton onClick={() => updatePatch({ body: undefined })} />
          )}
        </header>
        {overrideBody.type === 'none' ? (
          <div className="space-y-2 rounded-sm border border-dashed border-border-subtle p-2 text-center text-[0.6875rem] text-text-dim">
            <p>Source body is &quot;none&quot;. Pick an override body type to add content.</p>
            <div className="flex flex-wrap justify-center gap-1">
              {(['json', 'text', 'xml', 'urlencoded'] as const).map((t) => (
                <button
                  key={t}
                  type="button"
                  onClick={() => updatePatch({ body: { type: t, content: '' } })}
                  className="inline-flex h-6 items-center rounded-sm border border-accent/40 bg-accent/10 px-2 text-[0.625rem] text-accent hover:bg-accent/20"
                >
                  Set to {t}
                </button>
              ))}
            </div>
          </div>
        ) : overrideBody.type === 'json' ||
          overrideBody.type === 'text' ||
          overrideBody.type === 'xml' ||
          overrideBody.type === 'graphql' ||
          overrideBody.type === 'urlencoded' ? (
          <textarea
            aria-label="Override body content"
            value={overrideBody.content}
            onChange={(e) =>
              updatePatch({
                body: { ...overrideBody, content: e.target.value },
              })
            }
            rows={6}
            className="block w-full rounded-sm border border-border bg-card px-2 py-1.5 font-mono text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        ) : (
          <p className="rounded-sm border border-dashed border-border-subtle p-2 text-center text-[0.6875rem] text-text-dim">
            Body type &quot;{overrideBody.type}&quot; — full editor lands in a later slice. For now,
            edit body via the dedicated editor on owned requests, or reset to source.
          </p>
        )}
      </section>

      <section aria-label="Override headers">
        <header className="mb-1 flex items-center justify-between">
          <h3 className={labelClass}>Headers (override)</h3>
        </header>
        <KeyValueRows
          ariaLabel="Override header"
          rows={overrideHeaders}
          onChange={(rows) => updatePatch({ headers: rows })}
          keyPlaceholder="Header"
          valuePlaceholder="value"
        />
      </section>

      <section aria-label="Override context vars">
        <header className="mb-1 flex items-center justify-between">
          <h3 className={labelClass}>Manual context vars (override)</h3>
        </header>
        <ContextVarRows
          rows={overrideContextVars}
          onChange={(rows) => updatePatch({ contextVars: rows })}
        />
      </section>

      <section aria-label="Override extractions">
        <header className="mb-1 flex items-center justify-between">
          <h3 className={labelClass}>Response extractors (override)</h3>
        </header>
        <ExtractionRows
          rows={overrideExtractions}
          onChange={(rows) => updatePatch({ extractions: rows })}
        />
      </section>

      <section aria-label="Override assertions">
        <header className="mb-1 flex items-center justify-between">
          <h3 className={labelClass}>Assertions (override)</h3>
        </header>
        <AssertionRows
          rows={overrideAssertions}
          onChange={(rows) => updatePatch({ assertions: rows })}
        />
      </section>

      {override && (
        <ResetOverrideButton
          onConfirm={() => clearOverride(linkedWorkspaceId, itemId)}
          updatedAt={override.updatedAt}
        />
      )}
    </div>
  );
}

function ContextVarRows({
  rows,
  onChange,
}: {
  rows: ApiRequest['contextVars'];
  onChange: (rows: ApiRequest['contextVars']) => void;
}) {
  const update = (index: number, patch: Partial<{ key: string; value: string }>) =>
    onChange(rows.map((r, i) => (i === index ? { ...r, ...patch } : r)));
  const add = () => onChange([...rows, { key: '', value: '' }]);
  const remove = (index: number) => onChange(rows.filter((_, i) => i !== index));
  return (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-2 text-center text-[0.6875rem] text-text-dim">
          No context vars.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={i} className="flex items-center gap-2">
          <input
            value={row.key}
            onChange={(e) => update(i, { key: e.target.value })}
            aria-label={`Override context var ${i + 1} key`}
            className={inputClass}
            placeholder="NAME"
          />
          <input
            value={row.value}
            onChange={(e) => update(i, { value: e.target.value })}
            aria-label={`Override context var ${i + 1} value`}
            className={inputClass}
            placeholder="value"
          />
          <button
            type="button"
            onClick={() => remove(i)}
            aria-label={`Remove override context var ${i + 1}`}
            className="text-text-faint hover:text-danger"
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        Add row
      </button>
    </div>
  );
}

function ExtractionRows({
  rows,
  onChange,
}: {
  rows: ContextExtraction[];
  onChange: (rows: ContextExtraction[]) => void;
}) {
  const update = (id: string, patch: Partial<ContextExtraction>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = () =>
    onChange([
      ...rows,
      { id: generateId(), variable: '', source: 'body', path: '', enabled: true },
    ]);
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-2 text-center text-[0.6875rem] text-text-dim">
          No extractors.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={row.id} className="grid grid-cols-[auto_1fr_120px_2fr_auto] items-center gap-2">
          <input
            type="checkbox"
            checked={row.enabled}
            onChange={(e) => update(row.id, { enabled: e.target.checked })}
            aria-label={`Enable override extraction ${i + 1}`}
            style={{ accentColor: 'rgb(var(--accent))' }}
          />
          <input
            value={row.variable}
            onChange={(e) => update(row.id, { variable: e.target.value })}
            aria-label={`Override extraction ${i + 1} variable`}
            className={inputClass}
            placeholder="VAR"
          />
          <select
            value={row.source}
            onChange={(e) =>
              update(row.id, { source: e.target.value as ContextExtraction['source'] })
            }
            aria-label={`Override extraction ${i + 1} source`}
            className={inputClass}
          >
            <option value="body">Body</option>
            <option value="header">Header</option>
            <option value="cookie">Cookie</option>
            <option value="status">Status</option>
          </select>
          <input
            value={row.path}
            onChange={(e) => update(row.id, { path: e.target.value })}
            disabled={row.source === 'status'}
            aria-label={`Override extraction ${i + 1} path`}
            className={inputClass}
            placeholder="data.token"
          />
          <button
            type="button"
            onClick={() => remove(row.id)}
            aria-label={`Remove override extraction ${i + 1}`}
            className="text-text-faint hover:text-danger"
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        Add extractor
      </button>
    </div>
  );
}

function AssertionRows({
  rows,
  onChange,
}: {
  rows: Assertion[];
  onChange: (rows: Assertion[]) => void;
}) {
  const update = (id: string, patch: Partial<Assertion>) =>
    onChange(rows.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  const add = () =>
    onChange([...rows, { id: generateId(), kind: 'status', op: 'equals', expected: 200 }]);
  const remove = (id: string) => onChange(rows.filter((r) => r.id !== id));
  return (
    <div className="flex flex-col gap-1">
      {rows.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-2 text-center text-[0.6875rem] text-text-dim">
          No assertions.
        </p>
      )}
      {rows.map((row, i) => (
        <div key={row.id} className="flex items-center gap-2">
          <select
            value={row.kind}
            onChange={(e) =>
              update(row.id, kindChangePatch(row, e.target.value as Assertion['kind']))
            }
            aria-label={`Override assertion ${i + 1} kind`}
            className={inputClass}
          >
            <option value="status">status</option>
            <option value="header">header</option>
            <option value="json-path">json-path</option>
            <option value="duration">duration</option>
            <option value="json-schema">json-schema</option>
          </select>
          {row.kind !== 'status' && (
            <input
              value={row.target ?? ''}
              onChange={(e) => update(row.id, { target: e.target.value })}
              aria-label={`Override assertion ${i + 1} target`}
              className={inputClass}
              placeholder="path/header/duration"
            />
          )}
          <select
            value={row.op}
            onChange={(e) => update(row.id, opChangePatch(row, e.target.value as Assertion['op']))}
            aria-label={`Override assertion ${i + 1} op`}
            className={inputClass}
          >
            {row.kind === 'json-schema' ? (
              <option value="matches-schema">matches schema</option>
            ) : (
              <>
                <option value="equals">equals</option>
                <option value="not-equals">not-equals</option>
                <option value="contains">contains</option>
                <option value="lt">{'<'}</option>
                <option value="gt">{'>'}</option>
                <option value="matches">matches</option>
                <option value="exists">exists</option>
                <option value="type">is type</option>
              </>
            )}
          </select>
          {row.op === 'matches-schema' ? (
            <textarea
              value={String(row.expected)}
              onChange={(e) => update(row.id, { expected: e.target.value })}
              aria-label={`Override assertion ${i + 1} schema`}
              rows={3}
              className="min-w-0 flex-1 rounded-sm border border-border bg-card px-1 py-0.5 font-mono text-[0.6875rem] text-text-primary"
            />
          ) : row.op === 'exists' ? (
            <span
              aria-label={`Override assertion ${i + 1} expected`}
              className="flex-1 px-1 text-[0.6875rem] text-text-dim"
            >
              no value
            </span>
          ) : row.op === 'type' ? (
            <select
              value={String(row.expected)}
              onChange={(e) => update(row.id, { expected: e.target.value })}
              aria-label={`Override assertion ${i + 1} expected`}
              className={inputClass}
            >
              {JSON_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t}
                </option>
              ))}
            </select>
          ) : (
            <input
              value={String(row.expected)}
              onChange={(e) => {
                const raw = e.target.value;
                const numeric = Number(raw);
                update(row.id, { expected: !raw.length || Number.isNaN(numeric) ? raw : numeric });
              }}
              aria-label={`Override assertion ${i + 1} expected`}
              className={inputClass}
              placeholder="expected"
            />
          )}
          <button
            type="button"
            onClick={() => remove(row.id)}
            aria-label={`Remove override assertion ${i + 1}`}
            className="text-text-faint hover:text-danger"
          >
            <Trash2 size={12} aria-hidden="true" />
          </button>
        </div>
      ))}
      <button
        type="button"
        onClick={add}
        className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        Add assertion
      </button>
    </div>
  );
}

function ResetFieldButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="text-[0.625rem] text-text-dim hover:text-danger"
      aria-label="Reset this field to source"
    >
      Reset to source
    </button>
  );
}

function ResetOverrideButton({
  onConfirm,
  updatedAt,
}: {
  onConfirm: () => void;
  updatedAt: string;
}) {
  const [open, setOpen] = useState(false);
  return (
    <div className="flex items-center justify-between rounded-sm border border-border-subtle bg-surface px-3 py-2 text-[0.6875rem] text-text-muted">
      <span>Override saved {new Date(updatedAt).toLocaleString()}</span>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-sm border border-border bg-card px-2 py-0.5 text-text-muted hover:border-danger/40 hover:text-danger"
      >
        Reset to source
      </button>
      <ConfirmDialog
        open={open}
        title="Reset override"
        description="Drop your local override for this linked request? The source workspace's values will apply on the next run."
        confirmLabel="Reset"
        tone="danger"
        onConfirm={() => {
          onConfirm();
          setOpen(false);
        }}
        onCancel={() => setOpen(false)}
      />
    </div>
  );
}
