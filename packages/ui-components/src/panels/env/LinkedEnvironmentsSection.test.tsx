import { act, fireEvent, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LinkedSnapshot, LinkedWorkspace } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { LinkedEnvironmentsSection } from './LinkedEnvironmentsSection';
import * as workspaceSharing from '../../layout/workspaceSharing';

// This suite covers the workspace-sharing cluster, which is switched OFF in
// shipped builds (`WORKSPACE_SHARING_ENABLED`). Forcing the accessor to `true`
// keeps that coverage alive — the code is still in the repo and still has to
// work the day the switch flips. The shipped, disabled path is covered by
// `layout/workspaceSharingOff.test.tsx`.
//
// A spy rather than `vi.mock`: `test/setup.ts` imports `workspaceStore`, so the
// store — and the accessor it imports — are already evaluated by the time a
// test file's module mocks register, and a `vi.mock` here would only rebind the
// test's own import. Re-applied per test because setup's `afterEach` calls
// `vi.restoreAllMocks()`, and declared first so it lands before any suite's own
// `beforeEach` reaches a gated action.
beforeEach(() => {
  vi.spyOn(workspaceSharing, 'isWorkspaceSharingEnabled').mockReturnValue(true);
});

const T0 = '2026-04-27T00:00:00.000Z';

function makeLink(): LinkedWorkspace {
  return {
    id: 'lw-1',
    kind: 'public',
    name: 'Payments',
    sourceWorkspaceId: 'src-ws-payments',
    source: {
      provider: 'github',
      repoFullName: 'org/payments',
      branch: 'main',
      sessionMode: 'workspace' as const,
    },
    scope: ['environments'],
    pinnedVersion: '1.0.0',
    updatePolicy: 'manual',
    linkedAt: T0,
    requiredSecretKeyIds: [],
  };
}

function makeSnapshotWithEnv(): LinkedSnapshot {
  return {
    pulledAt: T0,
    ref: 'v1.0.0',
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: {
      items: {
        dev: {
          name: 'dev',
          variables: [
            { key: 'BASE_URL', value: 'https://api.example.test', encrypted: false },
            { key: 'API_KEY', value: '', encrypted: true, secretKeyId: 'sec-abc' },
          ],
        },
      },
      activeName: 'dev',
      priorityOrder: [{ kind: 'local', name: 'dev' }],
    },
  };
}

async function setup(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  const synced = useWorkspaceStore.getState().synced!;
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    synced: { ...synced, linkedWorkspaces: { 'lw-1': makeLink() } },
    local: { ...local, linkedCollections: { 'lw-1': makeSnapshotWithEnv() } },
  });
}

describe('LinkedEnvironmentsSection', () => {
  beforeEach(setup);

  it('renders a row per source variable when expanded', async () => {
    render(<LinkedEnvironmentsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Expand linked environments for Payments/ }),
    );
    expect(screen.getByText('BASE_URL')).toBeInTheDocument();
    expect(screen.getByText('API_KEY')).toBeInTheDocument();
    // The encrypted row shows the source secret-key fingerprint instead of an editable value.
    expect(screen.getByText(/source: sec-ab/)).toBeInTheDocument();
  });

  it('editing a source value writes a per-variable override', async () => {
    render(<LinkedEnvironmentsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Expand linked environments for Payments/ }),
    );
    const input = screen.getByLabelText('Override value for BASE_URL');
    // fireEvent.change sets the value in one shot, avoiding the
    // per-keystroke cost of userEvent.type — keeps the test inside the
    // default 5s timeout under parallel-suite contention.
    fireEvent.change(input, { target: { value: 'https://my-fork.example.test' } });
    const stored =
      useWorkspaceStore.getState().synced!.linkedOverrides.environmentVars['lw-1:dev:BASE_URL'];
    expect(stored.value).toBe('https://my-fork.example.test');
  });

  it('Reset returns the row to source content', async () => {
    useWorkspaceStore
      .getState()
      .setLinkedEnvVarOverride('lw-1', 'dev', 'BASE_URL', { value: 'https://x' });
    render(<LinkedEnvironmentsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Expand linked environments for Payments/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Reset BASE_URL to source/ }));
    expect(
      useWorkspaceStore.getState().synced!.linkedOverrides.environmentVars['lw-1:dev:BASE_URL'],
    ).toBeUndefined();
  });

  it('Hide soft-deletes a source variable; Restore brings it back', async () => {
    render(<LinkedEnvironmentsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Expand linked environments for Payments/ }),
    );
    await userEvent.click(
      screen.getByRole('button', { name: /Hide BASE_URL from this workspace/ }),
    );
    expect(screen.getByText('hidden by you')).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: /Restore BASE_URL from source/ }));
    // Restored row goes back to the editable state
    expect(screen.getByLabelText('Override value for BASE_URL')).toBeInTheDocument();
  });

  it('Add row injects a consumer-only variable that is not in source', async () => {
    render(<LinkedEnvironmentsSection />);
    await userEvent.click(
      screen.getByRole('button', { name: /Expand linked environments for Payments/ }),
    );
    await userEvent.click(screen.getByRole('button', { name: /Add variable for this workspace/ }));
    await userEvent.type(screen.getByLabelText('New consumer-only variable name'), 'LOCAL_FLAG');
    await userEvent.click(screen.getByRole('button', { name: 'Add' }));
    expect(screen.getByText('LOCAL_FLAG')).toBeInTheDocument();
    expect(screen.getByText('added')).toBeInTheDocument();
  });
});
