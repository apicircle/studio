import { useEffect, useMemo, useState } from 'react';
import { KeyRound, Lock, Plus, Trash2, Unlock } from 'lucide-react';
import type { Environment, EnvironmentVariable, SecretEntry } from '@apicircle/shared';
import { cn } from '../../primitives/cn';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { LinkedEnvironmentsSection } from './LinkedEnvironmentsSection';

export function EnvironmentsPanel() {
  const items = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const priorityOrder = useWorkspaceStore((s) => s.synced?.environments.priorityOrder ?? []);
  const renameEnvironment = useWorkspaceStore((s) => s.renameEnvironment);
  const envFocus = useWorkspaceStore((s) => s.envFocus);
  const setEnvFocus = useWorkspaceStore((s) => s.setEnvFocus);

  const allNames = Object.keys(items);
  const defaultFocus = priorityOrder.find((n) => items[n]) ?? allNames[0] ?? null;
  useEffect(() => {
    if (!envFocus && defaultFocus) setEnvFocus(defaultFocus);
    if (envFocus && !items[envFocus] && defaultFocus !== envFocus) setEnvFocus(defaultFocus);
  }, [envFocus, defaultFocus, items, setEnvFocus]);

  if (allNames.length === 0) {
    return (
      <div className="flex h-full flex-col gap-2 overflow-y-auto p-6 text-sm text-text-muted">
        <p>Create an environment from the sidebar to start.</p>
        <LinkedEnvironmentsSection />
      </div>
    );
  }

  const focusName = envFocus && items[envFocus] ? envFocus : defaultFocus;
  const env = focusName ? items[focusName] : null;
  if (!env) return null;

  const layered = priorityOrder.filter((n) => items[n]);
  const layerPos = layered.indexOf(env.name);

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <header className="flex items-baseline gap-3">
        <span className="text-xs uppercase tracking-wider text-text-dim">Variables in</span>
        <input
          key={env.name}
          defaultValue={env.name}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next && next !== env.name) {
              renameEnvironment(env.name, next);
              setEnvFocus(next);
            }
          }}
          aria-label="Environment name"
          className="rounded-sm border border-transparent bg-transparent px-1 text-base font-medium text-text-primary hover:border-border focus:border-accent focus:outline-none"
        />
        {layerPos >= 0 ? (
          <span
            className="rounded-sm border border-accent/40 bg-accent/5 px-2 py-0.5 text-[10px] uppercase tracking-wider text-accent"
            title="Position in the global resolver layer"
          >
            Layer position {layerPos + 1} of {layered.length}
          </span>
        ) : (
          <span className="rounded-sm border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-dim">
            Not in global layer
          </span>
        )}
      </header>
      <p className="text-xs text-text-muted">
        The resolver walks <span className="text-text-primary">context vars</span> → the global
        layer (in sidebar order) → <span className="text-text-primary">vault secrets</span> when
        expanding <code>{'{{NAME}}'}</code> in a request. First match wins.
      </p>
      <VariableTable env={env} />
      <LinkedEnvironmentsSection />
    </div>
  );
}

interface VariableTableProps {
  env: Environment;
}

function VariableTable({ env }: VariableTableProps) {
  const setVariables = useWorkspaceStore((s) => s.setVariables);
  const addVariableRow = useWorkspaceStore((s) => s.addVariableRow);
  const setVariableValue = useWorkspaceStore((s) => s.setVariableValue);
  const bindVariableToSecretKey = useWorkspaceStore((s) => s.bindVariableToSecretKey);
  const unbindVariableSecretKey = useWorkspaceStore((s) => s.unbindVariableSecretKey);

  return (
    <div role="group" aria-label={`Variables for ${env.name}`} className="flex flex-col gap-1">
      {env.variables.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No variables yet.
        </p>
      )}
      {env.variables.map((v, i) => {
        // A row is a duplicate when its non-empty trimmed key matches
        // ANOTHER row's trimmed key. Empty keys never collide (the row
        // is in the middle of being typed).
        const trimmed = v.key.trim();
        const duplicate =
          trimmed.length > 0 &&
          env.variables.some((r, idx) => idx !== i && r.key.trim() === trimmed);
        return (
          <VariableRow
            key={`${env.name}-${i}`}
            envName={env.name}
            index={i}
            row={v}
            duplicate={duplicate}
            onKey={(key) => {
              const next = env.variables.map((r, idx) => (idx === i ? { ...r, key } : r));
              setVariables(env.name, next);
            }}
            onCommitValue={(value) => {
              void setVariableValue(env.name, i, value, false);
            }}
            onBindKey={(secretKeyId) => bindVariableToSecretKey(env.name, i, secretKeyId)}
            onUnbind={() => unbindVariableSecretKey(env.name, i)}
            onRemove={() => {
              const next = env.variables.filter((_, idx) => idx !== i);
              setVariables(env.name, next);
            }}
          />
        );
      })}
      <button
        type="button"
        onClick={() => addVariableRow(env.name)}
        className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Plus size={12} />
        Add variable
      </button>
      <p className="mt-2 text-[11px] text-text-dim">
        Encrypted values must be bound to a Secret Vault key. The synced workspace stores only the
        key id + label — the actual value lives in your local vault and (for CLI runs) is supplied
        via <code>APICIRCLE_SECRET_&lt;id&gt;</code> env vars or{' '}
        <code>--secrets &lt;file&gt;.json</code>.
      </p>
    </div>
  );
}

