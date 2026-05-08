import { useEffect, useMemo, useState } from 'react';
import type {
  MockEndpoint,
  MockResponseRule,
  MockServer,
  MockValidationRule,
} from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';

// Cross-endpoint rule import picker. Walks every mock server in the
// workspace, lists every rule, and lets the user pick one (or many) to
// deep-copy into the current endpoint. Sharing model is copy-on-import:
// rules stay owned by their endpoint of origin; the picker just clones
// them with fresh ids.
//
// Self-source: the current endpoint is included in the list so users can
// clone-with-tweaks within the same endpoint.

interface RuleEntry<T> {
  /** Composite key: `${serverId}:${endpointId}:${rule.id}` — rule ids are scoped per-endpoint
   * (and seed data does reuse ids across endpoints), so the rule id alone is not unique. */
  key: string;
  rule: T;
  serverId: string;
  serverName: string;
  endpointId: string;
  endpointLabel: string;
  isSelf: boolean;
}

const VALIDATION_KIND_LABEL: Record<string, string> = {
  'header-required': 'Header required',
  'header-equals': 'Header equals',
  'header-matches': 'Header matches',
  'query-required': 'Query required',
  'query-equals': 'Query equals',
  'query-matches': 'Query matches',
  'cookie-required': 'Cookie required',
  'body-required': 'Body required',
  'content-type-equals': 'Content-Type equals',
};

interface BaseProps {
  open: boolean;
  onClose: () => void;
  /** Endpoint receiving the imported rules — used only to flag "this endpoint" in the list. */
  targetEndpointId: string;
}

interface ValidationProps extends BaseProps {
  kind: 'validation';
  onImport: (rules: MockValidationRule[]) => void;
}

interface ResponseProps extends BaseProps {
  kind: 'response';
  onImport: (rules: MockResponseRule[]) => void;
}

export function MockRulePicker(props: ValidationProps | ResponseProps) {
  const mockServers = useWorkspaceStore((s) => s.synced?.mockServers ?? {});
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [search, setSearch] = useState('');

  // Reset selections each time the dialog closes — `useEffect` instead of
  // a state update during render so React StrictMode doesn't warn about
  // re-renders triggered mid-render.
  useEffect(() => {
    if (!props.open) {
      setSelectedIds(new Set());
      setSearch('');
    }
  }, [props.open]);

  const allEntries = useMemo(
    () => collectEntries(mockServers, props.kind, props.targetEndpointId),
    [mockServers, props.kind, props.targetEndpointId],
  );
  const entries = useMemo(() => {
    const q = search.trim().toLowerCase();
    if (!q) return allEntries;
    return allEntries.filter((e) => {
      const haystacks = [
        e.serverName.toLowerCase(),
        e.endpointLabel.toLowerCase(),
        // Validation rule: kind + target. Response rule: name.
        ('name' in e.rule ? ((e.rule as { name?: string }).name ?? '') : '').toLowerCase(),
        ('target' in e.rule ? ((e.rule as { target?: string }).target ?? '') : '').toLowerCase(),
        ('kind' in e.rule ? ((e.rule as { kind?: string }).kind ?? '') : '').toLowerCase(),
      ];
      return haystacks.some((h) => h.includes(q));
    });
  }, [allEntries, search]);

  const toggle = (key: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  };

  const onConfirm = () => {
    if (selectedIds.size === 0) {
      props.onClose();
      return;
    }
    if (props.kind === 'validation') {
      const picked = entries
        .filter((e) => selectedIds.has(e.key))
        .map((e) => e.rule as MockValidationRule);
      props.onImport(picked);
    } else {
      const picked = entries
        .filter((e) => selectedIds.has(e.key))
        .map((e) => e.rule as MockResponseRule);
      props.onImport(picked);
    }
    setSelectedIds(new Set());
    props.onClose();
  };

  const title = props.kind === 'validation' ? 'Import validation rule' : 'Import response rule';

  return (
    <Modal open={props.open} onClose={props.onClose} title={title} className="max-w-2xl">
      <div className="space-y-3">
        <p className="text-[11px] text-text-dim">
          Pick one or more rules to copy into this endpoint. Imported rules get fresh ids — future
          edits don&rsquo;t sync back to the originals.
        </p>
        {allEntries.length > 0 && (
          <input
            type="search"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Search by rule name, endpoint, server…"
            aria-label="Filter rules"
            className="h-8 w-full rounded-sm border border-border bg-surface px-2 text-[11px] text-text-primary placeholder:text-text-faint focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        )}
        {allEntries.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border-subtle p-4 text-center text-[11px] text-text-dim">
            No {props.kind === 'validation' ? 'validation' : 'response'} rules in the workspace yet.
            Create one with <strong>Add rule</strong> first.
          </p>
        ) : entries.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border-subtle p-4 text-center text-[11px] text-text-dim">
            No rules match &ldquo;{search}&rdquo;. Clear the search to see all.
          </p>
        ) : (
          <ul className="max-h-[50vh] space-y-1 overflow-y-auto rounded-sm border border-border-subtle bg-surface p-2">
            {entries.map((entry) => {
              const checked = selectedIds.has(entry.key);
              return (
                <li key={entry.key}>
                  <label
                    className={`flex cursor-pointer items-start gap-2 rounded-sm border p-2 text-[11px] transition-colors ${
                      checked
                        ? 'border-accent/40 bg-accent/10 text-text-primary'
                        : 'border-transparent text-text-muted hover:border-border-subtle hover:bg-card'
                    }`}
                  >
                    <input
                      type="checkbox"
                      checked={checked}
                      onChange={() => toggle(entry.key)}
                      aria-label={`Select rule from ${entry.serverName} · ${entry.endpointLabel}`}
                      style={{ accentColor: 'rgb(var(--accent))' }}
                      className="mt-0.5"
                    />
                    <div className="flex-1 min-w-0">
                      <div className="flex items-center gap-1.5">
                        {props.kind === 'validation' ? (
                          <ValidationRuleSummary rule={entry.rule as MockValidationRule} />
                        ) : (
                          <ResponseRuleSummary rule={entry.rule as MockResponseRule} />
                        )}
                        {entry.isSelf && (
                          <span
                            className="rounded-sm bg-card px-1 py-0 text-[9px] uppercase tracking-wider text-text-dim"
                            title="This rule lives on the endpoint you're importing into — useful for clone-with-tweaks"
                          >
                            this endpoint
                          </span>
                        )}
                      </div>
                      <p className="truncate text-[10px] text-text-dim">
                        {entry.serverName} · {entry.endpointLabel}
                      </p>
                    </div>
                  </label>
                </li>
              );
            })}
          </ul>
        )}
        <div className="flex justify-end gap-2 pt-1">
          <button
            type="button"
            onClick={props.onClose}
            className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={onConfirm}
            disabled={selectedIds.size === 0}
            className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:cursor-not-allowed disabled:opacity-50"
          >
            Import {selectedIds.size > 0 ? `(${selectedIds.size})` : ''}
          </button>
        </div>
      </div>
    </Modal>
  );
}

