import { Plus, Trash2, Wand2 } from 'lucide-react';
import {
  generateId,
  type MockEndpoint,
  type MockParamDef,
  type MockRequestSchema,
} from '@apicircle/shared';
import { Select } from '../../primitives/Select';

// =============================================================================
// Request-schema editor — declares the inputs a mock endpoint expects (path /
// query / header / cookie params + a body-shape doc). The data lives on
// MockEndpoint.requestSchema in WorkspaceSynced, so edits here round-trip
// through .apicircle/workspace.json and stay in sync with the VS Code YAML
// authoring surface + the OpenAPI export. Documentation-only — the runtime
// validation engine is driven by the separate requestValidation rules.
// =============================================================================

const TYPE_HINTS: readonly string[] = [
  'string',
  'integer',
  'number',
  'boolean',
  'array',
  'object',
  'uuid',
  'date-time',
  'email',
];

type ParamListKey = 'pathParams' | 'queryParams' | 'headers' | 'cookies';

const PARAM_LISTS: ReadonlyArray<{ key: ParamListKey; label: string; singular: string }> = [
  { key: 'pathParams', label: 'Path params', singular: 'path param' },
  { key: 'queryParams', label: 'Query params', singular: 'query param' },
  { key: 'headers', label: 'Headers', singular: 'header' },
  { key: 'cookies', label: 'Cookies', singular: 'cookie' },
];

/** Extract `{slot}` names from an OpenAPI-style path pattern. */
function pathSlots(pathPattern: string): string[] {
  const out: string[] = [];
  const re = /\{([^}]+)\}/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(pathPattern)) !== null) out.push(m[1]);
  return out;
}

export function MockRequestSchemaEditor({
  endpoint,
  setEndpoint,
}: {
  endpoint: MockEndpoint;
  setEndpoint: (patch: Partial<MockEndpoint>) => void;
}) {
  const schema = endpoint.requestSchema;
  const setSchema = (next: MockRequestSchema) => setEndpoint({ requestSchema: next });
  const setList = (key: ParamListKey, next: MockParamDef[]) =>
    setSchema({ ...schema, [key]: next });

  const deriveFromPath = () => {
    const declared = new Set(schema.pathParams.map((p) => p.name));
    const additions = pathSlots(endpoint.pathPattern)
      .filter((slot) => !declared.has(slot))
      .map((name) => ({ id: generateId(), name, typeHint: 'string', required: true }));
    if (additions.length === 0) return;
    setList('pathParams', [...schema.pathParams, ...additions]);
  };

  const undeclaredSlots = pathSlots(endpoint.pathPattern).filter(
    (slot) => !schema.pathParams.some((p) => p.name === slot),
  );

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <h3 className="text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
          Request schema
        </h3>
        {undeclaredSlots.length > 0 && (
          <button
            type="button"
            onClick={deriveFromPath}
            className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-accent hover:text-text-primary"
            title={`Add path params for: ${undeclaredSlots.join(', ')}`}
          >
            <Wand2 size={10} aria-hidden="true" />
            Derive from path
          </button>
        )}
      </div>
      <p className="text-[0.6875rem] text-text-dim">
        Declares the inputs this endpoint expects. Documentation only — it drives the OpenAPI export
        and is editable in the VS Code extension too. Runtime gating lives in the Validation node.
      </p>

      {PARAM_LISTS.map(({ key, label, singular }) => (
        <ParamTable
          key={key}
          label={label}
          singular={singular}
          headerName={key === 'headers'}
          params={schema[key]}
          onChange={(next) => setList(key, next)}
        />
      ))}

      <BodyDocsEditor schema={schema} onChange={setSchema} />
    </div>
  );
}

