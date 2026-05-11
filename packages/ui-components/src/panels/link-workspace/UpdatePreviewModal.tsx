import { useEffect, useMemo, useState } from 'react';
import { AlertTriangle, ArrowDown, Check } from 'lucide-react';
import type {
  LinkedUpdateBucket,
  LinkedUpdateEntry,
  LinkedUpdateResolutionMap,
  LinkedUpdateStatus,
} from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { Modal } from '../../primitives/Modal';
import { LinkedReleaseNotes } from './LinkedReleaseNotes';

const STATUS_LABEL: Record<LinkedUpdateStatus, string> = {
  unchanged: 'Unchanged',
  'source-only': 'Source updated · adopt',
  'local-only': 'Your local mods · keep',
  'both-changed': 'Both changed · pick one',
  'new-in-source': 'New in source · adopt',
  'removed-in-source': 'Removed in source · orphan',
};

const STATUS_TONE: Record<LinkedUpdateStatus, string> = {
  unchanged: 'border-border bg-card text-text-dim',
  'source-only': 'border-success/40 bg-success/5 text-success',
  'local-only': 'border-accent/40 bg-accent/10 text-accent',
  'both-changed': 'border-warning/40 bg-warning/10 text-warning',
  'new-in-source': 'border-success/40 bg-success/5 text-success',
  'removed-in-source': 'border-danger/40 bg-danger/10 text-danger',
};

const BUCKET_LABEL: Record<LinkedUpdateBucket, string> = {
  request: 'Request',
  folder: 'Folder',
  'environment-var': 'Env var',
};

/**
 * Modal driven by `state.activeLinkedUpdate`. Renders every classified
 * entry, lets the user pick `mine`/`theirs` for each `both-changed` row
 * (and optionally `removed-in-source` rows where the default of "drop
 * orphan" can be flipped). Apply is disabled until every required
 * decision is made.
 */
