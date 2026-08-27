import { useEffect, useMemo, useRef, useState } from 'react';
import {
  AlertCircle,
  CheckCircle2,
  ChevronDown,
  ChevronRight,
  Copy,
  ExternalLink,
  Eye,
  EyeOff,
  KeyRound,
  Lock,
  Plus,
  RefreshCw,
  ShieldCheck,
  Trash2,
  XCircle,
} from 'lucide-react';
import type { SecretEntry, SecretKeyMeta } from '@apicircle/shared';
import { safeExternalHref } from '@apicircle/shared';
import { type GitHostKind, GIT_HOST_KINDS, GIT_HOST_LABELS, hasGitProvider } from '@apicircle/git';
import { SCOPE_GUIDANCE_BY_HOST } from '../../store/workspaceStore';
import { useShallow } from 'zustand/react/shallow';
import {
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  UnauthorizedError,
} from '@apicircle/git';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { SecretsNotProtectedError } from '../../persistence/platformSecretGate';
import { cn } from '../../primitives/cn';
import { safeCopyToClipboard } from '../../primitives/clipboard';
import { isWebBuild } from './webBuild';
import { isGitHubDeviceFlowAvailable } from './githubDeviceFlow';

/**
 * Secret Vault tab content for the right-side dock. Two sub-tabs:
 *   - Vault    — encrypted named secrets, referenced via `{{LABEL}}`
 *   - Sessions — GitHub PAT/OAuth session for this workspace
 *
 * Sub-tab selection lives in the workspace store (`rightDock.vaultSubtab`)
 * so external callers — e.g. the "Manage session" button on the
 * Workspace panel — can deep-link to "sessions" without the dock
 * resetting to its "vault" default.
 *
 * The dock shell provides width/height; this component fills it and owns
 * the sub-tab strip + scrollable body.
 */
export function SecretVaultDockPanel() {
  const tab = useWorkspaceStore((s) => s.rightDock.vaultSubtab);
  const setTab = useWorkspaceStore((s) => s.setVaultSubtab);

  return (
    <div className="flex h-full min-h-0 flex-col">
      <div className="flex shrink-0 border-b border-border-subtle">
        <TabButton
          active={tab === 'vault'}
          onClick={() => setTab('vault')}
          icon={<KeyRound size={14} />}
          label="Vault"
        />
        <TabButton
          active={tab === 'sessions'}
          onClick={() => setTab('sessions')}
          icon={<ShieldCheck size={14} />}
          label="Sessions"
        />
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-4">
        {tab === 'vault' ? <VaultTab /> : <SessionsTab />}
      </div>
    </div>
  );
}

function TabButton({
  active,
  onClick,
  icon,
  label,
}: {
  active: boolean;
  onClick: () => void;
  icon: React.ReactNode;
  label: string;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={cn(
        'inline-flex h-10 items-center gap-2 border-b-2 px-4 text-sm transition-colors',
        active
          ? 'border-accent text-text-primary'
          : 'border-transparent text-text-muted hover:text-text-primary',
      )}
      aria-current={active ? 'page' : undefined}
    >
      {icon}
      {label}
    </button>
  );
}

