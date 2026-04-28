import { useState } from 'react';
import { ArrowDown, ArrowUp, Eye, EyeOff, Lock, Plus, Trash2 } from 'lucide-react';
import type { Environment } from '@apicircle/shared';
import { decryptString, tryParsePayload } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getMasterKey } from '../../persistence/secretKey';
import { cn } from '../../primitives/cn';

export function EnvironmentsPanel() {
  const items = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const activeName = useWorkspaceStore((s) => s.synced?.environments.activeName ?? null);
  const priorityOrder = useWorkspaceStore((s) => s.synced?.environments.priorityOrder ?? []);
  const setActiveEnvironment = useWorkspaceStore((s) => s.setActiveEnvironment);
  const setPriorityOrder = useWorkspaceStore((s) => s.setPriorityOrder);
  const renameEnvironment = useWorkspaceStore((s) => s.renameEnvironment);

  const [editingPanel, setEditingPanel] = useState<string | null>(null);
  // Use the first env as default focus when none selected.
  const focusName =
    editingPanel && items[editingPanel]
      ? editingPanel
      : (activeName ?? Object.keys(items)[0] ?? null);
  const env = focusName ? items[focusName] : null;

  if (Object.keys(items).length === 0) {
    return (
      <div className="flex h-full items-center justify-center p-6 text-sm text-text-muted">
        Create an environment from the sidebar to start.
      </div>
    );
  }

  return (
    <div className="flex h-full flex-col gap-6 overflow-y-auto p-6">
      <header className="flex items-baseline gap-3">
        <h1 className="text-lg font-medium text-text-primary">Environments</h1>
        <span className="rounded-sm border border-border bg-card px-2 py-0.5 text-[10px] uppercase tracking-wider text-text-muted">
          {activeName ? `Active: ${activeName}` : 'No active env'}
        </span>
      </header>

      <section className="max-w-3xl">
        <h2 className="mb-2 text-xs font-medium uppercase tracking-wider text-text-dim">
          Priority order
        </h2>
        <p className="mb-2 text-xs text-text-muted">
          When a request references <code>{'{{NAME}}'}</code>, the resolver walks{' '}
          <span className="text-text-primary">context vars</span> →{' '}
          <span className="text-text-primary">active env</span> → this list. First match wins.
          Plan-level priority overrides this list during plan runs.
        </p>
        <ul role="list" aria-label="Priority order" className="flex flex-col gap-1">
          {priorityOrder.map((name, i) => (
            <li
              key={name}
              className="flex items-center gap-2 rounded-sm border border-border-subtle bg-card px-2 py-1.5 text-xs"
            >
              <span className="w-5 text-text-dim">{i + 1}.</span>
              <span className="flex-1 text-text-primary">{name}</span>
              {name === activeName && (
                <span className="rounded-sm border border-accent/40 bg-accent/10 px-1.5 py-0.5 text-[10px] text-accent">
                  active
                </span>
              )}
              <button
                type="button"
                onClick={() => setPriorityOrder(swap(priorityOrder, i, i - 1))}
                disabled={i === 0}
                aria-label={`Move ${name} up`}
                className="text-text-faint hover:text-text-primary disabled:opacity-30"
              >
                <ArrowUp size={12} />
              </button>
              <button
                type="button"
                onClick={() => setPriorityOrder(swap(priorityOrder, i, i + 1))}
                disabled={i === priorityOrder.length - 1}
                aria-label={`Move ${name} down`}
                className="text-text-faint hover:text-text-primary disabled:opacity-30"
              >
                <ArrowDown size={12} />
              </button>
            </li>
          ))}
        </ul>
      </section>

      {env && (
        <section className="max-w-3xl">
          <h2 className="mb-2 flex items-center gap-3 text-xs font-medium uppercase tracking-wider text-text-dim">
            Variables in
            <input
              value={env.name}
              onBlur={(e) => {
                const next = e.target.value.trim();
                if (next && next !== env.name) {
                  renameEnvironment(env.name, next);
                  setEditingPanel(next);
                }
              }}
              onChange={(e) => setEditingPanel(e.target.value)}
              aria-label="Environment name"
              className="rounded-sm border border-transparent bg-transparent px-1 text-xs uppercase tracking-wider text-text-primary hover:border-border focus:border-accent focus:outline-none"
            />
            {env.name !== activeName && (
              <button
                type="button"
                onClick={() => setActiveEnvironment(env.name)}
                className="ml-auto rounded-sm border border-border px-2 py-0.5 text-[10px] normal-case tracking-normal text-text-muted hover:border-accent hover:text-text-primary"
              >
                Set active
              </button>
            )}
          </h2>
          <VariableTable env={env} />
        </section>
      )}
    </div>
  );
}

function swap<T>(arr: ReadonlyArray<T>, a: number, b: number): T[] {
  if (a < 0 || b < 0 || a >= arr.length || b >= arr.length || a === b) return [...arr];
  const next = [...arr];
  [next[a], next[b]] = [next[b], next[a]];
  return next;
}

interface VariableTableProps {
  env: Environment;
}

