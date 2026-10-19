import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi, type Mock } from 'vitest';
import type { LinkedUpdatePreview } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { UpdatePreviewModal } from './UpdatePreviewModal';
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

// Behavior: Apply is enabled by default even when the preview has
// `both-changed` rows. Rows where both source AND local override moved
// default to "keep mine" so the upgrade button doesn't gate on the user
// clicking through every conflict. The user can still flip individual
// rows to "Accept source" before applying.

const T0 = '2026-04-27T00:00:00.000Z';

function seedActivePreview(linkedWorkspaceId: string, preview: LinkedUpdatePreview): void {
  const synced = useWorkspaceStore.getState().synced!;
  useWorkspaceStore.setState({
    synced: {
      ...synced,
      linkedWorkspaces: {
        ...synced.linkedWorkspaces,
        [linkedWorkspaceId]: {
          id: linkedWorkspaceId,
          kind: 'private',
          name: 'Acme',
          sourceWorkspaceId: 'src-ws-acme',
          source: {
            provider: 'github',
            repoFullName: 'acme/tools',
            branch: 'main',
            sessionMode: 'workspace',
          },
          scope: ['collections', 'environments'],
          pinnedVersion: '1.0.0',
          updatePolicy: 'manual',
          linkedAt: T0,
          requiredSecretKeyIds: [],
        },
      },
    },
    activeLinkedUpdate: { linkedWorkspaceId, preview },
  });
}