function VaultTab() {
  const entries = useWorkspaceStore((s) => Object.values(s.local?.secretIndex.entries ?? {}));
  const addSecret = useWorkspaceStore((s) => s.addSecret);
  const recompute = useWorkspaceStore((s) => s.recomputeSecretUsage);
  const secretLockState = useWorkspaceStore((s) => s.secretLockState);
  const openPassphraseSetup = useWorkspaceStore((s) => s.openPassphraseSetup);
  const openPassphraseUnlock = useWorkspaceStore((s) => s.openPassphraseUnlock);
  // Desktop has OS-keychain protection — the passphrase model is
  // optional there, so we don't gate New Secret behind it. On web,
  // `secretCrypto` must exist before any new entry can be encrypted,
  // and the gate refuses to land plaintext writes (see
  // platformSecretGate.ts header). Surface that as a CTA in the same
  // slot as New Secret so the user can act on it immediately.
  const onWeb = isWebBuild();
  const needsPassphraseSetup = onWeb && secretLockState === 'unset';
  const needsPassphraseUnlock = secretLockState === 'locked';
  // Slots declared in synced.secretKeys (in Git) without a local payload
  // yet — typical post-clone state. Surfacing these is the onboarding
  // gate: the user can't decrypt encrypted env vars referencing these
  // slots until they supply each value here.
  //
  // Also includes linked-workspace required keys whose values haven't
  // been provisioned yet. Without this, users would only see those
  // slots on the link card and not in the Vault — making it look like
  // the Vault is missing entries that depend on the link.
  // Selector returns a fresh array literal — without useShallow it would
  // trigger a re-render of the entire vault dock on every unrelated store
  // mutation. Shallow compare on the array elements is the right
  // granularity (each MissingSlot entry is itself a stable object).
  const missingSlots = useWorkspaceStore(
    useShallow((s) => {
      const out: MissingSlot[] = [];
      const indexed = s.local?.secretIndex.entries ?? {};
      // Workspace-origin slots (the device hasn't provided a value yet).
      for (const meta of Object.values(s.synced?.secretKeys ?? {})) {
        if (!indexed[meta.id]) {
          out.push({ kind: 'workspace', meta });
        }
      }
      // Linked-workspace required slots. The slot is "missing" when no
      // entry in secretIndex has `origin === 'linked'` matching this
      // link/key pair. Pull the human label from the cached snapshot
      // so the row reads "Database token" instead of a raw id.
      const links = s.synced?.linkedWorkspaces ?? {};
      const cached = s.local?.linkedCollections ?? {};
      for (const link of Object.values(links)) {
        for (const keyId of link.requiredSecretKeyIds) {
          const provisioned = Object.values(indexed).some(
            (e) =>
              e.origin === 'linked' && e.linkedWorkspaceId === link.id && e.linkedKeyId === keyId,
          );
          if (provisioned) continue;
          const label = cached[link.id]?.secretKeys?.[keyId]?.label ?? keyId;
          out.push({
            kind: 'linked',
            linkId: link.id,
            linkName: link.name,
            keyId,
            label,
          });
        }
      }
      return out;
    }),
  );

  const [adding, setAdding] = useState(false);
  const [draftLabel, setDraftLabel] = useState('');
  const [draftValue, setDraftValue] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    const label = draftLabel.trim();
    if (!label || !draftValue) {
      setError('Both label and value are required.');
      return;
    }
    setSubmitting(true);
    try {
      const id = await addSecret({ label, value: draftValue });
      if (!id) {
        setError(`A secret with label "${label}" already exists.`);
        return;
      }
      setDraftLabel('');
      setDraftValue('');
      setAdding(false);
      setError(null);
      // Refresh usedIn — adding a new secret may light up references that
      // were typed before the vault entry existed.
      recompute();
    } catch (err) {
      // SecretsNotProtectedError on web means the user got here without
      // setting up a passphrase first — the CTA below should have caught
      // them, but if they reached the form anyway (race, deep link, old
      // tab), recover by surfacing the setup modal instead of a dead-end
      // error. We also tear down the inline form so the modal isn't
      // competing with a stale draft.
      if (err instanceof SecretsNotProtectedError) {
        setAdding(false);
        setDraftLabel('');
        setDraftValue('');
        setError(null);
        openPassphraseSetup();
        return;
      }
      // Encrypt-side failures (master key missing, IDB write failure) used
      // to surface as unhandled rejections. Keep the inline error and
      // also push a toast so it's not buried inside the form.
      const detail = err instanceof Error ? err.message : String(err);
      setError(detail);
      useWorkspaceStore.getState().pushToast({
        tone: 'error',
        title: 'Could not add secret',
        detail,
      });
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <div className="space-y-4">
      <p className="text-sm text-text-muted">
        Cross-workspace named secrets. Reference any secret by its label as{' '}
        <code className="text-text-primary">{'{{LABEL}}'}</code> in URLs, headers, params, body
        content, or environment variables. Resolution order at send time: context vars → active env
        → priority list → vault.
      </p>

      <p
        className="rounded-sm border border-warning/30 bg-warning/5 px-2.5 py-1.5 text-[0.6875rem] text-text-muted"
        role="note"
      >
        <strong className="text-warning">Encrypted with your workspace passphrase.</strong>{' '}
        Encrypted secret values may sync across devices and team members through git, but only users
        who know the passphrase can decrypt them. Lose the passphrase, lose the secrets — there is
        no recovery.
      </p>

      {missingSlots.length > 0 && <ProvideMissingSlotsGate slots={missingSlots} />}

      {needsPassphraseSetup && <SetupPassphraseGate onSet={openPassphraseSetup} />}
      {needsPassphraseUnlock && <UnlockPassphraseGate onUnlock={openPassphraseUnlock} />}

      <div className="flex items-center justify-between">
        <h3 className="text-xs font-medium uppercase tracking-wider text-text-dim">
          Entries{entries.length > 0 ? ` (${entries.length})` : ''}
        </h3>
        {!adding && !needsPassphraseSetup && !needsPassphraseUnlock && (
          <button
            type="button"
            onClick={() => setAdding(true)}
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2.5 text-xs text-accent hover:bg-accent/20"
          >
            <Plus size={12} />
            New secret
          </button>
        )}
      </div>

      {adding && (
        <div className="space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-3">
          <div className="flex gap-2">
            <input
              autoFocus
              size={1}
              value={draftLabel}
              onChange={(e) => setDraftLabel(e.target.value)}
              placeholder="LABEL"
              aria-label="New secret label"
              className="h-7 min-w-0 flex-1 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
            />
            <input
              type="password"
              size={1}
              value={draftValue}
              onChange={(e) => setDraftValue(e.target.value)}
              placeholder="value"
              aria-label="New secret value"
              className="h-7 min-w-0 flex-[2] rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
              onKeyDown={(e) => {
                if (e.key === 'Enter') void submit();
                if (e.key === 'Escape') {
                  setAdding(false);
                  setDraftLabel('');
                  setDraftValue('');
                  setError(null);
                }
              }}
            />
          </div>
          {error && <p className="text-xs text-danger">{error}</p>}
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void submit()}
              disabled={submitting}
              className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {submitting ? 'Saving…' : 'Save'}
            </button>
            <button
              type="button"
              onClick={() => {
                setAdding(false);
                setDraftLabel('');
                setDraftValue('');
                setError(null);
              }}
              className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      )}

      {entries.length === 0 && !adding && !needsPassphraseSetup && !needsPassphraseUnlock && (
        <div className="rounded-sm border border-dashed border-border-subtle p-6 text-center text-xs text-text-dim">
          No secrets yet. Click <span className="text-text-primary">New secret</span> to add one.
        </div>
      )}

      <ul role="list" aria-label="Secret entries" className="flex flex-col gap-1">
        {entries.map((entry) => (
          <SecretRow key={entry.id} entry={entry} />
        ))}
      </ul>

      <div className="rounded-sm border border-border bg-card p-3 text-xs text-text-muted">
        <p className="mb-1 text-text-primary">Master key</p>
        <p>
          Generated on this device on first use and stored in IndexedDB. Reinstalling the app or
          clearing site data drops the key; re-enter your secrets afterwards.
        </p>
      </div>
    </div>
  );
}

/**
 * Web-build gate: refuse to expose New Secret until the workspace has
 * a passphrase set. Surfaces a primary CTA + rationale in the same
 * vertical slot, so the user sees exactly what to do next instead of
 * filling in a form that the encryption gate will reject on Save.
 */
function SetupPassphraseGate({ onSet }: { onSet: () => void }) {
  return (
    <div
      role="group"
      aria-label="Set workspace passphrase to enable Secret Vault"
      className="space-y-2 rounded-sm border border-accent/40 bg-accent/5 p-3"
    >
      <div className="flex items-center gap-2">
        <ShieldCheck size={14} className="text-accent" aria-hidden="true" />
        <p className="text-sm text-text-primary">Set a workspace passphrase to add secrets</p>
      </div>
      <p className="text-[0.6875rem] text-text-muted">
        On the web build, secret values can only be saved after you set a passphrase. The passphrase
        encrypts every entry below and is required to decrypt them again — including on other
        devices and for teammates who clone this workspace.
      </p>
      <p className="text-[0.6875rem] text-warning">
        No recovery: lose the passphrase, lose the secrets.
      </p>
      <button
        type="button"
        onClick={onSet}
        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-accent/40 bg-accent/10 px-2.5 text-xs text-accent hover:bg-accent/20"
      >
        <ShieldCheck size={12} aria-hidden="true" />
        Set passphrase
      </button>
    </div>
  );
}

/**
 * Returning-user gate: the workspace HAS a passphrase set, but the
 * in-memory key is missing (cold start, idle-lock, browser refresh).
 * Show an Unlock CTA in the same slot so reveal/decrypt of existing
 * entries works again.
 */
