import { useMemo, useState } from 'react';
import { Camera, RotateCcw, Trash2 } from 'lucide-react';
import type {
  WorkspaceSnapshot,
  WorkspaceSnapshotTrigger,
  WorkspaceSynced,
} from '@apicircle/shared';
import { formatBytes } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ConfirmDialog } from '../../primitives/ConfirmDialog';

/**
 * Lightweight diff summary used in the restore preview. Counts requests,
 * folders, environments, mock servers, and execution plans on both sides
 * so the user sees the magnitude of the change before they confirm.
 *
 * Not a full 3-way diff — that lives in `summarizeUnpushedChanges` and is
 * heavier. This summary stays local + fast, suitable for an inline preview.
 */
interface SnapshotDiffSummary {
  category: string;
  before: number;
  after: number;
  delta: number;
}

function summarizeSnapshotDiff(
  current: WorkspaceSynced | null,
  snapshot: WorkspaceSynced,
): SnapshotDiffSummary[] {
  if (!current) return [];
  const pairs: Array<[string, number, number]> = [
    [
      'Requests',
      Object.keys(current.collections.requests).length,
      Object.keys(snapshot.collections.requests).length,
    ],
    [
      'Folders',
      Object.keys(current.collections.folders).length,
      Object.keys(snapshot.collections.folders).length,
    ],
    [
      'Environments',
      Object.keys(current.environments.items).length,
      Object.keys(snapshot.environments.items).length,
    ],
    [
      'Mock servers',
      Object.keys(current.mockServers ?? {}).length,
      Object.keys(snapshot.mockServers ?? {}).length,
    ],
    [
      'Execution plans',
      Object.keys(current.executionPlans ?? {}).length,
      Object.keys(snapshot.executionPlans ?? {}).length,
    ],
  ];
  return pairs.map(([category, before, after]) => ({
    category,
    before,
    after,
    delta: after - before,
  }));
}

// History panel's "Snapshots" tab. Pre-destructive snapshots are auto-
// captured before push / merge / linked-update / yank / deprecate, plus
// manual saves via the "Take snapshot now" button. Restore replaces the
// synced doc with the captured copy and clears the sync base so the next
// push re-forks against remote.

const TRIGGER_LABEL: Record<WorkspaceSnapshotTrigger, string> = {
  manual: 'Manual',
  'pre-push': 'Before push',
  'pre-merge': 'Before merge',
  'pre-linked-update': 'Before linked update',
  'pre-yank': 'Before yank',
  'pre-deprecate': 'Before deprecate',
};

const TRIGGER_TONE: Record<WorkspaceSnapshotTrigger, string> = {
  manual: 'border-accent/40 bg-accent/10 text-accent',
  'pre-push': 'border-accent/40 bg-accent/10 text-accent',
  'pre-merge': 'border-warning/40 bg-warning/5 text-warning',
  'pre-linked-update': 'border-warning/40 bg-warning/5 text-warning',
  'pre-yank': 'border-danger/40 bg-danger/5 text-danger',
  'pre-deprecate': 'border-danger/40 bg-danger/5 text-danger',
};