describe('UpdatePreviewModal — Apply enable defaults', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it('Apply is enabled by default even when the preview contains both-changed rows', async () => {
    const preview: LinkedUpdatePreview = {
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      entries: [
        {
          bucket: 'request',
          key: 'r1',
          label: 'Get user',
          status: 'both-changed',
          base: null,
          target: null,
          override: null,
        },
      ],
      summary: {
        unchanged: 0,
        'source-only': 0,
        'local-only': 0,
        'both-changed': 1,
        'new-in-source': 0,
        'removed-in-source': 0,
      },
    };
    act(() => seedActivePreview('lw-1', preview));
    render(<UpdatePreviewModal />);
    // Apply is enabled because the both-changed row defaults to "Keep mine".
    const applyBtn = await screen.findByRole('button', { name: 'Apply update' });
    expect(applyBtn).toBeEnabled();
    // The "Keep mine" option is pre-selected on the conflict row.
    const keepMine = screen.getByRole('button', { name: 'Keep mine' });
    expect(keepMine).toHaveAttribute('aria-pressed', 'true');
    const acceptSource = screen.getByRole('button', { name: 'Accept source' });
    expect(acceptSource).toHaveAttribute('aria-pressed', 'false');
  });

  it('user can flip a row to Accept source; the choice is remembered', async () => {
    const preview: LinkedUpdatePreview = {
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      entries: [
        {
          bucket: 'request',
          key: 'r1',
          label: 'Get user',
          status: 'both-changed',
          base: null,
          target: null,
          override: null,
        },
      ],
      summary: {
        unchanged: 0,
        'source-only': 0,
        'local-only': 0,
        'both-changed': 1,
        'new-in-source': 0,
        'removed-in-source': 0,
      },
    };
    act(() => seedActivePreview('lw-1', preview));
    render(<UpdatePreviewModal />);
    await userEvent.click(screen.getByRole('button', { name: 'Accept source' }));
    await waitFor(() =>
      expect(screen.getByRole('button', { name: 'Accept source' })).toHaveAttribute(
        'aria-pressed',
        'true',
      ),
    );
    expect(screen.getByRole('button', { name: 'Keep mine' })).toHaveAttribute(
      'aria-pressed',
      'false',
    );
    // Apply still enabled.
    expect(screen.getByRole('button', { name: 'Apply update' })).toBeEnabled();
  });

  it('zero entries + pin already at toVersion: Apply is disabled with the byte-equal message', async () => {
    const preview: LinkedUpdatePreview = {
      fromVersion: '1.0.0',
      toVersion: '1.0.0', // matches the seeded pin (1.0.0) → truly nothing to do
      entries: [],
      summary: {
        unchanged: 0,
        'source-only': 0,
        'local-only': 0,
        'both-changed': 0,
        'new-in-source': 0,
        'removed-in-source': 0,
      },
    };
    act(() => seedActivePreview('lw-1', preview));
    render(<UpdatePreviewModal />);
    expect(await screen.findByText(/Source is byte-equal/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Apply update' })).toBeDisabled();
  });

  it('zero entries but pin lags toVersion (post-refresh state): offers a one-click pin bump', async () => {
    // Common scenario: user clicked Refresh, snapshot updated to the new
    // version's bytes but pinnedVersion stayed put. previewLinkedUpdate
    // returns no entries (snapshot already matches target), but the user
    // shouldn't be stuck — let them advance the pin without a merge.
    const preview: LinkedUpdatePreview = {
      fromVersion: '1.0.0',
      toVersion: '2.0.0', // lags the seeded pin (1.0.0)
      entries: [],
      summary: {
        unchanged: 0,
        'source-only': 0,
        'local-only': 0,
        'both-changed': 0,
        'new-in-source': 0,
        'removed-in-source': 0,
      },
    };
    act(() => seedActivePreview('lw-1', preview));
    render(<UpdatePreviewModal />);
    expect(await screen.findByText(/No content changes between/)).toBeInTheDocument();
    const applyBtn = screen.getByRole('button', { name: /Update pin/ });
    expect(applyBtn).toBeEnabled();
    expect(applyBtn).toHaveTextContent(/Update pin to v2\.0\.0/);
  });
});

describe('UpdatePreviewModal — Apply shows the brand loader while busy', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  const NO_CHANGES: LinkedUpdatePreview['summary'] = {
    unchanged: 0,
    'source-only': 0,
    'local-only': 0,
    'both-changed': 0,
    'new-in-source': 0,
    'removed-in-source': 0,
  };

  /** Stubs the apply action with one whose promise the test settles. */
  function holdApply(): { apply: Mock<() => Promise<void>>; finish: () => void } {
    let finish: () => void = () => {};
    const apply = vi.fn(
      () =>
        new Promise<void>((resolve) => {
          finish = () => resolve();
        }),
    );
    useWorkspaceStore.setState({ applyLinkedUpdateForLink: apply });
    return { apply, finish: () => finish() };
  }

  it('a merge shows "Applying…" with the loader while the update applies, then returns to idle', async () => {
    const preview: LinkedUpdatePreview = {
      fromVersion: '1.0.0',
      toVersion: '2.0.0',
      entries: [
        {
          bucket: 'request',
          key: 'r1',
          label: 'Get user',
          status: 'both-changed',
          base: null,
          target: null,
          override: null,
        },
      ],
      summary: { ...NO_CHANGES, 'both-changed': 1 },
    };
    act(() => seedActivePreview('lw-1', preview));
    const { apply, finish } = holdApply();
    const user = userEvent.setup();
    render(<UpdatePreviewModal />);

    // The aria-label stays "Apply update" in both states; the visible text flips.
    const applyBtn = await screen.findByRole('button', { name: 'Apply update' });
    expect(applyBtn).toBeEnabled();
    expect(applyBtn).not.toHaveAttribute('aria-busy');
    expect(applyBtn).toHaveTextContent('Apply update');
    expect(applyBtn.querySelector('svg[data-brand-loader]')).toBeNull();
    expect(applyBtn.querySelector('svg')).not.toBeNull();

    await user.click(applyBtn);
    // The conflict row's default ("Keep mine") is what goes to the store.
    expect(apply).toHaveBeenCalledWith({ 'request:r1': 'mine' });
    expect(applyBtn).toBeDisabled();
    expect(applyBtn).toHaveAttribute('aria-busy', 'true');
    expect(applyBtn).toHaveTextContent('Applying…');
    expect(applyBtn.querySelector('svg[data-brand-loader]')).not.toBeNull();
    expect(applyBtn.querySelectorAll('svg')).toHaveLength(1);

    await act(async () => {
      finish();
    });

    expect(applyBtn).toBeEnabled();
    expect(applyBtn).not.toHaveAttribute('aria-busy');
    expect(applyBtn).toHaveTextContent('Apply update');
    expect(applyBtn.querySelector('svg[data-brand-loader]')).toBeNull();
  });

  it('a pin-only update shows "Updating pin…" with the loader while the pin moves, then returns to idle', async () => {
    const preview: LinkedUpdatePreview = {
      fromVersion: '1.0.0',
      toVersion: '2.0.0', // ahead of the seeded pin (1.0.0), no content changes
      entries: [],
      summary: NO_CHANGES,
    };
    act(() => seedActivePreview('lw-1', preview));
    const { apply, finish } = holdApply();
    const user = userEvent.setup();
    render(<UpdatePreviewModal />);

    const pinBtn = await screen.findByRole('button', { name: 'Update pin' });
    expect(pinBtn).toBeEnabled();
    expect(pinBtn).not.toHaveAttribute('aria-busy');
    expect(pinBtn).toHaveTextContent('Update pin to v2.0.0');
    expect(pinBtn.querySelector('svg[data-brand-loader]')).toBeNull();

    await user.click(pinBtn);
    expect(apply).toHaveBeenCalledWith({});
    expect(pinBtn).toBeDisabled();
    expect(pinBtn).toHaveAttribute('aria-busy', 'true');
    expect(pinBtn).toHaveTextContent('Updating pin…');
    expect(pinBtn.querySelector('svg[data-brand-loader]')).not.toBeNull();
    expect(pinBtn.querySelectorAll('svg')).toHaveLength(1);

    await act(async () => {
      finish();
    });

    expect(pinBtn).toBeEnabled();
    expect(pinBtn).not.toHaveAttribute('aria-busy');
    expect(pinBtn).toHaveTextContent('Update pin to v2.0.0');
    expect(pinBtn.querySelector('svg[data-brand-loader]')).toBeNull();
  });
});
