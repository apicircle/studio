import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// Snapshot lifecycle commands:
//   • captureSnapshot      — InputBox for note, fires snapshot.capture
//   • restoreSnapshot      — QuickPick over entries, confirmation modal,
//                            fires snapshot.restore
//   • deleteSnapshot       — confirmation, fires snapshot.delete
//   • setSnapshotMaxBytes  — InputBox for cap, fires snapshot.set_max_bytes
//
// Manual snapshots are the Phase 1 vehicle for "undo accidental delete". The
// pre-linked-update / pre-yank / pre-deprecate triggers fire automatically
// from their owning commands (Phases 7 + 8).
// =============================================================================

export interface SnapshotActionsDeps {
  bridge: VsCodeBridge;
}

export async function captureSnapshotCommand(deps: SnapshotActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }

  const note = await vscode.window.showInputBox({
    prompt: 'Snapshot note (optional — describes why you captured)',
    placeHolder: 'before refactor / about to delete old auth requests / …',
  });
  if (note === undefined) return; // dismissed

  await active.apply({
    kind: 'snapshot.capture',
    trigger: 'manual',
    note: note.length > 0 ? note : undefined,
  });
  await vscode.window.showInformationMessage('Snapshot captured.');
}

export interface SnapshotNodeArg {
  kind: 'entry';
  id: string;
}

export async function restoreSnapshotCommand(
  deps: SnapshotActionsDeps,
  node?: SnapshotNodeArg,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const state = await active.read();
  const snapshots = state.local.snapshots.entries;
  if (snapshots.length === 0) {
    await vscode.window.showInformationMessage('No snapshots available.');
    return;
  }

  let picked: { id: string; label: string } | undefined;
  if (node && node.kind === 'entry') {
    const direct = snapshots.find((s) => s.id === node.id);
    if (!direct) {
      await vscode.window.showWarningMessage('Snapshot no longer exists.');
      return;
    }
    picked = { id: direct.id, label: direct.note ?? `${direct.triggeredBy} snapshot` };
  } else {
    const items = [...snapshots]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        label: `${s.triggeredBy} · ${ago(s.createdAt)}`,
        description: s.note ?? '',
        detail: `${formatBytes(s.sizeBytes)} · captured ${s.createdAt}`,
        id: s.id,
      }));
    picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Pick a snapshot to restore',
    });
  }
  if (!picked) return;

  const confirm = await vscode.window.showWarningMessage(
    `Restore snapshot "${picked.label}"? This REPLACES the current workspace.synced state. The current state is captured as a "manual" snapshot first so the restore is itself reversible.`,
    { modal: true },
    'Restore',
  );
  if (confirm !== 'Restore') return;

  // Capture a safety snapshot before restoring so the user can undo.
  await active.apply({
    kind: 'snapshot.capture',
    trigger: 'manual',
    note: `Safety snapshot before restoring ${picked.id}`,
  });
  await active.apply({ kind: 'snapshot.restore', id: picked.id });
  await vscode.window.showInformationMessage('Snapshot restored.');
}

/**
 * Set the storage cap for the local snapshot ring buffer. The cap is shared
 * across every snapshot trigger (manual + pre-yank + pre-deprecate + …) so
 * raising it is the user's escape hatch when the eviction policy starts
 * trimming snapshots they wanted to keep.
 *
 * Reads the current value, prompts via InputBox (parsed as MB), and fires
 * `snapshot.set_max_bytes`. The Snapshots sidebar tree tooltip points users
 * here; before R2-G6 the command didn't exist and the tooltip was a dead end.
 */
export async function setSnapshotMaxBytesCommand(deps: SnapshotActionsDeps): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
    return;
  }
  const state = await active.read();
  const currentMB = Math.round(state.local.snapshots.maxBytes / (1024 * 1024));
  const input = await vscode.window.showInputBox({
    prompt: 'Snapshot storage cap in MB (current: ' + currentMB + ' MB)',
    value: String(currentMB),
    validateInput: (s) => {
      const n = Number(s);
      if (!Number.isFinite(n)) return 'Enter a number';
      if (!Number.isInteger(n)) return 'Enter whole MB (no decimals)';
      if (n <= 0) return 'Must be > 0';
      if (n > 2048) return 'Cap must be ≤ 2048 MB (2 GB)';
      return null;
    },
  });
  if (input === undefined) return;
  // Integer-validated above — `Number(input) * 1024 * 1024` is now exact.
  const nextBytes = Number(input) * 1024 * 1024;
  await active.apply({ kind: 'snapshot.set_max_bytes', maxBytes: nextBytes });
  await vscode.window.showInformationMessage(
    'Snapshot cap set to ' + Math.round(nextBytes / (1024 * 1024)) + ' MB.',
  );
}

export async function deleteSnapshotCommand(
  deps: SnapshotActionsDeps,
  node?: SnapshotNodeArg,
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) return;
  const state = await active.read();
  const snapshots = state.local.snapshots.entries;
  if (snapshots.length === 0) {
    await vscode.window.showInformationMessage('No snapshots to delete.');
    return;
  }
  let picked: { id: string } | undefined;
  if (node && node.kind === 'entry') {
    if (!snapshots.find((s) => s.id === node.id)) {
      await vscode.window.showWarningMessage('Snapshot no longer exists.');
      return;
    }
    picked = { id: node.id };
  } else {
    const items = [...snapshots]
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .map((s) => ({
        label: `${s.triggeredBy} · ${ago(s.createdAt)}`,
        description: s.note ?? '',
        id: s.id,
      }));
    picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Pick a snapshot to delete',
    });
  }
  if (!picked) return;
  const confirm = await vscode.window.showWarningMessage(
    `Delete this snapshot? Cannot be undone.`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;
  await active.apply({ kind: 'snapshot.delete', id: picked.id });
}

function ago(iso: string): string {
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return iso;
  const seconds = Math.floor((Date.now() - t) / 1000);
  if (seconds < 60) return `${seconds}s ago`;
  if (seconds < 3600) return `${Math.floor(seconds / 60)}m ago`;
  if (seconds < 86400) return `${Math.floor(seconds / 3600)}h ago`;
  return `${Math.floor(seconds / 86400)}d ago`;
}

function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