export function SnapshotsTimeline() {
  const ledger = useWorkspaceStore((s) => s.local?.snapshots);
  const currentSynced = useWorkspaceStore((s) => s.synced);
  const captureSnapshot = useWorkspaceStore((s) => s.captureSnapshot);
  const deleteSnapshot = useWorkspaceStore((s) => s.deleteSnapshot);
  const [restoreTarget, setRestoreTarget] = useState<WorkspaceSnapshot | null>(null);
  const [clearAllOpen, setClearAllOpen] = useState(false);
  // Per-row pending delete — caught at click time so the kebab can close
  // before the dialog opens. Symmetric with bulk Clear All which also
  // uses ConfirmDialog (above).
  const [pendingDelete, setPendingDelete] = useState<WorkspaceSnapshot | null>(null);

  // Precompute the diff summary when a restore target is selected.
  const restoreDiff = useMemo(
    () =>
      restoreTarget
        ? summarizeSnapshotDiff(currentSynced, restoreTarget.workspaceSyncedSnapshot)
        : [],
    [currentSynced, restoreTarget],
  );

  if (!ledger) return null;

  const totalBytes = ledger.entries.reduce((sum, s) => sum + s.sizeBytes, 0);
  const capLabel = Number.isFinite(ledger.maxBytes) ? formatBytes(ledger.maxBytes) : 'unlimited';

  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 text-xs text-text-muted">
          <Camera size={13} aria-hidden="true" className="text-accent" />
          <span className="font-medium text-text-primary">Workspace snapshots</span>
          <span className="text-[0.6875rem] text-text-dim">
            {ledger.entries.length} entr{ledger.entries.length === 1 ? 'y' : 'ies'}
            {' · '}
            {formatBytes(totalBytes)} of {capLabel}
          </span>
        </div>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={() => captureSnapshot({ trigger: 'manual' })}
            className="inline-flex h-7 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[0.6875rem] text-accent hover:bg-accent/20"
          >
            <Camera size={11} aria-hidden="true" />
            Take snapshot now
          </button>
          {ledger.entries.length > 0 && (
            <button
              type="button"
              onClick={() => setClearAllOpen(true)}
              aria-label="Clear all snapshots"
              className="inline-flex h-7 items-center gap-1 rounded-sm border border-border bg-card px-2 text-[0.6875rem] text-text-muted hover:text-text-primary"
            >
              <Trash2 size={11} aria-hidden="true" />
              Clear all
            </button>
          )}
        </div>
      </div>
      <p className="text-[0.6875rem] text-text-dim">
        Auto-captured before destructive ops (push, merge, linked-update, yank, deprecate). Restore
        swaps the synced doc back to the captured state and clears the diff base so the next push
        re-forks against remote. Cap: <code>Settings → Workspace snapshot cap</code>.
      </p>
      {ledger.entries.length === 0 ? (
        <p className="rounded-sm border border-dashed border-border-subtle p-4 text-center text-[0.6875rem] text-text-dim">
          No snapshots yet. The next push, merge, or release op will capture one — or use the button
          above to save the current state manually.
        </p>
      ) : (
        <ul className="space-y-1.5">
          {ledger.entries.map((entry) => (
            <SnapshotRow
              key={entry.id}
              entry={entry}
              onRestore={() => setRestoreTarget(entry)}
              onRequestDelete={() => setPendingDelete(entry)}
            />
          ))}
        </ul>
      )}

      <ConfirmDialog
        open={pendingDelete !== null}
        title="Delete this snapshot?"
        tone="danger"
        confirmLabel="Delete snapshot"
        description={
          pendingDelete && (
            <div className="space-y-1">
              <p>
                Removes this snapshot from the local ledger. The workspace itself isn&apos;t
                affected.
              </p>
              <p className="text-[0.6875rem] text-text-dim">
                {TRIGGER_LABEL[pendingDelete.triggeredBy]} · captured{' '}
                {formatTimestamp(pendingDelete.createdAt)} · {formatBytes(pendingDelete.sizeBytes)}
              </p>
            </div>
          )
        }
        onCancel={() => setPendingDelete(null)}
        onConfirm={() => {
          if (pendingDelete) deleteSnapshot(pendingDelete.id);
          setPendingDelete(null);
        }}
      />
      <ConfirmDialog
        open={clearAllOpen}
        title="Delete every snapshot?"
        tone="danger"
        confirmLabel="Delete all"
        description={
          <p>
            Removes all {ledger.entries.length} snapshot{ledger.entries.length === 1 ? '' : 's'}.
            This can&apos;t be undone. The workspace itself isn&apos;t affected.
          </p>
        }
        onCancel={() => setClearAllOpen(false)}
        onConfirm={() => {
          for (const entry of ledger.entries) deleteSnapshot(entry.id);
          setClearAllOpen(false);
        }}
      />
      <ConfirmDialog
        open={restoreTarget !== null}
        title="Restore workspace snapshot"
        description={
          restoreTarget && (
            <div className="space-y-2">
              <p>
                Restoring this snapshot replaces the entire <code>synced</code> doc with the
                captured state. Anything you&apos;ve done since the snapshot will be discarded.
              </p>
              {restoreDiff.length > 0 && (
                <div className="rounded-sm border border-border-subtle bg-surface p-2">
                  <p className="mb-1 text-[0.625rem] uppercase tracking-wider text-text-dim">
                    Counts after restore
                  </p>
                  <ul className="grid grid-cols-[1fr_auto_auto_auto] gap-x-2 text-[0.6875rem] font-mono">
                    <li className="contents text-text-dim">
                      <span>Category</span>
                      <span className="text-right">Now</span>
                      <span className="text-right">After</span>
                      <span className="text-right">Δ</span>
                    </li>
                    {restoreDiff.map((row) => (
                      <li key={row.category} className="contents">
                        <span className="text-text-muted">{row.category}</span>
                        <span className="text-right text-text-primary">{row.before}</span>
                        <span className="text-right text-text-primary">{row.after}</span>
                        <span
                          className={
                            'text-right ' +
                            (row.delta > 0
                              ? 'text-success'
                              : row.delta < 0
                                ? 'text-danger'
                                : 'text-text-dim')
                          }
                        >
                          {row.delta > 0 ? `+${row.delta}` : row.delta}
                        </span>
                      </li>
                    ))}
                  </ul>
                </div>
              )}
              <p className="text-[0.6875rem] text-text-dim">
                {TRIGGER_LABEL[restoreTarget.triggeredBy]} · captured{' '}
                {formatTimestamp(restoreTarget.createdAt)} · {formatBytes(restoreTarget.sizeBytes)}
              </p>
              {restoreTarget.note && (
                <p className="rounded-sm border border-border-subtle bg-surface px-2 py-1 text-[0.6875rem] text-text-muted">
                  Note: {restoreTarget.note}
                </p>
              )}
            </div>
          )
        }
        confirmLabel="Restore"
        tone="danger"
        typedConfirm="RESTORE"
        onCancel={() => setRestoreTarget(null)}
        onConfirm={() => {
          if (!restoreTarget) return;
          useWorkspaceStore.getState().restoreSnapshot(restoreTarget.id);
          setRestoreTarget(null);
        }}
      />
    </section>
  );
}