export function UpdatePreviewModal() {
  const active = useWorkspaceStore((s) => s.activeLinkedUpdate);
  const close = useWorkspaceStore((s) => s.clearLinkedUpdatePreview);
  const apply = useWorkspaceStore((s) => s.applyLinkedUpdateForLink);
  const link = useWorkspaceStore((s) =>
    active ? (s.synced?.linkedWorkspaces[active.linkedWorkspaceId] ?? null) : null,
  );

  const [resolutions, setResolutions] = useState<LinkedUpdateResolutionMap>({});
  const [applying, setApplying] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const requiredKeys = useMemo(() => {
    if (!active) return [] as string[];
    return active.preview.entries
      .filter((e) => e.status === 'both-changed')
      .map((e) => `${e.bucket}:${e.key}`);
  }, [active]);

  // Default every `both-changed` row to `'mine'` when the modal opens.
  // Rationale: the consumer explicitly edited the linked content — their
  // local override is the higher-confidence intent. The user can still
  // flip individual rows to `'theirs'` (or use the bulk "Accept all source"
  // button) before Apply. Without this default, Apply was blocked until
  // the user clicked through every conflict, which contradicts the
  // "edits will be merged with the upgraded version" promise.
  useEffect(() => {
    if (!active) return;
    setResolutions((prev) => {
      // Build a default map; only fill keys not already touched by the user
      // so re-opening the modal preserves prior choices in the same session.
      let touched = false;
      const next: LinkedUpdateResolutionMap = { ...prev };
      for (const e of active.preview.entries) {
        if (e.status !== 'both-changed') continue;
        const key = `${e.bucket}:${e.key}`;
        if (next[key] === undefined) {
          next[key] = 'mine';
          touched = true;
        }
      }
      return touched ? next : prev;
    });
  }, [active]);

  const allResolved = requiredKeys.every((k) => resolutions[k]);

  if (!active || !link) return null;

  const setChoice = (entry: LinkedUpdateEntry, choice: 'mine' | 'theirs') => {
    setResolutions((prev) => ({ ...prev, [`${entry.bucket}:${entry.key}`]: choice }));
  };

  const onApply = async () => {
    setApplying(true);
    setError(null);
    try {
      await apply(resolutions);
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Apply failed');
    } finally {
      setApplying(false);
    }
  };

  const bulkAcceptAll = () => {
    const next: LinkedUpdateResolutionMap = {};
    for (const e of active.preview.entries) {
      if (e.status === 'both-changed') next[`${e.bucket}:${e.key}`] = 'theirs';
    }
    setResolutions(next);
  };
  const bulkKeepAll = () => {
    const next: LinkedUpdateResolutionMap = {};
    for (const e of active.preview.entries) {
      if (e.status === 'both-changed') next[`${e.bucket}:${e.key}`] = 'mine';
    }
    setResolutions(next);
  };

  return (
    <Modal
      open
      onClose={() => close()}
      title={`Update ${link.name} ${active.preview.fromVersion ? `v${active.preview.fromVersion}` : '(unpinned)'} → v${active.preview.toVersion}`}
      className="max-w-3xl"
    >
      <div className="flex flex-col gap-3">
        <SummaryStrip preview={active.preview} />

        {/* Surface the cumulative release-note changelog from
            (fromVersion, toVersion]. Pulls from synced.releases.perLink
            which the link-refresh flow already populates. */}
        <LinkedReleaseNotes
          linkedWorkspaceId={active.linkedWorkspaceId}
          fromVersion={active.preview.fromVersion ?? null}
          toVersion={active.preview.toVersion}
        />

        {active.preview.entries.length === 0 ? (
          // Two distinct empty states. The pin can be ahead of (or in
          // sync with) the cached snapshot — refresh updates the
          // snapshot but not the pin, so it's common to land here with
          // a stale pin and a current snapshot. Offer a one-click pin
          // bump in that case; otherwise it's a true no-op.
          link.pinnedVersion !== active.preview.toVersion ? (
            <div className="flex items-start gap-2 rounded-sm border border-accent/30 bg-accent/5 p-3 text-xs text-accent">
              <Check size={14} className="mt-0.5 shrink-0" aria-hidden="true" />
              <div>
                <p className="text-text-primary">
                  No content changes between{' '}
                  {link.pinnedVersion ? <code>v{link.pinnedVersion}</code> : <em>unpinned</em>} and{' '}
                  <code>v{active.preview.toVersion}</code>.
                </p>
                <p className="mt-1 text-[11px] text-text-muted">
                  Your cached snapshot already matches the source — likely because you refreshed the
                  link after the version bump. Apply moves the pin to{' '}
                  <code>v{active.preview.toVersion}</code> with no merge needed.
                </p>
              </div>
            </div>
          ) : (
            <div className="flex items-center gap-2 rounded-sm border border-border bg-surface p-3 text-xs text-text-muted">
              <Check size={14} className="text-success" aria-hidden="true" />
              Source is byte-equal to your pinned snapshot. Nothing to apply.
            </div>
          )
        ) : (
          <>
            {/* Up-front explanation of how overrides interact with the
                update. Shown whenever there's anything to apply — addresses
                the common worry: "will my local edits be wiped?". They
                won't — `local-only` rows keep your override; `both-changed`
                rows default to keeping your override and let you flip to
                the source's value per row if you want. */}
            <p className="text-[11px] leading-snug text-text-muted">
              Your local edits are kept by default. Rows tagged
              <span className="mx-1 rounded-sm border border-accent/40 bg-accent/10 px-1 py-0.5 text-[10px] text-accent">
                Your local mods · keep
              </span>
              stay as-is on top of the upgraded source. Rows tagged
              <span className="mx-1 rounded-sm border border-warning/40 bg-warning/10 px-1 py-0.5 text-[10px] text-warning">
                Both changed · pick one
              </span>
              moved both upstream and locally — they default to{' '}
              <span className="text-text-primary">Keep mine</span>; click{' '}
              <span className="text-text-primary">Accept source</span> on any row to take the
              source&apos;s value instead. Apply commits the chosen state to your workspace; push to
              save sends it to your repo.
            </p>
            {requiredKeys.length > 0 && (
              <div className="flex items-center gap-2 rounded-sm border border-warning/30 bg-warning/5 p-2 text-xs text-warning">
                <AlertTriangle size={12} aria-hidden="true" />
                {requiredKeys.length} row{requiredKeys.length === 1 ? '' : 's'} changed both
                upstream and locally — defaulting to <span className="font-medium">Keep mine</span>.
                <button
                  type="button"
                  onClick={bulkAcceptAll}
                  className="ml-auto rounded-sm border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] hover:bg-warning/20"
                >
                  Accept all source
                </button>
                <button
                  type="button"
                  onClick={bulkKeepAll}
                  className="rounded-sm border border-accent/40 bg-accent/10 px-2 py-0.5 text-[10px] text-accent hover:bg-accent/20"
                >
                  Keep all mine
                </button>
              </div>
            )}
            <ul className="max-h-96 space-y-1.5 overflow-y-auto" aria-label="Update entries">
              {active.preview.entries.map((entry) => (
                <PreviewRow
                  key={`${entry.bucket}:${entry.key}`}
                  entry={entry}
                  choice={resolutions[`${entry.bucket}:${entry.key}`] ?? null}
                  onChoose={(c) => setChoice(entry, c)}
                />
              ))}
            </ul>
          </>
        )}

        {error && (
          <p
            className="rounded-sm border border-danger/30 bg-danger/5 p-2 text-xs text-danger"
            role="alert"
          >
            {error}
          </p>
        )}

        <div className="flex items-center justify-end gap-2 border-t border-border-subtle pt-3">
          <button
            type="button"
            onClick={() => close()}
            className="inline-flex h-8 items-center rounded-sm border border-border bg-surface px-3 text-xs text-text-muted hover:border-border-strong hover:text-text-primary"
          >
            Cancel
          </button>
          {(() => {
            // Three apply modes:
            //   1. Real merge — entries to apply, conflicts (if any) resolved.
            //   2. Pin-only — zero entries, but pinned version drifted from
            //      the source's currentVersion (typical post-refresh state).
            //      Apply just advances the pin; no content moves.
            //   3. Truly nothing — zero entries AND pin matches. Apply stays
            //      disabled.
            const noEntries = active.preview.entries.length === 0;
            const pinOnly = noEntries && link.pinnedVersion !== active.preview.toVersion;
            const trulyNothing = noEntries && !pinOnly;
            const applyDisabled = applying || !allResolved || trulyNothing;
            const label = applying
              ? pinOnly
                ? 'Updating pin…'
                : 'Applying…'
              : pinOnly
                ? `Update pin to v${active.preview.toVersion}`
                : 'Apply update';
            return (
              <button
                type="button"
                onClick={() => void onApply()}
                disabled={applyDisabled}
                aria-label={pinOnly ? 'Update pin' : 'Apply update'}
                className="inline-flex h-8 items-center gap-1.5 rounded-sm border border-accent bg-accent/10 px-3 text-xs text-accent hover:bg-accent/20 disabled:opacity-50"
              >
                <ArrowDown size={12} />
                {label}
              </button>
            );
          })()}
        </div>
      </div>
    </Modal>
  );
}

