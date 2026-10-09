import { act, fireEvent, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHostKind, GitHubRepo, GitProvider } from '@apicircle/git';
import {
  GIT_HOST_LABELS,
  GitHubError,
  UnauthorizedError,
  registerGitProvider,
  resetGitProviderRegistry,
} from '@apicircle/git';
import { SecretsInPushError, type SecretFinding } from '@apicircle/core';
import { NothingWrittenError } from '../../store/nothingWritten';
import type { GitHostSession, WorkspaceLocal } from '@apicircle/shared';
import { WorkspacePanel } from './WorkspacePanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import * as workspaceSharing from '../../layout/workspaceSharing';
import { GitHostAccessProvider, type GitHostAccess } from '../../layout/gitHostAccess';

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
  it('shows "Local Workspace" badge and connection prompt when no session exists', async () => {
    await renderWithStore(<WorkspacePanel />);
    expect(screen.getByText('Local Workspace')).toBeInTheDocument();
    // Host-neutral: the session can belong to any registered host, so the empty
    // state must not claim the one it is missing is GitHub's.
    expect(screen.getByText(/No Git source connected/)).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Git source' })).toBeInTheDocument();
    expect(screen.queryByText(/GitHub Connection/)).not.toBeInTheDocument();
    // Open-core Studio registers GitHub alone, so the guidance still lists
    // GitHub's `repo` and `pull_request` scopes.
    const codeMatches = screen.getAllByText(/^repo$/);
    expect(codeMatches.length).toBeGreaterThan(0);
    expect(screen.getByText('pull_request')).toBeInTheDocument();
    expect(screen.queryByText('Supported hosts:')).not.toBeInTheDocument();
  });

  it('says the workspace name is shared in the repo when you push', async () => {
    await renderWithStore(<WorkspacePanel />);
    expect(
      screen.getByText(/shared in the repo's workspace list when you push/),
    ).toBeInTheDocument();
    // The shipped copy promised the opposite; pushes now write the name.
    expect(screen.queryByText(/Never pushed to Git/)).not.toBeInTheDocument();
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

  describe('Git source on a multi-host build', () => {
    // The Lens shell registers GitLab / Bitbucket Cloud / Azure DevOps behind the
    // provider seam. Everything below is what THAT build shows; open-core Studio
    // registers GitHub alone and keeps the GitHub-only rendering asserted above.
    const SESSION: GitHostSession = {
      accountLogin: 'bb-user',
      tokenSecretId: 'sec_bb',
      grantedScopes: [],
      addedAt: '2026-09-01T00:00:00.000Z',
      lastVerifiedAt: null,
      canCreatePullRequests: null,
    };

    function repo(fullName: string): GitHubRepo {
      const [owner, name] = fullName.split('/');
      return {
        fullName,
        owner,
        name,
        defaultBranch: 'main',
        visibility: 'private',
        isPrivate: true,
        pushable: true,
      };
    }

    function registerAllHosts(): void {
      registerGitProvider('gitlab', () => ({}) as never);
      registerGitProvider('bitbucket', () => ({}) as never);
      registerGitProvider('azure-devops', () => ({}) as never);
    }

    function seedSessions(hosts: Array<'github' | 'gitlab' | 'bitbucket' | 'azure-devops'>): void {
      act(() => {
        const local = useWorkspaceStore.getState().local!;
        const others = Object.fromEntries(
          hosts
            .filter((h) => h !== 'github')
            .map((h) => [h, { workspace: { ...SESSION, accountLogin: `${h}-user` }, links: {} }]),
        );
        useWorkspaceStore.setState({
          local: {
            ...local,
            sessions: {
              github: hosts.includes('github')
                ? { workspace: { ...SESSION, accountLogin: 'gh-user' }, links: {} }
                : { workspace: null, links: {} },
              hosts: others,
            },
          },
        });
      });
    }

    afterEach(() => {
      resetGitProviderRegistry();
    });

    it('names the hosts it can connect instead of reciting GitHub scopes', async () => {
      registerAllHosts();
      await renderWithStore(<WorkspacePanel />);
      expect(screen.getByText(/No Git source connected/)).toBeInTheDocument();
      const hosts = screen.getByRole('list', { name: 'Supported Git hosts' });
      expect(hosts.textContent).toBe('GitHubGitLabBitbucketAzure DevOps');
      // GitHub's scope list is wrong advice for three of the four hosts, so the
      // card points at the per-host guidance in the vault instead.
      expect(screen.queryByText(/^repo$/)).not.toBeInTheDocument();
      expect(screen.getByText(/Each host lists the token scopes it needs/)).toBeInTheDocument();
      // The one route out is unchanged.
      expect(screen.getByRole('button', { name: /Connect via Secret Vault/ })).toBeInTheDocument();
    });

    it('a Bitbucket-only session is reported as Bitbucket, and the repo form lists through it', async () => {
      registerAllHosts();
      const listAccessibleRepos = vi.fn(async () => [repo('acme/api')]);
      await renderWithStore(<WorkspacePanel />);
      useWorkspaceStore.setState({ listAccessibleRepos });
      seedSessions(['bitbucket']);

      expect(screen.getByText('Bitbucket Connected')).toBeInTheDocument();
      expect(screen.queryByText('GitHub Connected')).not.toBeInTheDocument();
      expect(screen.getByText('bitbucket-user')).toBeInTheDocument();
      expect(screen.getByText('Connect a repo on Bitbucket')).toBeInTheDocument();
      // One session ⇒ no host picker: the other three hosts could only fail at
      // the token step, and offering them read as "choose any of four".
      expect(screen.queryByRole('combobox', { name: 'Git host' })).not.toBeInTheDocument();
      expect(
        screen.getByText(/Repos are listed through your Bitbucket session/),
      ).toBeInTheDocument();
      // A multi-host build still offers the self-managed base URL.
      expect(screen.getByLabelText('API base URL')).toBeInTheDocument();
      await waitFor(() =>
        expect(listAccessibleRepos).toHaveBeenCalledWith({ host: 'bitbucket', baseUrl: undefined }),
      );
    });

    it('offers only the hosts holding a session when more than one does', async () => {
      registerAllHosts();
      const listAccessibleRepos = vi.fn(async (opts?: { host?: string }) =>
        opts?.host === 'bitbucket' ? [repo('acme/bb-api')] : [repo('me/gh-api')],
      );
      await renderWithStore(<WorkspacePanel />);
      useWorkspaceStore.setState({ listAccessibleRepos });
      seedSessions(['github', 'bitbucket']);

      const picker = screen.getByRole('combobox', { name: 'Git host' });
      expect(
        within(picker)
          .getAllByRole('option')
          .map((o) => o.textContent),
      ).toEqual(['GitHub', 'Bitbucket']);
      expect(screen.getByText('Connect a repo on GitHub')).toBeInTheDocument();

      await userEvent.selectOptions(picker, 'bitbucket');
      expect(screen.getByText('Connect a repo on Bitbucket')).toBeInTheDocument();
      await waitFor(() =>
        expect(listAccessibleRepos).toHaveBeenLastCalledWith({
          host: 'bitbucket',
          baseUrl: undefined,
        }),
      );
      await userEvent.click(screen.getByRole('combobox', { name: 'Filter accessible repos' }));
      expect(
        await screen.findByRole('option', { name: 'Connect acme/bb-api' }),
      ).toBeInTheDocument();
    });

    it('pages the repo list on scroll instead of stopping at fifty', async () => {
      const repos = Array.from({ length: 120 }, (_, i) => repo(`me/repo-${i}`));
      await renderWithStore(<WorkspacePanel />);
      useWorkspaceStore.setState({ listAccessibleRepos: vi.fn(async () => repos) });
      seedSessions(['github']);

      const filter = screen.getByRole('combobox', { name: 'Filter accessible repos' });
      await waitFor(() => expect(filter).toBeEnabled());
      await userEvent.click(filter);
      const listbox = await screen.findByRole('listbox');
      // Fifty repos plus the "more" row, which says how much is left.
      expect(within(listbox).getAllByRole('option')).toHaveLength(51);
      const more = within(listbox).getByRole('option', { name: 'Show more repositories' });
      expect(more.textContent).toContain('Showing 50 of 120');

      // The keyboard / assistive path: activating the row reveals a page.
      await userEvent.click(more);
      expect(within(listbox).getAllByRole('option')).toHaveLength(101);

      // The pointer path: scrolling the listbox to its bottom reveals the rest.
      fireEvent.scroll(listbox, { target: { scrollTop: 10_000 } });
      expect(within(listbox).getAllByRole('option')).toHaveLength(120);
      expect(
        within(listbox).queryByRole('option', { name: 'Show more repositories' }),
      ).not.toBeInTheDocument();

      // A new filter is a new list: the window starts over.
      await userEvent.type(filter, 'repo-1');
      expect(within(listbox).getAllByRole('option')).toHaveLength(31);
    });

    describe('with sessions on more than one host', () => {
      // The card showed the first host holding a session, in host order. Beside
      // a GitHub session, a repo used through another host was headed by
      // GitHub's account, scopes and pull-request warning.
      const OTHER_HOSTS = ['gitlab', 'bitbucket', 'azure-devops'] as const;

      /** The "Git source" section: the session card and nothing else. */
      function gitSource() {
        return within(screen.getByRole('heading', { name: 'Git source' }).parentElement!);
      }

      it.each(OTHER_HOSTS)('shows the %s account for a repo on that host', async (host) => {
        registerAllHosts();
        await renderWithStore(<WorkspacePanel />);
        act(() => setupPushedBranchOn(host, { github: true, [host]: true }));

        expect(gitSource().getByText(`${host}-user`)).toBeInTheDocument();
        expect(gitSource().getByText(`on ${GIT_HOST_LABELS[host]}`)).toBeInTheDocument();
        expect(gitSource().queryByText('github-user')).not.toBeInTheDocument();
      });

      it('shows the GitHub account for a GitHub repo, with another host connected beside it', async () => {
        registerAllHosts();
        await renderWithStore(<WorkspacePanel />);
        act(() => setupPushedBranchOn('github', { github: true, gitlab: true }));

        expect(gitSource().getByText('github-user')).toBeInTheDocument();
        expect(gitSource().getByText('on GitHub')).toBeInTheDocument();
        expect(gitSource().queryByText('gitlab-user')).not.toBeInTheDocument();
      });

      it('shows the first host holding a session while no repo is connected', async () => {
        registerAllHosts();
        await renderWithStore(<WorkspacePanel />);
        useWorkspaceStore.setState({ listAccessibleRepos: vi.fn(async () => []) });
        seedSessions(['gitlab', 'bitbucket']);

        expect(gitSource().getByText('gitlab-user')).toBeInTheDocument();
        expect(gitSource().getByText('on GitLab')).toBeInTheDocument();
      });

      it("warns about pull requests from the repo's session, not from the one beside it", async () => {
        registerAllHosts();
        const view = await renderWithStore(<WorkspacePanel />);
        // GitHub's token cannot open pull requests, and the repo is not GitHub's.
        act(() => setupPushedBranchOn('gitlab', { github: false, gitlab: true }));
        expect(gitSource().queryByText(/can't create pull requests/i)).not.toBeInTheDocument();
        view.unmount();

        // A fresh render re-hydrates the store. Now it is the repo's own token.
        await renderWithStore(<WorkspacePanel />);
        act(() => setupPushedBranchOn('gitlab', { github: true, gitlab: false }));
        expect(gitSource().getByText(/can't create pull requests/i)).toBeInTheDocument();
      });
    });

    describe('with hosts the edition has locked (gitHostAccess)', () => {
      // What a plan without the extra hosts sees. A locked host stays visible —
      // so the user knows it exists — but nothing that would CALL it renders:
      // no repo browser, no branch controls, no pull prompt.
      const LOCK_ALL_BUT_GITHUB: GitHostAccess = {
        lockedHosts: ['gitlab', 'bitbucket', 'azure-devops'],
      };

      function renderLocked(access: GitHostAccess = LOCK_ALL_BUT_GITHUB) {
        return renderWithStore(
          <GitHostAccessProvider value={access}>
            <WorkspacePanel />
          </GitHostAccessProvider>,
        );
      }

      function connectRepoOn(host: 'gitlab' | 'bitbucket', withBranch = false): void {
        act(() => {
          const local = useWorkspaceStore.getState().local!;
          useWorkspaceStore.setState({
            local: {
              ...local,
              connectedRepo: {
                fullName: 'acme/api',
                owner: 'acme',
                name: 'api',
                defaultBranch: 'main',
                visibility: 'private',
                isPrivate: true,
                pushable: true,
                connectedAt: '2026-09-01T00:00:00.000Z',
                hostKind: host,
              },
              workingBranch: withBranch
                ? {
                    name: 'apicircle/payments-a3f9c2',
                    baseBranch: 'main',
                    repoFullName: 'acme/api',
                    repoOwner: 'acme',
                    repoName: 'api',
                    headSha: 'abc123',
                    createdAt: '2026-09-01T00:00:00.000Z',
                    lastPushedSha: 'abc123',
                    diffSummary: null,
                    openPrUrl: null,
                    hostKind: host,
                  }
                : null,
            },
          });
        });
      }

      it('marks the locked hosts among the supported ones, and says why', async () => {
        registerAllHosts();
        await renderLocked();
        const hosts = screen.getByRole('list', { name: 'Supported Git hosts' });
        // The "(locked)" is visually hidden text: sighted users read the lock icon.
        expect(hosts.textContent).toBe(
          'GitHubGitLab (locked)Bitbucket (locked)Azure DevOps (locked)',
        );
        expect(screen.getByText(/Hosts with a lock aren.t available on this plan/)).toBeVisible();
      });

      it('says nothing about locks when nothing is locked', async () => {
        registerAllHosts();
        await renderLocked({ lockedHosts: [] });
        expect(screen.getByRole('list', { name: 'Supported Git hosts' }).textContent).toBe(
          'GitHubGitLabBitbucketAzure DevOps',
        );
        expect(screen.queryByText(/Hosts with a lock/)).not.toBeInTheDocument();
      });

      it('shows a session on a locked host as locked, and never lists repos through it', async () => {
        registerAllHosts();
        const listAccessibleRepos = vi.fn(async () => [repo('acme/api')]);
        await renderLocked();
        useWorkspaceStore.setState({ listAccessibleRepos });
        seedSessions(['bitbucket']);

        expect(screen.getByText('Bitbucket locked')).toBeInTheDocument();
        expect(screen.queryByText('Bitbucket Connected')).not.toBeInTheDocument();
        expect(screen.getByText('bitbucket-user')).toBeInTheDocument();
        expect(screen.getByText('Locked')).toBeInTheDocument();
        // The notice stands where the repo browser would be: that browser lists
        // repos on mount, through a session the lock says is not used.
        expect(screen.getByText(/Bitbucket isn.t available on this plan/)).toBeInTheDocument();
        expect(screen.queryByText(/Connect a repo on/)).not.toBeInTheDocument();
        expect(listAccessibleRepos).not.toHaveBeenCalled();
      });

      it('lists repos through the unlocked session alone, and suggests no locked host', async () => {
        registerAllHosts();
        const listAccessibleRepos = vi.fn(async () => [repo('me/gh-api')]);
        await renderLocked();
        useWorkspaceStore.setState({ listAccessibleRepos });
        seedSessions(['github', 'bitbucket']);

        expect(screen.getByText('GitHub Connected')).toBeInTheDocument();
        expect(screen.getByText('Connect a repo on GitHub')).toBeInTheDocument();
        // Bitbucket holds a session but is locked, so there is nothing to pick.
        expect(screen.queryByRole('combobox', { name: 'Git host' })).not.toBeInTheDocument();
        // Every other host is locked: "connect another host" would be advice
        // nobody can follow.
        expect(screen.queryByText(/To connect a repo on another host/)).not.toBeInTheDocument();
        await waitFor(() =>
          expect(listAccessibleRepos).toHaveBeenCalledWith({ host: 'github', baseUrl: undefined }),
        );
        expect(listAccessibleRepos).not.toHaveBeenCalledWith(
          expect.objectContaining({ host: 'bitbucket' }),
        );
      });

      it('still suggests another host while one remains unlocked', async () => {
        registerAllHosts();
        await renderLocked({ lockedHosts: ['azure-devops'] });
        useWorkspaceStore.setState({ listAccessibleRepos: vi.fn(async () => []) });
        seedSessions(['github']);
        expect(screen.getByText(/To connect a repo on another host/)).toBeInTheDocument();
      });

      it('keeps a repo on a locked host and its Disconnect repo, but no branch controls', async () => {
        registerAllHosts();
        const listRepoBranches = vi.fn(async () => []);
        const listBranchWorkspaces = vi.fn(async () => []);
        await renderLocked();
        useWorkspaceStore.setState({ listRepoBranches, listBranchWorkspaces });
        seedSessions(['bitbucket']);
        connectRepoOn('bitbucket');

        expect(screen.getByText('acme/api')).toBeInTheDocument();
        expect(screen.getByText('Bitbucket locked')).toBeInTheDocument();
        expect(screen.getByText(/Bitbucket isn.t available on this plan/)).toBeInTheDocument();
        // The create-branch form reads the repo's branches on mount; it must not exist.
        expect(
          screen.queryByRole('button', { name: /Create working branch/ }),
        ).not.toBeInTheDocument();
        expect(listRepoBranches).not.toHaveBeenCalled();
        expect(listBranchWorkspaces).not.toHaveBeenCalled();

        // Disconnecting the repo is local-only, so it stays — the way off the
        // locked host without throwing the saved token away.
        await userEvent.click(screen.getByRole('button', { name: /Disconnect repo/ }));
        await userEvent.click(await screen.findByRole('button', { name: 'Disconnect' }));
        expect(useWorkspaceStore.getState().local!.connectedRepo).toBeNull();
      });

      it('renders no push, pull or PR control for a working branch on a locked host', async () => {
        registerAllHosts();
        await renderLocked();
        seedSessions(['gitlab']);
        connectRepoOn('gitlab', true);
        act(() =>
          useWorkspaceStore.setState({
            firstPullPrompt: { branchName: 'apicircle/payments-a3f9c2', remoteSha: 'abc123' },
          }),
        );

        expect(screen.getByText('GitLab locked')).toBeInTheDocument();
        expect(screen.queryByText('Branch ready')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /^Push/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Refresh/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Create PR/ })).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: /Sync attachments/ })).not.toBeInTheDocument();
        // The first-pull prompt pulls from the host; it waits for the unlock too.
        expect(screen.queryByText('This branch already has content')).not.toBeInTheDocument();
      });

      it('keeps every branch control for a working branch on an unlocked host', async () => {
        // The control for the test above: the same state, one host over, so its
        // absences are the lock's doing and not a matcher that never matched.
        registerAllHosts();
        await renderLocked({ lockedHosts: ['bitbucket'] });
        seedSessions(['gitlab']);
        connectRepoOn('gitlab', true);
        act(() =>
          useWorkspaceStore.setState({
            firstPullPrompt: { branchName: 'apicircle/payments-a3f9c2', remoteSha: 'abc123' },
          }),
        );

        expect(screen.getByText('Branch ready')).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /^Push/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Refresh/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Create PR/ })).toBeInTheDocument();
        expect(screen.getByRole('button', { name: /Sync attachments/ })).toBeInTheDocument();
        expect(screen.getByText('This branch already has content')).toBeInTheDocument();
      });

      it("marks the Git source locked by the repo's host, not by the first session's", async () => {
        const gitSource = () =>
          within(screen.getByRole('heading', { name: 'Git source' }).parentElement!);
        registerAllHosts();
        // The repo is used through GitLab, which is locked. GitHub's session,
        // first in host order, is not.
        const view = await renderLocked({ lockedHosts: ['gitlab'] });
        seedSessions(['github', 'gitlab']);
        connectRepoOn('gitlab');
        expect(gitSource().getByText('gitlab-user')).toBeInTheDocument();
        expect(gitSource().getByText('Locked')).toBeInTheDocument();
        view.unmount();

        // The other way round: the locked session is the first one, and the repo
        // is used through Bitbucket, which is not locked.
        await renderLocked({ lockedHosts: ['gitlab'] });
        useWorkspaceStore.setState({
          listRepoBranches: vi.fn(async () => []),
          listBranchWorkspaces: vi.fn(async () => []),
        });
        seedSessions(['gitlab', 'bitbucket']);
        connectRepoOn('bitbucket');
        expect(gitSource().getByText('bitbucket-user')).toBeInTheDocument();
        expect(gitSource().queryByText('Locked')).not.toBeInTheDocument();
      });

      it('drops the push-access warning on a locked host, keeping it on an unlocked one', async () => {
        // "Reconnect with a token that grants push access" is advice about a
        // host the user cannot use; the lock notice already says what to do.
        function makeReadOnly(): void {
          act(() => {
            const local = useWorkspaceStore.getState().local!;
            useWorkspaceStore.setState({
              local: { ...local, connectedRepo: { ...local.connectedRepo!, pushable: false } },
            });
          });
        }
        registerAllHosts();
        useWorkspaceStore.setState({
          listRepoBranches: vi.fn(async () => []),
          listBranchWorkspaces: vi.fn(async () => []),
        });
        const view = await renderLocked({ lockedHosts: ['bitbucket'] });
        seedSessions(['gitlab', 'bitbucket']);
        connectRepoOn('gitlab');
        makeReadOnly();
        expect(screen.getByText(/You don.t have push access to this repo/)).toBeInTheDocument();
        view.unmount();

        // A fresh render re-hydrates the store, so the sessions are seeded again.
        await renderLocked({ lockedHosts: ['bitbucket'] });
        seedSessions(['gitlab', 'bitbucket']);
        connectRepoOn('bitbucket');
        makeReadOnly();
        expect(screen.getByText(/Bitbucket isn.t available on this plan/)).toBeInTheDocument();
        expect(screen.queryByText(/You don.t have push access/)).not.toBeInTheDocument();
      });

      it('renders a repo on an unlocked host exactly as before', async () => {
        registerAllHosts();
        await renderLocked({ lockedHosts: ['bitbucket'] });
        useWorkspaceStore.setState({
          listRepoBranches: vi.fn(async () => []),
          listBranchWorkspaces: vi.fn(async () => []),
        });
        seedSessions(['gitlab']);
        connectRepoOn('gitlab');
        expect(screen.getByText('Repo connected')).toBeInTheDocument();
        expect(screen.queryByText(/isn.t available on this plan/)).not.toBeInTheDocument();
        expect(
          await screen.findByRole('button', { name: /Create working branch/ }),
        ).toBeInTheDocument();
      });
    });
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

    it('public repo shows the marketplace-topics context banner', async () => {
      await renderWithStore(<WorkspacePanel />);
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
      expect(screen.getByText(/listed in the API Circle marketplace/)).toBeInTheDocument();
      expect(
        screen.getByTitle('Public repo — discoverable in the API Circle marketplace'),
      ).toBeInTheDocument();
    });

    it('private repo hides the marketplace-topics context banner', async () => {
      await renderWithStore(<WorkspacePanel />);
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
              visibility: 'private',
              isPrivate: true,
              pushable: true,
              connectedAt: 't',
            },
          },
        });
      });
      expect(screen.queryByText(/listed in the API Circle marketplace/)).not.toBeInTheDocument();
    });

    it('internal repo hides the marketplace-topics context banner', async () => {
      await renderWithStore(<WorkspacePanel />);
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
              visibility: 'internal',
              isPrivate: true,
              pushable: true,
              connectedAt: 't',
            },
          },
        });
      });
      expect(screen.queryByText(/listed in the API Circle marketplace/)).not.toBeInTheDocument();
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

  describe('Import from workspace (create working branch)', () => {
    // The create-branch form can start the new branch from a workspace that
    // already lives on the base branch. These tests drive the picker, its
    // three non-happy states (loading / error / empty), the destructive
    // warning, and the wiring through to `createWorkingBranch`.

    const IMPORT_ID = 'ws-payments';

    /** Contents-API response body carrying `json` as base64. */
    function contentsSpec(path: string, json: string, sha = 'blob-sha'): ResponseSpec {
      return {
        body: {
          type: 'file',
          path,
          sha,
          size: json.length,
          content: btoa(unescape(encodeURIComponent(json))),
          encoding: 'base64',
        },
      };
    }

    function registrySpec(workspaces: Array<{ id: string; name?: string }>): ResponseSpec {
      return contentsSpec(
        '.apicircle/registry.json',
        JSON.stringify({
          schemaVersion: 1,
          activeWorkspaceId: workspaces[0]?.id ?? null,
          workspaces,
        }),
        'registry-sha',
      );
    }

    /** URL-routed stub — the form's request order is an implementation detail. */
    function routedFetch(routes: Array<[RegExp, ResponseSpec]>): {
      fetch: ReturnType<typeof vi.fn>;
      urls: string[];
    } {
      const urls: string[] = [];
      const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
        const url =
          typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
        urls.push(url);
        for (const [pattern, spec] of routes) {
          if (pattern.test(url)) return fakeResponse(spec);
        }
        throw new Error(`unrouted fetch: ${url}`);
      });
      return { fetch: fetchMock, urls };
    }

    const REGISTRY_RE = /contents\/\.apicircle\/registry\.json/;
    const SOURCE_RE = new RegExp(`contents/\\.apicircle/workspace-${IMPORT_ID}/workspace\\.json`);

    const CONNECT_ROUTES: Array<[RegExp, ResponseSpec]> = [
      [/\/user$/, { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo' } }],
      [
        /\/repos\/me\/api$/,
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
      ],
      [/\/branches\?/, { body: [{ name: 'main', commit: { sha: 'abc123' } }] }],
    ];

    /** A minimal but valid remote workspace document. */
    function sourceJson(): string {
      return JSON.stringify({
        schemaVersion: 1,
        workspaceId: IMPORT_ID,
        collections: {
          tree: { id: 'root', type: 'root', children: [{ kind: 'request', id: 'imported-req' }] },
          requests: {
            'imported-req': {
              id: 'imported-req',
              name: 'Imported request',
              folderId: null,
              method: 'GET',
              url: 'https://example.test/imported',
              headers: [],
              query: [],
              body: { type: 'none', content: '' },
              auth: { type: 'inherit' },
              contextVars: [],
              extractions: [],
              assertions: [],
              createdAt: '2026-01-01T00:00:00.000Z',
              updatedAt: '2026-01-01T00:00:00.000Z',
            },
          },
          folders: {},
        },
        environments: { items: {}, activeName: null, priorityOrder: [] },
        linkedWorkspaces: {},
        linkedOverrides: { requests: {}, environmentVars: {} },
        releases: { self: null, perLink: {} },
        globalAssets: { schemas: {}, graphql: {}, files: {} },
        mockServers: {},
        secretKeys: {},
        meta: {
          createdAt: '2026-01-01T00:00:00.000Z',
          updatedAt: '2026-01-01T00:00:00.000Z',
          appVersion: '1.0.0',
        },
      });
    }

    async function connect(): Promise<void> {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        await useWorkspaceStore.getState().connectGitHubSession('tok');
        await useWorkspaceStore.getState().connectRepo('me', 'api');
      });
      // The base-branch <select> only renders once the branch listing has
      // settled; until then the whole form is disabled. Gate on it so the
      // assertions below describe the settled form, not the loading one.
      await screen.findByRole('combobox', { name: 'Base branch' });
    }

    it('defaults to starting from this workspace, with no picker on screen', async () => {
      vi.stubGlobal('fetch', routedFetch(CONNECT_ROUTES).fetch);
      await connect();
      expect(screen.getByRole('radio', { name: 'This workspace' })).toBeChecked();
      expect(screen.getByRole('radio', { name: 'Import from workspace' })).not.toBeChecked();
      expect(screen.queryByLabelText('Workspace to import')).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create working branch/ })).toBeEnabled();
    });

    it('lists the base branch workspaces once import mode is chosen', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [
            REGISTRY_RE,
            registrySpec([
              { id: IMPORT_ID, name: 'Payments' },
              { id: 'ws-billing', name: 'Billing' },
            ]),
          ],
        ]).fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));

      const select = (await screen.findByLabelText('Workspace to import')) as HTMLSelectElement;
      expect(within(select).getByText(/Payments/)).toBeInTheDocument();
      expect(within(select).getByText(/Billing/)).toBeInTheDocument();
      // The branch's active workspace is pre-selected.
      expect(select.value).toBe(IMPORT_ID);
    });

    /** Opens import mode over a branch registry listing `workspaces`; returns the picker. */
    async function openPicker(
      workspaces: Array<{ id: string; name?: string }>,
    ): Promise<HTMLSelectElement> {
      vi.stubGlobal(
        'fetch',
        routedFetch([...CONNECT_ROUTES, [REGISTRY_RE, registrySpec(workspaces)]]).fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));
      return (await screen.findByLabelText('Workspace to import')) as HTMLSelectElement;
    }

    function optionLabels(select: HTMLSelectElement): Array<string | null> {
      return within(select)
        .getAllByRole('option')
        .map((option) => option.textContent);
    }

    it('labels each workspace with the name it was pushed with, not an abbreviated id', async () => {
      const select = await openPicker([
        { id: IMPORT_ID, name: 'Payments' },
        { id: 'ws-billing', name: 'Billing' },
      ]);
      expect(optionLabels(select)).toEqual(['Payments · active', 'Billing']);
    });

    it("prefers this device's own name for a workspace over the pushed one", async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [REGISTRY_RE, registrySpec([{ id: IMPORT_ID, name: 'Payments' }])],
        ]).fetch,
      );
      await connect();
      act(() => {
        const registry = useWorkspaceStore.getState().workspaceRegistry!;
        useWorkspaceStore.setState({
          workspaceRegistry: {
            ...registry,
            workspaces: [
              ...registry.workspaces,
              {
                id: IMPORT_ID,
                name: '  Payments (mine)  ',
                createdAt: '2026-01-01T00:00:00.000Z',
                lastOpenedAt: '2026-01-01T00:00:00.000Z',
              },
            ],
          },
        });
      });
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));

      const select = (await screen.findByLabelText('Workspace to import')) as HTMLSelectElement;
      expect(optionLabels(select)).toEqual(['Payments (mine) · active']);
      // The destructive warning names it the same way.
      expect(screen.getByText('Payments (mine)', { selector: 'strong' })).toBeInTheDocument();
    });

    it('falls back to the full workspace id when no name is known', async () => {
      // A missing name and the legacy 'Workspace' placeholder both read as unnamed.
      const select = await openPicker([{ id: IMPORT_ID }, { id: 'ws-billing', name: 'Workspace' }]);
      expect(optionLabels(select)).toEqual([`${IMPORT_ID} · active`, 'ws-billing']);
      expect(screen.getByText(IMPORT_ID, { selector: 'strong' })).toBeInTheDocument();
    });

    it('tells same-named workspaces apart with a short id suffix', async () => {
      const select = await openPicker([
        { id: IMPORT_ID, name: 'API' },
        { id: 'ws-billing', name: 'api' },
        { id: 'ws-orders', name: 'Orders' },
      ]);
      expect(optionLabels(select)).toEqual(['API #ws-p · active', 'api #ws-b', 'Orders']);
      // The warning carries the suffix too, so it names exactly one workspace.
      expect(screen.getByText('API #ws-p', { selector: 'strong' })).toBeInTheDocument();
    });

    it('explains that only workspaces pushed to the base branch are listed', async () => {
      const select = await openPicker([{ id: IMPORT_ID, name: 'Payments' }]);
      expect(select).toHaveAccessibleDescription(
        /^Only workspaces pushed to main are listed\. To import one that lives on a working branch, choose that branch as the base\.$/,
      );
    });

    it('warns that the import clears the current workspace and says what survives', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [REGISTRY_RE, registrySpec([{ id: IMPORT_ID, name: 'Payments' }])],
        ]).fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));

      expect(await screen.findByText(/This clears the current workspace/)).toBeInTheDocument();
      expect(screen.getByText(/is replaced by/)).toBeInTheDocument();
      expect(screen.getByText(/Before workspace import/)).toBeInTheDocument();
      expect(screen.getByText(/Run history, saved secrets/)).toBeInTheDocument();
      expect(screen.getByText(/Missing — re-upload/)).toBeInTheDocument();
    });

    it('renders an empty state, and blocks submit, when the branch has no workspaces', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [REGISTRY_RE, { status: 404, body: { message: 'Not Found' } }],
        ]).fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));

      expect(await screen.findByText(/there is nothing to import/)).toBeInTheDocument();
      // An empty base branch is exactly when the working-branch tip matters.
      expect(screen.getByText(/Only workspaces pushed to/)).toBeInTheDocument();
      expect(screen.queryByLabelText('Workspace to import')).not.toBeInTheDocument();
      // No warning without a selection — nothing is about to be replaced.
      expect(screen.queryByText(/This clears the current workspace/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Import & create working branch/ })).toBeDisabled();
    });

    it('surfaces a listing failure instead of claiming the branch is empty', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([...CONNECT_ROUTES, [REGISTRY_RE, { status: 500, body: { message: 'boom' } }]])
          .fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));

      expect(await screen.findByRole('alert')).toBeInTheDocument();
      expect(screen.queryByText(/there is nothing to import/)).not.toBeInTheDocument();
      // No listing came back, so there is nothing for the hint to describe.
      expect(screen.queryByText(/Only workspaces pushed to/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Import & create working branch/ })).toBeDisabled();
    });

    it('re-reads the workspace list when the base branch changes', async () => {
      const routed = routedFetch([
        ...CONNECT_ROUTES.slice(0, 2),
        [
          /\/branches\?/,
          {
            body: [
              { name: 'main', commit: { sha: 'abc123' } },
              { name: 'release/2.x', commit: { sha: 'def456' } },
            ],
          },
        ],
        [REGISTRY_RE, registrySpec([{ id: IMPORT_ID, name: 'Payments' }])],
      ]);
      vi.stubGlobal('fetch', routed.fetch);
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));
      await screen.findByLabelText('Workspace to import');

      await userEvent.selectOptions(
        screen.getByRole('combobox', { name: 'Base branch' }),
        'release/2.x',
      );

      await waitFor(() => {
        expect(
          routed.urls.filter(
            (u) => REGISTRY_RE.test(u) && u.includes(encodeURIComponent('release/2.x')),
          ),
        ).toHaveLength(1);
      });
    });

    it('imports the chosen workspace and creates the branch', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [REGISTRY_RE, registrySpec([{ id: IMPORT_ID, name: 'Payments' }])],
          [
            SOURCE_RE,
            contentsSpec(`.apicircle/workspace-${IMPORT_ID}/workspace.json`, sourceJson()),
          ],
          [/\/branches\/main/, { body: { name: 'main', commit: { sha: 'abc123' } } }],
          [
            /\/git\/refs$/,
            { body: { ref: 'refs/heads/apicircle/imported', object: { sha: 'abc123' } } },
          ],
        ]).fetch,
      );
      await connect();
      const localId = useWorkspaceStore.getState().synced!.workspaceId;
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));
      await screen.findByLabelText('Workspace to import');

      // The auto-generated branch name is already valid — retyping it would
      // only cost a char-by-char userEvent.type on every run.
      const branchName = (screen.getByLabelText('Branch name') as HTMLInputElement).value;
      await userEvent.click(screen.getByRole('button', { name: /Import & create working branch/ }));

      await waitFor(() => {
        expect(useWorkspaceStore.getState().local!.workingBranch?.name).toBe(branchName);
      });
      const synced = useWorkspaceStore.getState().synced!;
      expect(synced.collections.requests['imported-req']?.name).toBe('Imported request');
      // Copy-in: the content arrived, the identity did not.
      expect(synced.workspaceId).toBe(localId);
    });

    it('renders the store error inline when the source document is gone', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [REGISTRY_RE, registrySpec([{ id: IMPORT_ID, name: 'Payments' }])],
          [SOURCE_RE, { status: 404, body: { message: 'Not Found' } }],
        ]).fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));
      await screen.findByLabelText('Workspace to import');
      await userEvent.click(screen.getByRole('button', { name: /Import & create working branch/ }));

      expect(await screen.findByText(/has no workspace\.json on main/)).toBeInTheDocument();
      expect(useWorkspaceStore.getState().local!.workingBranch).toBeNull();
    });

    it('still explains itself when the listing rejects with a non-Error', async () => {
      vi.stubGlobal('fetch', routedFetch(CONNECT_ROUTES).fetch);
      await connect();
      // Override the action itself: nothing in the client throws a bare
      // string today, but a rejected promise carries no type guarantee, and
      // an unlabelled empty picker would be the worst possible outcome.
      // Typed `unknown` on purpose: the point of this test is a rejection
      // that is NOT an Error, which is what the component's last branch
      // handles.
      const nonError: unknown = 'nope';
      act(() => {
        useWorkspaceStore.setState({
          listBranchWorkspaces: async () => {
            throw nonError;
          },
        });
      });

      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));

      expect(
        await screen.findByText('Failed to load workspaces on this branch'),
      ).toBeInTheDocument();
    });

    it('routes a missing-scope listing failure to the scope prompt', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [
            REGISTRY_RE,
            {
              status: 403,
              body: { message: 'Forbidden' },
              headers: { 'x-accepted-oauth-scopes': 'repo', 'x-oauth-scopes': '' },
            },
          ],
        ]).fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));

      expect(await screen.findByText(/Missing required scopes: repo/)).toBeInTheDocument();
      // A scope failure is actionable, so it also raises the app-wide prompt
      // that points the user at the Sessions tab.
      expect(useWorkspaceStore.getState().missingScopePrompt).toEqual(['repo']);
    });

    it('imports whichever workspace the user selects, not just the default', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [
            REGISTRY_RE,
            registrySpec([
              { id: IMPORT_ID, name: 'Payments' },
              { id: 'ws-billing', name: 'Billing' },
            ]),
          ],
          [
            /contents\/\.apicircle\/workspace-ws-billing\/workspace\.json/,
            contentsSpec(
              '.apicircle/workspace-ws-billing/workspace.json',
              sourceJson().replace(IMPORT_ID, 'ws-billing'),
            ),
          ],
          [/\/branches\/main/, { body: { name: 'main', commit: { sha: 'abc123' } } }],
          [
            /\/git\/refs$/,
            { body: { ref: 'refs/heads/apicircle/imported', object: { sha: 'abc123' } } },
          ],
        ]).fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));
      const picker = (await screen.findByLabelText('Workspace to import')) as HTMLSelectElement;

      await userEvent.selectOptions(picker, 'ws-billing');
      expect(picker.value).toBe('ws-billing');
      // The warning names the workspace that is actually about to land. Scoped to the
      // warning's <strong>: the picker's own option now reads "Billing" as well.
      expect(screen.getByText('Billing', { selector: 'strong' })).toBeInTheDocument();

      // The auto-generated branch name is already valid — retyping it would
      // only cost a char-by-char userEvent.type on every run.
      const branchName = (screen.getByLabelText('Branch name') as HTMLInputElement).value;
      await userEvent.click(screen.getByRole('button', { name: /Import & create working branch/ }));

      await waitFor(() => {
        expect(useWorkspaceStore.getState().local!.workingBranch?.name).toBe(branchName);
      });
      expect(
        useWorkspaceStore.getState().synced!.collections.requests['imported-req'],
      ).toBeDefined();
    });

    it('switching back to this workspace drops the picker and the warning', async () => {
      vi.stubGlobal(
        'fetch',
        routedFetch([
          ...CONNECT_ROUTES,
          [REGISTRY_RE, registrySpec([{ id: IMPORT_ID, name: 'Payments' }])],
        ]).fetch,
      );
      await connect();
      await userEvent.click(screen.getByRole('radio', { name: 'Import from workspace' }));
      await screen.findByLabelText('Workspace to import');

      await userEvent.click(screen.getByRole('radio', { name: 'This workspace' }));

      expect(screen.queryByLabelText('Workspace to import')).not.toBeInTheDocument();
      expect(screen.queryByText(/This clears the current workspace/)).not.toBeInTheDocument();
      expect(screen.getByRole('button', { name: /Create working branch/ })).toBeEnabled();
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

    // A session is per host: GitHub's lives in `sessions.github`, every other
    // host's in `sessions.hosts[host]`. The card read GitHub's whatever host the
    // repo was on, so the answer a GitLab session recorded was never looked at,
    // and the one GitHub recorded decided for a repo GitHub does not hold.
    describe('on the host the repo lives on', () => {
      const OTHER_HOSTS = ['gitlab', 'bitbucket', 'azure-devops'] as const;
      let calls: string[];

      beforeEach(() => {
        calls = [];
        for (const host of OTHER_HOSTS) registerGitProvider(host, () => stubProvider(calls, host));
      });

      afterEach(() => {
        resetGitProviderRegistry();
      });

      async function createPrButtonOn(
        host: GitHostKind,
        capability: Partial<Record<GitHostKind, boolean | null>>,
      ): Promise<HTMLElement> {
        await renderWithStore(<WorkspacePanel />);
        await act(async () => {
          setupPushedBranchOn(host, capability);
        });
        return screen.getByRole('button', { name: /Create PR/ });
      }

      it.each(OTHER_HOSTS)(
        'Create PR is disabled when the %s session cannot create pull requests',
        async (host) => {
          const button = await createPrButtonOn(host, { [host]: false });
          expect(button).toBeDisabled();
          // The gate is the answer the store recorded. Nothing is asked of the
          // host to draw the button.
          expect(calls).toEqual([]);
        },
      );

      it.each([true, null])(
        'Create PR is enabled when the GitLab session recorded %s',
        async (capability) => {
          const button = await createPrButtonOn('gitlab', { gitlab: capability });
          expect(button).not.toBeDisabled();
        },
      );

      it('a GitHub session that cannot create pull requests does not decide for a GitLab repo', async () => {
        const button = await createPrButtonOn('gitlab', { github: false, gitlab: true });
        expect(button).not.toBeDisabled();
      });

      it('a GitLab session that cannot create pull requests does not decide for a GitHub repo', async () => {
        const button = await createPrButtonOn('github', { github: true, gitlab: false });
        expect(button).not.toBeDisabled();
      });

      it('a GitHub repo still answers to its own session beside one on another host', async () => {
        const button = await createPrButtonOn('github', { github: false, gitlab: true });
        expect(button).toBeDisabled();
      });
    });

    // The three cases above this block leave `hostKind` off the repo, which is
    // what a workspace persisted before multi-host carries. A repo connected
    // since records `hostKind: 'github'`; with GitHub the only host registered
    // and no `sessions.hosts` at all, it reads the same session to the same end.
    it.each([
      [true, false],
      [false, true],
      [null, false],
    ] as const)(
      'a GitHub-only workspace is unchanged: capability=%s leaves Create PR disabled=%s',
      async (capability, disabled) => {
        await renderWithStore(<WorkspacePanel />);
        await act(async () => {
          setupPushedBranchOn('github', { github: capability });
        });
        expect(useWorkspaceStore.getState().local!.sessions.hosts).toBeUndefined();
        const button = screen.getByRole('button', { name: /Create PR/ });
        if (disabled) expect(button).toBeDisabled();
        else expect(button).not.toBeDisabled();
      },
    );
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

// The recovery advice a failed push gives, which is the half the user acts on.
function setupPushableBranch(): void {
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
      workingBranch: {
        name: 'apicircle/test',
        baseBranch: 'main',
        repoFullName: 'me/api',
        repoOwner: 'me',
        repoName: 'api',
        headSha: 'abc1234',
        createdAt: 't',
        lastPushedSha: null,
        diffSummary: null,
        openPrUrl: null,
      },
    },
  });
}