function ValidationRuleSummary({ rule }: { rule: MockValidationRule }) {
  return (
    <span className="flex items-center gap-1.5">
      <span className="rounded-sm border border-danger/40 bg-danger/5 px-1.5 py-0.5 font-mono text-[10px] text-danger">
        {rule.failResponse.status}
      </span>
      <span className="font-medium text-text-primary">
        {VALIDATION_KIND_LABEL[rule.kind] ?? rule.kind}
        {rule.target ? ` · ${rule.target}` : ''}
      </span>
      {!rule.enabled && (
        <span className="rounded-sm border border-border-subtle px-1 py-0 text-[9px] uppercase tracking-wider text-text-dim">
          disabled
        </span>
      )}
    </span>
  );
}

function ResponseRuleSummary({ rule }: { rule: MockResponseRule }) {
  return (
    <span className="flex items-center gap-1.5">
      <span
        className={`rounded-sm border px-1.5 py-0.5 font-mono text-[10px] ${rule.enabled ? 'border-success/40 bg-success/5 text-success' : 'border-border bg-surface text-text-muted'}`}
      >
        {rule.response.status}
      </span>
      <span className="font-medium text-text-primary">{rule.name || 'Unnamed'}</span>
      <span className="text-[10px] text-text-dim">
        {rule.when.length} clause{rule.when.length === 1 ? '' : 's'}
      </span>
    </span>
  );
}

function collectEntries(
  servers: Record<string, MockServer>,
  kind: 'validation' | 'response',
  targetEndpointId: string,
): RuleEntry<MockValidationRule | MockResponseRule>[] {
  const out: RuleEntry<MockValidationRule | MockResponseRule>[] = [];
  // Defensive: track seen keys so duplicate ids in legacy data (which the
  // editor doesn't strictly prevent across endpoints) can't crash the
  // React reconciler. Append an index suffix when a collision shows up.
  const seen = new Map<string, number>();
  for (const server of Object.values(servers)) {
    for (const endpoint of server.endpoints) {
      const list: ReadonlyArray<MockValidationRule | MockResponseRule> =
        kind === 'validation' ? endpoint.requestValidation : endpoint.responseRules;
      list.forEach((rule, idx) => {
        const baseKey = `${server.id}:${endpoint.id}:${rule.id}`;
        const collisions = seen.get(baseKey) ?? 0;
        seen.set(baseKey, collisions + 1);
        const key = collisions === 0 ? baseKey : `${baseKey}#${idx}-${collisions}`;
        out.push({
          key,
          rule,
          serverId: server.id,
          serverName: server.name,
          endpointId: endpoint.id,
          endpointLabel: endpointLabel(endpoint),
          isSelf: endpoint.id === targetEndpointId,
        });
      });
    }
  }
  return out;
}

function endpointLabel(endpoint: MockEndpoint): string {
  return `${endpoint.method} ${endpoint.pathPattern}`;
}