function SummaryStrip({
  preview,
}: {
  preview: NonNullable<
    ReturnType<typeof useWorkspaceStore.getState>['activeLinkedUpdate']
  >['preview'];
}) {
  const items: Array<{ label: string; count: number; tone: string }> = [
    {
      label: 'source-only',
      count: preview.summary['source-only'],
      tone: 'border-success/40 bg-success/5 text-success',
    },
    {
      label: 'new-in-source',
      count: preview.summary['new-in-source'],
      tone: 'border-success/40 bg-success/5 text-success',
    },
    {
      label: 'local-only',
      count: preview.summary['local-only'],
      tone: 'border-accent/40 bg-accent/10 text-accent',
    },
    {
      label: 'both-changed',
      count: preview.summary['both-changed'],
      tone: 'border-warning/40 bg-warning/10 text-warning',
    },
    {
      label: 'removed-in-source',
      count: preview.summary['removed-in-source'],
      tone: 'border-danger/40 bg-danger/10 text-danger',
    },
  ].filter((i) => i.count > 0);
  if (items.length === 0) return null;
  return (
    <div className="flex flex-wrap gap-1.5">
      {items.map((i) => (
        <span
          key={i.label}
          className={`inline-flex items-center gap-1 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${i.tone}`}
        >
          {i.label} · {i.count}
        </span>
      ))}
    </div>
  );
}

function PreviewRow({
  entry,
  choice,
  onChoose,
}: {
  entry: LinkedUpdateEntry;
  choice: 'mine' | 'theirs' | null;
  onChoose: (c: 'mine' | 'theirs') => void;
}) {
  const needsDecision = entry.status === 'both-changed';
  return (
    <li className="rounded-sm border border-border bg-surface p-2">
      <div className="flex flex-wrap items-center gap-2 text-xs">
        <span
          className={`shrink-0 rounded-sm border px-1.5 py-0.5 text-[10px] uppercase tracking-wider ${STATUS_TONE[entry.status]}`}
        >
          {STATUS_LABEL[entry.status]}
        </span>
        <span className="rounded-sm border border-border bg-card px-1.5 py-0.5 text-[10px] text-text-dim">
          {BUCKET_LABEL[entry.bucket]}
        </span>
        <code className="truncate text-text-primary">{entry.label}</code>
        {needsDecision && (
          <div className="ml-auto flex gap-1">
            <button
              type="button"
              onClick={() => onChoose('theirs')}
              className={`rounded-sm border px-2 py-0.5 text-[10px] ${
                choice === 'theirs'
                  ? 'border-success bg-success/15 text-success'
                  : 'border-border bg-card text-text-muted hover:border-success/40 hover:text-success'
              }`}
              aria-pressed={choice === 'theirs'}
            >
              Accept source
            </button>
            <button
              type="button"
              onClick={() => onChoose('mine')}
              className={`rounded-sm border px-2 py-0.5 text-[10px] ${
                choice === 'mine'
                  ? 'border-accent bg-accent/15 text-accent'
                  : 'border-border bg-card text-text-muted hover:border-accent/40 hover:text-accent'
              }`}
              aria-pressed={choice === 'mine'}
            >
              Keep mine
            </button>
          </div>
        )}
      </div>
    </li>
  );
}