/**
 * A host that answers and records what it was asked, after the `stubProvider`
 * of `store/multiHostConnect.test.ts`. The other hosts' real providers are
 * registered by the Lens shell, not by this package.
 */
function stubProvider(calls: string[], host: string): GitProvider {
  return {
    getViewer: vi.fn(async () => {
      calls.push(`${host}:getViewer`);
      return { viewer: { login: `${host}-user`, id: 7 }, scopes: { granted: [], missing: [] } };
    }),
    getRepo: vi.fn(async (_token: string, owner: string, name: string) => {
      calls.push(`${host}:getRepo`);
      return {
        fullName: `${owner}/${name}`,
        owner,
        name,
        defaultBranch: 'main',
        visibility: 'private' as const,
        isPrivate: true,
        pushable: true,
      };
    }),
    listPullRequests: vi.fn(async () => {
      calls.push(`${host}:listPullRequests`);
      return [];
    }),
  } as unknown as GitProvider;
}

/**
 * A repo on `host` with a pushed working branch and no open PR, which is the
 * state where only the session's answer can disable Create PR. Each entry of
 * `capability` is a workspace session on that host recording the value as
 * `canCreatePullRequests`: GitHub's in `sessions.github`, any other host's in
 * `sessions.hosts[host]`, the two slots the card has to choose between.
 */
