import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, KeyRound, Layers, Lock, Plus, Trash2, Unlock, X } from 'lucide-react';
import type { Environment, EnvironmentVariable, SecretEntry } from '@apicircle/shared';
import { useShallow } from 'zustand/react/shallow';
import { cn } from '../../primitives/cn';
import { Button } from '../../primitives/Button';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { LinkedEnvironmentsSection } from './LinkedEnvironmentsSection';

/**
 * Imperative toast push — used for fire-and-forget sync writes that we
 * don't want to block on (the UI is already optimistic; only the failure
 * path needs surfacing). Subscribing via a hook here would cause every
 * row to re-render on every toast push.
 */
function reportError(title: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  useWorkspaceStore.getState().pushToast({ tone: 'error', title, detail });
}

export function EnvironmentsPanel() {
  const items = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const priorityOrder = useWorkspaceStore((s) => s.synced?.environments.priorityOrder ?? []);
  const renameEnvironment = useWorkspaceStore((s) => s.renameEnvironment);
  const envFocus = useWorkspaceStore((s) => s.envFocus);
  const setEnvFocus = useWorkspaceStore((s) => s.setEnvFocus);
  // Reveals the sidebar's "name your environment" input — the same creation
  // flow the sidebar uses, so the empty-state CTA has a single source of truth.
  const setEnvAdding = useWorkspaceStore((s) => s.setEnvAdding);

  // Memoize the trio of derivations so the panel only recomputes them when
  // `items` / `priorityOrder` actually move. Without these wrappers, every
  // unrelated store mutation that re-renders the panel would re-run the
  // O(n) Object.keys / .find — Phase-5 audit follow-up.
  const allNames = useMemo(() => Object.keys(items), [items]);
  // Pick the first LOCAL env in the priority list as the default focus —
  // linked envs aren't editable from this surface, so focusing one would
  // leave the right pane empty.
  const firstLocalInPriority = useMemo(
    () =>
      priorityOrder.find(
        (r): r is { kind: 'local'; name: string } => r.kind === 'local' && Boolean(items[r.name]),
      ),
    [priorityOrder, items],
  );
  const defaultFocus = firstLocalInPriority?.name ?? allNames[0] ?? null;
  // Hook-order rule: every useMemo / useEffect must run unconditionally on
  // every render. Compute `focusName`, `env`, and the layered/layerPos
  // memos here, BEFORE the early-return branches below. Otherwise React
  // throws "Rendered more hooks than during the previous render" the
  // first time the panel transitions from "no envs" → "an env exists".
  const focusName = envFocus && items[envFocus] ? envFocus : defaultFocus;
  const env = focusName ? items[focusName] : null;

  useEffect(() => {
    if (!envFocus && defaultFocus) setEnvFocus(defaultFocus);
    if (envFocus && !items[envFocus] && defaultFocus !== envFocus) setEnvFocus(defaultFocus);
  }, [envFocus, defaultFocus, items, setEnvFocus]);

  // Position in the layered priority list. We only count entries that
  // resolve — local envs that exist + linked envs whose snapshot is
  // available — so the "n of N" badge matches what the resolver actually
  // sees at send time. Memoized for the same reason as the trio above.
  const layered = useMemo(
    () => priorityOrder.filter((r) => (r.kind === 'local' ? Boolean(items[r.name]) : true)),
    [priorityOrder, items],
  );
  const layerPos = useMemo(
    () => (env ? layered.findIndex((r) => r.kind === 'local' && r.name === env.name) : -1),
    [layered, env],
  );

  if (allNames.length === 0) {
    return (
      <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
        <div className="mx-auto flex max-w-xl flex-col items-center gap-3 pt-16 text-center text-text-dim">
          <Layers size={28} aria-hidden="true" />
          <p className="text-sm text-text-primary">No environments yet.</p>
          <p className="max-w-md text-xs text-text-muted">
            An environment is a named set of variables — base URLs, IDs, tokens — that fill in{' '}
            <code className="rounded-sm bg-card px-1 py-0.5 font-mono">{'{{placeholders}}'}</code>{' '}
            when a request runs. Create one to switch values between, say, local and production.
          </p>
          <Button
            variant="primary"
            leftIcon={<Plus size={14} />}
            onClick={() => setEnvAdding(true)}
          >
            Create your first environment
          </Button>
        </div>
        <LinkedEnvironmentsSection />
      </div>
    );
  }

  if (!env) return null;

  return (
    <div className="flex h-full flex-col gap-4 overflow-y-auto p-6">
      <DecryptFailureBanner envName={env.name} />
      <header className="flex items-baseline gap-3">
        <span className="text-xs uppercase tracking-wider text-text-dim">Variables in</span>
        <input
          key={env.name}
          defaultValue={env.name}
          onBlur={(e) => {
            const next = e.target.value.trim();
            if (next && next !== env.name) {
              try {
                renameEnvironment(env.name, next);
                setEnvFocus(next);
              } catch (err) {
                reportError('Rename failed', err);
                e.target.value = env.name; // revert visible value
              }
            }
          }}
          aria-label="Environment name"
          className="rounded-sm border border-transparent bg-transparent px-2 py-1 text-base font-medium text-text-primary hover:border-border focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
        />
        {layerPos >= 0 ? (
          <span
            className="rounded-sm border border-accent/40 bg-accent/5 px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-accent"
            title="Position in the global resolver layer"
          >
            Layer position {layerPos + 1} of {layered.length}
          </span>
        ) : (
          <span className="rounded-sm border border-border bg-card px-2 py-0.5 text-[0.625rem] uppercase tracking-wider text-text-dim">
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

  // Force-unbind confirm state. Set when the soft unbind path returns
  // `false` because the row's ciphertext can't be decrypted on this device
  // (missing slot value, value mismatch). Carrying the row index +
  // variable key in state lets us write a specific confirm body — "this
  // variable's value will be cleared" beats a generic warning.
  const [forceUnbind, setForceUnbind] = useState<{
    index: number;
    variableKey: string;
  } | null>(null);

  return (
    <div role="group" aria-label={`Variables for ${env.name}`} className="flex flex-col gap-1">
      {env.variables.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No variables yet.
        </p>
      )}
      {env.variables.length > 0 && (
        // Visible column headers over the key/value grid. Each input already
        // carries its own aria-label, so this row is a purely visual aid for
        // sighted users (it's aria-hidden). Grid template MUST match VariableRow
        // so the columns line up.
        <div
          aria-hidden="true"
          // Same grid template AND no container padding, so the fr columns
          // resolve to the same widths as VariableRow. `pl-2` insets each label
          // to sit over its input's text (the inputs carry px-2 internally).
          className="grid grid-cols-[minmax(120px,1fr)_minmax(160px,2fr)_96px_28px] items-center gap-2 pb-0.5 text-[0.6875rem] font-medium uppercase tracking-wide text-text-dim"
        >
          <span className="pl-2">Key</span>
          <span className="pl-2">Value</span>
          <span className="pl-2">Secret</span>
          <span />
        </div>
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
              void Promise.resolve(setVariableValue(env.name, i, value)).catch((err) =>
                reportError('Could not save value', err),
              );
            }}
            onBindKey={(secretKeyId) => {
              void Promise.resolve(bindVariableToSecretKey(env.name, i, secretKeyId)).catch((err) =>
                reportError('Could not bind to secret key', err),
              );
            }}
            onUnbind={() => {
              // Soft unbind first — succeeds when this device can decrypt
              // the row's ciphertext via its local slot value. If it
              // returns false the decrypt failed (slot value missing or
              // value mismatch); promote to the force-confirm dialog so
              // the user explicitly approves clearing the value.
              void (async () => {
                try {
                  const ok = await unbindVariableSecretKey(env.name, i);
                  if (!ok) {
                    setForceUnbind({ index: i, variableKey: v.key });
                  }
                } catch (err) {
                  reportError('Could not unbind secret key', err);
                }
              })();
            }}
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
      <p className="mt-2 text-[0.6875rem] text-text-dim">
        Encrypted values must be bound to a Secret Vault key. The synced workspace stores only the
        key id + label — the actual value lives in your local vault and (for CLI runs) is supplied
        via <code>APICIRCLE_SECRET_&lt;id&gt;</code> env vars or{' '}
        <code>--secrets &lt;file&gt;.json</code>.
      </p>
      <ConfirmDialog
        open={forceUnbind !== null}
        title="Unbind anyway?"
        tone="danger"
        confirmLabel="Unbind and clear value"
        cancelLabel="Keep encrypted"
        description={
          <>
            <p>
              <strong className="text-text-primary">
                {forceUnbind?.variableKey || 'This variable'}
              </strong>{' '}
              can&apos;t be decrypted on this device. The slot value in your Vault either isn&apos;t
              set or doesn&apos;t match the value used to encrypt this row (different passphrase,
              different machine, or a re-keyed slot).
            </p>
            <p className="mt-2">
              Unbinding will <strong className="text-text-primary">clear the value to empty</strong>
              . You can then type a fresh plaintext value, or re-bind to a different Secret Vault
              key once you&apos;ve restored the right slot value.
            </p>
          </>
        }
        onCancel={() => setForceUnbind(null)}
        onConfirm={async () => {
          if (!forceUnbind) return;
          try {
            const ok = await unbindVariableSecretKey(env.name, forceUnbind.index, {
              force: true,
            });
            if (!ok) {
              reportError(
                'Could not unbind secret key',
                new Error('Forced unbind failed — no row at that index.'),
              );
            }
          } catch (err) {
            reportError('Could not unbind secret key', err);
          } finally {
            setForceUnbind(null);
          }
        }}
      />
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
      {/* Four-column grid: name | value | CTA (Encrypt OR Unbind) | delete.
          When a row is bound to a secret, the value cell hosts both the
          binding label AND the "Change key" trigger — they share the same
          column so the secret-key context stays visually grouped with the
          value it replaces. The CTA column has a fixed 96px width so the
          Encrypt and Unbind buttons render at identical widths. Min-widths
          keep the layout readable when the right-side dock crowds the panel. */}
      <div className="relative grid grid-cols-[minmax(120px,1fr)_minmax(160px,2fr)_96px_28px] items-center gap-2">
        <input
          type="text"
          value={row.key}
          onChange={(e) => onKey(e.target.value)}
          placeholder="VAR_NAME"
          aria-label="Variable key"
          aria-invalid={duplicate || undefined}
          className={cn(
            'h-7 min-w-0 rounded-sm border bg-card px-2 text-xs text-text-primary focus:outline-none focus:ring-1',
            duplicate
              ? 'border-danger focus:border-danger focus:ring-danger/40'
              : 'border-border focus:border-accent focus:ring-accent/30',
          )}
        />
        {row.encrypted && row.secretKeyId ? (
          <div
            className="flex h-7 min-w-0 items-center gap-2 rounded-sm border border-amber/30 bg-amber/5 pl-2 pr-1 text-xs"
            aria-label="Variable value (bound to secret key)"
          >
            <Lock size={12} className="shrink-0 text-amber" />
            <span className="flex-1 truncate text-text-primary">
              {boundLabel ?? '(secret key missing locally)'}
            </span>
            <button
              type="button"
              onClick={() => setPickerOpen((o) => !o)}
              className="inline-flex h-5 shrink-0 items-center gap-1 rounded-sm border border-amber/40 bg-amber/10 px-1.5 text-[0.625rem] text-amber hover:border-amber/70"
              aria-label="Change secret key"
              aria-expanded={pickerOpen}
              title="Pick a different Secret Vault key"
            >
              <KeyRound size={11} aria-hidden="true" />
              Change key
            </button>
          </div>
        ) : (
          <input
            type="text"
            value={liveValue}
            onChange={(e) => setDraftValue(e.target.value)}
            onBlur={onValueBlur}
            placeholder="value"
            aria-label="Variable value"
            className="h-7 min-w-0 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
        )}
        {row.encrypted && row.secretKeyId ? (
          <button
            type="button"
            onClick={onUnbind}
            className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-accent hover:text-text-primary"
            aria-label="Unbind secret key"
            title="Unbind — return to plain value"
          >
            <Unlock size={12} aria-hidden="true" />
            Unbind
          </button>
        ) : (
          <button
            type="button"
            onClick={() => setPickerOpen((o) => !o)}
            className="inline-flex h-7 w-full items-center justify-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-accent hover:text-text-primary"
            aria-label="Encrypt"
            aria-expanded={pickerOpen}
            title="Bind this value to a Secret Vault key"
          >
            <Lock size={12} aria-hidden="true" />
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
        <span role="alert" className="pl-1 text-[0.625rem] text-danger">
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
        <span className="text-[0.625rem] uppercase tracking-wider text-text-dim">Secret keys</span>
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
            <p className="px-1 py-2 text-[0.6875rem] text-text-dim">
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
                    <span className="text-[0.625rem] text-text-dim">
                      id {entry.id.slice(0, 6)}…
                    </span>
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
            className="inline-flex h-7 items-center justify-center gap-1 rounded-sm border border-dashed border-accent bg-accent/5 text-[0.6875rem] text-accent hover:bg-accent/10"
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
              className="h-7 flex-1 rounded-sm border border-border bg-surface px-2 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void submitCreate()}
              disabled={!newLabel.trim() || busy}
              className="h-7 flex-1 rounded-sm border border-accent bg-accent/10 px-2 text-[0.6875rem] text-text-primary hover:bg-accent/20 disabled:opacity-50"
            >
              {busy ? 'Creating…' : 'Create & bind'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}

/**
 * Surfaced when the resolver couldn't decrypt one or more encrypted env
 * vars on the latest pass. Two important things this banner does NOT do:
 *   - It does not block the panel — the user can still edit other vars.
 *   - It does not silently re-run anything; the resolver is the source
 *     of truth and re-runs naturally on the next request execute, which
 *     either clears or refreshes the list.
 *
 * We filter to the rows that are most actionable from the Environments
 * panel: `decrypt-failed` and `invalid-ciphertext`. `missing-slot-value`
 * is already covered by the Vault dock's missing-slots gate (and would
 * be noisy to repeat here); `missing-slot-meta` is a workspace-integrity
 * issue that surfaces with a different remedy path.
 *
 * Scoped to the currently focused env so the user sees the failures
 * relevant to what they're looking at. Linked-env failures (tagged with
 * `linked:<id> :: <name>` in the envName) are shown only when the user
 * is on a local env that has linked failures referencing it — for now
 * we leave linked-env surfaces to the Link Workspace panel.
 */
function DecryptFailureBanner({ envName }: { envName: string }) {
  const failures = useWorkspaceStore(
    useShallow((s) =>
      s.envDecryptFailures.filter(
        (f) =>
          f.envName === envName &&
          (f.reason === 'decrypt-failed' || f.reason === 'invalid-ciphertext'),
      ),
    ),
  );
  const clear = useWorkspaceStore((s) => s.clearEnvDecryptFailures);
  if (failures.length === 0) return null;

  return (
    <div
      role="alert"
      aria-label="Decryption failures on encrypted environment variables"
      className="flex items-start gap-2 rounded-sm border border-danger/40 bg-danger/5 p-3 text-xs text-text-muted"
    >
      <AlertTriangle size={14} className="mt-0.5 shrink-0 text-danger" aria-hidden="true" />
      <div className="flex-1 space-y-1.5">
        <p className="text-sm text-text-primary">
          {failures.length === 1
            ? '1 encrypted variable won’t decrypt on this device'
            : `${failures.length} encrypted variables won’t decrypt on this device`}
        </p>
        <p>
          The slot value on this device doesn&apos;t produce the same key the row was encrypted
          with. Open the Vault dock and re-enter the slot value, or use the row&apos;s{' '}
          <strong className="text-text-primary">Unbind</strong> button to clear the value and type a
          fresh plaintext.
        </p>
        <ul className="ml-3 list-disc space-y-0.5 text-[0.6875rem]">
          {failures.slice(0, 6).map((f) => (
            <li key={`${f.envName}:${f.varKey}`}>
              <code className="text-text-primary">{f.varKey}</code>{' '}
              <span className="text-text-dim">— slot</span>{' '}
              <code className="text-text-primary">{f.label}</code>
              {f.reason === 'invalid-ciphertext' ? (
                <span className="ml-1 text-text-dim">(not a valid ciphertext)</span>
              ) : null}
            </li>
          ))}
          {failures.length > 6 && <li className="text-text-dim">+ {failures.length - 6} more…</li>}
        </ul>
      </div>
      <button
        type="button"
        onClick={clear}
        aria-label="Dismiss decryption failures banner"
        className="inline-flex h-6 w-6 shrink-0 items-center justify-center rounded-sm text-text-dim hover:bg-danger/10 hover:text-text-primary"
        title="Dismiss — failures will rebuild on next request if still present"
      >
        <X size={12} aria-hidden="true" />
      </button>
    </div>
  );
}
