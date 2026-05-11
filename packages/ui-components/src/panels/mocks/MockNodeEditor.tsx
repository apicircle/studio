import { useState } from 'react';
import {
  ArrowDown,
  ArrowLeft,
  ArrowUp,
  Download,
  Plus,
  ShieldAlert,
  Sparkles,
  Trash2,
  X,
} from 'lucide-react';
import {
  generateId,
  makeDefaultMockResponse,
  type MockConditionClause,
  type MockConditionOp,
  type MockConditionScope,
  type MockEndpoint,
  type MockResponseConfig,
  type MockResponseRule,
  type MockServer,
  type MockValidationKind,
  type MockValidationRule,
} from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { MockResponseEditor } from './MockResponseEditor';
import { MockRulePicker } from './MockRulePicker';
import { Select } from '../../primitives/Select';

// Node-editor surface for whichever flow node the user has selected.
// Imports each inner editor below so the selection switch is a single
// `switch` statement at the top.

export type MockNodeSelection =
  | { kind: 'endpoint' }
  | { kind: 'validation' }
  | { kind: 'validation-rule'; ruleId: string }
  | { kind: 'rules' }
  | { kind: 'rule'; ruleId: string }
  | { kind: 'default' };

export function MockNodeEditor({
  server,
  endpoint,
  selection,
  onSelect,
}: {
  server: MockServer;
  endpoint: MockEndpoint;
  selection: MockNodeSelection;
  onSelect: (next: MockNodeSelection) => void;
}) {
  const updateMockEndpoint = useWorkspaceStore((s) => s.updateMockEndpoint);
  const setEndpoint = (patch: Partial<MockEndpoint>) =>
    updateMockEndpoint(server.id, endpoint.id, patch);

  switch (selection.kind) {
    case 'endpoint':
      return <EndpointDetailsEditor endpoint={endpoint} setEndpoint={setEndpoint} />;
    case 'validation':
      return (
        <ValidationOverview endpoint={endpoint} setEndpoint={setEndpoint} onSelect={onSelect} />
      );
    case 'validation-rule': {
      const rule = endpoint.requestValidation.find((r) => r.id === selection.ruleId);
      if (!rule) return <FallbackMissing label="validation rule" />;
      return (
        <ValidationRuleEditor
          endpoint={endpoint}
          rule={rule}
          setEndpoint={setEndpoint}
          onBack={() => onSelect({ kind: 'validation' })}
        />
      );
    }
    case 'rules':
      return (
        <ResponseRulesOverview endpoint={endpoint} setEndpoint={setEndpoint} onSelect={onSelect} />
      );
    case 'rule': {
      const rule = endpoint.responseRules.find((r) => r.id === selection.ruleId);
      if (!rule) return <FallbackMissing label="response rule" />;
      return (
        <ResponseRuleEditor
          endpoint={endpoint}
          rule={rule}
          setEndpoint={setEndpoint}
          onBack={() => onSelect({ kind: 'rules' })}
        />
      );
    }
    case 'default':
      return (
        <MockResponseEditor
          label="Default response"
          value={endpoint.defaultResponse}
          onChange={(next) => setEndpoint({ defaultResponse: next })}
          attachmentSlot={{ serverId: server.id, endpointId: endpoint.id }}
        />
      );
  }
}

function FallbackMissing({ label }: { label: string }) {
  return (
    <p className="rounded-sm border border-dashed border-border-subtle p-4 text-center text-[11px] text-text-dim">
      The selected {label} no longer exists. Pick another node from the flow above.
    </p>
  );
}

// =============================================================================
// Endpoint details — name + description (method/path live in the toolbar above
// the flow).
// =============================================================================