function ParamTable({
  label,
  singular,
  headerName,
  params,
  onChange,
}: {
  label: string;
  singular: string;
  headerName: boolean;
  params: MockParamDef[];
  onChange: (next: MockParamDef[]) => void;
}) {
  const update = (idx: number, patch: Partial<MockParamDef>) => {
    const next = [...params];
    next[idx] = { ...next[idx], ...patch };
    onChange(next);
  };
  const add = () =>
    onChange([
      ...params,
      {
        id: generateId(),
        name: '',
        typeHint: 'string',
        required: false,
      },
    ]);
  const remove = (idx: number) => onChange(params.filter((_, i) => i !== idx));

  return (
    <div className="rounded-sm border border-border-subtle bg-card/40 p-2.5">
      <p className="mb-1.5 text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
        {label}
      </p>
      {params.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border-subtle px-2 py-2 text-center text-[0.625rem] text-text-dim">
          No {label.toLowerCase()}. Add one below.
        </p>
      ) : (
        <ul className="space-y-1">
          {params.map((param, idx) => (
            <li
              key={param.id}
              className="grid grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto_minmax(0,1.4fr)_auto] items-center gap-1"
            >
              <input
                value={param.name}
                onChange={(e) => update(idx, { name: e.target.value })}
                placeholder={headerName ? 'Header-Name' : 'name'}
                aria-label={`${singular} ${idx + 1} name`}
                className="h-7 rounded-sm border border-border bg-card px-1.5 font-mono text-[0.625rem] text-text-primary focus:border-accent focus:outline-none"
              />
              <Select
                size="sm"
                value={param.typeHint ?? 'string'}
                onChange={(e) => update(idx, { typeHint: e.target.value })}
                aria-label={`${singular} ${idx + 1} type`}
                wrapperClassName="w-full"
                className="text-[0.625rem] text-text-primary"
              >
                {TYPE_HINTS.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
              <label className="flex items-center gap-1 px-1 text-[0.625rem] text-text-dim">
                <input
                  type="checkbox"
                  checked={param.required ?? false}
                  onChange={(e) => update(idx, { required: e.target.checked })}
                  aria-label={`${singular} ${idx + 1} required`}
                  style={{ accentColor: 'rgb(var(--accent))' }}
                />
                req
              </label>
              <input
                value={param.example ?? ''}
                onChange={(e) => update(idx, { example: e.target.value })}
                placeholder="example"
                aria-label={`${singular} ${idx + 1} example`}
                className="h-7 rounded-sm border border-border bg-card px-1.5 font-mono text-[0.625rem] text-text-primary focus:border-accent focus:outline-none"
              />
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label={`Remove ${singular} ${idx + 1}`}
                className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
              >
                <Trash2 size={10} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <button
        type="button"
        onClick={add}
        className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[0.625rem] text-text-muted hover:border-border-strong hover:text-text-primary"
      >
        <Plus size={9} aria-hidden="true" />
        Add {singular}
      </button>
    </div>
  );
}

function BodyDocsEditor({
  schema,
  onChange,
}: {
  schema: MockRequestSchema;
  onChange: (next: MockRequestSchema) => void;
}) {
  const body = schema.body;
  const setBody = (patch: { description?: string; example?: string }) => {
    const next = { ...(body ?? {}), ...patch };
    // Drop the body doc entirely when both fields are blank — keeps the
    // projection clean (matches the VS Code YAML hide-when-empty rule).
    if (!next.description && !next.example) {
      const { body: _omit, ...rest } = schema;
      onChange(rest);
      return;
    }
    onChange({ ...schema, body: next });
  };

  return (
    <div className="rounded-sm border border-border-subtle bg-card/40 p-2.5">
      <p className="mb-1.5 text-[0.625rem] font-medium uppercase tracking-wider text-text-dim">
        Body shape (docs)
      </p>
      <label htmlFor="reqschema-body-desc" className="block text-[0.625rem] text-text-dim">
        Description
      </label>
      <input
        id="reqschema-body-desc"
        value={body?.description ?? ''}
        onChange={(e) => setBody({ description: e.target.value })}
        placeholder="What the request body should contain…"
        aria-label="Request body description"
        className="mt-1 h-7 w-full rounded-sm border border-border bg-card px-1.5 text-[0.625rem] text-text-primary focus:border-accent focus:outline-none"
      />
      <label htmlFor="reqschema-body-example" className="mt-2 block text-[0.625rem] text-text-dim">
        Example
      </label>
      <textarea
        id="reqschema-body-example"
        value={body?.example ?? ''}
        onChange={(e) => setBody({ example: e.target.value })}
        placeholder='{ "name": "Fido" }'
        aria-label="Request body example"
        rows={3}
        className="mt-1 w-full resize-y rounded-sm border border-border bg-card px-1.5 py-1 font-mono text-[0.625rem] text-text-primary focus:border-accent focus:outline-none"
      />
    </div>
  );
}
