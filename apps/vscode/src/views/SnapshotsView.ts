import * as vscode from 'vscode';
import { BaseTreeView } from './BaseTreeView';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// SnapshotsView — `synced.snapshots` ledger as a sidebar tree.
//
// Top-level row is a storage-meter summary; children are individual snapshots
// newest-first. Each entry exposes inline Restore + Delete actions via context
// menu items registered in package.json.
//
// Gap D — previously the snapshot ledger was reachable only through the
// command palette's "Restore Snapshot…" / "Delete Snapshot…" pickers. The
// sidebar TreeView surfaces the same data live, with the size headroom
// visualized against `snapshots.maxBytes` so users see when the cap is
// approaching.
// =============================================================================

export type SnapshotsNode = { kind: 'storage' } | { kind: 'entry'; id: string };

export class SnapshotsView extends BaseTreeView<SnapshotsNode> {
  readonly viewId = 'apicircle.snapshots';

  constructor(private readonly bridge: VsCodeBridge) {
    super();
  }

  async getTreeItem(element: SnapshotsNode): Promise<vscode.TreeItem> {
    const active = this.bridge.activeWorkspace();
    if (!active) return new vscode.TreeItem('No workspace');
    const state = await active.read();
    const snapshots = state.local.snapshots;

    if (element.kind === 'storage') {
      const used = snapshots.entries.reduce((sum, e) => sum + e.sizeBytes, 0);
      const cap = snapshots.maxBytes;
      const pct = cap > 0 ? Math.round((used / cap) * 100) : 0;
      const item = new vscode.TreeItem(
        `Storage: ${formatBytes(used)} / ${formatBytes(cap)} (${pct}%)`,
        vscode.TreeItemCollapsibleState.None,
      );
      item.iconPath = new vscode.ThemeIcon('database');
      item.tooltip = `${snapshots.entries.length} snapshot(s) using ${formatBytes(
        used,
      )} of ${formatBytes(cap)} cap.\nSet the cap via the Command Palette → "APICircle: Set Snapshot Max Bytes".`;
      item.contextValue = 'storage-meter';
      return item;
    }

    const entry = snapshots.entries.find((e) => e.id === element.id);
    if (!entry) return new vscode.TreeItem('(deleted snapshot)');
    const triggerIcon = ICON_BY_TRIGGER[entry.triggeredBy] ?? 'history';
    const item = new vscode.TreeItem(
      entry.note ?? `${entry.triggeredBy} snapshot`,
      vscode.TreeItemCollapsibleState.None,
    );
    item.description = `${entry.triggeredBy} · ${formatBytes(entry.sizeBytes)} · ${ago(entry.createdAt)}`;
    item.iconPath = new vscode.ThemeIcon(triggerIcon);
    item.tooltip = `Captured: ${entry.createdAt}\nTrigger: ${entry.triggeredBy}\nSize: ${formatBytes(entry.sizeBytes)}${entry.note ? `\nNote: ${entry.note}` : ''}`;
    item.contextValue = 'snapshot-entry';
    return item;
  }

  async getChildren(element?: SnapshotsNode): Promise<SnapshotsNode[]> {
    const active = this.bridge.activeWorkspace();
    if (!active) return [];
    if (element) return [];

    const state = await active.read();
    const sorted = [...state.local.snapshots.entries].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    // R3-G5: when no snapshots exist, return an empty children array so the
    // viewsWelcome contribution in package.json fires with the "capture your
    // first snapshot" call-to-action. The storage meter only appears once
    // there's something to meter — otherwise it's a confusing "Storage: 0 B"
    // row with no guidance.
    if (sorted.length === 0) return [];
    return [{ kind: 'storage' }, ...sorted.map((e) => ({ kind: 'entry' as const, id: e.id }))];
  }
}

const ICON_BY_TRIGGER: Record<string, string> = {
  manual: 'save',
  'pre-linked-update': 'cloud-download',
  'pre-yank': 'warning',
  'pre-deprecate': 'archive',
  'pre-restore': 'history',
};

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
