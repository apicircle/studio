import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { renderWithStore } from '../../../test/renderWithStore';
import { WorkspacePanel } from './WorkspacePanel';

// The Workspace panel in the SHIPPED configuration. `WorkspacePanel.test.tsx`
// spies workspace sharing to `true` for the whole file so the Releases card and
// the Tag/Topics controls stay covered; this file is the counterpart that runs
// with the real (off) accessor.
//
// Worth stating why the Releases assertion matters most: that section sits
// OUTSIDE the `!isLocalOnly` guard in `WorkspacePanel`, so it renders even for a
// workspace with no Git session at all. The flag is the only thing hiding it.

const githubSession = {
  github: {
    workspace: {
      accountLogin: 'me',
      tokenSecretId: 's',
      grantedScopes: ['repo'],
      addedAt: 't',
      lastVerifiedAt: 't',
      canCreatePullRequests: true,
    },
    links: {},
  },
};

async function connectPublicRepo(): Promise<void> {
  await act(async () => {
    useWorkspaceStore.setState({
      local: {
        ...useWorkspaceStore.getState().local!,
        sessions: githubSession,
        connectedRepo: {
          fullName: 'me/api',
          owner: 'me',
          name: 'api',
          defaultBranch: 'main',
          visibility: 'public',
          isPrivate: false,
          pushable: true,
          connectedAt: 't',
        },
      },
    });
  });
}

describe('WorkspacePanel — workspace sharing off', () => {
  it('hides the Releases section even with no Git session (it sits outside the session guard)', async () => {
    await renderWithStore(<WorkspacePanel />);
    expect(useWorkspaceStore.getState().local!.connectedRepo).toBeNull();
    expect(screen.queryByRole('heading', { name: 'Releases' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Publish release/ })).not.toBeInTheDocument();
  });

  it('hides the Releases section for a connected repo too', async () => {
    await renderWithStore(<WorkspacePanel />);
    await connectPublicRepo();
    expect(screen.queryByRole('heading', { name: 'Releases' })).not.toBeInTheDocument();
  });

  it('hides Tag release and the topics editor, leaving Disconnect repo in the row', async () => {
    await renderWithStore(<WorkspacePanel />);
    await connectPublicRepo();
    expect(screen.queryByRole('button', { name: /Tag release/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Edit topics/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /View topics/ })).not.toBeInTheDocument();
    // The remaining button in that row still renders — the gate removes two
    // controls, it doesn't blank the group.
    expect(screen.getByRole('button', { name: /Disconnect repo/ })).toBeInTheDocument();
  });

  it('hides the marketplace-topics banner on a PUBLIC repo — the branch that would otherwise show it', async () => {
    await renderWithStore(<WorkspacePanel />);
    await connectPublicRepo();
    expect(screen.queryByText(/listed in the API Circle marketplace/)).not.toBeInTheDocument();
  });
});
