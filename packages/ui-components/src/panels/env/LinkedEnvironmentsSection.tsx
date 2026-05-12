import { useState } from 'react';
import {
  ChevronDown,
  ChevronRight,
  Eye,
  EyeOff,
  Link2,
  Lock,
  Package,
  RotateCcw,
  Trash2,
} from 'lucide-react';
import type {
  EnvironmentVariable,
  EnvironmentVariableOverride,
  LinkedWorkspace,
} from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';

function reportError(title: string, err: unknown): void {
  const detail = err instanceof Error ? err.message : String(err);
  useWorkspaceStore.getState().pushToast({ tone: 'error', title, detail });
}

const safe = <T,>(value: T | Promise<T>, title: string): Promise<T | undefined> =>
  Promise.resolve(value).catch((err) => {
    reportError(title, err);
    return undefined;
  });

/**
 * Renders every linked workspace's environments below the consumer's
 * own env panel. Each variable is editable in-place — consumer changes
 * land in `synced.linkedOverrides.environmentVars` and round-trip
 * through Git so collaborators see them on pull.
 *
 * Three editable modes per row:
 *   • Edit value: replaces source's value for this consumer.
 *   • Reset to source: drops the override entry for this row.
 *   • Soft-delete: hides the source variable from this consumer (writes
 *     `removed: true`).
 *
 * New variables not present in source can be appended via "Add row" —
 * those rows persist as overrides keyed by varKey with `removed: false`.
 */
export function LinkedEnvironmentsSection() {
  const links = useWorkspaceStore((s) =>
    s.synced ? Object.values(s.synced.linkedWorkspaces) : [],
  );
  if (links.length === 0) return null;
  return (
    <section aria-label="Linked environments" className="mt-6 border-t border-border-subtle pt-4">
      <h2 className="mb-2 flex items-center gap-2 text-xs font-medium uppercase tracking-wider text-text-dim">
        <Link2 size={12} aria-hidden="true" />
        Linked environments
      </h2>
      <p className="mb-3 max-w-2xl text-[0.6875rem] text-text-dim">
        Environments inherited from linked workspaces. Edit values inline — overrides persist on the
        synced doc and apply on top of the source&apos;s env on next refresh.
      </p>
      <ul className="flex flex-col gap-2">
        {links.map((link) => (
          <LinkedEnvGroup key={link.id} link={link} />
        ))}
      </ul>
    </section>
  );
}

function LinkedEnvGroup({ link }: { link: LinkedWorkspace }) {
  const snapshot = useWorkspaceStore((s) => s.local?.linkedCollections[link.id] ?? null);
  const [open, setOpen] = useState(false);

  const envs = snapshot ? Object.values(snapshot.environments.items) : [];

  return (
    <li className="rounded-sm border border-border-subtle bg-card">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        aria-expanded={open}
        aria-label={`${open ? 'Collapse' : 'Expand'} linked environments for ${link.name}`}
        className="flex w-full items-center gap-2 px-3 py-2 text-xs text-text-muted hover:text-text-primary"
      >
        {open ? (
          <ChevronDown size={12} className="shrink-0 text-text-faint" />
        ) : (
          <ChevronRight size={12} className="shrink-0 text-text-faint" />
        )}
        <Package size={12} className="shrink-0 text-accent" aria-hidden="true" />
        <span className="font-medium text-text-primary">{link.name}</span>
        {link.pinnedVersion && (
          <span className="rounded-sm border border-border bg-surface px-1 py-0.5 font-mono text-[0.5625rem] text-text-dim">
            v{link.pinnedVersion}
          </span>
        )}
        <span className="ml-auto text-[0.625rem] text-text-dim">
          {envs.length} env{envs.length === 1 ? '' : 's'}
        </span>
      </button>
      {open && (
        <div className="border-t border-border-subtle px-3 py-3">
          {!snapshot ? (
            <p className="text-[0.6875rem] text-text-dim">
              Refresh this link from the Link Workspace panel to load its environments.
            </p>
          ) : envs.length === 0 ? (
            <p className="text-[0.6875rem] text-text-dim">Source has no environments yet.</p>
          ) : (
            <div className="flex flex-col gap-3">
              {envs.map((env) => (
                <LinkedEnvVarTable
                  key={env.name}
                  link={link}
                  envName={env.name}
                  sourceVariables={env.variables}
                />
              ))}
            </div>
          )}
        </div>
      )}
    </li>
  );
}

