// Per-request Context tab. Two sections:
//
//   • Manual context vars — key/value pairs entered by the user.
//     These live on the request itself (`request.contextVars`) and are
//     git-synced. They take precedence over the workspace-wide globalContext.
//
//   • Extractors — rules that pull a value out of the response after every
//     successful run. The variable name + path is git-synced (on the request);
//     the extracted *value* lands in `local.globalContext` (local-only, never
//     pushed to Git) and becomes visible to subsequent requests + plan steps
//     as `{{name}}`. The local store survives reload via IDB.

import { memo, useState } from 'react';
import { Crosshair, Plus, Trash2 } from 'lucide-react';
import type { ContextExtraction, Request as ApiRequest } from '@apicircle/shared';
import { generateId, validateEnvVarName, validateJsonPath } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { cn } from '../../primitives/cn';
import { JsonPathPicker } from './JsonPathPicker';
import { useRowKeyboardNav } from './useRowKeyboardNav';

interface ContextTabProps {
  request: ApiRequest;
}

const inputClass =
  'h-7 w-full rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30';
const sectionTitle = 'text-[0.6875rem] uppercase tracking-wide text-text-dim';

const SOURCES: Array<{ id: ContextExtraction['source']; label: string; placeholder: string }> = [
  { id: 'body', label: 'Body (JSON path)', placeholder: 'data.token' },
  { id: 'header', label: 'Response header', placeholder: 'X-Request-Id' },
  { id: 'cookie', label: 'Cookie', placeholder: 'session' },
  { id: 'status', label: 'Status code', placeholder: '(ignored)' },
];