function setupPushedBranchOn(
  host: GitHostKind,
  capability: Partial<Record<GitHostKind, boolean | null>>,
): void {
  const sessionOn = (kind: GitHostKind): GitHostSession | null => {
    const canCreatePullRequests = capability[kind];
    if (canCreatePullRequests === undefined) return null;
    return {
      accountLogin: `${kind}-user`,
      tokenSecretId: `sec_${kind}`,
      grantedScopes: [],
      addedAt: 't',
      lastVerifiedAt: 't',
      canCreatePullRequests,
    };
  };
  const others = (['gitlab', 'bitbucket', 'azure-devops'] as const).flatMap((kind) => {
    const workspace = sessionOn(kind);
    return workspace ? [[kind, { workspace, links: {} }] as const] : [];
  });
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: {
      ...local,
      sessions: {
        github: { workspace: sessionOn('github'), links: {} },
        // A workspace that never held another host's session has no `hosts`.
        ...(others.length > 0 ? { hosts: Object.fromEntries(others) } : {}),
      },
      connectedRepo: {
        fullName: 'acme/api',
        owner: 'acme',
        name: 'api',
        defaultBranch: 'main',
        visibility: 'private',
        isPrivate: true,
        pushable: true,
        connectedAt: 't',
        hostKind: host,
      },
      workingBranch: {
        name: 'apicircle/test',
        baseBranch: 'main',
        repoFullName: 'acme/api',
        repoOwner: 'acme',
        repoName: 'api',
        headSha: 'abc1234',
        createdAt: 't',
        lastPushedSha: 'abc1234',
        diffSummary: null,
        openPrUrl: null,
        hostKind: host,
      },
    },
  });
}

