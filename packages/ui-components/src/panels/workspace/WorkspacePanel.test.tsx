import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { WorkspacePanel } from './WorkspacePanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

describe('WorkspacePanel', () => {
  it('shows "Local Workspace" badge and connection prompt when no GitHub session', async () => {
    await renderWithStore(<WorkspacePanel />);
    expect(screen.getByText('Local Workspace')).toBeInTheDocument();
    expect(screen.getByText(/No GitHub connection/)).toBeInTheDocument();
    expect(screen.getByText(/repo/)).toBeInTheDocument();
    expect(screen.getByText(/pull_request/)).toBeInTheDocument();
  });

  it('clicking the connect CTA opens the Secret Vault', async () => {
    await renderWithStore(<WorkspacePanel />);
    await userEvent.click(screen.getByRole('button', { name: /Connect via Secret Vault/ }));
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(true);
  });

  it('shows "GitHub Connected" and account details when a session is present', async () => {
    await renderWithStore(<WorkspacePanel />);
    act(() => {
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local,
          sessions: {
            github: {
              accountLogin: 'devaprakash',
              tokenSecretId: 'sec_123',
              grantedScopes: ['repo', 'pull_request'],
              addedAt: new Date().toISOString(),
              lastVerifiedAt: '2026-04-27T09:00:00.000Z',
            },
          },
        },
      });
    });
    expect(screen.getByText('GitHub Connected')).toBeInTheDocument();
    expect(screen.getByText('devaprakash')).toBeInTheDocument();
    expect(screen.getByText(/repo, pull_request/)).toBeInTheDocument();
  });

  it('editing the workspace name persists', async () => {
    await renderWithStore(<WorkspacePanel />);
    const input = screen.getByLabelText(/Workspace name/);
    await userEvent.clear(input);
    await userEvent.type(input, 'Payments API');
    expect(useWorkspaceStore.getState().synced!.workspaceName).toBe('Payments API');
  });
});