function VariableTable({ env }: VariableTableProps) {
  const setVariables = useWorkspaceStore((s) => s.setVariables);
  const addVariableRow = useWorkspaceStore((s) => s.addVariableRow);
  const setVariableValue = useWorkspaceStore((s) => s.setVariableValue);

  return (
    <div role="group" aria-label={`Variables for ${env.name}`} className="flex flex-col gap-1">
      {env.variables.length === 0 && (
        <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-xs text-text-dim">
          No variables yet.
        </p>
      )}
      {env.variables.map((v, i) => (
        <VariableRow
          key={i}
          envName={env.name}
          index={i}
          row={v}
          onKey={(key) => {
            const next = env.variables.map((r, idx) => (idx === i ? { ...r, key } : r));
            setVariables(env.name, next);
          }}
          onCommitValue={(value, encrypted) => {
            void setVariableValue(env.name, i, value, encrypted);
          }}
          onToggleEncrypted={(encrypted) => {
            // Toggle without re-encrypt: leave the literal value in place. The
            // user is expected to re-enter the value afterward — toggling
            // encryption on a non-empty plaintext is a separate flow handled
            // by the on-commit path.
            const next = env.variables.map((r, idx) => (idx === i ? { ...r, encrypted } : r));
            setVariables(env.name, next);
          }}
          onRemove={() => {
            const next = env.variables.filter((_, idx) => idx !== i);
            setVariables(env.name, next);
          }}
        />
      ))}
      <button
        type="button"
        onClick={() => addVariableRow(env.name)}
        className="inline-flex h-7 items-center gap-1.5 self-start rounded-sm border border-dashed border-border px-2 text-xs text-text-muted hover:border-accent hover:text-text-primary"
      >
        <Plus size={12} />
        Add variable
      </button>
      <p className="mt-2 text-[11px] text-text-dim">
        Encrypted values are AES-GCM-encrypted with your local master key. The ciphertext is what
        gets pushed to Git; only this browser holds the key to decrypt them.
      </p>
    </div>
  );
}

interface VariableRowProps {
  envName: string;
  index: number;
  row: Environment['variables'][number];
  onKey: (key: string) => void;
  onCommitValue: (value: string, encrypted: boolean) => void;
  onToggleEncrypted: (encrypted: boolean) => void;
  onRemove: () => void;
}

function VariableRow({ row, onKey, onCommitValue, onToggleEncrypted, onRemove }: VariableRowProps) {
  const [draftValue, setDraftValue] = useState<string | null>(null);
  const [reveal, setReveal] = useState(false);
  const [revealed, setRevealed] = useState<string | null>(null);

  const placeholder = row.encrypted ? 'enter value to encrypt and store' : 'value';
  const displayedStored = row.encrypted ? '••••••••' : row.value;
  const liveValue = draftValue ?? displayedStored;

  const onValueBlur = () => {
    if (draftValue === null) return;
    onCommitValue(draftValue, row.encrypted);
    setDraftValue(null);
    setRevealed(null);
    setReveal(false);
  };

  const onReveal = async () => {
    if (!row.encrypted || !row.value) {
      setReveal((r) => !r);
      return;
    }
    if (reveal) {
      setReveal(false);
      setRevealed(null);
      return;
    }
    const payload = tryParsePayload(row.value);
    if (!payload) {
      setRevealed('(unparseable ciphertext)');
      setReveal(true);
      return;
    }
    try {
      const key = await getMasterKey();
      const plaintext = await decryptString(payload, key);
      setRevealed(plaintext);
      setReveal(true);
    } catch {
      setRevealed('(decrypt failed — wrong key)');
      setReveal(true);
    }
  };

  return (
    <div className="flex items-center gap-2">
      <input
        type="text"
        value={row.key}
        onChange={(e) => onKey(e.target.value)}
        placeholder="VAR_NAME"
        aria-label="Variable key"
        className="h-7 flex-1 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
      />
      <input
        type={row.encrypted && !reveal ? 'password' : 'text'}
        value={reveal && revealed !== null ? revealed : liveValue}
        onChange={(e) => {
          setDraftValue(e.target.value);
          setRevealed(null);
        }}
        onBlur={onValueBlur}
        placeholder={placeholder}
        aria-label="Variable value"
        className="h-7 flex-[2] rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
      />
      {row.encrypted && (
        <button
          type="button"
          onClick={() => void onReveal()}
          className="text-text-faint hover:text-text-primary"
          aria-label={reveal ? 'Hide value' : 'Reveal value'}
        >
          {reveal ? <EyeOff size={12} /> : <Eye size={12} />}
        </button>
      )}
      <button
        type="button"
        onClick={() => onToggleEncrypted(!row.encrypted)}
        className={cn(
          'inline-flex h-6 items-center gap-1 rounded-sm border px-1.5 text-[10px]',
          row.encrypted
            ? 'border-amber/40 bg-amber/10 text-amber'
            : 'border-border bg-surface text-text-muted',
        )}
        aria-pressed={row.encrypted}
        aria-label="Toggle encrypted"
      >
        <Lock size={10} />
        {row.encrypted ? 'Encrypted' : 'Plain'}
      </button>
      <button
        type="button"
        onClick={onRemove}
        className="text-text-faint hover:text-danger"
        aria-label="Remove variable"
      >
        <Trash2 size={12} />
      </button>
    </div>
  );
}