function SnapshotRow({
  entry,
  onRestore,
  onRequestDelete,
}: {
  entry: WorkspaceSnapshot;
  onRestore: () => void;
  onRequestDelete: () => void;
}) {
  return (
    <li className="flex items-center gap-2 rounded-sm border border-border bg-surface px-2 py-1.5 text-[0.6875rem]">
      <span
        className={`shrink-0 rounded-sm border px-1.5 py-0.5 font-mono text-[0.625rem] ${TRIGGER_TONE[entry.triggeredBy]}`}
      >
        {TRIGGER_LABEL[entry.triggeredBy]}
      </span>
      <div className="min-w-0 flex-1">
        <div className="truncate text-text-primary">
          {entry.note ?? <em className="text-text-dim">No note</em>}
        </div>
        <div className="text-[0.625rem] text-text-dim">
          {formatTimestamp(entry.createdAt)} · {formatBytes(entry.sizeBytes)}
        </div>
      </div>
      <button
        type="button"
        onClick={onRestore}
        aria-label={`Restore snapshot from ${formatTimestamp(entry.createdAt)}`}
        title="Restore"
        className="inline-flex h-6 items-center gap-1 rounded-sm border border-accent/40 bg-accent/10 px-2 text-[0.625rem] text-accent hover:bg-accent/20"
      >
        <RotateCcw size={10} aria-hidden="true" />
        Restore
      </button>
      <button
        type="button"
        onClick={onRequestDelete}
        aria-label={`Delete snapshot from ${formatTimestamp(entry.createdAt)}`}
        title="Delete snapshot"
        className="inline-flex h-6 w-6 items-center justify-center rounded-sm text-text-faint hover:bg-danger/5 hover:text-danger"
      >
        <Trash2 size={10} aria-hidden="true" />
      </button>
    </li>
  );
}

function formatTimestamp(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleString();
  } catch {
    return iso;
  }
}
