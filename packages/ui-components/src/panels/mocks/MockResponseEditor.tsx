import { useRef, useState } from 'react';
import { Paperclip, Plus, Trash2, X } from 'lucide-react';
import {
  coerceMockResponseBodyTypeForStatus,
  formatBytes,
  generateId,
  getAllowedMockResponseBodyTypes,
  makeDefaultMockResponseBody,
  type MockMultiplierSourceKind,
  type MockResponseBody,
  type MockResponseBodyType,
  type MockResponseConfig,
  type MockResponseMultiplier,
} from '@apicircle/shared';
// MockResponseBodyType is still used by the body-type picker below. Keeping
// import explicit so a future tree-shake doesn't quietly drop it.
import { applyContentTypeForBodyType } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { MonacoBodyEditor } from '../../editors/MonacoBodyEditor';
import { HeaderKeyAutocomplete, HeaderValueRecommendations } from '../editor/HeaderAutocomplete';
import { cn } from '../../primitives/cn';
import { Select } from '../../primitives/Select';

// Reusable editor for a `MockResponseConfig`. Used by:
//   • Default Response tab (full editor)
//   • Validation fail responses (compact mode)
//   • Response Rule "then" responses (compact mode)
//
// The `attachmentSlot` prop tells the editor whether binary uploads
// should land in the workspace's attachment store (Default Response on
// a real endpoint) or be rejected (validation/rules don't currently
// support attachments — that would require a slot-id namespacing
// strategy across nested response contexts; deferred to a follow-up).

const BODY_TYPES: Array<{ id: MockResponseBodyType; label: string }> = [
  { id: 'none', label: 'none' },
  { id: 'json', label: 'JSON' },
  { id: 'text', label: 'text' },
  { id: 'xml', label: 'XML' },
  { id: 'urlencoded', label: 'urlencoded' },
  { id: 'form-data', label: 'form-data' },
  { id: 'binary', label: 'binary (file)' },
];

export function MockResponseEditor({
  label,
  value,
  onChange,
  attachmentSlot,
  compact,
}: {
  label: string;
  value: MockResponseConfig;
  onChange: (next: MockResponseConfig) => void;
  /** Pass null to disable attachment uploads in this context. */
  attachmentSlot: { serverId: string; endpointId: string } | null;
  compact?: boolean;
}) {
  // Phase 3: when the body type changes, also auto-update the
  // Content-Type header to the matching MIME so the wire stays
  // consistent. Reuses `applyContentTypeForBodyType` from core (the
  // same helper the request editor uses for its body tab).
  const setBodyAndSyncContentType = (body: MockResponseBody) => {
    const headers = applyContentTypeForBodyType(value.headers, body.type);
    onChange({ ...value, body, headers });
  };
  const setBody = setBodyAndSyncContentType;
  const setStatus = (status: number) => {
    // Status-aware coercion (Phase 2): if the new status forbids the
    // current body type — e.g. 200→404 with binary, or 200→204 with
    // any body — silently switch to the safest allowed type so the
    // user doesn't end up with an invalid response on the wire.
    const coercedType = coerceMockResponseBodyTypeForStatus(value.body.type, status);
    if (coercedType !== null) {
      const nextBody = makeDefaultMockResponseBody(coercedType);
      const nextHeaders = applyContentTypeForBodyType(value.headers, nextBody.type);
      onChange({ ...value, status, body: nextBody, headers: nextHeaders });
    } else {
      onChange({ ...value, status });
    }
  };
  const setHeaders = (headers: MockResponseConfig['headers']) => onChange({ ...value, headers });
  const setDelay = (delayMs: number | undefined) =>
    onChange({ ...value, ...(delayMs !== undefined ? { delayMs } : { delayMs: undefined }) });

  const allowedBodyTypes = getAllowedMockResponseBodyTypes(value.status);

  return (
    <div className="space-y-2">
      <div className="flex items-center gap-2">
        <label className="text-[11px] text-text-dim">Status</label>
        <input
          type="number"
          min={100}
          max={599}
          value={value.status}
          onChange={(e) => setStatus(Number(e.target.value) || 200)}
          aria-label={`${label} status`}
          className="h-7 w-16 rounded-sm border border-border bg-card px-1 text-center font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
        />
        <label className="ml-2 text-[11px] text-text-dim">Delay (ms)</label>
        <input
          type="number"
          min={0}
          value={value.delayMs ?? 0}
          onChange={(e) => {
            const n = Math.max(0, Number(e.target.value) || 0);
            setDelay(n > 0 ? n : undefined);
          }}
          aria-label={`${label} delay`}
          className="h-7 w-20 rounded-sm border border-border bg-card px-1 text-center font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
        />
      </div>

      <HeadersEditor
        label={label}
        headers={value.headers}
        onChange={setHeaders}
        compact={compact}
      />

      <BodyTypePicker
        label={label}
        body={value.body}
        allowedTypes={allowedBodyTypes}
        status={value.status}
        onTypeChange={(type) => setBody(makeDefaultMockResponseBody(type))}
      />

      {/* Multipliers sit ABOVE the body editor so they're visible without
          scrolling past 300+ pixel Monaco. Gated to JSON success responses
          (status < 300) — multipliers don't make semantic sense on error
          responses and Monaco isn't shown for non-text bodies anyway. */}
      {value.body.type === 'json' && value.status < 300 && (
        <MultipliersEditor
          label={label}
          multipliers={value.multipliers ?? []}
          onChange={(next) =>
            onChange({ ...value, multipliers: next.length === 0 ? undefined : next })
          }
        />
      )}

      <BodyContentEditor
        label={label}
        body={value.body}
        onContentChange={(content) => {
          if (
            value.body.type === 'json' ||
            value.body.type === 'text' ||
            value.body.type === 'xml' ||
            value.body.type === 'urlencoded'
          ) {
            setBody({ ...value.body, content });
          }
        }}
        onFormRowsChange={(formRows) => {
          if (value.body.type === 'form-data') {
            setBody({ type: 'form-data', content: '', formRows });
          }
        }}
        attachmentSlot={attachmentSlot}
        compact={compact}
      />
    </div>
  );
}

