import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { WorkspacePanel } from './WorkspacePanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

interface ResponseSpec {
  body: unknown;
  status?: number;
  headers?: Record<string, string>;
}

function fakeResponse(spec: ResponseSpec): Response {
  return new Response(JSON.stringify(spec.body), {
    status: spec.status ?? 200,
    statusText: 'OK',
    headers: { 'content-type': 'application/json', ...(spec.headers ?? {}) },
  });
}

function queuedFetch(queue: ResponseSpec[]): ReturnType<typeof vi.fn> {
  let i = 0;
  return vi.fn(async () => {
    if (i >= queue.length) throw new Error(`unexpected fetch call #${i + 1}`);
    return fakeResponse(queue[i++]);
  });
}

describe('WorkspacePanel', () => {
  it('shows "Local Workspace" badge and connection prompt when no GitHub session', async () => {
    await renderWithStore(<WorkspacePanel />);
    expect(screen.getByText('Local Workspace')).toBeInTheDocument();
    expect(screen.getByText(/No GitHub connection/)).toBeInTheDocument();
    // The scope guidance lists `repo` and `pull_request` as required.
    const codeMatches = screen.getAllByText(/^repo$/);
    expect(codeMatches.length).toBeGreaterThan(0);
    expect(screen.getByText('pull_request')).toBeInTheDocument();
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

  describe('Repo + working branch (P4.2)', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('connecting a repo writes connectedRepo and reveals the create-branch form', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
          {
            body: {
              full_name: 'me/payments',
              name: 'payments',
              owner: { login: 'me' },
              default_branch: 'main',
              visibility: 'public',
              permissions: { push: true, admin: false },
            },
          },
        ]),
      );
      await renderWithStore(<WorkspacePanel />);
      // First connect a session via the store directly (UI for that lives in
      // SecretVaultModal; this panel test focuses on the repo flow).
      await act(async () => {
        await useWorkspaceStore.getState().connectGitHubSession('tok');
      });

      await userEvent.type(screen.getByLabelText('Repo full name'), 'me/payments');
      await userEvent.click(screen.getByRole('button', { name: /Connect repo/ }));

      await waitFor(() => {
        expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe('me/payments');
      });
      // Create-branch form is now visible.
      expect(screen.getByLabelText('Branch name')).toBeInTheDocument();
    });

    it('owner/name format is enforced before any fetch', async () => {
      const fetchMock = vi.fn();
      vi.stubGlobal('fetch', fetchMock);
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        useWorkspaceStore.setState({
          local: {
            ...useWorkspaceStore.getState().local!,
            sessions: {
              github: {
                accountLogin: 'me',
                tokenSecretId: 'sec',
                grantedScopes: ['repo'],
                addedAt: '2026-04-27T00:00:00.000Z',
                lastVerifiedAt: null,
              },
            },
          },
        });
      });
      await userEvent.type(screen.getByLabelText('Repo full name'), 'just-a-name');
      await userEvent.click(screen.getByRole('button', { name: /Connect repo/ }));
      expect(screen.getByText(/owner\/name/)).toBeInTheDocument();
      expect(fetchMock).not.toHaveBeenCalled();
    });

    it('Create working branch writes a real branch via GitHub then renders the branch card', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, pull_request' } },
          {
            body: {
              full_name: 'me/api',
              name: 'api',
              owner: { login: 'me' },
              default_branch: 'main',
              visibility: 'public',
              permissions: { push: true, admin: false },
            },
          },
          { body: { name: 'main', commit: { sha: 'abc123' } } },
          { body: { ref: 'refs/heads/apicircle/test-zz1199', object: { sha: 'abc123' } } },
        ]),
      );
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        await useWorkspaceStore.getState().connectGitHubSession('tok');
        await useWorkspaceStore.getState().connectRepo('me', 'api');
      });
      // Override the auto-generated name with a deterministic one.
      const input = screen.getByLabelText('Branch name');
      await userEvent.clear(input);
      await userEvent.type(input, 'apicircle/test-zz1199');
      await userEvent.click(screen.getByRole('button', { name: /Create working branch/ }));

      await waitFor(() => {
        expect(useWorkspaceStore.getState().local!.workingBranch?.name).toBe(
          'apicircle/test-zz1199',
        );
      });
      // Branch card is now visible with truncated SHA.
      expect(screen.getByText(/abc123/)).toBeInTheDocument();
      expect(screen.getByText('Branch ready')).toBeInTheDocument();
    });

    it('GitHub 422 (branch already exists) renders an inline error', async () => {
      vi.stubGlobal(
        'fetch',
        queuedFetch([
          { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo' } },
          {
            body: {
              full_name: 'me/api',
              name: 'api',
              owner: { login: 'me' },
              default_branch: 'main',
              permissions: { push: true, admin: false },
            },
          },
          { body: { name: 'main', commit: { sha: 'abc' } } },
          { body: { message: 'Reference already exists' }, status: 422 },
        ]),
      );
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        await useWorkspaceStore.getState().connectGitHubSession('tok');
        await useWorkspaceStore.getState().connectRepo('me', 'api');
      });
      await userEvent.click(screen.getByRole('button', { name: /Create working branch/ }));
      expect(await screen.findByText(/already exists on GitHub/i)).toBeInTheDocument();
    });
  });
});
