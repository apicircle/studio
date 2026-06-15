import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import type { LinkedUpdatePreview } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { UpdatePreviewModal } from './UpdatePreviewModal';

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