// A 5xx alone cannot say whether anything was written: out of `createCommit` it
// might have left an orphan commit, out of a pre-flight read it wrote nothing at
// all. The store marks the second case; this is where that marking has to show.
describe('WorkspacePanel push failure advice', () => {
  async function pushRejectingWith(err: unknown): Promise<void> {
    await renderWithStore(<WorkspacePanel />);
    await act(async () => {
      setupPushableBranch();
      useWorkspaceStore.setState({ pushWorkspace: vi.fn().mockRejectedValue(err) });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));
  }

  it('warns the write may have landed when the failure could have hit the commit', async () => {
    await pushRejectingWith(new GitHubError('Server Error', 502));

    expect(await screen.findByText('GitHub 502: Server Error')).toBeInTheDocument();
    expect(screen.getByText(/may have partially landed/i)).toBeInTheDocument();
  });

  it('does not warn about a partial write when the push was refused before writing', async () => {
    await pushRejectingWith(new NothingWrittenError(new GitHubError('Server Error', 502)));

    // Same failure, same message -- only the advice differs, because this one
    // never wrote: sending the user to Refresh would steer them away from the
    // retry that is actually safe.
    expect(await screen.findByText('GitHub 502: Server Error')).toBeInTheDocument();
    expect(screen.queryByText(/may have partially landed/i)).not.toBeInTheDocument();
  });

  it('sends a rejected GitHub token to the GitHub session card', async () => {
    await pushRejectingWith(new UnauthorizedError('Bad credentials', 401));

    expect(
      await screen.findByText('Open the GitHub session card above to reconnect.'),
    ).toBeInTheDocument();
  });

  it('names the host the repo is on when that host rejects the token', async () => {
    // The card above reads "gitlab-user on GitLab"; there is no GitHub one.
    const calls: string[] = [];
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab'));
    try {
      await renderWithStore(<WorkspacePanel />);
      await act(async () => {
        setupPushedBranchOn('gitlab', { gitlab: true });
        useWorkspaceStore.setState({
          pushWorkspace: vi.fn().mockRejectedValue(new UnauthorizedError('Unauthorized', 401)),
        });
      });
      await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));

      expect(
        await screen.findByText('Open the GitLab session card above to reconnect.'),
      ).toBeInTheDocument();
      expect(screen.queryByText(/GitHub session card/)).not.toBeInTheDocument();
    } finally {
      resetGitProviderRegistry();
    }
  });
});