function UnlockPassphraseGate({ onUnlock }: { onUnlock: () => void }) {
  return (
    <div
      role="group"
      aria-label="Unlock workspace secrets"
      className="space-y-2 rounded-sm border border-warning/40 bg-warning/5 p-3"
    >
      <div className="flex items-center gap-2">
        <Lock size={14} className="text-warning" aria-hidden="true" />
        <p className="text-sm text-text-primary">Secrets are locked</p>
      </div>
      <p className="text-[0.6875rem] text-text-muted">
        Enter the workspace passphrase to decrypt existing secrets and add new ones. The passphrase
        is held only in memory; you&apos;ll be asked again after a restart or 15 minutes of
        inactivity.
      </p>
      <button
        type="button"
        onClick={onUnlock}
        className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-warning/40 bg-warning/10 px-2.5 text-xs text-warning hover:bg-warning/20"
      >
        <Lock size={12} aria-hidden="true" />
        Unlock secrets
      </button>
    </div>
  );
}

/**
 * A slot whose value isn't on this device yet. Two flavors:
 *   - `workspace`: declared by `synced.secretKeys` (this workspace's
 *     own vault registry, e.g. needed to decrypt encrypted env vars).
 *   - `linked`: declared by a linked workspace's `requiredSecretKeyIds`
 *     (a slot the source expects the consumer to provide).
 */
type MissingSlot =
  | { kind: 'workspace'; meta: SecretKeyMeta }
  | { kind: 'linked'; linkId: string; linkName: string; keyId: string; label: string };

interface ProvideMissingSlotsGateProps {
  slots: MissingSlot[];
}

/**
 * Onboarding gate. The workspace declares N secret-vault slots in Git
 * (each with an id, label, and per-slot salt) but this device has no
 * payload for them yet — typical "I just cloned this workspace" state.
 * Encrypted env vars referencing these slots can't be decrypted until
 * the user supplies the matching slot value here.
 *
 * Linked-workspace required keys appear here too — every slot a linked
 * source declares but this consumer hasn't provisioned yet. Saving a
 * linked slot routes through `provisionLinkedSecret` so the entry
 * gets `origin: 'linked'` + the linkedWorkspaceId binding.
 */
function ProvideMissingSlotsGate({ slots }: ProvideMissingSlotsGateProps) {
  return (
    <div
      role="group"
      aria-label="Provide missing secret values"
      className="space-y-2 rounded-sm border border-warning/40 bg-warning/5 p-3"
    >
      <div className="flex items-center gap-2">
        <KeyRound size={14} className="text-warning" aria-hidden="true" />
        <p className="text-sm text-text-primary">
          {slots.length === 1 ? '1 secret value needed' : `${slots.length} secret values needed`}
        </p>
      </div>
      <p className="text-[0.6875rem] text-text-muted">
        This workspace references secret keys whose values aren&apos;t on this device yet. Provide
        each one to unlock encrypted environment variables that depend on it.
      </p>
      <ul className="flex flex-col gap-2">
        {slots.map((slot) =>
          slot.kind === 'workspace' ? (
            <ProvideSlotRow key={`w:${slot.meta.id}`} slot={slot.meta} />
          ) : (
            <ProvideLinkedSlotRow
              key={`l:${slot.linkId}:${slot.keyId}`}
              linkId={slot.linkId}
              linkName={slot.linkName}
              keyId={slot.keyId}
              label={slot.label}
            />
          ),
        )}
      </ul>
    </div>
  );
}

function ProvideSlotRow({ slot }: { slot: SecretKeyMeta }) {
  const provide = useWorkspaceStore((s) => s.provideSlotValue);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!value) return;
    setSubmitting(true);
    try {
      await provide(slot.id, value);
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <li className="flex items-center gap-2">
      <span className="min-w-0 flex-1 truncate font-mono text-xs text-text-primary">
        {slot.label}
      </span>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="value"
        aria-label={`Value for ${slot.label}`}
        className="h-7 w-44 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !submitting && value) void submit();
        }}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || !value}
        className="inline-flex h-7 items-center rounded-sm border border-warning/40 bg-warning/10 px-2.5 text-[0.6875rem] text-warning hover:bg-warning/20 disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Save'}
      </button>
    </li>
  );
}

function ProvideLinkedSlotRow({
  linkId,
  linkName,
  keyId,
  label,
}: {
  linkId: string;
  linkName: string;
  keyId: string;
  label: string;
}) {
  const provision = useWorkspaceStore((s) => s.provisionLinkedSecret);
  const [value, setValue] = useState('');
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!value) return;
    setSubmitting(true);
    try {
      await provision(linkId, keyId, value);
      setValue('');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <li className="flex items-center gap-2">
      <div className="min-w-0 flex-1">
        <div className="truncate font-mono text-xs text-text-primary">{label}</div>
        <div
          className="truncate text-[0.625rem] text-text-dim"
          title={`Required by linked: ${linkName}`}
        >
          required by linked · {linkName}
        </div>
      </div>
      <input
        type="password"
        value={value}
        onChange={(e) => setValue(e.target.value)}
        placeholder="value"
        aria-label={`Value for ${label} (linked)`}
        className="h-7 w-44 rounded-sm border border-border bg-card px-2 text-xs text-text-primary focus:border-accent focus:outline-none"
        onKeyDown={(e) => {
          if (e.key === 'Enter' && !submitting && value) void submit();
        }}
      />
      <button
        type="button"
        onClick={() => void submit()}
        disabled={submitting || !value}
        className="inline-flex h-7 items-center rounded-sm border border-warning/40 bg-warning/10 px-2.5 text-[0.6875rem] text-warning hover:bg-warning/20 disabled:opacity-50"
      >
        {submitting ? 'Saving…' : 'Save'}
      </button>
    </li>
  );
}

interface SecretRowProps {
  entry: SecretEntry;
}

// How long a revealed secret stays on screen before auto-masking. Tuned for
// "long enough to copy + look once, short enough that walking away from the
// laptop doesn't leak it". Reset by user interaction (re-reveal restarts).
const SECRET_AUTO_MASK_MS = 15_000;