function HeadersEditor({
  label,
  headers,
  onChange,
  compact,
}: {
  label: string;
  headers: MockResponseConfig['headers'];
  onChange: (next: MockResponseConfig['headers']) => void;
  compact?: boolean;
}) {
  // `compact` was previously used to default-collapse the headers section
  // inside validation/response rule editors; user feedback is to keep it
  // expanded everywhere so the editable rows are visible at a glance. The
  // <details> element still allows manual collapse via the summary.
  void compact;
  const update = (idx: number, patch: Partial<MockResponseConfig['headers'][number]>) => {
    const next = [...headers];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(headers.filter((_, i) => i !== idx));
  const add = () => onChange([...headers, { key: '', value: '', enabled: true }]);

  return (
    <details open className="rounded-sm border border-border-subtle bg-card p-2">
      <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wider text-text-dim">
        Response headers ({headers.length})
      </summary>
      <ul className="mt-2 space-y-1">
        {headers.map((h, idx) => (
          <ResponseHeaderRow
            key={idx}
            label={label}
            header={h}
            index={idx}
            onChange={(patch) => update(idx, patch)}
            onRemove={() => remove(idx)}
          />
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        aria-label={`Add ${label} header`}
        className="mt-1.5 inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[10px] text-text-muted hover:border-border-strong hover:text-text-primary"
      >
        + Header
      </button>
    </details>
  );
}

function ResponseHeaderRow({
  label,
  header,
  index,
  onChange,
  onRemove,
}: {
  label: string;
  header: MockResponseConfig['headers'][number];
  index: number;
  onChange: (patch: Partial<MockResponseConfig['headers'][number]>) => void;
  onRemove: () => void;
}) {
  // Track focus on the value input so we can show the curated-values
  // popover only when focused — mirrors the request editor's UX.
  const [valueFocused, setValueFocused] = useState(false);
  return (
    <li className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1">
      <input
        type="checkbox"
        checked={header.enabled}
        onChange={(e) => onChange({ enabled: e.target.checked })}
        aria-label={`${label} header ${index + 1} enabled`}
        style={{ accentColor: 'rgb(var(--accent))' }}
      />
      <HeaderKeyAutocomplete
        value={header.key}
        onChange={(next) => onChange({ key: next })}
        ariaLabel={`${label} header ${index + 1} name`}
        placeholder="Header name"
        mode="response"
      />
      <div className="relative">
        <input
          value={header.value}
          onChange={(e) => onChange({ value: e.target.value })}
          onFocus={() => setValueFocused(true)}
          onBlur={() => setTimeout(() => setValueFocused(false), 150)}
          placeholder="value"
          aria-label={`${label} header ${index + 1} value`}
          className="h-7 w-full rounded-sm border border-border bg-card px-2 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        <HeaderValueRecommendations
          headerKey={header.key}
          currentValue={header.value}
          isFocused={valueFocused}
          onPick={(v) => onChange({ value: v })}
          ariaLabel={`${label} header ${index + 1} value suggestions`}
        />
      </div>
      <button
        type="button"
        onClick={onRemove}
        aria-label={`Remove ${label} header ${index + 1}`}
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
      >
        <X size={9} aria-hidden="true" />
      </button>
    </li>
  );
}

function BodyTypePicker({
  label,
  body,
  allowedTypes,
  status,
  onTypeChange,
}: {
  label: string;
  body: MockResponseBody;
  allowedTypes: MockResponseBodyType[];
  status: number;
  onTypeChange: (type: MockResponseBodyType) => void;
}) {
  const allowed = new Set(allowedTypes);
  return (
    <div className="flex flex-wrap items-center gap-1">
      <span className="text-[10px] text-text-dim">Body</span>
      <div role="tablist" aria-label={`${label} body type`} className="flex flex-wrap gap-1">
        {BODY_TYPES.map((bt) => {
          const active = body.type === bt.id;
          const enabled = allowed.has(bt.id);
          // The disabled chips render with a dim tone + tooltip
          // explaining why — keeps the affordance visible (so users
          // know binary IS supported, just not for this status) while
          // preventing invalid selection.
          const tooltip = !enabled
            ? bt.id === 'binary'
              ? `Binary file responses are only supported on status 200 (current: ${status}).`
              : `Status ${status} doesn't support a body.`
            : undefined;
          return (
            <button
              key={bt.id}
              type="button"
              role="tab"
              aria-selected={active}
              aria-disabled={!enabled}
              disabled={!enabled}
              title={tooltip}
              onClick={() => enabled && onTypeChange(bt.id)}
              className={
                !enabled
                  ? 'rounded-sm border border-border-subtle bg-card px-2 py-0.5 text-[10px] text-text-faint opacity-50 cursor-not-allowed'
                  : active
                    ? 'rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] font-medium text-accent'
                    : 'rounded-sm border border-border bg-card px-2 py-0.5 text-[10px] text-text-muted hover:border-border-strong hover:text-text-primary'
              }
            >
              {bt.label}
            </button>
          );
        })}
      </div>
    </div>
  );
}

function BodyContentEditor({
  label,
  body,
  onContentChange,
  onFormRowsChange,
  attachmentSlot,
  compact,
}: {
  label: string;
  body: MockResponseBody;
  onContentChange: (content: string) => void;
  onFormRowsChange: (rows: Array<{ key: string; value: string; enabled: boolean }>) => void;
  attachmentSlot: { serverId: string; endpointId: string } | null;
  compact?: boolean;
}) {
  if (body.type === 'none') {
    return (
      <p className="rounded-sm border border-dashed border-border-subtle px-2 py-3 text-center text-[11px] text-text-dim">
        No body — runtime returns Content-Length: 0.
      </p>
    );
  }
  if (body.type === 'binary') {
    return <BinaryBodyEditor body={body} attachmentSlot={attachmentSlot} />;
  }
  if (body.type === 'form-data') {
    return (
      <FormDataBodyEditor label={label} formRows={body.formRows} onChange={onFormRowsChange} />
    );
  }
  // json / text / xml / urlencoded all share the Monaco-backed editor.
  // `min-w-0` on the wrapper prevents Monaco's intrinsic width from blowing
  // out the surrounding flex/grid column when the parent (rule card)
  // already has a fixed inner width — without it, Monaco's auto-layout can
  // push the editor past the rule card's right border.
  return (
    <div className={cn('w-full min-w-0 overflow-hidden', compact ? 'h-40' : 'h-72')}>
      <MonacoBodyEditor
        value={body.content}
        bodyType={
          body.type === 'json'
            ? 'json'
            : body.type === 'xml'
              ? 'xml'
              : body.type === 'urlencoded'
                ? 'urlencoded'
                : 'text'
        }
        onChange={onContentChange}
        modelPath={`inmemory://apicircle/mock-response/${attachmentSlot?.endpointId ?? 'inline'}.body`}
        ariaLabel={`${label} body`}
      />
    </div>
  );
}

function BinaryBodyEditor({
  body,
  attachmentSlot,
}: {
  body: Extract<MockResponseBody, { type: 'binary' }>;
  attachmentSlot: { serverId: string; endpointId: string } | null;
}) {
  const fileInputRef = useRef<HTMLInputElement | null>(null);
  const attachMockResponseFile = useWorkspaceStore((s) => s.attachMockResponseFile);
  const detachMockResponseFile = useWorkspaceStore((s) => s.detachMockResponseFile);

  if (!attachmentSlot) {
    return (
      <p className="rounded-sm border border-dashed border-warning/40 px-2 py-3 text-center text-[10px] text-warning">
        File uploads aren&rsquo;t supported in this response context yet — only on the
        endpoint&rsquo;s Default Response.
      </p>
    );
  }

  const onPick = async (file: File | null | undefined) => {
    if (!file) return;
    try {
      await attachMockResponseFile(attachmentSlot.serverId, attachmentSlot.endpointId, file);
    } catch (err) {
      console.error('[MockResponse] attach failed', err);
    }
  };

  const onDrop = async (e: React.DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    const file = e.dataTransfer.files[0];
    if (file) await onPick(file);
  };

  if (body.attachment?.slotId) {
    const a = body.attachment;
    return (
      <div className="flex items-center gap-2 rounded-sm border border-success/30 bg-success/5 px-3 py-2 text-[11px]">
        <Paperclip size={12} className="shrink-0 text-success" aria-hidden="true" />
        <div className="flex-1">
          <div className="font-mono text-text-primary">{a.filename ?? 'unnamed-file'}</div>
          <div className="text-[10px] text-text-dim">
            {a.mimeType ?? 'application/octet-stream'}
            {a.size !== undefined && (
              <>
                {' · '}
                {formatBytes(a.size)}
              </>
            )}
            {a.sha256 && (
              <>
                {' · '}
                <span className="font-mono">{a.sha256.slice(0, 12)}…</span>
              </>
            )}
          </div>
        </div>
        <button
          type="button"
          onClick={() =>
            void detachMockResponseFile(attachmentSlot.serverId, attachmentSlot.endpointId)
          }
          aria-label="Remove uploaded file"
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[10px] text-text-muted hover:border-danger/40 hover:text-danger"
        >
          <Trash2 size={10} aria-hidden="true" />
          Remove
        </button>
      </div>
    );
  }

  return (
    <div
      onClick={() => fileInputRef.current?.click()}
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => void onDrop(e)}
      role="button"
      tabIndex={0}
      onKeyDown={(e) => {
        if (e.key === 'Enter' || e.key === ' ') fileInputRef.current?.click();
      }}
      aria-label="Upload response file"
      className="flex cursor-pointer flex-col items-center gap-1 rounded-sm border-2 border-dashed border-border bg-card px-3 py-6 text-center text-[11px] text-text-muted hover:border-accent/40 hover:text-accent"
    >
      <Paperclip size={16} aria-hidden="true" />
      <span>Click or drop a file to attach</span>
      <span className="text-[10px] text-text-dim">
        Stored as a workspace attachment — survives push to Git.
      </span>
      <input
        ref={fileInputRef}
        type="file"
        className="hidden"
        onChange={(e) => void onPick(e.target.files?.[0])}
        aria-hidden="true"
      />
    </div>
  );
}

function FormDataBodyEditor({
  label,
  formRows,
  onChange,
}: {
  label: string;
  formRows: Array<{ key: string; value: string; enabled: boolean }>;
  onChange: (rows: Array<{ key: string; value: string; enabled: boolean }>) => void;
}) {
  const update = (
    idx: number,
    patch: Partial<{ key: string; value: string; enabled: boolean }>,
  ) => {
    const next = [...formRows];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const remove = (idx: number) => onChange(formRows.filter((_, i) => i !== idx));
  const add = () => onChange([...formRows, { key: '', value: '', enabled: true }]);

  return (
    <div className="space-y-1 rounded-sm border border-border bg-card p-2">
      <ul className="space-y-1">
        {formRows.map((row, idx) => (
          <li
            key={idx}
            className="grid grid-cols-[auto_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1"
          >
            <input
              type="checkbox"
              checked={row.enabled}
              onChange={(e) => update(idx, { enabled: e.target.checked })}
              aria-label={`${label} form row ${idx + 1} enabled`}
              style={{ accentColor: 'rgb(var(--accent))' }}
            />
            <input
              value={row.key}
              onChange={(e) => update(idx, { key: e.target.value })}
              placeholder="field"
              aria-label={`${label} form row ${idx + 1} key`}
              className="h-6 rounded-sm border border-border bg-surface px-1.5 font-mono text-[10px] text-text-primary focus:border-accent focus:outline-none"
            />
            <input
              value={row.value}
              onChange={(e) => update(idx, { value: e.target.value })}
              placeholder="value"
              aria-label={`${label} form row ${idx + 1} value`}
              className="h-6 rounded-sm border border-border bg-surface px-1.5 font-mono text-[10px] text-text-primary focus:border-accent focus:outline-none"
            />
            <button
              type="button"
              onClick={() => remove(idx)}
              aria-label={`Remove ${label} form row ${idx + 1}`}
              className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
            >
              <X size={9} aria-hidden="true" />
            </button>
          </li>
        ))}
      </ul>
      <button
        type="button"
        onClick={add}
        aria-label={`Add ${label} form row`}
        className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[10px] text-text-muted hover:border-border-strong hover:text-text-primary"
      >
        + Field
      </button>
    </div>
  );
}

// =============================================================================
// Response multipliers — repeat an array element inside the body N times
// based on a query/path/header/body-field value from the inbound request.
// =============================================================================

const MULTIPLIER_SOURCE_LABEL: Record<MockMultiplierSourceKind, string> = {
  query: 'Query',
  pathParam: 'Path param',
  header: 'Header',
  'body-json-path': 'Request body (JSON path)',
};

const MULTIPLIER_SOURCE_PLACEHOLDER: Record<MockMultiplierSourceKind, string> = {
  query: 'pageSize',
  pathParam: 'count',
  header: 'X-Page-Size',
  'body-json-path': '$.page.size',
};

function MultipliersEditor({
  label,
  multipliers,
  onChange,
}: {
  label: string;
  multipliers: MockResponseMultiplier[];
  onChange: (next: MockResponseMultiplier[]) => void;
}) {
  const update = (idx: number, patch: Partial<MockResponseMultiplier>) => {
    const next = multipliers.map((m, i) => (i === idx ? { ...m, ...patch } : m));
    onChange(next);
  };
  const updateSource = (idx: number, patch: Partial<MockResponseMultiplier['source']>) => {
    const next = multipliers.map((m, i) =>
      i === idx ? { ...m, source: { ...m.source, ...patch } } : m,
    );
    onChange(next);
  };
  const remove = (idx: number) => onChange(multipliers.filter((_, i) => i !== idx));
  const add = () => {
    onChange([
      ...multipliers,
      {
        id: generateId(),
        source: { kind: 'query', key: '' },
        targetJsonPath: '$.items',
        defaultCount: 3,
      },
    ]);
  };

  return (
    <details
      open={multipliers.length > 0}
      className="rounded-sm border border-border-subtle bg-card p-2"
    >
      <summary className="cursor-pointer text-[10px] font-medium uppercase tracking-wider text-text-dim">
        Response multipliers ({multipliers.length})
      </summary>
      <div className="mt-2 space-y-2">
        {multipliers.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[11px] text-text-dim">
            No multipliers — server returns the body as-authored. Add one to repeat an array inside
            the response body based on a request value.
          </p>
        ) : (
          <ul className="space-y-2">
            {multipliers.map((m, idx) => (
              <li key={m.id} className="rounded-sm border border-border bg-surface p-2">
                <div className="grid grid-cols-[minmax(0,1.2fr)_minmax(0,1fr)_minmax(0,1.2fr)_auto_auto] gap-1.5">
                  <Select
                    size="sm"
                    value={m.source.kind}
                    onChange={(e) =>
                      updateSource(idx, {
                        kind: e.target.value as MockMultiplierSourceKind,
                      })
                    }
                    aria-label={`${label} multiplier ${idx + 1} source kind`}
                    wrapperClassName="w-full"
                    className="text-[11px] text-text-primary"
                  >
                    {(Object.keys(MULTIPLIER_SOURCE_LABEL) as MockMultiplierSourceKind[]).map(
                      (k) => (
                        <option key={k} value={k}>
                          {MULTIPLIER_SOURCE_LABEL[k]}
                        </option>
                      ),
                    )}
                  </Select>
                  <input
                    value={m.source.key}
                    onChange={(e) => updateSource(idx, { key: e.target.value })}
                    placeholder={MULTIPLIER_SOURCE_PLACEHOLDER[m.source.kind]}
                    aria-label={`${label} multiplier ${idx + 1} source key`}
                    className="h-7 rounded-sm border border-border bg-card px-2 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
                  />
                  <input
                    value={m.targetJsonPath}
                    onChange={(e) => update(idx, { targetJsonPath: e.target.value })}
                    placeholder="$.items"
                    aria-label={`${label} multiplier ${idx + 1} target JSON path`}
                    className="h-7 rounded-sm border border-border bg-card px-2 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
                  />
                  <input
                    type="number"
                    min={0}
                    value={m.defaultCount}
                    onChange={(e) =>
                      update(idx, {
                        defaultCount: Math.max(0, Number(e.target.value) || 0),
                      })
                    }
                    aria-label={`${label} multiplier ${idx + 1} default count`}
                    title="Default count when source is missing or non-numeric"
                    className="h-7 w-16 rounded-sm border border-border bg-card px-1 text-center font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
                  />
                  <button
                    type="button"
                    onClick={() => remove(idx)}
                    aria-label={`Remove ${label} multiplier ${idx + 1}`}
                    className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
                  >
                    <Trash2 size={11} aria-hidden="true" />
                  </button>
                </div>
                <div className="mt-1 grid grid-cols-[auto_minmax(0,4rem)_auto_minmax(0,4rem)_minmax(0,1fr)] items-center gap-1.5 text-[10px] text-text-dim">
                  <label htmlFor={`mul-${m.id}-min`}>Min</label>
                  <input
                    id={`mul-${m.id}-min`}
                    type="number"
                    min={0}
                    value={m.min ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const raw = e.target.value;
                      update(idx, {
                        min: raw === '' ? undefined : Math.max(0, Number(raw) || 0),
                      });
                    }}
                    aria-label={`${label} multiplier ${idx + 1} min`}
                    className="h-6 rounded-sm border border-border bg-card px-1 text-center font-mono text-[10px] text-text-primary focus:border-accent focus:outline-none"
                  />
                  <label htmlFor={`mul-${m.id}-max`}>Max</label>
                  <input
                    id={`mul-${m.id}-max`}
                    type="number"
                    min={0}
                    value={m.max ?? ''}
                    placeholder="—"
                    onChange={(e) => {
                      const raw = e.target.value;
                      update(idx, {
                        max: raw === '' ? undefined : Math.max(0, Number(raw) || 0),
                      });
                    }}
                    aria-label={`${label} multiplier ${idx + 1} max`}
                    className="h-6 rounded-sm border border-border bg-card px-1 text-center font-mono text-[10px] text-text-primary focus:border-accent focus:outline-none"
                  />
                  <input
                    value={m.name ?? ''}
                    onChange={(e) =>
                      update(idx, { name: e.target.value === '' ? undefined : e.target.value })
                    }
                    placeholder="Optional label"
                    aria-label={`${label} multiplier ${idx + 1} label`}
                    className="h-6 rounded-sm border border-border bg-card px-2 text-[10px] text-text-primary focus:border-accent focus:outline-none"
                  />
                </div>
                {m.min !== undefined && m.max !== undefined && m.min > m.max && (
                  <p className="mt-1 rounded-sm border border-warning/30 bg-warning/5 px-2 py-1 text-[10px] text-warning">
                    Min ({m.min}) is greater than Max ({m.max}). At runtime, max wins after the min
                    clamp — adjust to avoid surprise.
                  </p>
                )}
              </li>
            ))}
          </ul>
        )}
        <button
          type="button"
          onClick={add}
          aria-label={`Add ${label} multiplier`}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[11px] text-accent hover:bg-accent/20"
        >
          <Plus size={10} aria-hidden="true" />
          Add multiplier
        </button>
      </div>
    </details>
  );
}
