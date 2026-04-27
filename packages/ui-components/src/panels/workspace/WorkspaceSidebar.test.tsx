import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { WorkspaceSidebar } from './WorkspaceSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

describe('WorkspaceSidebar', () => {
  it('shows the local-only message when no GitHub session exists', async () => {
    await renderWithStore(<WorkspaceSidebar />);
    expect(screen.getByText(/Local Workspace — no GitHub connection/)).toBeInTheDocument();
  });

  it('renders account + working-branch summary when a session is present', async () => {
    await renderWithStore(<WorkspaceSidebar />);
    act(() => {
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local,
          sessions: {
            github: {
              accountLogin: 'devaprakash',
              tokenSecretId: 'sec_1',
              grantedScopes: ['repo'],
              addedAt: new Date().toISOString(),
              lastVerifiedAt: null,
            },
          },
          workingBranch: {
            name: 'apicircle/payments-api-a3f9c2',
            baseBranch: 'main',
            repoFullName: 'me/payments-api',
            repoOwner: 'me',
            repoName: 'payments-api',
            headSha: 'abc123',
            createdAt: new Date().toISOString(),
            lastPushedSha: null,
            diffSummary: null,
            openPrUrl: null,
          },
        },
      });
    });
    expect(screen.getByText('devaprakash')).toBeInTheDocument();
    expect(screen.getByText('apicircle/payments-api-a3f9c2')).toBeInTheDocument();
  });
});