function LinkedEnvVarTable({
  link,
  envName,
  sourceVariables,
}: {
  link: LinkedWorkspace;
  envName: string;
  sourceVariables: EnvironmentVariable[];
}) {
  const overrides = useWorkspaceStore((s) =>
    s.synced
      ? Object.values(s.synced.linkedOverrides.environmentVars).filter(
          (o) => o.linkedWorkspaceId === link.id && o.envName === envName,
        )
      : [],
  );
  const setOverride = useWorkspaceStore((s) => s.setLinkedEnvVarOverride);

  const overrideByKey = new Map<string, EnvironmentVariableOverride>(
    overrides.map((o) => [o.varKey, o]),
  );
  const consumerOnlyKeys = overrides
    .filter((o) => !sourceVariables.some((v) => v.key === o.varKey) && !o.removed)
    .map((o) => o.varKey);

  return (
    <div>
      <header className="mb-1.5 flex items-baseline gap-2">
        <span className="text-[0.6875rem] font-medium uppercase tracking-wider text-text-dim">
          {envName}
        </span>
        <span className="text-[0.625rem] text-text-dim">
          {sourceVariables.length} from source
          {consumerOnlyKeys.length > 0 ? `, +${consumerOnlyKeys.length} added by you` : ''}
        </span>
      </header>
      <ul className="flex flex-col gap-1">
        {sourceVariables.map((v) => (
          <LinkedEnvVarRow
            key={v.key}
            link={link}
            envName={envName}
            sourceVariable={v}
            override={overrideByKey.get(v.key) ?? null}
          />
        ))}
        {consumerOnlyKeys.map((k) => {
          const ov = overrideByKey.get(k)!;
          return (
            <LinkedEnvVarRow
              key={k}
              link={link}
              envName={envName}
              sourceVariable={null}
              override={ov}
            />
          );
        })}
      </ul>
      <AddLinkedVarButton
        existingKeys={[...sourceVariables.map((v) => v.key), ...consumerOnlyKeys]}
        onAdd={(varKey) =>
          void safe(setOverride(link.id, envName, varKey, { value: '' }), 'Could not add override')
        }
      />
      <p className="mt-2 text-[0.625rem] text-text-dim">
        Reset returns this row to the source workspace&apos;s value. Soft-delete hides a source
        variable from this consumer only.
      </p>
    </div>
  );
}

function LinkedEnvVarRow({
  link,
  envName,
  sourceVariable,
  override,
}: {
  link: LinkedWorkspace;
  envName: string;
  sourceVariable: EnvironmentVariable | null;
  override: EnvironmentVariableOverride | null;
}) {
  const setOverride = useWorkspaceStore((s) => s.setLinkedEnvVarOverride);
  const clearOverride = useWorkspaceStore((s) => s.clearLinkedEnvVarOverride);
  const varKey = sourceVariable?.key ?? override!.varKey;
  const [revealed, setRevealed] = useState(false);

  // Compute the effective row: source merged with the override.
  const removed = override?.removed === true;
  const value = override?.value ?? sourceVariable?.value ?? '';
  const encrypted = override?.encrypted ?? sourceVariable?.encrypted ?? false;
  const hasOverride = override !== null;
  const isConsumerOnly = sourceVariable === null;

  const onValueChange = (next: string) => {
    void safe(
      setOverride(link.id, envName, varKey, { value: next, encrypted }),
      'Could not save override',
    );
  };

  if (removed) {
    return (
      <li className="flex items-center gap-2 rounded-sm border border-dashed border-border-subtle bg-surface px-2 py-1.5 text-xs">
        <code className="flex-1 truncate text-text-dim line-through">{varKey}</code>
        <span className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-[0.625rem] text-text-dim">
          hidden by you
        </span>
        <button
          type="button"
          onClick={() =>
            void safe(clearOverride(link.id, envName, varKey), 'Could not reset override')
          }
          className="inline-flex h-6 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[0.625rem] text-text-muted hover:border-accent hover:text-text-primary"
          aria-label={`Restore ${varKey} from source`}
        >
          <RotateCcw size={10} />
          Restore
        </button>
      </li>
    );
  }

  return (
    <li className="flex items-center gap-2">
      <code className="w-40 shrink-0 truncate text-xs text-text-primary">{varKey}</code>
      {encrypted ? (
        <div className="flex h-7 flex-1 items-center gap-2 rounded-sm border border-amber/30 bg-amber/5 px-2 text-xs">
          <Lock size={12} className="text-amber" aria-hidden="true" />
          <span className="truncate text-text-primary">
            {override?.secretKeyId
              ? `bound to ${override.secretKeyId.slice(0, 6)}…`
              : sourceVariable?.secretKeyId
                ? `source: ${sourceVariable.secretKeyId.slice(0, 6)}…`
                : '(encrypted)'}
          </span>
        </div>
      ) : (
        <div className="relative flex h-7 flex-1">
          <input
            type={revealed ? 'text' : 'password'}
            value={value}
            onChange={(e) => onValueChange(e.target.value)}
            onBlur={() => setRevealed(false)}
            aria-label={`Override value for ${varKey}`}
            placeholder={
              sourceVariable
                ? `source: ${sourceVariable.value || '(empty)'}`
                : 'consumer-only value'
            }
            className="h-7 flex-1 rounded-sm border border-border bg-card pl-2 pr-7 text-xs text-text-primary focus:border-accent focus:outline-none focus:ring-1 focus:ring-accent/30"
          />
          <button
            type="button"
            onClick={() => setRevealed((v) => !v)}
            onMouseDown={(e) => e.preventDefault()}
            aria-label={revealed ? 'Hide override value' : 'Show override value'}
            aria-pressed={revealed}
            title={revealed ? 'Hide value' : 'Show value (auto-hides on blur)'}
            className="absolute right-1 top-1/2 inline-flex h-5 w-5 -translate-y-1/2 items-center justify-center rounded-sm text-text-faint hover:text-text-primary"
          >
            {revealed ? (
              <EyeOff size={11} aria-hidden="true" />
            ) : (
              <Eye size={11} aria-hidden="true" />
            )}
          </button>
        </div>
      )}
      {hasOverride && !isConsumerOnly && (
        <span
          aria-label="modified"
          title="Locally modified"
          className="h-1.5 w-1.5 shrink-0 rounded-full bg-accent"
        />
      )}
      {isConsumerOnly && (
        <span className="rounded-sm border border-accent/40 bg-accent/10 px-1 py-0.5 text-[0.5625rem] text-accent">
          added
        </span>
      )}
      {hasOverride && (
        <button
          type="button"
          onClick={() =>
            void safe(clearOverride(link.id, envName, varKey), 'Could not reset override')
          }
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-accent hover:text-text-primary"
          aria-label={`Reset ${varKey} to source`}
          title={
            isConsumerOnly
              ? 'Remove this consumer-only variable'
              : 'Reset to source — drop this row’s override'
          }
        >
          <RotateCcw size={10} />
          Reset
        </button>
      )}
      {!isConsumerOnly && (
        <button
          type="button"
          onClick={() =>
            void safe(
              setOverride(link.id, envName, varKey, { removed: true }),
              'Could not hide variable',
            )
          }
          className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:border-danger hover:text-danger"
          aria-label={`Hide ${varKey} from this workspace`}
          title="Hide this source variable from your workspace (soft-delete)"
        >
          <Trash2 size={10} />
          Hide
        </button>
      )}
    </li>
  );
}