function EndpointDetailsEditor({
  endpoint,
  setEndpoint,
}: {
  endpoint: MockEndpoint;
  setEndpoint: (patch: Partial<MockEndpoint>) => void;
}) {
  return (
    <div className="space-y-3">
      <SectionHeader>Endpoint</SectionHeader>
      <p className="text-[11px] text-text-dim">
        Method + path live in the editor toolbar. Edit the friendly name and documentation here.
      </p>
      <div>
        <label htmlFor="endpoint-name" className="block text-[11px] text-text-dim">
          Name
        </label>
        <input
          id="endpoint-name"
          value={endpoint.name}
          onChange={(e) => setEndpoint({ name: e.target.value })}
          aria-label="Endpoint name"
          className="mt-1 h-8 w-full max-w-md rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
      <div>
        <label htmlFor="endpoint-description" className="block text-[11px] text-text-dim">
          Description
        </label>
        <textarea
          id="endpoint-description"
          value={endpoint.description ?? ''}
          onChange={(e) => setEndpoint({ description: e.target.value })}
          placeholder="What this endpoint mocks…"
          aria-label="Endpoint description"
          rows={4}
          className="mt-1 w-full resize-y rounded-sm border border-border bg-card px-2 py-1.5 text-xs text-text-primary focus:border-accent focus:outline-none"
        />
      </div>
    </div>
  );
}

// =============================================================================
// Validation node — overview + per-rule editor
// =============================================================================

const VALIDATION_KIND_LABEL: Record<MockValidationKind, string> = {
  'header-required': 'Header required',
  'header-equals': 'Header equals',
  'header-matches': 'Header matches (regex)',
  'query-required': 'Query required',
  'query-equals': 'Query equals',
  'query-matches': 'Query matches (regex)',
  'cookie-required': 'Cookie required',
  'body-required': 'Body required',
  'content-type-equals': 'Content-Type equals',
};

/**
 * Clone a validation rule with fresh ids on every nested entity so two
 * endpoints can host independent copies after import.
 */
function cloneValidationRule(rule: MockValidationRule): MockValidationRule {
  return {
    ...rule,
    id: generateId(),
    failResponse: cloneResponseConfig(rule.failResponse),
  };
}

function cloneResponseRule(rule: MockResponseRule): MockResponseRule {
  return {
    ...rule,
    id: generateId(),
    when: rule.when.map((c) => ({ ...c, id: generateId() })),
    response: cloneResponseConfig(rule.response),
  };
}

function cloneResponseConfig<T extends MockResponseConfig>(response: T): T {
  return {
    ...response,
    headers: response.headers.map((h) => ({ ...h })),
    body:
      response.body.type === 'form-data'
        ? { ...response.body, formRows: response.body.formRows.map((r) => ({ ...r })) }
        : response.body.type === 'binary'
          ? {
              ...response.body,
              attachment: response.body.attachment ? { ...response.body.attachment } : undefined,
            }
          : { ...response.body },
    multipliers: response.multipliers?.map((m) => ({
      ...m,
      id: generateId(),
      source: { ...m.source },
    })),
  };
}