function SecretRow({ entry }: SecretRowProps) {
  const decryptSecret = useWorkspaceStore((s) => s.decryptSecret);
  const removeSecret = useWorkspaceStore((s) => s.removeSecret);
  const pushToast = useWorkspaceStore((s) => s.pushToast);
  // For linked-origin entries, prefer the source workspace's slot label
  // (cached on the link snapshot). The persisted entry.label is
  // `link:<linkName>:<keyId>` which leaks the raw slot id; reading
  // the live label from the snapshot gives a clean human-readable
  // display and stays in sync if the source renames the slot.
  // Returns a fresh `{ label, linkName }` literal — wrap in useShallow so
  // the secret-entry row only re-renders when those two strings actually
  // change, not on every store tick.
  const linkedDisplay = useWorkspaceStore(
    useShallow((s) => {
      if (entry.origin !== 'linked' || !entry.linkedWorkspaceId || !entry.linkedKeyId) {
        return null;
      }
      const link = s.synced?.linkedWorkspaces[entry.linkedWorkspaceId];
      const snapshot = s.local?.linkedCollections[entry.linkedWorkspaceId];
      const sourceLabel = snapshot?.secretKeys?.[entry.linkedKeyId]?.label;
      if (!link) return null;
      return {
        label: sourceLabel && sourceLabel.trim() ? sourceLabel : entry.linkedKeyId,
        linkName: link.name,
      };
    }),
  );

  // Reveal state — either the decrypted plaintext or an error marker.
  // Separating these lets us style the failure as a `role="alert"` instead
  // of pretending the literal string '(decrypt failed)' is the secret value.
  const [revealed, setRevealed] = useState<string | null>(null);
  const [revealError, setRevealError] = useState<string | null>(null);
  const [showUsage, setShowUsage] = useState(false);
  const [confirmDelete, setConfirmDelete] = useState(false);
  const rowRef = useRef<HTMLLIElement>(null);

  // Auto-mask after SECRET_AUTO_MASK_MS so a revealed value doesn't sit on
  // screen forever (the old behaviour). Resets when the user clicks Hide.
  useEffect(() => {
    if (revealed === null && revealError === null) return;
    const id = window.setTimeout(() => {
      setRevealed(null);
      setRevealError(null);
    }, SECRET_AUTO_MASK_MS);
    return () => window.clearTimeout(id);
  }, [revealed, revealError]);

  // Click-outside resets the inline Delete→Confirm two-state so the row
  // doesn't stay primed indefinitely (audit gap: the help text claimed
  // "click anywhere else to cancel" but there was no handler implementing
  // it). Also reverts on Esc.
  useEffect(() => {
    if (!confirmDelete) return;
    const onPointer = (e: PointerEvent) => {
      if (!rowRef.current) return;
      if (!rowRef.current.contains(e.target as Node)) setConfirmDelete(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setConfirmDelete(false);
    };
    window.addEventListener('pointerdown', onPointer);
    window.addEventListener('keydown', onKey);
    return () => {
      window.removeEventListener('pointerdown', onPointer);
      window.removeEventListener('keydown', onKey);
    };
  }, [confirmDelete]);

  const onReveal = async () => {
    if (revealed !== null || revealError !== null) {
      setRevealed(null);
      setRevealError(null);
      return;
    }
    try {
      const plain = await decryptSecret(entry.id);
      if (plain === null) {
        setRevealError('Decrypt failed. The master key may be missing or rotated.');
      } else {
        setRevealed(plain);
      }
    } catch (err) {
      setRevealError(err instanceof Error ? err.message : 'Decrypt failed.');
    }
  };

  const onCopy = async () => {
    if (revealed === null) return;
    const result = await safeCopyToClipboard(revealed);
    if (result.ok) {
      pushToast({ tone: 'success', title: 'Copied to clipboard', ttlMs: 2000 });
    } else {
      pushToast({
        tone: 'error',
        title: 'Copy failed',
        detail: result.reason,
      });
    }
  };

  const usedInCount = entry.usedIn.length;
  const blockedDelete = usedInCount > 0 && !confirmDelete;
  // Display label is the live source-side label for linked entries,
  // otherwise the raw entry label (workspace-origin secrets).
  const displayLabel = linkedDisplay ? linkedDisplay.label : entry.label;

  const isRevealed = revealed !== null;
  const hasReveal = isRevealed || revealError !== null;

  return (
    <li ref={rowRef} className="rounded-sm border border-border bg-card p-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <div className="flex min-w-0 flex-1 items-center gap-2">
          <KeyRound size={12} className="shrink-0 text-text-dim" aria-hidden="true" />
          <div className="min-w-0 flex-1">
            <div className="truncate font-medium text-text-primary">{displayLabel}</div>
            {linkedDisplay && (
              <div
                className="truncate text-[0.625rem] text-text-dim"
                title={`Required by linked: ${linkedDisplay.linkName}`}
              >
                required by linked · {linkedDisplay.linkName}
              </div>
            )}
          </div>
          <span
            className={cn(
              'shrink-0 rounded-sm border px-1.5 py-0.5 text-[0.625rem] uppercase tracking-wider',
              entry.origin === 'workspace'
                ? 'border-border-subtle bg-surface text-text-muted'
                : 'border-blue/40 bg-blue/10 text-blue',
            )}
            title={
              entry.origin === 'linked'
                ? linkedDisplay
                  ? `Required by linked workspace ${linkedDisplay.linkName}`
                  : 'Required by a linked workspace'
                : 'Defined in this workspace'
            }
          >
            {entry.origin}
          </span>
        </div>
        <div className="flex shrink-0 flex-wrap items-center gap-2">
          <button
            type="button"
            onClick={() => void onReveal()}
            className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:text-text-primary"
            aria-label={hasReveal ? `Hide ${displayLabel}` : `Reveal ${displayLabel}`}
          >
            {hasReveal ? <EyeOff size={10} /> : <Eye size={10} />}
            {hasReveal ? 'Hide' : 'Reveal'}
          </button>
          {isRevealed && (
            <button
              type="button"
              onClick={() => void onCopy()}
              aria-label={`Copy ${displayLabel} value`}
              title="Copy value to clipboard"
              className="inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border border-border bg-surface px-2 text-[0.625rem] text-text-muted hover:text-text-primary"
            >
              <Copy size={10} />
              Copy
            </button>
          )}
          <button
            type="button"
            onClick={() => {
              if (blockedDelete) {
                setConfirmDelete(true);
                return;
              }
              void removeSecret(entry.id);
            }}
            className={cn(
              'inline-flex h-6 shrink-0 items-center gap-1 rounded-sm border px-2 text-[0.625rem]',
              blockedDelete
                ? 'border-warning/40 bg-warning/10 text-warning'
                : 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20',
            )}
            aria-label={`Delete ${displayLabel}`}
          >
            <Trash2 size={10} />
            {blockedDelete ? `In use (${usedInCount})` : confirmDelete ? 'Confirm' : 'Delete'}
          </button>
        </div>
      </div>

      {isRevealed && (
        <pre className="mt-2 break-all rounded-sm border border-border-subtle bg-surface p-2 font-mono text-[0.6875rem] text-text-primary">
          {revealed}
        </pre>
      )}
      {revealError !== null && (
        <p
          role="alert"
          className="mt-2 inline-flex items-center gap-1.5 rounded-sm border border-danger/40 bg-danger/10 px-2 py-1 text-[0.6875rem] text-danger"
        >
          <AlertCircle size={11} aria-hidden="true" />
          {revealError}
        </p>
      )}
      {hasReveal && (
        <p className="mt-1 text-[0.625rem] text-text-dim">
          Auto-hides in {Math.round(SECRET_AUTO_MASK_MS / 1000)}s.
        </p>
      )}

      {usedInCount > 0 && (
        <button
          type="button"
          onClick={() => setShowUsage((v) => !v)}
          className="mt-1 inline-flex items-center gap-1 text-[0.6875rem] text-text-dim hover:text-text-muted"
          aria-expanded={showUsage}
          aria-label={`Toggle where ${displayLabel} is used`}
        >
          {showUsage ? <ChevronDown size={10} /> : <ChevronRight size={10} />}
          Used in {usedInCount} place{usedInCount === 1 ? '' : 's'}
        </button>
      )}
      {showUsage && usedInCount > 0 && (
        <ul className="mt-1 ml-4 list-disc space-y-0.5 text-[0.6875rem] text-text-muted">
          {entry.usedIn.map((u) => (
            <li key={`${u.kind}:${u.id}`}>
              <span className="text-text-dim">{u.kind}</span> · {u.label}
            </li>
          ))}
        </ul>
      )}
      {confirmDelete && (
        <p className="mt-2 text-[0.6875rem] text-warning">
          This secret is referenced in {usedInCount} place{usedInCount === 1 ? '' : 's'}. Click{' '}
          <span className="text-text-primary">Confirm</span> to delete anyway, or click outside this
          row (or press Esc) to cancel.
        </p>
      )}
    </li>
  );
}

function SessionsTab() {
  // Only hosts this build can resolve; the open-core Studio registers GitHub
  // alone, so this is `['github']` there and the picker below never renders.
  const hosts = useMemo(() => GIT_HOST_KINDS.filter((kind) => hasGitProvider(kind)), []);
  const [host, setHost] = useState<GitHostKind>('github');
  const local = useWorkspaceStore((s) => s.local);
  const workspaceSession =
    host === 'github'
      ? (local?.sessions.github.workspace ?? null)
      : (local?.sessions.hosts?.[host]?.workspace ?? null);
  const linkSessions = local?.sessions.github.links ?? {};
  const linkedWorkspaces = useWorkspaceStore((s) => s.synced?.linkedWorkspaces ?? {});
  const linkSessionEntries = Object.entries(linkSessions);
  return (
    <div className="space-y-4">
      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-text-dim">
          Workspace session
        </h3>
        <p className="mb-2 text-[0.6875rem] text-text-muted">
          Drives push, pull, and PR creation for this workspace&apos;s own repo. Disconnecting
          doesn&apos;t touch linking sessions below.
        </p>
        {hosts.length > 1 && (
          <div className="mb-2 flex items-center gap-2">
            <label className="text-[0.6875rem] text-text-muted" htmlFor="session-host">
              Host
            </label>
            <select
              id="session-host"
              aria-label="Session Git host"
              value={host}
              onChange={(e) => setHost(e.target.value as GitHostKind)}
              className="h-6 rounded-sm border border-border bg-card px-1.5 text-[0.6875rem] text-text-primary"
            >
              {hosts.map((kind) => (
                <option key={kind} value={kind}>
                  {GIT_HOST_LABELS[kind]}
                  {(
                    kind === 'github'
                      ? local?.sessions.github.workspace
                      : local?.sessions.hosts?.[kind]?.workspace
                  )
                    ? ' · connected'
                    : ''}
                </option>
              ))}
            </select>
          </div>
        )}
        <ScopeGuidance host={host} />
        {workspaceSession ? <ActiveSessionCard /> : <ConnectForm host={host} />}
      </div>
      <div>
        <h3 className="mb-1 text-xs font-medium uppercase tracking-wider text-text-dim">
          Linking sessions
        </h3>
        <p className="mb-2 text-[0.6875rem] text-text-muted">
          Per-link credentials used to fetch source repos that aren&apos;t reachable from the
          workspace session. Manage each one from its link card under{' '}
          <span className="text-text-primary">Link Workspace</span>.
        </p>
        {linkSessionEntries.length === 0 ? (
          <p className="rounded-sm border border-dashed border-border-subtle p-3 text-center text-[0.6875rem] text-text-dim">
            No linking sessions yet.
          </p>
        ) : (
          <ul className="flex flex-col gap-1.5">
            {linkSessionEntries.map(([linkId, s]) => {
              const link = linkedWorkspaces[linkId];
              return (
                <li
                  key={linkId}
                  className="rounded-sm border border-border bg-card p-2.5 text-[0.6875rem]"
                >
                  <div className="flex items-center gap-2">
                    <ShieldCheck size={12} className="text-success" aria-hidden="true" />
                    <span className="font-medium text-text-primary">{s.accountLogin}</span>
                    <span className="ml-auto text-text-dim">
                      {link ? link.source.repoFullName : `(orphaned link ${linkId.slice(0, 6)}…)`}
                    </span>
                  </div>
                  <div className="mt-1 text-text-muted">
                    Scopes: {s.grantedScopes.length > 0 ? s.grantedScopes.join(', ') : '—'}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </div>
    </div>
  );
}

/** Where each host issues personal access tokens. */
const TOKEN_PAGE_BY_HOST: Record<GitHostKind, string> = {
  github: 'https://github.com/settings/tokens?type=beta',
  gitlab: 'https://gitlab.com/-/user_settings/personal_access_tokens',
  bitbucket: 'https://bitbucket.org/account/settings/app-passwords/',
  'azure-devops': 'https://dev.azure.com',
};

/**
 * What to create the token WITH.
 *
 * GitHub's two scopes are the only ones the product can actually verify — it is
 * the one host that reports a token's scopes back. For the others this is
 * guidance and nothing more: they do not expose scopes, so the connect step
 * cannot check them and deliberately does not pretend to. Saying so here is the
 * difference between a user understanding a later 403 and being baffled by it.
 */
function ScopeGuidance({ host }: { host: GitHostKind }) {
  const scopes = SCOPE_GUIDANCE_BY_HOST[host];
  return (
    <div className="rounded-sm border border-border bg-card p-3 text-xs text-text-muted">
      {/* GitHub's heading is unchanged, verbatim. It is asserted by this panel's
          own tests and it is what users have read since the vault shipped; only
          a non-GitHub host needs to say which host it means. */}
      <p className="mb-2 text-text-primary">
        {host === 'github'
          ? 'Required PAT scopes'
          : `Required ${GIT_HOST_LABELS[host]} token scopes`}
      </p>
      <ul className="ml-4 list-disc space-y-0.5">
        {host === 'github' ? (
          <>
            <li>
              <code className="text-text-primary">repo</code> — required for push to save and read
              of the working branch
            </li>
            <li>
              <code className="text-text-primary">pull_request</code> — required to create PRs from
              the working branch to <code>main</code>
            </li>
          </>
        ) : (
          scopes.map((scope) => (
            <li key={scope}>
              <code className="text-text-primary">{scope}</code>
            </li>
          ))
        )}
      </ul>
      {host !== 'github' && (
        <p className="mt-2">
          {GIT_HOST_LABELS[host]} does not report a token&apos;s scopes, so these cannot be checked
          when you connect — a token missing one fails at the first write instead.
        </p>
      )}
      <a
        href={TOKEN_PAGE_BY_HOST[host]}
        target="_blank"
        rel="noreferrer noopener"
        className="mt-2 inline-flex items-center gap-1 text-accent hover:underline"
      >
        Create a token on {GIT_HOST_LABELS[host]}
        <ExternalLink size={10} aria-hidden="true" />
      </a>
    </div>
  );
}

function ConnectForm({ host = 'github' }: { host?: GitHostKind } = {}) {
  const connect = useWorkspaceStore((s) => s.connectHostSession);
  const connectViaDeviceFlow = useWorkspaceStore((s) => s.connectGitHubSessionViaDeviceFlow);
  const [token, setToken] = useState('');
  // Self-managed instances only (self-hosted GitLab, an Azure DevOps org,
  // GitHub Enterprise Server). Blank means the host's public API.
  const [baseUrl, setBaseUrl] = useState('');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // Device-flow state. While `code` is non-null, the polling loop is
  // running and the UI shows the user_code + verification URL with a
  // Cancel button.
  const [code, setCode] = useState<{
    userCode: string;
    verificationUri: string;
    expiresAt: number;
  } | null>(null);
  const [oauthBusy, setOauthBusy] = useState(false);
  const [oauthError, setOauthError] = useState<string | null>(null);
  const abortRef = useRef<AbortController | null>(null);

  const submit = async () => {
    setSubmitting(true);
    setError(null);
    try {
      await connect(token, host, { baseUrl: baseUrl.trim() || undefined });
      setToken('');
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setError(`Token is missing required scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Failed to connect — unknown error');
      }
    } finally {
      setSubmitting(false);
    }
  };

  const startOauth = async () => {
    setOauthError(null);
    setOauthBusy(true);
    abortRef.current = new AbortController();
    try {
      await connectViaDeviceFlow({
        onCodeReady: (info) => setCode(info),
        signal: abortRef.current.signal,
      });
      // On success, the session card flips in.
      setCode(null);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setOauthError(
          `Authorized account is missing required scope(s): ${err.missingScopes.join(', ')}`,
        );
      } else if (err instanceof Error) {
        setOauthError(err.message);
      } else {
        setOauthError('OAuth sign-in failed — unknown error.');
      }
      setCode(null);
    } finally {
      setOauthBusy(false);
      abortRef.current = null;
    }
  };

  const cancelOauth = () => {
    abortRef.current?.abort();
    setCode(null);
    setOauthBusy(false);
  };

  // The one-click device flow only works where the same-origin `/_gh-oauth`
  // relay exists (the Vite dev server). On the static web deploy and the
  // packaged desktop app it can't reach GitHub, so we hide the button there
  // and lead with the personal-access-token path. See `githubDeviceFlow.ts`.
  const deviceFlowAvailable = isGitHubDeviceFlowAvailable();

  return (
    <div className="space-y-3">
      {deviceFlowAvailable && (
        <div className="space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-3">
          {code ? (
            <DeviceFlowCard
              code={code}
              busy={oauthBusy}
              onCancel={cancelOauth}
              error={oauthError}
            />
          ) : (
            <button
              type="button"
              onClick={() => void startOauth()}
              disabled={oauthBusy}
              className="inline-flex h-8 w-full items-center justify-center gap-2 rounded-sm border border-accent/40 bg-accent/10 px-3 text-sm text-accent hover:bg-accent/20 disabled:opacity-50"
              aria-label="Sign in with GitHub"
            >
              <ShieldCheck size={14} aria-hidden="true" />
              Sign in with GitHub
            </button>
          )}
          {oauthError && !code && (
            <p className="text-[0.6875rem] text-danger" role="alert">
              {oauthError}
            </p>
          )}
          <p className="text-[0.625rem] text-text-dim">
            OAuth uses GitHub's device flow — no client secret stays in the browser. You'll be
            prompted on github.com/login/device to authorize API Circle Studio.
          </p>
        </div>
      )}

      <div className="space-y-2 rounded-sm border border-border bg-surface p-3">
        <p className="text-[0.6875rem] font-medium uppercase tracking-wider text-text-dim">
          {deviceFlowAvailable
            ? 'Or — paste a personal access token'
            : 'Connect with a personal access token'}
        </p>
        <label htmlFor="pat-input" className="block text-xs text-text-muted">
          Personal access token
        </label>
        <input
          id="pat-input"
          type="password"
          value={token}
          onChange={(e) => setToken(e.target.value)}
          placeholder={
            host === 'github' ? 'ghp_… or github_pat_…' : `${GIT_HOST_LABELS[host]} token`
          }
          // The aria-label stays "GitHub PAT" for GitHub, verbatim: it is what
          // every existing test and the Lens regression harness select on, and a
          // renamed control does not throw — it matches nothing and those cases
          // silently stop asserting.
          aria-label={host === 'github' ? 'GitHub PAT' : `${GIT_HOST_LABELS[host]} PAT`}
          className="h-8 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !submitting) void submit();
          }}
        />
        {host !== 'github' && (
          <input
            aria-label="API base URL"
            value={baseUrl}
            onChange={(e) => setBaseUrl(e.target.value)}
            placeholder="API base URL (self-managed — optional)"
            className="h-8 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary placeholder:text-text-dim focus:border-accent focus:outline-none"
          />
        )}
        {error && (
          <p className="text-xs text-danger" role="alert">
            {error}
          </p>
        )}
        <div className="flex gap-2">
          <button
            type="button"
            onClick={() => void submit()}
            disabled={submitting || !token.trim()}
            className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
          >
            {submitting ? 'Verifying…' : 'Connect'}
          </button>
        </div>
        <p className="text-[0.6875rem] text-text-dim">
          We verify the token via <code>GET /user</code> before storing it. The token is encrypted
          with your local master key — only this browser can decrypt it.
        </p>
      </div>
    </div>
  );
}

function DeviceFlowCard({
  code,
  busy,
  onCancel,
  error,
}: {
  code: { userCode: string; verificationUri: string; expiresAt: number };
  busy: boolean;
  onCancel: () => void;
  error: string | null;
}) {
  // Tick the expiry every second so the user sees the countdown move.
  const [now, setNow] = useState(() => Date.now());
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, []);
  const remaining = Math.max(0, Math.floor((code.expiresAt - now) / 1000));
  const minutes = Math.floor(remaining / 60);
  const seconds = remaining % 60;
  // IdP-supplied URL — restrict to http(s) before rendering as a clickable
  // link. Unsafe schemes (javascript:/data:/file:/custom protocol handlers)
  // are shown as plain text so the user can still see the value.
  const safeVerification = safeExternalHref(code.verificationUri);
  return (
    <div className="space-y-2">
      <p className="text-xs text-text-primary">
        Open{' '}
        {safeVerification ? (
          <a
            href={safeVerification}
            target="_blank"
            rel="noopener noreferrer"
            className="inline-flex items-center gap-1 text-accent underline-offset-2 hover:underline"
          >
            {code.verificationUri.replace(/^https?:\/\//, '')}
            <ExternalLink size={11} aria-hidden="true" />
          </a>
        ) : (
          <span
            className="font-mono text-text-muted"
            title="Unsupported URL scheme — copy manually"
          >
            {code.verificationUri}
          </span>
        )}{' '}
        and enter this code:
      </p>
      <div className="flex items-center gap-2">
        <code
          aria-label="Device flow user code"
          className="flex-1 select-all rounded-sm border border-accent/40 bg-card px-3 py-2 text-center font-mono text-lg tracking-widest text-text-primary"
        >
          {code.userCode}
        </code>
        <button
          type="button"
          onClick={() => {
            void safeCopyToClipboard(code.userCode).then((r) => {
              if (!r.ok) {
                useWorkspaceStore.getState().pushToast({
                  tone: 'error',
                  title: 'Copy failed',
                  detail: r.reason,
                });
              }
            });
          }}
          aria-label="Copy device flow code"
          className="inline-flex h-9 items-center rounded-sm border border-border bg-surface px-3 text-[0.6875rem] text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          Copy
        </button>
      </div>
      <p className="text-[0.625rem] text-text-dim">
        Expires in{' '}
        <strong className="text-text-primary">
          {String(minutes).padStart(2, '0')}:{String(seconds).padStart(2, '0')}
        </strong>
        {busy ? ' · waiting for GitHub authorization…' : ''}
      </p>
      {error && (
        <p className="text-[0.6875rem] text-danger" role="alert">
          {error}
        </p>
      )}
      <div className="flex gap-2">
        <button
          type="button"
          onClick={onCancel}
          className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}

// Required scopes for the in-app linking + push flow. Surfaced on the
// session card so the user can see at a glance whether their token
// covers everything before they hit a 403 mid-link.
const REQUIRED_SESSION_SCOPES = ['repo'] as const;
const RECOMMENDED_SESSION_SCOPES = ['pull_request'] as const;

function ScopeChip({ name, ok, required }: { name: string; ok: boolean; required?: boolean }) {
  const tone = ok
    ? 'border-success/40 bg-success/10 text-success'
    : required
      ? 'border-danger/40 bg-danger/10 text-danger'
      : 'border-warning/40 bg-warning/10 text-warning';
  return (
    <span
      className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 font-mono text-[0.625rem] ${tone}`}
      aria-label={`${name} scope ${ok ? 'present' : required ? 'missing (required)' : 'missing (recommended)'}`}
      title={
        ok
          ? `${name}: present`
          : required
            ? `${name}: missing — required for linking + push`
            : `${name}: missing — recommended for PR creation`
      }
    >
      {ok ? <CheckCircle2 size={9} aria-hidden="true" /> : <XCircle size={9} aria-hidden="true" />}
      {name}
      {required && !ok ? '*' : ''}
    </span>
  );
}

type ConnectionTestResult =
  | { kind: 'pass'; grantedScopes: string[] }
  | {
      kind: 'fail';
      reason: 'unauthorized' | 'rate-limited' | 'scope' | 'network' | 'other';
      message: string;
    };

function ActiveSessionCard() {
  const session = useWorkspaceStore((s) => s.local!.sessions.github.workspace!);
  const verify = useWorkspaceStore((s) => s.verifyGitHubScopes);
  const updateToken = useWorkspaceStore((s) => s.updateGitHubToken);
  const disconnect = useWorkspaceStore((s) => s.disconnectGitHubSession);

  const [verifying, setVerifying] = useState(false);
  const [updating, setUpdating] = useState(false);
  const [showUpdate, setShowUpdate] = useState(false);
  const [newToken, setNewToken] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [confirmDisconnect, setConfirmDisconnect] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResult | null>(null);

  const onVerify = async () => {
    setVerifying(true);
    setError(null);
    setTestResult(null);
    try {
      const granted = await verify();
      // verify() returns null when there's no session at all. Treat as fail.
      if (granted === null) {
        setTestResult({
          kind: 'fail',
          reason: 'other',
          message: 'No session to test — reconnect.',
        });
        return;
      }
      setTestResult({ kind: 'pass', grantedScopes: granted });
    } catch (err) {
      // Map error types to user-friendly reasons so the user knows what
      // to fix instead of guessing from a raw stack trace.
      if (err instanceof UnauthorizedError) {
        setTestResult({
          kind: 'fail',
          reason: 'unauthorized',
          message:
            'Token rejected by GitHub (401). The PAT may be revoked or expired — reconnect to refresh.',
        });
      } else if (err instanceof RateLimitedError) {
        setTestResult({
          kind: 'fail',
          reason: 'rate-limited',
          message: 'GitHub rate-limited the verify call. Try again in a few minutes.',
        });
      } else if (err instanceof MissingScopeError) {
        setTestResult({
          kind: 'fail',
          reason: 'scope',
          message: `Token missing required scope(s): ${err.missingScopes.join(', ')}. Update the token from this card.`,
        });
      } else if (err instanceof GitHubError) {
        setTestResult({
          kind: 'fail',
          reason: 'other',
          message: `GitHub error ${err.status}: ${err.message}`,
        });
      } else if (err instanceof Error) {
        // Network error / fetch failure / DNS — TypeError from fetch.
        const isNetwork = err.name === 'TypeError' || /fetch|network/i.test(err.message);
        setTestResult({
          kind: 'fail',
          reason: isNetwork ? 'network' : 'other',
          message: isNetwork ? 'Network error — check your connection and try again.' : err.message,
        });
      } else {
        setTestResult({
          kind: 'fail',
          reason: 'other',
          message: 'Test failed with an unknown error.',
        });
      }
    } finally {
      setVerifying(false);
    }
  };

  const onUpdate = async () => {
    setUpdating(true);
    setError(null);
    try {
      await updateToken(newToken);
      setNewToken('');
      setShowUpdate(false);
    } catch (err) {
      if (err instanceof MissingScopeError) {
        setError(`New token still missing scope(s): ${err.missingScopes.join(', ')}`);
      } else if (err instanceof Error) {
        setError(err.message);
      } else {
        setError('Update failed — unknown error');
      }
    } finally {
      setUpdating(false);
    }
  };

  const missingRequired = REQUIRED_SESSION_SCOPES.filter((s) => !session.grantedScopes.includes(s));
  // The recommended `pull_request` permission is satisfied either by the
  // scope appearing in the granted list (fine-grained PATs that surface
  // it) or by `canCreatePullRequests` being true (classic PATs where
  // `repo` covers PR ops, or fine-grained PATs that passed the probe).
  // The warning + chip use the same source of truth so they never
  // contradict each other.
  const prCapability = session.canCreatePullRequests;
  const prScopeSatisfied = prCapability !== false && prCapability !== null;

  return (
    <div className="space-y-3 rounded-sm border border-success/30 bg-success/5 p-3">
      <div className="flex items-center gap-2">
        <CheckCircle2 size={14} className="text-success" aria-hidden="true" />
        <span className="text-sm font-medium text-text-primary">
          Connected as {session.accountLogin}
        </span>
      </div>
      <dl className="grid grid-cols-[120px_1fr] gap-y-1 text-xs">
        <dt className="text-text-dim">Required scopes</dt>
        <dd className="flex flex-wrap items-center gap-1.5 text-text-primary">
          {REQUIRED_SESSION_SCOPES.map((s) => (
            <ScopeChip key={s} name={s} ok={session.grantedScopes.includes(s)} required />
          ))}
          {RECOMMENDED_SESSION_SCOPES.map((s) => (
            <ScopeChip
              key={s}
              name={s}
              ok={s === 'pull_request' ? prScopeSatisfied : session.grantedScopes.includes(s)}
            />
          ))}
        </dd>
        <dt className="text-text-dim">Granted scopes</dt>
        <dd className="text-text-primary">
          {session.grantedScopes.length > 0 ? session.grantedScopes.join(', ') : '—'}
        </dd>
        <dt className="text-text-dim">Last verified</dt>
        <dd className="text-text-primary">
          {session.lastVerifiedAt ? new Date(session.lastVerifiedAt).toLocaleString() : 'never'}
        </dd>
      </dl>
      {missingRequired.length > 0 && (
        <p className="rounded-sm border border-danger/40 bg-danger/10 p-2 text-[0.6875rem] text-danger">
          Required scope(s) missing: <code>{missingRequired.join(', ')}</code>. Linking and push to
          save will fail until you update the token.
        </p>
      )}
      {missingRequired.length === 0 && prCapability === false && (
        <p className="rounded-sm border border-warning/40 bg-warning/10 p-2 text-[0.6875rem] text-warning">
          This token can&apos;t create pull requests. Push to save works, but creating PRs from the
          app will fail until you update the token.
        </p>
      )}
      {testResult && (
        <p
          role="status"
          className={
            testResult.kind === 'pass'
              ? 'flex items-start gap-1.5 rounded-sm border border-success/40 bg-success/10 p-2 text-[0.6875rem] text-success'
              : 'flex items-start gap-1.5 rounded-sm border border-danger/40 bg-danger/10 p-2 text-[0.6875rem] text-danger'
          }
        >
          {testResult.kind === 'pass' ? (
            <CheckCircle2 size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          ) : (
            <XCircle size={12} aria-hidden="true" className="mt-0.5 shrink-0" />
          )}
          <span>
            {testResult.kind === 'pass'
              ? `Connection healthy — token verified, scopes refreshed.`
              : testResult.message}
          </span>
        </p>
      )}
      {error && (
        <p className="text-xs text-danger" role="alert">
          {error}
        </p>
      )}
      {showUpdate ? (
        <div className="space-y-2 rounded-sm border border-accent/30 bg-accent/5 p-2">
          <input
            type="password"
            value={newToken}
            onChange={(e) => setNewToken(e.target.value)}
            placeholder="New PAT (must belong to the same account)"
            aria-label="New GitHub PAT"
            className="h-7 w-full rounded-sm border border-border bg-card px-2 font-mono text-xs text-text-primary focus:border-accent focus:outline-none"
          />
          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void onUpdate()}
              disabled={updating || !newToken.trim()}
              className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
            >
              {updating ? 'Verifying…' : 'Update'}
            </button>
            <button
              type="button"
              onClick={() => {
                setShowUpdate(false);
                setNewToken('');
                setError(null);
              }}
              className="inline-flex h-7 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:text-text-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            onClick={() => void onVerify()}
            disabled={verifying}
            aria-label="Test GitHub connection"
            className="inline-flex h-7 items-center gap-1.5 rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary disabled:opacity-50"
          >
            <RefreshCw size={12} className={verifying ? 'animate-spin' : ''} />
            {verifying ? 'Testing…' : 'Test connection'}
          </button>
          <button
            type="button"
            onClick={() => setShowUpdate(true)}
            className="inline-flex h-7 items-center rounded-sm border border-accent/40 bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20"
          >
            Update token
          </button>
          <button
            type="button"
            onClick={() => {
              if (confirmDisconnect) {
                void disconnect();
                setConfirmDisconnect(false);
              } else {
                setConfirmDisconnect(true);
              }
            }}
            className={cn(
              'inline-flex h-7 items-center rounded-sm border px-3 text-xs',
              confirmDisconnect
                ? 'border-danger/40 bg-danger/10 text-danger hover:bg-danger/20'
                : 'border-border bg-surface text-text-muted hover:text-text-primary',
            )}
          >
            {confirmDisconnect ? 'Confirm disconnect' : 'Disconnect'}
          </button>
        </div>
      )}
    </div>
  );
}