function AddLinkedVarButton({
  existingKeys,
  onAdd,
}: {
  existingKeys: string[];
  onAdd: (varKey: string) => void;
}) {
  const [adding, setAdding] = useState(false);
  const [draft, setDraft] = useState('');
  const trimmed = draft.trim();
  const duplicate = trimmed.length > 0 && existingKeys.includes(trimmed);

  if (!adding) {
    return (
      <button
        type="button"
        onClick={() => setAdding(true)}
        className="mt-1.5 inline-flex h-7 items-center gap-1 rounded-sm border border-dashed border-border bg-card px-2 text-[0.6875rem] text-text-muted hover:border-accent hover:text-text-primary"
      >
        + Add variable for this workspace
      </button>
    );
  }
  return (
    <div className="mt-1.5 flex items-center gap-1.5">
      <input
        autoFocus
        value={draft}
        onChange={(e) => setDraft(e.target.value)}
        placeholder="VAR_NAME"
        aria-label="New consumer-only variable name"
        aria-invalid={duplicate || undefined}
        onKeyDown={(e) => {
          if (e.key === 'Escape') {
            setAdding(false);
            setDraft('');
          } else if (e.key === 'Enter' && trimmed && !duplicate) {
            onAdd(trimmed);
            setAdding(false);
            setDraft('');
          }
        }}
        className="h-7 flex-1 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
      />
      <button
        type="button"
        onClick={() => {
          if (trimmed && !duplicate) {
            onAdd(trimmed);
            setAdding(false);
            setDraft('');
          }
        }}
        disabled={!trimmed || duplicate}
        className="h-7 rounded-sm border border-accent bg-accent/10 px-2 text-[0.6875rem] text-accent hover:bg-accent/20 disabled:opacity-50"
      >
        Add
      </button>
      <button
        type="button"
        onClick={() => {
          setAdding(false);
          setDraft('');
        }}
        className="h-7 rounded-sm border border-border bg-surface px-2 text-[0.6875rem] text-text-muted hover:text-text-primary"
      >
        Cancel
      </button>
      {duplicate && (
        <span role="alert" className="text-[0.625rem] text-danger">
          Already exists
        </span>
      )}
    </div>
  );
}
