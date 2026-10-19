import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { WorkspaceSnapshot, WorkspaceSnapshotTrigger } from '@apicircle/shared';
import { SnapshotsTimeline } from './SnapshotsTimeline';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import * as download from '../../primitives/download';

// The timeline badges each snapshot with the op that captured it. The label
// and tone maps are exhaustive over `WorkspaceSnapshotTrigger`, so a new
// trigger that is added to the union but not to the badge would render an
// `undefined` chip — these tests pin every trigger to a visible label.

function snapshotFixture(
  triggeredBy: WorkspaceSnapshotTrigger,
  overrides: Partial<WorkspaceSnapshot> = {},
): WorkspaceSnapshot {
  const synced = useWorkspaceStore.getState().synced!;
  return {
    id: `snap-${triggeredBy}`,
    createdAt: '2026-01-01T00:00:00.000Z',
    triggeredBy,
    workspaceSyncedSnapshot: synced,
    sizeBytes: 128,
    ...overrides,
  };
}

async function renderWithSnapshots(entries: WorkspaceSnapshot[]): Promise<void> {
  await renderWithStore(<SnapshotsTimeline />);
  act(() => {
    useWorkspaceStore.setState({
      local: {
        ...useWorkspaceStore.getState().local!,
        snapshots: { entries, maxBytes: 5_000_000 },
      },
    });
  });
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('SnapshotsTimeline trigger badges', () => {
  const CASES: Array<[WorkspaceSnapshotTrigger, string]> = [
    ['manual', 'Manual'],
    ['pre-push', 'Before push'],
    ['pre-merge', 'Before merge'],
    ['pre-import', 'Before workspace import'],
    ['pre-clear', 'Before clearing'],
    ['pre-linked-update', 'Before linked update'],
    ['pre-yank', 'Before yank'],
    ['pre-deprecate', 'Before deprecate'],
  ];

  it.each(CASES)('labels a %s snapshot as "%s"', async (trigger, label) => {
    await renderWithSnapshots([snapshotFixture(trigger)]);
    expect(screen.getByText(label)).toBeInTheDocument();
  });

  it('renders every trigger at once without an unlabelled chip', async () => {
    await renderWithSnapshots(
      CASES.map(([trigger], i) => snapshotFixture(trigger, { id: `snap-${i}`, note: `note ${i}` })),
    );
    for (const [, label] of CASES) {
      expect(screen.getByText(label)).toBeInTheDocument();
    }
    expect(screen.queryByText('undefined')).not.toBeInTheDocument();
  });

  it('tells the user that a workspace import auto-captures a restore point', async () => {
    await renderWithSnapshots([]);
    // The create-branch import warning promises this; the History panel has
    // to actually say the same thing.
    expect(screen.getByText(/workspace import/)).toBeInTheDocument();
  });
});

describe('SnapshotsTimeline download', () => {
  it('downloads a snapshot as its captured workspace, named by when it was taken', async () => {
    const save = vi.spyOn(download, 'downloadTextFile').mockReturnValue(true);
    await renderWithSnapshots([]);
    // Built once the workspace has loaded, so the snapshot holds a real document.
    const snapshot = snapshotFixture('manual');
    act(() => {
      useWorkspaceStore.setState({
        local: {
          ...useWorkspaceStore.getState().local!,
          snapshots: { entries: [snapshot], maxBytes: 5_000_000 },
        },
      });
    });
    await userEvent.click(
      screen.getByRole('button', { name: /^Download snapshot from .* as JSON$/ }),
    );
    const [name, contents, type] = save.mock.calls[0];
    expect(name).toBe('apicircle-snapshot-2026-01-01T00-00-00-000Z.json');
    expect(snapshot.workspaceSyncedSnapshot).not.toBeNull();
    expect(JSON.parse(contents)).toEqual(snapshot.workspaceSyncedSnapshot);
    expect(type).toBe('application/json');
  });
});
