import { describe, it, expect } from 'vitest';
import type * as vscode from 'vscode';
import { SnapshotsView } from './SnapshotsView';
import type { VsCodeBridge } from '../host/vscodeBridge';

interface Snap {
  id: string;
  createdAt: string;
  sizeBytes: number;
  triggeredBy: 'manual' | 'pre-linked-update' | 'pre-yank' | 'pre-deprecate' | 'pre-restore';
  note?: string;
}

function makeBridge(entries: Snap[] = [], maxBytes = 50 * 1024 * 1024): VsCodeBridge {
  return {
    activeWorkspace: () => ({
      workspace: { id: 'w' },
      read: async () => ({
        synced: {},
        local: {
          snapshots: { entries, maxBytes },
        },
      }),
    }),
  } as unknown as VsCodeBridge;
}

describe('SnapshotsView', () => {
  it('returns empty children when no workspace is active', async () => {
    const view = new SnapshotsView({
      activeWorkspace: () => undefined,
    } as unknown as VsCodeBridge);
    expect(await view.getChildren()).toEqual([]);
  });

  it('returns storage row + entries newest-first', async () => {
    const view = new SnapshotsView(
      makeBridge([
        { id: 'a', createdAt: '2026-01-01T00:00:00Z', sizeBytes: 10, triggeredBy: 'manual' },
        { id: 'b', createdAt: '2026-02-01T00:00:00Z', sizeBytes: 20, triggeredBy: 'pre-yank' },
      ]),
    );
    const kids = (await view.getChildren()) as Array<{ kind: string; id?: string }>;
    expect(kids[0]).toEqual({ kind: 'storage' });
    expect(kids[1]).toEqual({ kind: 'entry', id: 'b' });
    expect(kids[2]).toEqual({ kind: 'entry', id: 'a' });
  });

  it('returns no children for any non-root node (flat list)', async () => {
    const view = new SnapshotsView(
      makeBridge([{ id: 'a', createdAt: '2026-01-01', sizeBytes: 10, triggeredBy: 'manual' }]),
    );
    expect(await view.getChildren({ kind: 'entry', id: 'a' })).toEqual([]);
    expect(await view.getChildren({ kind: 'storage' })).toEqual([]);
  });

  it('renders the storage meter with a percentage', async () => {
    const view = new SnapshotsView(
      makeBridge(
        [{ id: 'a', createdAt: '2026-01-01', sizeBytes: 1024, triggeredBy: 'manual' }],
        4096,
      ),
    );
    const item = (await view.getTreeItem({ kind: 'storage' })) as vscode.TreeItem;
    expect(typeof item.label).toBe('string');
    expect(item.label as string).toContain('(25%)');
    expect((item.iconPath as { id: string }).id).toBe('database');
  });

  it('renders an entry with note as label, description, and trigger-themed icon', async () => {
    const view = new SnapshotsView(
      makeBridge([
        {
          id: 'a',
          createdAt: '2026-01-01T00:00:00Z',
          sizeBytes: 256,
          triggeredBy: 'pre-yank',
          note: 'About to yank linked release',
        },
      ]),
    );
    const item = (await view.getTreeItem({ kind: 'entry', id: 'a' })) as vscode.TreeItem;
    expect(item.label).toBe('About to yank linked release');
    expect(typeof item.description).toBe('string');
    expect(item.description as string).toContain('pre-yank');
    expect((item.iconPath as { id: string }).id).toBe('warning');
    expect(item.contextValue).toBe('snapshot-entry');
  });

  it('falls back to a default label when no note is provided', async () => {
    const view = new SnapshotsView(
      makeBridge([{ id: 'a', createdAt: '2026-01-01', sizeBytes: 100, triggeredBy: 'manual' }]),
    );
    const item = (await view.getTreeItem({ kind: 'entry', id: 'a' })) as vscode.TreeItem;
    expect(typeof item.label).toBe('string');
    expect(item.label as string).toBe('manual snapshot');
  });

  it('shows a stub label when an entry referenced by id no longer exists', async () => {
    const view = new SnapshotsView(makeBridge([]));
    const item = (await view.getTreeItem({ kind: 'entry', id: 'missing' })) as vscode.TreeItem;
    expect(item.label).toBe('(deleted snapshot)');
  });

  it('returns empty children when active workspace has zero snapshots (lets viewsWelcome fire)', async () => {
    const view = new SnapshotsView(makeBridge([]));
    const kids = await view.getChildren();
    expect(kids).toEqual([]);
  });
});