// A push that would write values shaped like secrets stops before writing and
// asks. The dialog says where each value sits and why it was flagged — never the
// value — and the user either cancels (nothing written) or pushes anyway.
describe('WorkspacePanel push: values that look like secrets', () => {
  const findings: SecretFinding[] = [
    {
      id: 'request:login:Header:1:Authorization',
      location: 'Request "Login" in Auth › Header "Authorization"',
      reason: 'looks like a GitHub token',
    },
    {
      id: 'environment:prod:variable:0:API_TOKEN',
      location: 'Environment "prod" › Variable "API_TOKEN"',
      reason: 'named like a credential',
    },
  ];

  async function pushWith(pushWorkspace: ReturnType<typeof vi.fn>): Promise<void> {
    await renderWithStore(<WorkspacePanel />);
    await act(async () => {
      setupPushableBranch();
      useWorkspaceStore.setState({ pushWorkspace });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));
  }

  it('pushes straight through when there is nothing to ask about', async () => {
    const pushWorkspace = vi.fn().mockResolvedValue({ commitSha: '0123456789abc' });
    await pushWith(pushWorkspace);

    expect(await screen.findByText('0123456')).toBeInTheDocument();
    expect(pushWorkspace).toHaveBeenCalledTimes(1);
    expect(pushWorkspace).toHaveBeenCalledWith(undefined);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('lists where each value sits and why, and Cancel pushes nothing', async () => {
    const pushWorkspace = vi.fn().mockRejectedValue(new SecretsInPushError(findings));
    await pushWith(pushWorkspace);

    const dialog = await screen.findByRole('dialog', {
      name: 'Push 2 values that look like secrets?',
    });
    expect(within(dialog).getByText('me/api')).toBeInTheDocument();
    expect(within(dialog).getByText('apicircle/test')).toBeInTheDocument();
    const items = within(within(dialog).getByRole('list')).getAllByRole('listitem');
    expect(items.map((item) => item.textContent)).toEqual([
      'Request "Login" in Auth › Header "Authorization" — looks like a GitHub token',
      'Environment "prod" › Variable "API_TOKEN" — named like a credential',
    ]);
    // Asking is not failing: no error is shown behind the dialog.
    expect(screen.queryByRole('alert')).not.toBeInTheDocument();

    await userEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(pushWorkspace).toHaveBeenCalledTimes(1);
    expect(screen.getByRole('button', { name: 'Push to save' })).toBeEnabled();
  });

  it('Push anyway pushes again with exactly those findings acknowledged', async () => {
    const one = [findings[0]];
    const pushWorkspace = vi
      .fn()
      .mockRejectedValueOnce(new SecretsInPushError(one))
      .mockResolvedValueOnce({ commitSha: 'abcdef1234567' });
    await pushWith(pushWorkspace);

    const dialog = await screen.findByRole('dialog', {
      name: 'Push a value that looks like a secret?',
    });
    await userEvent.click(within(dialog).getByRole('button', { name: 'Push anyway' }));

    await waitFor(() => expect(pushWorkspace).toHaveBeenCalledTimes(2));
    expect(pushWorkspace).toHaveBeenNthCalledWith(1, undefined);
    expect(pushWorkspace).toHaveBeenNthCalledWith(2, undefined, {
      acknowledgedSecretFindings: one,
    });
    expect(await screen.findByText('abcdef1')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('keeps the custom commit message across the question', async () => {
    const pushWorkspace = vi
      .fn()
      .mockRejectedValueOnce(new SecretsInPushError(findings))
      .mockResolvedValueOnce({ commitSha: 'fedcba9876543' });
    await renderWithStore(<WorkspacePanel />);
    await act(async () => {
      setupPushableBranch();
      useWorkspaceStore.setState({ pushWorkspace });
    });
    await userEvent.click(screen.getByRole('button', { name: 'Custom commit message' }));
    await userEvent.type(screen.getByLabelText('Commit message'), 'feat: rotate keys');
    await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));

    const dialog = await screen.findByRole('dialog');
    await userEvent.click(within(dialog).getByRole('button', { name: 'Push anyway' }));

    await waitFor(() => expect(pushWorkspace).toHaveBeenCalledTimes(2));
    expect(pushWorkspace).toHaveBeenNthCalledWith(1, 'feat: rotate keys');
    expect(pushWorkspace).toHaveBeenNthCalledWith(2, 'feat: rotate keys', {
      acknowledgedSecretFindings: findings,
    });
  });
});

// When the remote matches, Refresh's notice also counts what is still unpushed,
// and that count has to be the strip's. The refresh makes the remote the
// last-pulled baseline, so a count taken before it named changes the strip no
// longer showed.
describe('WorkspacePanel refresh notice', () => {
  /** What an up-to-date refresh does to the store: the matching remote becomes the baseline. */
  function pullCurrentDoc(): void {
    const { local, synced } = useWorkspaceStore.getState();
    useWorkspaceStore.setState({
      local: {
        ...local!,
        sync: {
          ...local!.sync,
          lastPulledSnapshot: synced,
          lastPulledSha: 'remote-sha',
          lastPulledAt: new Date().toISOString(),
        },
      },
    });
  }

  async function renderBranchWith(requestNames: string[]): Promise<string[]> {
    await renderWithStore(<WorkspacePanel />);
    let ids: string[] = [];
    await act(async () => {
      setupPushableBranch();
      ids = requestNames.map((name) => useWorkspaceStore.getState().addRequest(null, name));
    });
    return ids;
  }

  async function refreshWith(refreshWorkspace: ReturnType<typeof vi.fn>): Promise<void> {
    act(() => useWorkspaceStore.setState({ refreshWorkspace }));
    await userEvent.click(screen.getByRole('button', { name: 'Refresh' }));
  }

  it('says the branch is up to date when the refresh leaves nothing unpushed', async () => {
    await renderBranchWith(['Users', 'Orders']);
    // Nothing has been pulled yet, so the strip counts both requests as unpushed.
    expect(screen.getByRole('button', { name: 'Show unpushed changes preview' })).toBeVisible();

    await refreshWith(
      vi.fn(async () => {
        pullCurrentDoc();
        return { status: 'up-to-date' as const };
      }),
    );

    expect(await screen.findByText('Up to date with the remote.')).toBeInTheDocument();
    expect(
      screen.getByText('No unpushed changes — workspace matches the last pull.'),
    ).toBeInTheDocument();
    expect(screen.queryByText(/Remote has no new changes/)).not.toBeInTheDocument();
  });

  it('counts a change made while the refresh ran', async () => {
    const [users] = await renderBranchWith(['Users', 'Orders']);

    await refreshWith(
      vi.fn(async () => {
        pullCurrentDoc();
        // An edit that lands after the refresh moved the baseline.
        useWorkspaceStore.getState().renameRequest(users, 'Users v2');
        return { status: 'up-to-date' as const };
      }),
    );

    expect(
      await screen.findByText('Remote has no new changes. 1 unpushed local change still pending.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show unpushed changes preview' })).toHaveTextContent(
      '~1 unpushed change · click to preview',
    );
  });

  it('keeps agreeing with the strip as the workspace changes after the refresh', async () => {
    const [users, orders] = await renderBranchWith(['Users', 'Orders']);
    await refreshWith(
      vi.fn(async () => {
        pullCurrentDoc();
        return { status: 'up-to-date' as const };
      }),
    );
    expect(await screen.findByText('Up to date with the remote.')).toBeInTheDocument();

    act(() => {
      useWorkspaceStore.getState().renameRequest(users, 'Users v2');
      useWorkspaceStore.getState().renameRequest(orders, 'Orders v2');
    });

    expect(
      screen.getByText('Remote has no new changes. 2 unpushed local changes still pending.'),
    ).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Show unpushed changes preview' })).toHaveTextContent(
      '~2 unpushed changes · click to preview',
    );
  });
});

// What the panel says about a repo names the host the repo is on. GitLab,
// Bitbucket and Azure DevOps are registered by a multi-host build only, so with
// GitHub alone every line below reads as it always did, and the GitHub rows pin
// that.
describe('WorkspacePanel names the host the repo is on', () => {
  const HOSTS = [
    ['github', 'GitHub'],
    ['gitlab', 'GitLab'],
    ['bitbucket', 'Bitbucket'],
    ['azure-devops', 'Azure DevOps'],
  ] as const;
  const OTHER_HOSTS = HOSTS.slice(1);

  beforeEach(() => {
    const calls: string[] = [];
    for (const [host] of OTHER_HOSTS) registerGitProvider(host, () => stubProvider(calls, host));
  });

  afterEach(() => {
    resetGitProviderRegistry();
  });

  /** A repo on `host` with a pushed branch, and a session on that host alone. */
  async function renderRepoOn(
    host: GitHostKind,
    canCreatePullRequests: boolean | null = true,
  ): Promise<void> {
    await renderWithStore(<WorkspacePanel />);
    await act(async () => {
      setupPushedBranchOn(host, { [host]: canCreatePullRequests });
    });
  }

  // Every host's client throws the same error classes, so the message took its
  // host from nowhere and said GitHub: "GitHub rejected the token" stood right
  // above "Open the GitLab session card above to reconnect."
  describe('in the message of a failed call', () => {
    const rejected = () => new UnauthorizedError('Unauthorized', 401);

    it.each([
      ['Push to save', () => ({ pushWorkspace: vi.fn().mockRejectedValue(rejected()) })],
      ['Refresh', () => ({ refreshWorkspace: vi.fn().mockRejectedValue(rejected()) })],
      ['Sync attachments', () => ({ syncAttachments: vi.fn().mockRejectedValue(rejected()) })],
    ] as const)('%s on a GitLab repo says GitLab rejected the token', async (button, failing) => {
      await renderRepoOn('gitlab');
      act(() => useWorkspaceStore.setState(failing()));
      await userEvent.click(screen.getByRole('button', { name: button }));

      const alert = await screen.findByRole('alert');
      expect(alert).toHaveTextContent(/^GitLab rejected the token\./);
      expect(alert).not.toHaveTextContent('GitHub');
    });

    it.each(HOSTS)('a failed call to a %s repo is prefixed with %s', async (host, label) => {
      await renderRepoOn(host);
      act(() =>
        useWorkspaceStore.setState({
          pushWorkspace: vi.fn().mockRejectedValue(new GitHubError('Server Error', 502)),
        }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(
        new RegExp(`^${label} 502: Server Error$`),
      );
    });

    it('still says GitHub rejected the token of a GitHub repo', async () => {
      await renderRepoOn('github');
      act(() =>
        useWorkspaceStore.setState({ pushWorkspace: vi.fn().mockRejectedValue(rejected()) }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Push to save' }));

      expect(await screen.findByRole('alert')).toHaveTextContent(/^GitHub rejected the token\./);
    });
  });

  // The `pull_request` permission and the `repo` scope are GitHub's. The other
  // hosts name theirs differently, and the vault lists them per host.
  describe("in the session card's pull-request warning", () => {
    const warning = () => screen.getByText(/This token can't create pull requests/);

    it.each(OTHER_HOSTS)('does not recite GitHub scopes to a %s token', async (host, label) => {
      await renderRepoOn(host, false);

      expect(warning().textContent).toBe(
        "This token can't create pull requests. Push will work; PR creation from the app will " +
          `fail until the token is updated. Secret Vault → Sessions lists the token scopes ${label} needs.`,
      );
    });

    it('keeps the wording a GitHub token has always had', async () => {
      await renderRepoOn('github', false);

      expect(warning().textContent).toBe(
        "This token can't create pull requests. Push will work; PR creation from the app will " +
          'fail until the token is updated with the pull_request permission (fine-grained PATs) ' +
          'or the full repo scope (classic PATs).',
      );
    });
  });

  describe('in the dialogs that leave the remote alone', () => {
    it.each(HOSTS)('disconnecting a %s repo says the repo on %s stays', async (host, label) => {
      await renderRepoOn(host);
      await userEvent.click(screen.getByRole('button', { name: 'Disconnect repo' }));

      expect(await screen.findByRole('dialog', { name: 'Disconnect acme/api?' })).toHaveTextContent(
        `The remote repo on ${label} is not touched.`,
      );
    });

    it.each(HOSTS)(
      'discarding the branch of a %s repo says the branch on %s stays',
      async (host, label) => {
        await renderRepoOn(host);
        await userEvent.click(screen.getByRole('button', { name: 'Discard working branch' }));

        expect(
          await screen.findByRole('dialog', { name: 'Discard working branch "apicircle/test"?' }),
        ).toHaveTextContent(`The remote branch on ${label} is not touched.`);
      },
    );
  });

  // The link's text was the address without `https://github.com/`, so only a
  // GitHub pull request was shortened and every other host showed all of it.
  describe('in the open pull request link', () => {
    async function prLinkFor(host: GitHostKind, openPrUrl: string): Promise<HTMLElement> {
      await renderRepoOn(host);
      act(() => {
        const local = useWorkspaceStore.getState().local!;
        useWorkspaceStore.setState({
          local: { ...local, workingBranch: { ...local.workingBranch!, openPrUrl } },
        });
      });
      return within(screen.getByText('PR open:').parentElement!).getByRole('link');
    }

    it.each([
      ['github', 'https://github.com/acme/api/pull/7', 'acme/api/pull/7'],
      ['gitlab', 'https://gitlab.com/acme/api/-/merge_requests/7', 'acme/api/-/merge_requests/7'],
      ['gitlab', 'https://git.acme.dev/acme/api/-/merge_requests/7', 'acme/api/-/merge_requests/7'],
      [
        'gitlab',
        'http://localhost:8929/acme/api/-/merge_requests/7',
        'acme/api/-/merge_requests/7',
      ],
      ['bitbucket', 'https://bitbucket.org/acme/api/pull-requests/7', 'acme/api/pull-requests/7'],
      [
        'azure-devops',
        'https://dev.azure.com/acme/shop/_git/api/pullrequest/7',
        'acme/shop/_git/api/pullrequest/7',
      ],
    ] as const)('a %s pull request at %s reads %s', async (host, url, text) => {
      const link = await prLinkFor(host, url);

      expect(link).toHaveTextContent(new RegExp(`^${text}$`));
      // Only the text is shortened. The link goes to the whole address.
      expect(link).toHaveAttribute('href', url);
    });

    it('shows an address with nothing after the host whole, not as an empty link', async () => {
      const link = await prLinkFor('gitlab', 'https://gitlab.com/');

      expect(link).toHaveTextContent('https://gitlab.com/');
    });
  });

  /**
   * A repo on `host` with a session there and no working branch, which is where
   * the create-branch form, the retired-branch banner and the push-access
   * warning are. The form lists the repo's branches as it mounts, so that call
   * is answered before the repo appears.
   */
  async function renderRepoWithoutBranchOn(
    host: GitHostKind,
    change: (local: WorkspaceLocal) => Partial<WorkspaceLocal> = () => ({}),
  ): Promise<void> {
    await renderWithStore(<WorkspacePanel />);
    await act(async () => {
      useWorkspaceStore.setState({
        listRepoBranches: vi.fn(async () => [{ name: 'main', commitSha: 'abc1234' }]),
      });
      setupPushedBranchOn(host, { [host]: true });
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({ local: { ...local, workingBranch: null, ...change(local) } });
    });
  }

  // The form turns a 422 from creating the branch into a sentence, and the
  // sentence said the branch was on GitHub.
  describe('when the new branch name is taken', () => {
    it.each(HOSTS)('a %s repo says the branch already exists on %s', async (host, label) => {
      await renderRepoWithoutBranchOn(host);
      act(() =>
        useWorkspaceStore.setState({
          createWorkingBranch: vi
            .fn()
            .mockRejectedValue(new GitHubError('Reference already exists', 422)),
        }),
      );
      const name = screen.getByLabelText('Branch name');
      await userEvent.clear(name);
      await userEvent.type(name, 'apicircle/taken');
      const create = screen.getByRole('button', { name: 'Create working branch' });
      await waitFor(() => expect(create).toBeEnabled());
      await userEvent.click(create);

      expect((await screen.findByRole('alert')).textContent).toBe(
        `Branch \`apicircle/taken\` already exists on ${label}. Pick a different name.`,
      );
    });
  });

  // A branch that is gone was deleted on the host the repo is on, and the
  // re-check asks that host.
  describe('in the retired branch banner', () => {
    const deleted = (): Partial<WorkspaceLocal> => ({
      retiredBranch: {
        branchName: 'apicircle/abandoned',
        reason: 'branch-deleted',
        retiredAt: '2026-05-09T12:00:00.000Z',
        prUrl: null,
        prNumber: null,
      },
    });

    it.each(HOSTS)('a branch of a %s repo was deleted on %s', async (host, label) => {
      await renderRepoWithoutBranchOn(host, deleted);

      expect(
        screen.getByText(`Branch apicircle/abandoned was deleted on ${label}`),
      ).toBeInTheDocument();
    });

    const STILL_RETIRED = [
      ['merged', (label: string) => `The PR is still marked merged on ${label}.`],
      ['deleted', (label: string) => `The branch is still missing from ${label}.`],
      [
        'inconclusive',
        (label: string) => `No definitive signal from ${label} yet — try again shortly.`,
      ],
    ] as const;

    it.each(
      HOSTS.flatMap(([host, label]) =>
        STILL_RETIRED.map(([reason, detail]) => [host, reason, detail(label)] as const),
      ),
    )('re-checking a %s repo that answers "%s" says: %s', async (host, reason, detail) => {
      await renderRepoWithoutBranchOn(host, deleted);
      act(() =>
        useWorkspaceStore.setState({
          recheckRetiredBranch: vi.fn(async () => ({ status: 'still-retired' as const, reason })),
        }),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Re-check branch state' }));

      await waitFor(() =>
        expect(useWorkspaceStore.getState().toasts).toContainEqual(
          expect.objectContaining({ tone: 'info', title: 'Still retired', detail }),
        ),
      );
    });
  });

  // "The `repo` scope" is GitHub's name. Another host has its own, and the
  // vault lists them beside the session it manages.
  describe('in the warning on a repo the account cannot push to', () => {
    const warning = () => screen.getByText(/You don't have push access to this repo/);
    const readOnly = (local: WorkspaceLocal): Partial<WorkspaceLocal> => ({
      connectedRepo: { ...local.connectedRepo!, pushable: false },
    });

    it.each(OTHER_HOSTS)('does not recite the GitHub scope for a %s repo', async (host, label) => {
      await renderRepoWithoutBranchOn(host, readOnly);

      expect(warning().textContent).toBe(
        "You don't have push access to this repo. Working branches can't be created. " +
          'Reconnect with a token that grants push access, from an account that can write to ' +
          `this repo. Secret Vault → Sessions lists the token scopes ${label} needs.`,
      );
    });

    it('keeps the wording a GitHub repo has always had', async () => {
      await renderRepoWithoutBranchOn('github', readOnly);

      expect(warning().textContent).toBe(
        "You don't have push access to this repo. Working branches can't be created. " +
          'Reconnect with a token that grants push access (typically the repo scope on a token ' +
          'owned by a collaborator).',
      );
    });
  });
});