interface VariableRowProps {
  envName: string;
  index: number;
  row: EnvironmentVariable;
  /**
   * True when another row in the same env has the same trimmed key.
   * Surfaces an inline `role="alert"` warning so the user notices
   * before committing — second-write-wins is still applied at resolve
   * time, but we don't want this happening silently.
   */
  duplicate: boolean;
  onKey: (key: string) => void;
  onCommitValue: (value: string) => void;
  onBindKey: (secretKeyId: string) => void;
  onUnbind: () => void;
  onRemove: () => void;
}

function VariableRow({
  row,
  duplicate,
  onKey,
  onCommitValue,
  onBindKey,
  onUnbind,
  onRemove,
}: VariableRowProps) {
  const secretEntries = useWorkspaceStore((s) => s.local?.secretIndex.entries ?? {});
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [pickerOpen, setPickerOpen] = useState(false);

  const liveValue = draftValue ?? row.value;
  const onValueBlur = () => {
    if (draftValue === null) return;
    onCommitValue(draftValue);
    setDraftValue(null);
  };

  const boundLabel = row.secretKeyId ? secretEntries[row.secretKeyId]?.label : null;

  return (
    <div className="flex flex-col gap-0.5">
      <div className="relative flex items-center gap-2">
        <input
          type="text"
          value={row.key}
          onChange={(e) => onKey(e.target.value)}
          placeholder="VAR_NAME"
          aria-label="Variable key"
          aria-invalid={duplicate || undefined}
          className={cn(
            'h-7 flex-1 rounded-sm border bg-card px-2 text-xs text-text-primary focus:outline-none focus:ring-1',
            duplicate
              ? 'border-danger focus:border-danger focus:ring-danger/40'
              : 'border-border focus:border-accent focus:ring-accent/30',
          )}
        />
        {row.encrypted && row.secretKeyId ? (
          <div
            className="flex h-7 flex-[2] items-center gap-2 rounded-sm border border-amber/30 bg-amber/5 px-2 text-xs"
            aria-label="Variable value (bound to secret key)"
          >
            <Lock size={12} className="text-amber" />
            <span className="truncate text-text-primary">
              {boundLabel ?? '(secret key missing locally)'}
            </span>
            <span className="ml-auto rounded-sm border border-border bg-surface px-1 text-[10px] text-text-dim">
              id: {row.secretKeyId.slice(0, 6)}…
            </span>
          </div>
        ) : (
          <input
            type="text"
            value={liveValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onBlur={onValueBlur}
            placeholder="value"
            aria-label="Variable value"
            className="h-7 flex-[2] rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        )}
        {row.encrypted && row.secretKeyId ? (
          <>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-amber/40 bg-amber/10 px-2 text-[10px] text-amber hover:border-amber/70"
              aria-label="Change secret key"
              aria-expanded={pickerOpen}
            >
              <KeyRound size={12} />
              Change key
            </button>
            <button
              type="button"
              onClick={onUnbind}
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[10px] text-text-muted hover:border-accent hover:text-text-primary"
              aria-label="Unbind secret key"
              title="Unbind — return to plain value"
            >
              <Unlock size={12} />
              Unbind
            </button>
          </>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[10px] text-text-muted hover:border-accent hover:text-text-primary"
            aria-label="Encrypt"
            aria-expanded={pickerOpen}
            title="Bind this value to a Secret Vault key"
          >
            <Lock size={12} />
            Encrypt
          </button>
        )}
        <button
          type="button"
          onClick={onRemove}
          className="inline-flex h-7 w-7 items-center justify-center text-text-faint hover:text-danger"
          aria-label="Remove variable"
          title="Remove variable"
        >
          <Trash2 size={14} />
        </button>
        {pickerOpen && (
          <SecretKeyPicker
            onClose={() => setPickerOpen(false)}
            onPick={(id) => {
              onBindKey(id);
              setPickerOpen(false);
            }}
          />
        )}
      </div>
      {duplicate && (
        <span role="alert" className="pl-1 text-[10px] text-danger">
          Name already used
        </span>
      )}
    </div>
  );
}

interface SecretKeyPickerProps {
  onClose: () => void;
  onPick: (id: string) => void;
}

function SecretKeyPicker({ onClose, onPick }: SecretKeyPickerProps) {
  const entries = useWorkspaceStore((s) => s.local?.secretIndex.entries ?? {});
  const addSecret = useWorkspaceStore((s) => s.addSecret);
  const list: SecretEntry[] = useMemo(
    () => Object.values(entries).sort((a, b) => a.label.localeCompare(b.label)),
    [entries],
  );
  const [filter, setFilter] = useState('');
  const [creating, setCreating] = useState(false);
  const [newLabel, setNewLabel] = useState('');
  const [newValue, setNewValue] = useState('');
  const [busy, setBusy] = useState(false);
  const filtered = list.filter(
    (e) => filter === '' || e.label.toLowerCase().includes(filter.toLowerCase()),
  );

  const submitCreate = async () => {
    if (!newLabel.trim() || busy) return;
    setBusy(true);
    try {
      const id = await addSecret({ label: newLabel.trim(), value: newValue, origin: 'workspace' });
      if (id) onPick(id);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      role="dialog"
      aria-label="Pick or create a Secret Vault key"
      className="absolute right-0 top-8 z-30 flex w-80 flex-col gap-2 rounded-sm border border-border bg-card p-2 shadow-lg"
      onMouseDown={(e) => e.stopPropagation()}
    >
      <div className="flex items-center justify-between">
        <span className="text-[10px] uppercase tracking-wider text-text-dim">Secret keys</span>
        <button
          type="button"
          onClick={onClose}
          className="text-text-faint hover:text-text-primary"
          aria-label="Close picker"
        >
          ×
        </button>
      </div>

      {!creating && (
        <>
          <input
            autoFocus
            value={filter}
            onChange={(e) => setFilter(e.target.value)}
            placeholder="Filter labels…"
            aria-label="Filter labels"
            className="h-7 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
          {filtered.length === 0 ? (
            <p className="px-1 py-2 text-[11px] text-text-dim">
              {list.length === 0 ? 'No secret keys yet — create one below.' : 'No matches.'}
            </p>
          ) : (
            <ul role="listbox" className="max-h-48 overflow-y-auto">
              {filtered.map((entry) => (
                <li key={entry.id}>
                  <button
                    type="button"
                    onClick={() => onPick(entry.id)}
                    className="flex w-full items-center justify-between gap-2 rounded-sm px-2 py-1 text-left text-xs text-text-muted hover:bg-surface hover:text-text-primary"
                  >
                    <span className="truncate">{entry.label}</span>
                    <span className="text-[10px] text-text-dim">id {entry.id.slice(0, 6)}…</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <button
            type="button"
            onClick={() => {
              setCreating(true);
              setNewLabel(filter);
              setFilter('');
            }}
            className="inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-dashed border-accent bg-accent/5 text-[11px] text-accent hover:bg-accent/10"
          >
            <Plus size={12} />
            New secret key
          </button>
        </>
      )}

      {creating && (
        <div className="flex flex-col gap-2">
          <input
            autoFocus
            value={newLabel}
            onChange={(e) => setNewLabel(e.target.value)}
            placeholder="Label (e.g. PROD_API_TOKEN)"
            aria-label="Secret key label"
            className="h-7 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
          <input
            type="password"
            value={newValue}
            onChange={(e) => setNewValue(e.target.value)}
            placeholder="Value (stays in your local vault)"
            aria-label="Secret key value"
            className="h-7 rounded-sm border border-border bg-surface px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
          />
          <div className="flex gap-1">
            <button
              type="button"
              onClick={() => {
                setCreating(false);
                setNewLabel('');
                setNewValue('');
              }}
              className="h-7 flex-1 rounded-sm border border-border bg-surface px-2 text-[11px] text-text-muted hover:border-accent hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitCreate()}
              disabled={!newLabel.trim() || busy}
              className="h-7 flex-1 rounded-sm border border-accent bg-accent/10 px-2 text-[11px] text-text-primary hover:bg-accent/20 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create & bind'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