function ValidationOverview({
  endpoint,
  setEndpoint,
  onSelect,
}: {
  endpoint: MockEndpoint;
  setEndpoint: (patch: Partial<MockEndpoint>) => void;
  onSelect: (next: MockNodeSelection) => void;
}) {
  const [importerOpen, setImporterOpen] = useState(false);
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...endpoint.requestValidation];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setEndpoint({ requestValidation: next });
  };
  const add = () => {
    const id = generateId();
    setEndpoint({
      requestValidation: [
        ...endpoint.requestValidation,
        {
          id,
          kind: 'header-required',
          target: '',
          message: '',
          enabled: true,
          failResponse: {
            ...makeDefaultMockResponse(),
            status: 400,
            body: { type: 'json', content: '{"error":"bad request"}' },
          },
        },
      ],
    });
    // Drop the user straight into the new rule's editor — that's
    // almost always what they want next.
    onSelect({ kind: 'validation-rule', ruleId: id });
  };
  const remove = (idx: number) =>
    setEndpoint({
      requestValidation: endpoint.requestValidation.filter((_, i) => i !== idx),
    });
  const toggle = (idx: number) => {
    const next = [...endpoint.requestValidation];
    next[idx] = { ...next[idx], enabled: !next[idx].enabled };
    setEndpoint({ requestValidation: next });
  };

  return (
    <div className="space-y-3">
      <SectionHeader icon={<ShieldAlert size={12} aria-hidden="true" />}>
        Validation rules
      </SectionHeader>
      <p className="text-[11px] text-text-dim">
        Run before any response logic. The first failing rule&rsquo;s response is returned
        immediately. Click a rule to edit it; uncheck the box to disable a rule without deleting it;
        use the up/down buttons to reorder — order is significant.
      </p>
      {endpoint.requestValidation.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border-subtle p-4 text-center text-[11px] text-text-dim">
          No validation rules. Click <strong>Add rule</strong> below to create one.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {endpoint.requestValidation.map((rule, idx) => (
            <li
              key={rule.id}
              className={`flex items-center gap-1.5 rounded-sm border bg-card pr-1 text-[11px] hover:border-border-strong ${rule.enabled ? 'border-border' : 'border-border-subtle opacity-60'}`}
            >
              {/* Disable toggle stays a separate hit-target — mirrors
                  the response-rules row affordance. Flexbox-centered both
                  axes so the input sits visually mid-row regardless of
                  the row's auto height. */}
              <span className="flex h-full items-center justify-center pl-2">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => toggle(idx)}
                  aria-label={`Enable validation rule ${idx + 1}`}
                  style={{ accentColor: 'rgb(var(--accent))' }}
                />
              </span>
              {/* Click-to-open: status + label is a button covering the
                  bulk of the row. The reorder/delete controls stay
                  outside so they don't trigger navigation. */}
              <button
                type="button"
                onClick={() => onSelect({ kind: 'validation-rule', ruleId: rule.id })}
                aria-label={`Open validation rule ${VALIDATION_KIND_LABEL[rule.kind]}${rule.target ? ` for ${rule.target}` : ''} — ${rule.failResponse.status}`}
                className="flex flex-1 items-center gap-1.5 px-1 py-1.5 text-left text-text-primary hover:text-accent"
              >
                <span
                  className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${rule.enabled ? 'border-danger/40 bg-danger/5 text-danger' : 'border-border bg-surface text-text-muted'}`}
                >
                  {rule.failResponse.status}
                </span>
                <span className="flex-1 truncate">
                  {VALIDATION_KIND_LABEL[rule.kind]}
                  {rule.target ? ` · ${rule.target}` : ''}
                </span>
              </button>
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                aria-label={`Move rule ${idx + 1} up`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-surface hover:text-text-primary disabled:opacity-30"
              >
                <ArrowUp size={10} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === endpoint.requestValidation.length - 1}
                aria-label={`Move rule ${idx + 1} down`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-surface hover:text-text-primary disabled:opacity-30"
              >
                <ArrowDown size={10} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label={`Delete rule ${idx + 1}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
              >
                <Trash2 size={10} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={add}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[11px] text-accent hover:bg-accent/20"
        >
          <Plus size={10} aria-hidden="true" />
          Add rule
        </button>
        <button
          type="button"
          onClick={() => setImporterOpen(true)}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
          title="Import a rule from another endpoint"
        >
          <Download size={10} aria-hidden="true" />
          Import rule
        </button>
      </div>
      <MockRulePicker
        kind="validation"
        open={importerOpen}
        onClose={() => setImporterOpen(false)}
        targetEndpointId={endpoint.id}
        onImport={(picked) => {
          setEndpoint({
            requestValidation: [...endpoint.requestValidation, ...picked.map(cloneValidationRule)],
          });
        }}
      />
    </div>
  );
}

function ValidationRuleEditor({
  endpoint,
  rule,
  setEndpoint,
  onBack,
}: {
  endpoint: MockEndpoint;
  rule: MockValidationRule;
  setEndpoint: (patch: Partial<MockEndpoint>) => void;
  onBack: () => void;
}) {
  const update = (patch: Partial<MockValidationRule>) =>
    setEndpoint({
      requestValidation: endpoint.requestValidation.map((r) =>
        r.id === rule.id ? { ...r, ...patch } : r,
      ),
    });
  const remove = () => {
    setEndpoint({
      requestValidation: endpoint.requestValidation.filter((r) => r.id !== rule.id),
    });
    onBack();
  };

  const needsExpected =
    rule.kind === 'header-equals' ||
    rule.kind === 'header-matches' ||
    rule.kind === 'query-equals' ||
    rule.kind === 'query-matches';

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <BackButton onClick={onBack} ariaLabel="Back to validation rules list" />
          <SectionHeader icon={<ShieldAlert size={12} aria-hidden="true" />}>
            Validation rule
          </SectionHeader>
        </div>
        <button
          type="button"
          onClick={remove}
          aria-label="Delete this validation rule"
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-danger/30 bg-danger/5 px-2 text-[11px] text-danger hover:bg-danger/10"
        >
          <Trash2 size={10} aria-hidden="true" />
          Delete rule
        </button>
      </div>

      <div className="grid grid-cols-2 gap-3">
        <div>
          <label className="block text-[11px] text-text-dim">Rule kind</label>
          <Select
            size="md"
            value={rule.kind}
            onChange={(e) => update({ kind: e.target.value as MockValidationKind })}
            aria-label="Rule kind"
            wrapperClassName="mt-1 w-full"
            className="text-[11px] text-text-primary"
          >
            {(Object.keys(VALIDATION_KIND_LABEL) as MockValidationKind[]).map((k) => (
              <option key={k} value={k}>
                {VALIDATION_KIND_LABEL[k]}
              </option>
            ))}
          </Select>
        </div>
        <div>
          <label className="block text-[11px] text-text-dim">Target</label>
          <input
            value={rule.target}
            onChange={(e) => update({ target: e.target.value })}
            placeholder={
              rule.kind.startsWith('header-')
                ? 'Header name'
                : rule.kind.startsWith('query-')
                  ? 'Query key'
                  : rule.kind === 'cookie-required'
                    ? 'Cookie name'
                    : rule.kind === 'content-type-equals'
                      ? 'application/json'
                      : ''
            }
            aria-label="Rule target"
            className="mt-1 h-8 w-full rounded-sm border border-border bg-card px-2 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
      </div>

      {needsExpected && (
        <div>
          <label className="block text-[11px] text-text-dim">Expected</label>
          <input
            value={rule.expected ?? ''}
            onChange={(e) => update({ expected: e.target.value })}
            placeholder={rule.kind.endsWith('-matches') ? '/^bearer .+/i' : 'expected value'}
            aria-label="Rule expected value"
            className="mt-1 h-8 w-full rounded-sm border border-border bg-card px-2 font-mono text-[11px] text-text-primary focus:border-accent focus:outline-none"
          />
        </div>
      )}

      <div>
        <label className="block text-[11px] text-text-dim">Friendly message (optional)</label>
        <input
          value={rule.message ?? ''}
          onChange={(e) => update({ message: e.target.value })}
          placeholder="e.g. Authorization header is required"
          aria-label="Rule friendly message"
          className="mt-1 h-8 w-full rounded-sm border border-border bg-card px-2 text-[11px] text-text-primary focus:border-accent focus:outline-none"
        />
      </div>

      <div className="rounded-sm border border-border-subtle bg-card/40 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-dim">
          Fail response (returned when this rule fails)
        </p>
        <MockResponseEditor
          label="Validation fail response"
          value={rule.failResponse}
          onChange={(next) => update({ failResponse: next })}
          attachmentSlot={null}
          compact
        />
      </div>
    </div>
  );
}

// =============================================================================
// Response Rules node — overview + per-rule editor
// =============================================================================

const SCOPE_LABEL: Record<MockConditionScope, string> = {
  query: 'Query',
  pathParam: 'Path param',
  header: 'Header',
  cookie: 'Cookie',
  'body-json-path': 'Body (JSON path)',
};

const OP_LABEL: Record<MockConditionOp, string> = {
  equals: '=',
  'not-equals': '≠',
  matches: 'matches',
  gt: '>',
  lt: '<',
  gte: '≥',
  lte: '≤',
  present: 'is present',
  absent: 'is absent',
};

function ResponseRulesOverview({
  endpoint,
  setEndpoint,
  onSelect,
}: {
  endpoint: MockEndpoint;
  setEndpoint: (patch: Partial<MockEndpoint>) => void;
  onSelect: (next: MockNodeSelection) => void;
}) {
  const [importerOpen, setImporterOpen] = useState(false);
  const move = (idx: number, dir: -1 | 1) => {
    const next = [...endpoint.responseRules];
    const target = idx + dir;
    if (target < 0 || target >= next.length) return;
    [next[idx], next[target]] = [next[target], next[idx]];
    setEndpoint({ responseRules: next });
  };
  const add = () => {
    const id = generateId();
    setEndpoint({
      responseRules: [
        ...endpoint.responseRules,
        {
          id,
          name: 'New rule',
          enabled: true,
          when: [{ id: generateId(), scope: 'query', target: '', op: 'equals', value: '' }],
          response: makeDefaultMockResponse(),
        },
      ],
    });
    // Drop into the new rule for editing.
    onSelect({ kind: 'rule', ruleId: id });
  };
  const remove = (idx: number) =>
    setEndpoint({ responseRules: endpoint.responseRules.filter((_, i) => i !== idx) });
  const toggle = (idx: number) => {
    const next = [...endpoint.responseRules];
    next[idx] = { ...next[idx], enabled: !next[idx].enabled };
    setEndpoint({ responseRules: next });
  };

  return (
    <div className="space-y-3">
      <SectionHeader icon={<Sparkles size={12} aria-hidden="true" />}>Response rules</SectionHeader>
      <p className="text-[11px] text-text-dim">
        Evaluated top-down; the first rule whose <strong>all</strong> clauses match wins. Click a
        rule to edit it. If none match, the Default Response is returned.
      </p>
      {endpoint.responseRules.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border-subtle p-4 text-center text-[11px] text-text-dim">
          No response rules. Click <strong>Add rule</strong> below to create one.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {endpoint.responseRules.map((rule, idx) => (
            <li
              key={rule.id}
              className="flex items-center gap-1.5 rounded-sm border border-border bg-card pr-1 text-[11px] hover:border-border-strong"
            >
              {/* The checkbox stays a separate hit-target; everything
                  else (status + name + clause-count) is the open-rule
                  button. Flexbox-centered both axes for vertical alignment. */}
              <span className="flex h-full items-center justify-center pl-2">
                <input
                  type="checkbox"
                  checked={rule.enabled}
                  onChange={() => toggle(idx)}
                  aria-label={`Enable rule ${idx + 1}`}
                  style={{ accentColor: 'rgb(var(--accent))' }}
                />
              </span>
              <button
                type="button"
                onClick={() => onSelect({ kind: 'rule', ruleId: rule.id })}
                aria-label={`Open response rule ${rule.name || 'Unnamed'} — ${rule.response.status}`}
                className="flex flex-1 items-center gap-1.5 px-1 py-1.5 text-left text-text-primary hover:text-accent"
              >
                <span
                  className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${rule.enabled ? 'border-success/40 bg-success/5 text-success' : 'border-border bg-surface text-text-muted'}`}
                >
                  {rule.response.status}
                </span>
                <span className="flex-1 truncate">{rule.name || 'Unnamed'}</span>
                <span className="text-[10px] text-text-dim">
                  {rule.when.length} clause{rule.when.length === 1 ? '' : 's'}
                </span>
              </button>
              <button
                type="button"
                onClick={() => move(idx, -1)}
                disabled={idx === 0}
                aria-label={`Move rule ${idx + 1} up`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-surface hover:text-text-primary disabled:opacity-30"
              >
                <ArrowUp size={10} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => move(idx, 1)}
                disabled={idx === endpoint.responseRules.length - 1}
                aria-label={`Move rule ${idx + 1} down`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-surface hover:text-text-primary disabled:opacity-30"
              >
                <ArrowDown size={10} aria-hidden="true" />
              </button>
              <button
                type="button"
                onClick={() => remove(idx)}
                aria-label={`Delete rule ${idx + 1}`}
                className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
              >
                <Trash2 size={10} aria-hidden="true" />
              </button>
            </li>
          ))}
        </ul>
      )}
      <div className="flex flex-wrap gap-2">
        <button
          type="button"
          onClick={add}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[11px] text-accent hover:bg-accent/20"
        >
          <Plus size={10} aria-hidden="true" />
          Add rule
        </button>
        <button
          type="button"
          onClick={() => setImporterOpen(true)}
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
          title="Import a rule from another endpoint"
        >
          <Download size={10} aria-hidden="true" />
          Import rule
        </button>
      </div>
      <MockRulePicker
        kind="response"
        open={importerOpen}
        onClose={() => setImporterOpen(false)}
        targetEndpointId={endpoint.id}
        onImport={(picked) => {
          setEndpoint({
            responseRules: [...endpoint.responseRules, ...picked.map(cloneResponseRule)],
          });
        }}
      />
    </div>
  );
}

function ResponseRuleEditor({
  endpoint,
  rule,
  setEndpoint,
  onBack,
}: {
  endpoint: MockEndpoint;
  rule: MockResponseRule;
  setEndpoint: (patch: Partial<MockEndpoint>) => void;
  onBack: () => void;
}) {
  const update = (patch: Partial<MockResponseRule>) =>
    setEndpoint({
      responseRules: endpoint.responseRules.map((r) => (r.id === rule.id ? { ...r, ...patch } : r)),
    });
  const updateClause = (cIdx: number, patch: Partial<MockConditionClause>) => {
    const next = [...rule.when];
    next[cIdx] = { ...next[cIdx], ...patch };
    update({ when: next });
  };
  const removeClause = (cIdx: number) => update({ when: rule.when.filter((_, i) => i !== cIdx) });
  const addClause = () =>
    update({
      when: [
        ...rule.when,
        { id: generateId(), scope: 'query', target: '', op: 'equals', value: '' },
      ],
    });
  const removeRule = () => {
    setEndpoint({
      responseRules: endpoint.responseRules.filter((r) => r.id !== rule.id),
    });
    onBack();
  };

  return (
    <div className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5">
          <BackButton onClick={onBack} ariaLabel="Back to response rules list" />
          <SectionHeader icon={<Sparkles size={12} aria-hidden="true" />}>
            Response rule
          </SectionHeader>
        </div>
        <button
          type="button"
          onClick={removeRule}
          aria-label="Delete this response rule"
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-danger/30 bg-danger/5 px-2 text-[11px] text-danger hover:bg-danger/10"
        >
          <Trash2 size={10} aria-hidden="true" />
          Delete rule
        </button>
      </div>
      <div className="grid grid-cols-[auto_1fr] items-center gap-2">
        <input
          type="checkbox"
          checked={rule.enabled}
          onChange={(e) => update({ enabled: e.target.checked })}
          aria-label="Rule enabled"
          style={{ accentColor: 'rgb(var(--accent))' }}
        />
        <input
          value={rule.name}
          onChange={(e) => update({ name: e.target.value })}
          placeholder="Rule name"
          aria-label="Rule name"
          className="h-8 w-full rounded-sm border border-border bg-card px-2 text-[11px] text-text-primary focus:border-accent focus:outline-none"
        />
      </div>

      <div className="rounded-sm border border-border-subtle bg-card/40 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-dim">
          When (all of)
        </p>
        <ul className="space-y-1">
          {rule.when.map((clause, cIdx) => {
            const needsValue = clause.op !== 'present' && clause.op !== 'absent';
            return (
              <li
                key={clause.id}
                className="grid grid-cols-[minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_minmax(0,1fr)_auto] items-center gap-1"
              >
                <Select
                  size="sm"
                  value={clause.scope}
                  onChange={(e) =>
                    updateClause(cIdx, { scope: e.target.value as MockConditionScope })
                  }
                  aria-label={`Clause ${cIdx + 1} scope`}
                  wrapperClassName="w-full"
                  className="text-[10px] text-text-primary"
                >
                  {(Object.keys(SCOPE_LABEL) as MockConditionScope[]).map((s) => (
                    <option key={s} value={s}>
                      {SCOPE_LABEL[s]}
                    </option>
                  ))}
                </Select>
                <input
                  value={clause.target}
                  onChange={(e) => updateClause(cIdx, { target: e.target.value })}
                  placeholder="name"
                  aria-label={`Clause ${cIdx + 1} target`}
                  className="h-7 rounded-sm border border-border bg-card px-1.5 font-mono text-[10px] text-text-primary focus:border-accent focus:outline-none"
                />
                <Select
                  size="sm"
                  value={clause.op}
                  onChange={(e) => updateClause(cIdx, { op: e.target.value as MockConditionOp })}
                  aria-label={`Clause ${cIdx + 1} operator`}
                  wrapperClassName="w-full"
                  className="text-[10px] text-text-primary"
                >
                  {(Object.keys(OP_LABEL) as MockConditionOp[]).map((o) => (
                    <option key={o} value={o}>
                      {OP_LABEL[o]}
                    </option>
                  ))}
                </Select>
                {needsValue ? (
                  <input
                    value={clause.value ?? ''}
                    onChange={(e) => updateClause(cIdx, { value: e.target.value })}
                    placeholder="value"
                    aria-label={`Clause ${cIdx + 1} value`}
                    className="h-7 rounded-sm border border-border bg-card px-1.5 font-mono text-[10px] text-text-primary focus:border-accent focus:outline-none"
                  />
                ) : (
                  <span aria-hidden="true" />
                )}
                <button
                  type="button"
                  onClick={() => removeClause(cIdx)}
                  aria-label={`Remove clause ${cIdx + 1}`}
                  disabled={rule.when.length <= 1}
                  className="inline-flex h-7 w-7 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger disabled:opacity-30"
                >
                  <X size={10} aria-hidden="true" />
                </button>
              </li>
            );
          })}
        </ul>
        <button
          type="button"
          onClick={addClause}
          className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[10px] text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          <Plus size={9} aria-hidden="true" />
          Add clause
        </button>
      </div>

      <div className="rounded-sm border border-border-subtle bg-card/40 p-3">
        <p className="mb-2 text-[10px] font-medium uppercase tracking-wider text-text-dim">
          Then (response)
        </p>
        <MockResponseEditor
          label={`Rule "${rule.name || 'Unnamed'}" response`}
          value={rule.response}
          onChange={(next) => update({ response: next })}
          attachmentSlot={null}
          compact
        />
      </div>
    </div>
  );
}

// =============================================================================
// Helpers
// =============================================================================

function SectionHeader({ icon, children }: { icon?: React.ReactNode; children: React.ReactNode }) {
  return (
    <h2 className="flex items-center gap-1.5 text-[11px] font-medium uppercase tracking-wider text-text-dim">
      {icon}
      {children}
    </h2>
  );
}

function BackButton({ onClick, ariaLabel }: { onClick: () => void; ariaLabel: string }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label={ariaLabel}
      title={ariaLabel}
      className="inline-flex h-6 w-6 items-center justify-center rounded-sm border border-border bg-card text-text-muted hover:border-border-strong hover:text-text-primary"
    >
      <ArrowLeft size={11} aria-hidden="true" />
    </button>
  );
}