// memo'd — see ParamsTab for the rationale.
export const ContextTab = memo(function ContextTab({ request }: ContextTabProps) {
  const setContextVars = useWorkspaceStore((s) => s.setRequestContextVars);
  const setExtractions = useWorkspaceStore((s) => s.setRequestExtractions);
  const lastRunBody = useWorkspaceStore((s) => s.lastRun[request.id]?.body ?? '');
  const lastRunBodyKind = useWorkspaceStore((s) => s.lastRun[request.id]?.bodyKind ?? null);
  const [pickerForExtractionId, setPickerForExtractionId] = useState<string | null>(null);

  const updateRow = (index: number, patch: Partial<{ key: string; value: string }>): void => {
    setContextVars(
      request.id,
      request.contextVars.map((r, i) => (i === index ? { ...r, ...patch } : r)),
    );
  };
  const addCtxRow = () =>
    setContextVars(request.id, [...request.contextVars, { key: '', value: '' }]);
  const removeCtxRow = (index: number) =>
    setContextVars(
      request.id,
      request.contextVars.filter((_, i) => i !== index),
    );

  // Row keyboard nav for the Manual variables section. Field labels match
  // the aria-labels on each cell so focusCell() can find them.
  const ctxKeyboard = useRowKeyboardNav({
    ariaPrefix: 'Context var',
    fields: ['name', 'value'],
    rowCount: request.contextVars.length,
    isRowEmpty: (i) => request.contextVars[i]?.key === '' && request.contextVars[i]?.value === '',
    onAdd: addCtxRow,
    onRemove: removeCtxRow,
  });

  const updateExtraction = (id: string, patch: Partial<ContextExtraction>) =>
    setExtractions(
      request.id,
      request.extractions.map((e) => (e.id === id ? { ...e, ...patch } : e)),
    );
  const addExtraction = () =>
    setExtractions(request.id, [
      ...request.extractions,
      { id: generateId(), variable: '', source: 'body', path: '', enabled: true },
    ]);
  const removeExtraction = (id: string) =>
    setExtractions(
      request.id,
      request.extractions.filter((e) => e.id !== id),
    );

  return (
    <div className="flex flex-col gap-4">
      <section aria-label="Manual context variables" className="flex flex-col gap-2">
        <header className="flex items-center justify-between">
          <h3 className={sectionTitle}>Manual variables</h3>
          <span className="text-[0.6875rem] text-text-dim">
            Stored on the request — pushed to Git.
          </span>
        </header>
        <div className="flex flex-col gap-1">
          {request.contextVars.length === 0 && (
            <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
              No manual variables. Add one below or extract from the response.
            </p>
          )}
          {request.contextVars.map((row, i) => {
            const nameValidation =
              row.key.trim().length > 0 ? validateEnvVarName(row.key) : { ok: true as const };
            const nameInvalid = !nameValidation.ok;
            return (
              <div key={i} className="flex flex-col gap-0.5">
                <div className="flex items-center gap-2">
                  <input
                    value={row.key}
                    onChange={(e) => updateRow(i, { key: e.target.value })}
                    onKeyDown={(e) => ctxKeyboard.onKeyDown(e, i, 'name')}
                    aria-label={`Context var ${i + 1} name`}
                    aria-invalid={nameInvalid || undefined}
                    placeholder="NAME"
                    className={cn(
                      inputClass,
                      nameInvalid && 'border-danger focus:border-danger focus:ring-danger/40',
                    )}
                  />
                  <input
                    value={row.value}
                    onChange={(e) => updateRow(i, { value: e.target.value })}
                    onKeyDown={(e) => ctxKeyboard.onKeyDown(e, i, 'value')}
                    aria-label={`Context var ${i + 1} value`}
                    placeholder="value"
                    className={inputClass}
                  />
                  <button
                    type="button"
                    onClick={() => removeCtxRow(i)}
                    aria-label={`Remove context var ${i + 1}`}
                    className="text-text-faint hover:text-danger"
                  >
                    <Trash2 size={12} />
                  </button>
                </div>
                {nameInvalid && !nameValidation.ok && (
                  <p role="alert" className="ml-1 text-[0.625rem] text-danger">
                    {nameValidation.reason}
                  </p>
                )}
              </div>
            );
          })}
          <button
            type="button"
            onClick={addCtxRow}
            className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
          >
            <Plus size={12} />
            Add manual variable
          </button>
        </div>
      </section>

      <section aria-label="Response extractions" className="flex flex-col gap-2">
        <header className="flex items-center justify-between">
          <h3 className={sectionTitle}>Auto-extract from response</h3>
          <span className="text-[0.6875rem] text-text-dim">
            Names + paths pushed to Git · captured values stay local · feed <code>{'{{var}}'}</code>{' '}
            in next requests.
          </span>
        </header>
        <div className="flex flex-col gap-1">
          {request.extractions.length === 0 && (
            <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
              No extractors yet. Add one to capture a token, status, header, or JSON path.
            </p>
          )}
          {request.extractions.map((ex, idx) => (
            <div key={ex.id} className="grid grid-cols-[auto_1fr_auto_2fr_auto] items-center gap-2">
              <input
                type="checkbox"
                checked={ex.enabled}
                onChange={(e) => updateExtraction(ex.id, { enabled: e.target.checked })}
                aria-label={`Enable extraction ${idx + 1}`}
                style={{ accentColor: 'rgb(var(--accent))' }}
              />
              <ExtractionVariableInput
                value={ex.variable}
                onChange={(v) => updateExtraction(ex.id, { variable: v })}
                index={idx}
              />
              <select
                value={ex.source}
                onChange={(e) =>
                  updateExtraction(ex.id, { source: e.target.value as ContextExtraction['source'] })
                }
                aria-label={`Extraction ${idx + 1} source`}
                className={cn(inputClass, 'w-[170px]')}
              >
                {SOURCES.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.label}
                  </option>
                ))}
              </select>
              <div className="flex flex-col gap-0.5">
                <div className="flex items-center gap-1">
                  <input
                    value={ex.path}
                    onChange={(e) => updateExtraction(ex.id, { path: e.target.value })}
                    aria-label={`Extraction ${idx + 1} path`}
                    placeholder={SOURCES.find((s) => s.id === ex.source)?.placeholder}
                    disabled={ex.source === 'status'}
                    aria-invalid={(() => {
                      if (ex.source !== 'body' || !ex.path) return undefined;
                      return validateJsonPath(ex.path).ok ? undefined : true;
                    })()}
                    className={cn(
                      inputClass,
                      'font-mono',
                      ex.source === 'status' && 'opacity-50',
                      ex.source === 'body' &&
                        ex.path &&
                        !validateJsonPath(ex.path).ok &&
                        'border-danger',
                    )}
                  />
                  {ex.source === 'body' && (
                    <button
                      type="button"
                      onClick={() => setPickerForExtractionId(ex.id)}
                      disabled={!lastRunBody || lastRunBodyKind !== 'json'}
                      aria-label={`Pick JSON path for extraction ${idx + 1}`}
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
                {ex.source === 'body' && ex.path && !validateJsonPath(ex.path).ok && (
                  <p role="alert" className="text-[0.625rem] text-danger">
                    {validateJsonPath(ex.path).ok
                      ? ''
                      : (validateJsonPath(ex.path) as { ok: false; reason: string }).reason}
                  </p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeExtraction(ex.id)}
                aria-label={`Remove extraction ${idx + 1}`}
                className="text-text-faint hover:text-danger"
              >
                <Trash2 size={12} />
              </button>
            </div>
          ))}
          <button
            type="button"
            onClick={addExtraction}
            className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
          >
            <Plus size={12} />
            Add extractor
          </button>
        </div>
      </section>

      {pickerForExtractionId && (
        <JsonPathPicker
          jsonText={lastRunBody}
          title={request.name}
          onClose={() => setPickerForExtractionId(null)}
          onPick={(path) => {
            updateExtraction(pickerForExtractionId, { path });
          }}
        />
      )}
    </div>
  );
});

function ExtractionVariableInput({
  value,
  onChange,
  index,
}: {
  value: string;
  onChange: (v: string) => void;
  index: number;
}) {
  const validation = value.trim().length > 0 ? validateEnvVarName(value) : { ok: true as const };
  const invalid = !validation.ok;
  return (
    <div className="flex flex-col">
      <input
        value={value}
        onChange={(e) => onChange(e.target.value)}
        aria-label={`Extraction ${index + 1} variable`}
        aria-invalid={invalid || undefined}
        placeholder="VAR_NAME"
        className={cn(
          inputClass,
          'font-mono',
          invalid && 'border-danger focus:border-danger focus:ring-danger/40',
        )}
      />
      {invalid && !validation.ok && (
        <p role="alert" className="mt-0.5 text-[0.625rem] text-danger">
          {validation.reason}
        </p>
      )}
    </div>
  );
}
