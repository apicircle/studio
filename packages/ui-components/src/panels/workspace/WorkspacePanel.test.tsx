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

  it('clicking the connect CTA opens the Vault dock pre-selected on the Sessions sub-tab', async () => {
    await renderWithStore(<WorkspacePanel />);
    await userEvent.click(screen.getByRole('button', { name: /Connect via Secret Vault/ }));
    // Regression: the button label promises "→ Sessions" — it has to
    // actually deliver. Pre-fix the dock opened on the default 'vault'
    // sub-tab and the user had to manually click "Sessions".
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('vault');
    expect(useWorkspaceStore.getState().rightDock.vaultSubtab).toBe('sessions');
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
              workspace: {
                accountLogin: 'devaprakash',
                tokenSecretId: 'sec_123',
                grantedScopes: ['repo', 'pull_request'],
                addedAt: new Date().toISOString(),
                lastVerifiedAt: '2026-04-27T09:00:00.000Z',
                canCreatePullRequests: true,
              },
              links: {},
            },
          },
        },
      });
    });
    expect(screen.getByText('GitHub Connected')).toBeInTheDocument();
    expect(screen.getByText('devaprakash')).toBeInTheDocument();
    expect(screen.getByText(/repo, pull_request/)).toBeInTheDocument();
    // The "Manage session" CTA on the session card also lands the user
    // on the Sessions sub-tab, not the Vault default.
    await userEvent.click(screen.getByRole('button', { name: /Manage session/ }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('vault');
    expect(useWorkspaceStore.getState().rightDock.vaultSubtab).toBe('sessions');
  });

  it('editing the workspace name persists', async () => {
    await renderWithStore(<WorkspacePanel />);
    const input = screen.getByLabelText(/Workspace name/);
    await userEvent.clear(input);
    await userEvent.type(input, 'Payments API');
    // The name lives in the local registry, not in the git-synced doc.
    const reg = useWorkspaceStore.getState().workspaceRegistry!;
    const active = reg.workspaces.find((w) => w.id === reg.activeWorkspaceId)!;
    expect(active.name).toBe('Payments API');
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
          // ConnectRepoForm mounts in browser mode and lists accessible repos.
          // An empty list is fine — the test flips to manual entry below.
          { body: [] },
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

      // Repo browser is the default — flip into manual mode for the form input.
      await userEvent.click(screen.getByRole('button', { name: /Switch to manual entry/ }));
      await userEvent.type(screen.getByLabelText('Repo full name'), 'me/payments');
      await userEvent.click(screen.getByRole('button', { name: /Connect repo/ }));

      await waitFor(() => {
        expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe('me/payments');
      });
      // Create-branch form is now visible.
      expect(screen.getByLabelText('Branch name')).toBeInTheDocument();
    });

    it('owner/name format is enforced before any fetch', async () => {
      // Repo browser mounts and asks GitHub for /user/repos — return empty.
      // After we flip into manual mode and clear the mock, the format check
      // must reject `just-a-name` without issuing any further fetch.
      const fetchMock = vi.fn(async () => fakeResponse({ body: [] }));
      vi.stubGlobal('fetch', fetchMock);
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        useWorkspaceStore.setState({
          local: {
            ...useWorkspaceStore.getState().local!,
            sessions: {
              github: {
                workspace: {
                  accountLogin: 'me',
                  tokenSecretId: 'sec',
                  grantedScopes: ['repo'],
                  addedAt: '2026-04-27T00:00:00.000Z',
                  lastVerifiedAt: null,
                  canCreatePullRequests: true,
                },
                links: {},
              },
            },
          },
        });
      });
      await userEvent.click(screen.getByRole('button', { name: /Switch to manual entry/ }));
      fetchMock.mockClear();
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
          // CreateBranchForm mounts after connectRepo and lists the repo's
          // existing branches to populate the base-branch dropdown.
          { body: [{ name: 'main', commit: { sha: 'abc123' } }] },
          { body: { name: 'main', commit: { sha: 'abc123' } } }, // getBranchHead
          { body: { ref: 'refs/heads/apicircle/test-zz1199', object: { sha: 'abc123' } } }, // createBranch
          // first-pull-prompt probe — empty branch
          { status: 404, body: { message: 'Not Found' } },
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

    it('disconnect repo clears connectedRepo + the working branch', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        useWorkspaceStore.setState({
          local: {
            ...useWorkspaceStore.getState().local!,
            sessions: {
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
            },
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
      // Click "Disconnect repo" — opens the ConfirmDialog (audit fix:
      // disconnect was previously unconfirmed). Click "Disconnect" inside
      // the dialog to actually clear the connection.
      await userEvent.click(screen.getByRole('button', { name: /Disconnect repo/ }));
      expect(useWorkspaceStore.getState().local!.connectedRepo).toBeTruthy();
      await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
      expect(useWorkspaceStore.getState().local!.connectedRepo).toBeNull();
    });

    it('discard branch clears the working branch slot', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        useWorkspaceStore.setState({
          local: {
            ...useWorkspaceStore.getState().local!,
            sessions: {
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
            },
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
            workingBranch: {
              name: 'apicircle/wb',
              baseBranch: 'main',
              repoFullName: 'me/api',
              repoOwner: 'me',
              repoName: 'api',
              headSha: 'abc',
              createdAt: 't',
              lastPushedSha: null,
              diffSummary: null,
              openPrUrl: null,
            },
          },
        });
      });
      // Click "Discard working branch" — opens the typed-confirm dialog
      // (audit fix: discard was previously unconfirmed). The user must
      // type DISCARD before the confirm button enables.
      await userEvent.click(screen.getByLabelText('Discard working branch'));
      expect(useWorkspaceStore.getState().local!.workingBranch).toBeTruthy();
      const typedInput = await screen.findByLabelText('Type to confirm');
      await userEvent.type(typedInput, 'DISCARD');
      await userEvent.click(screen.getByRole('button', { name: 'Discard branch' }));
      expect(useWorkspaceStore.getState().local!.workingBranch).toBeNull();
    });
  });

  describe('Releases card', () => {
    it('publishes a new version end-to-end through the modal + confirm dialog', async () => {
      await renderWithStore(<WorkspacePanel />);
      const user = userEvent.setup();
      // Open the publish modal.
      await user.click(screen.getByRole('button', { name: /Publish release/ }));
      // Validation: empty version input disables review.
      const versionInput = screen.getByLabelText('Release version');
      expect(screen.getByRole('button', { name: /Review .* publish/ })).toBeDisabled();
      // Invalid semver surfaces inline.
      await user.type(versionInput, 'not-semver');
      expect(screen.getByText(/valid semver/)).toBeInTheDocument();
      await user.tripleClick(versionInput);
      await user.keyboard('0.1.0');
      await user.type(screen.getByLabelText('Release notes'), 'first cut');
      await user.click(screen.getByRole('button', { name: /Review .* publish/ }));
      // Confirm dialog → Publish.
      await user.click(screen.getByRole('button', { name: 'Publish' }));
      const synced = useWorkspaceStore.getState().synced!;
      expect(synced.releases.self?.currentVersion).toBe('0.1.0');
    });

    it('rejects duplicate versions with an inline error', async () => {
      await renderWithStore(<WorkspacePanel />);
      // Pre-publish 0.1.0 via the store action.
      await act(async () => {
        await useWorkspaceStore.getState().publishRelease({ version: '0.1.0', notes: 'first' });
      });
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: /Publish release/ }));
      await user.type(screen.getByLabelText('Release version'), '0.1.0');
      // Validation message surfaces before review can fire.
      expect(screen.getByText(/already published/)).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Review .* publish/ })).toBeDisabled();
    });

    it('deprecate via per-row confirm flips the badge', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        await useWorkspaceStore.getState().publishRelease({ version: '0.1.0', notes: '' });
      });
      const user = userEvent.setup();
      await user.click(screen.getByRole('button', { name: 'Deprecate' }));
      // Confirm dialog has its own "Deprecate" button.
      const deprecateButtons = screen.getAllByRole('button', { name: 'Deprecate' });
      await user.click(deprecateButtons[deprecateButtons.length - 1]);
      expect(useWorkspaceStore.getState().synced!.releases.self!.versions[0].deprecated).toBe(true);
    });

    it('withdraw requires typed confirmation and flips the yanked flag', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        await useWorkspaceStore.getState().publishRelease({ version: '0.1.0', notes: '' });
      });
      const user = userEvent.setup();
      // The user-facing button reads "Withdraw" now. The store action /
      // data field stays `yankRelease` / `yanked` — that's the on-disk
      // shape and renaming it would force a migration with no benefit.
      await user.click(screen.getByRole('button', { name: /Withdraw/ }));
      const withdrawButtons = screen.getAllByRole('button', { name: 'Withdraw' });
      const modalWithdraw = withdrawButtons[withdrawButtons.length - 1];
      expect(modalWithdraw).toBeDisabled();
      await user.type(screen.getByLabelText('Type to confirm'), 'WITHDRAW v0.1.0');
      await user.click(modalWithdraw);
      expect(useWorkspaceStore.getState().synced!.releases.self!.versions[0].yanked).toBe(true);
    });
  });

  describe('PR-creation capability gating', () => {
    /**
     * Build the (session + connectedRepo + workingBranch + push state)
     * fixture the BranchCard needs to render its action row. `capability`
     * is the value of `session.canCreatePullRequests` — the field the test
     * is exercising.
     */
    function setupBranchCardState(opts: { capability: boolean | null }) {
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local,
          sessions: {
            github: {
              workspace: {
                accountLogin: 'me',
                tokenSecretId: 'sec',
                grantedScopes: ['repo'],
                addedAt: 't',
                lastVerifiedAt: 't',
                canCreatePullRequests: opts.capability,
              },
              links: {},
            },
          },
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
          workingBranch: {
            name: 'apicircle/test',
            baseBranch: 'main',
            repoFullName: 'me/api',
            repoOwner: 'me',
            repoName: 'api',
            // `lastPushedSha` non-null + `openPrUrl` null is the state where
            // Create PR would otherwise be enabled — so any disabling we see
            // is attributable to the capability flag, not push state.
            headSha: 'abc1234',
            createdAt: 't',
            lastPushedSha: 'abc1234',
            diffSummary: null,
            openPrUrl: null,
          },
        },
      });
    }

    it('hides the SessionCard PR-scope warning when capability=true (classic PAT with `repo`)', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupBranchCardState({ capability: true });
      });
      // The warning's distinctive text — absent under capability=true.
      expect(screen.queryByText(/can't create pull requests/i)).not.toBeInTheDocument();
    });

    it('shows the SessionCard PR-scope warning when capability=false (probe disproved)', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupBranchCardState({ capability: false });
      });
      expect(screen.getByText(/can't create pull requests/i)).toBeInTheDocument();
    });

    it('hides the SessionCard PR-scope warning when capability=null (not yet probed)', async () => {
      // `null` means the probe hasn't run / was inconclusive. We don't
      // alarm the user pre-emptively — only after a definitive 403 do we
      // surface the warning.
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupBranchCardState({ capability: null });
      });
      expect(screen.queryByText(/can't create pull requests/i)).not.toBeInTheDocument();
    });

    it('Create PR button is enabled when capability=true and a push has landed', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupBranchCardState({ capability: true });
      });
      const button = screen.getByRole('button', { name: /Create PR/ });
      expect(button).not.toBeDisabled();
    });

    it('Create PR button is disabled when capability=false', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupBranchCardState({ capability: false });
      });
      const button = screen.getByRole('button', { name: /Create PR/ });
      expect(button).toBeDisabled();
    });

    it('Create PR button is enabled when capability=null (lets API call surface MissingScopeError if it actually fails)', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupBranchCardState({ capability: null });
      });
      const button = screen.getByRole('button', { name: /Create PR/ });
      expect(button).not.toBeDisabled();
    });
  });

  // The retirement banner appears above CreateBranchForm when refreshWorkspace
  // discovers the working branch is over (PR merged or branch deleted).
  // workingBranch is null in this state, so BranchSection renders the form
  // path with the banner stacked above.
  describe('retired branch banner', () => {
    /**
     * Stage the post-retirement state: session + repo connected, no working
     * branch, retiredBranch populated as if refreshWorkspace had just
     * discovered the merge.
     */
    function setupRetiredState(opts: {
      reason: 'pr-merged' | 'branch-deleted';
      prNumber?: number | null;
      prUrl?: string | null;
      branchName?: string;
    }) {
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local,
          sessions: {
            github: {
              workspace: {
                accountLogin: 'me',
                tokenSecretId: 'sec',
                grantedScopes: ['repo'],
                addedAt: 't',
                lastVerifiedAt: 't',
                canCreatePullRequests: true,
              },
              links: {},
            },
          },
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
          workingBranch: null,
          retiredBranch: {
            branchName: opts.branchName ?? 'apicircle/feat-auth',
            reason: opts.reason,
            retiredAt: '2026-05-09T12:00:00.000Z',
            prUrl: opts.prUrl ?? null,
            prNumber: opts.prNumber ?? null,
          },
        },
      });
    }

    it('renders the merged-PR headline when reason=pr-merged', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupRetiredState({
          reason: 'pr-merged',
          prNumber: 42,
          prUrl: 'https://github.com/me/api/pull/42',
        });
      });
      expect(screen.getByText(/PR #42 was merged/)).toBeInTheDocument();
      // The banner explicitly names the retired branch so the disappearance
      // doesn't feel like the app lost their work.
      expect(screen.getByText(/apicircle\/feat-auth/)).toBeInTheDocument();
    });

    it('links to the PR when a PR URL is recorded', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupRetiredState({
          reason: 'pr-merged',
          prNumber: 42,
          prUrl: 'https://github.com/me/api/pull/42',
        });
      });
      const link = screen.getByRole('link', { name: /View PR/ });
      expect(link).toHaveAttribute('href', 'https://github.com/me/api/pull/42');
      expect(link).toHaveAttribute('target', '_blank');
    });

    it('renders the branch-deleted headline when reason=branch-deleted', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupRetiredState({ reason: 'branch-deleted', branchName: 'apicircle/abandoned' });
      });
      expect(
        screen.getByText(/Branch apicircle\/abandoned was deleted on GitHub/),
      ).toBeInTheDocument();
    });

    it('renders CreateBranchForm below the banner so the user can immediately start a new branch', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupRetiredState({ reason: 'pr-merged', prNumber: 1 });
      });
      // CreateBranchForm exposes the branch-name input.
      expect(screen.getByLabelText('Branch name')).toBeInTheDocument();
    });

    it('dismiss button clears local.retiredBranch and removes the banner', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupRetiredState({ reason: 'pr-merged', prNumber: 1 });
      });
      expect(screen.getByText(/PR #1 was merged/)).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: /Dismiss retired branch notice/ }));
      expect(useWorkspaceStore.getState().local!.retiredBranch).toBeNull();
      expect(screen.queryByText(/PR #1 was merged/)).not.toBeInTheDocument();
      // The CreateBranchForm stays — the user is still in the create flow.
      expect(screen.getByLabelText('Branch name')).toBeInTheDocument();
    });

    it('hides the banner once the user creates a new working branch', async () => {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupRetiredState({ reason: 'pr-merged', prNumber: 1 });
      });
      // Auto-clear path: the store wipes retiredBranch when createWorkingBranch
      // succeeds. We exercise it via direct setState (the e2e wiring of the
      // mutation is covered in refreshWorkspace.test.ts).
      await act(async () => {
        const local = useWorkspaceStore.getState().local!;
        useWorkspaceStore.setState({
          local: {
            ...local,
            workingBranch: {
              name: 'apicircle/fresh',
              baseBranch: 'main',
              repoFullName: 'me/api',
              repoOwner: 'me',
              repoName: 'api',
              headSha: 'sha-1',
              createdAt: 't',
              lastPushedSha: null,
              diffSummary: null,
              openPrUrl: null,
            },
            retiredBranch: null,
          },
        });
      });
      expect(screen.queryByText(/PR #1 was merged/)).not.toBeInTheDocument();
      // BranchCard's "Created from" line is now visible instead.
      expect(screen.getByText(/Created from/)).toBeInTheDocument();
    });
  });
});
