import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SecretVaultDockPanel } from './SecretVaultDockPanel';
import { __setWebBuildForTests } from './webBuild';
import { __setGitHubDeviceFlowAvailableForTests } from './githubDeviceFlow';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { deleteSecretPayload } from '../../persistence/secrets';
import {
  registerGitProvider,
  resetGitProviderRegistry,
  UnauthorizedError,
  type GitProvider,
} from '@apicircle/git';
import * as workspaceSharing from '../workspaceSharing';
import { GitHostAccessProvider, type GitHostAccess } from '../gitHostAccess';
import { RepoDisconnectNoticeProvider } from '../repoDisconnectNotice';

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

describe('SecretVaultDockPanel', () => {
  it('renders Vault tab content by default', async () => {
    await renderWithStore(<SecretVaultDockPanel />);
    expect(screen.getByRole('button', { name: /Vault/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Cross-workspace named secrets/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New secret/ })).toBeInTheDocument();
  });

  it('switches to Sessions tab and shows required scope guidance', async () => {
    await renderWithStore(<SecretVaultDockPanel />);
    await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
    expect(screen.getByRole('button', { name: /Sessions/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    // Required-scope guidance lives in the Workspace session subsection.
    // The matchers below disambiguate the multiple "repo" mentions added
    // by the per-link Linking sessions copy.
    const guidance = screen.getByText('Required PAT scopes').closest('div');
    expect(guidance).not.toBeNull();
    expect(guidance!.textContent).toMatch(/repo/);
    expect(guidance!.textContent).toMatch(/pull_request/);
    // Connect form is visible when no workspace session is active.
    expect(screen.getByLabelText('GitHub PAT')).toBeInTheDocument();
  });

  describe('Sessions tab — more than one registered host', () => {
    // The Lens shell registers the other three hosts behind the provider seam.
    // Open-core Studio registers GitHub alone and renders no host strip at all,
    // which the GitHub-only test above keeps asserting.
    const BB_SESSION = {
      accountLogin: 'bb-user',
      tokenSecretId: 'sec_bb',
      grantedScopes: [],
      addedAt: '2026-09-01T00:00:00.000Z',
      lastVerifiedAt: null,
      canCreatePullRequests: null,
    };

    function seedBitbucketSession(): void {
      act(() => {
        const local = useWorkspaceStore.getState().local!;
        useWorkspaceStore.setState({
          local: {
            ...local,
            sessions: {
              ...local.sessions,
              hosts: { bitbucket: { workspace: BB_SESSION, links: {} } },
            },
          },
        });
      });
    }

    async function openSessions(): Promise<void> {
      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
    }

    /** Connect `acme/api` on `hostKind` as the workspace's repository. */
    function connectRepoOn(hostKind: 'github' | 'bitbucket'): void {
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
              hostKind,
            },
          },
        });
      });
    }

    afterEach(() => {
      resetGitProviderRegistry();
    });

    it('picks the host from a tab strip that shows each host connection status', async () => {
      registerGitProvider('gitlab', () => ({}) as never);
      registerGitProvider('bitbucket', () => ({}) as never);
      await openSessions();
      seedBitbucketSession();

      // A real tablist, not a <select>: every host's status is visible at once,
      // and the accessible name spells out what the dot shows.
      const strip = screen.getByRole('tablist', { name: 'Session Git host' });
      expect(
        within(strip)
          .getAllByRole('tab')
          .map((t) => t.getAttribute('aria-label')),
      ).toEqual(['GitHub, not connected', 'GitLab, not connected', 'Bitbucket, connected']);
      // Opens on the host that HAS a session.
      expect(screen.getByRole('tab', { name: 'Bitbucket, connected' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByText(/Connected as bb-user on Bitbucket/)).toBeInTheDocument();
      expect(screen.getByRole('tabpanel', { name: 'Bitbucket, connected' })).toBeInTheDocument();

      // Arrow keys move between hosts, and the section below follows.
      screen.getByRole('tab', { name: 'Bitbucket, connected' }).focus();
      await userEvent.keyboard('{ArrowLeft}');
      expect(screen.getByRole('tab', { name: 'GitLab, not connected' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByText('Required GitLab token scopes')).toBeInTheDocument();
      expect(screen.getByLabelText('GitLab PAT')).toBeInTheDocument();
    });

    it("opens on the repo's host when another host holds a session beside it", async () => {
      // "Manage session" on the Workspace page lands here. With the repo used
      // through Bitbucket it has to land on Bitbucket's card: the first host
      // holding a session is GitHub, whose card manages a different token.
      registerGitProvider('gitlab', () => ({}) as never);
      registerGitProvider('bitbucket', () => ({}) as never);
      await openSessions();
      act(() => {
        const local = useWorkspaceStore.getState().local!;
        useWorkspaceStore.setState({
          local: {
            ...local,
            sessions: {
              github: {
                workspace: {
                  ...BB_SESSION,
                  accountLogin: 'gh-user',
                  tokenSecretId: 'sec_gh',
                  grantedScopes: ['repo'],
                  canCreatePullRequests: true,
                },
                links: {},
              },
              hosts: { bitbucket: { workspace: BB_SESSION, links: {} } },
            },
          },
        });
      });
      // No repo yet: the first host holding a session, as before.
      expect(screen.getByRole('tab', { name: 'GitHub, connected' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByText(/Connected as gh-user on GitHub/)).toBeInTheDocument();

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
              hostKind: 'bitbucket',
            },
          },
        });
      });
      expect(screen.getByRole('tab', { name: 'Bitbucket, connected' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      expect(screen.getByText(/Connected as bb-user on Bitbucket/)).toBeInTheDocument();
      expect(screen.queryByText(/Connected as gh-user/)).not.toBeInTheDocument();
    });

    it('does not render the strip with a single registered host', async () => {
      await openSessions();
      expect(screen.queryByRole('tablist', { name: 'Session Git host' })).not.toBeInTheDocument();
      expect(screen.queryByRole('tabpanel')).not.toBeInTheDocument();
    });

    it('connects Bitbucket with an API token as email:token', async () => {
      // Bitbucket authenticates an API token together with the Atlassian account
      // email, over HTTP Basic. The form takes both and composes ONE secret, so
      // the user never has to know about the colon that used to be the only way.
      registerGitProvider('bitbucket', () => ({}) as never);
      const connectHostSession = vi.fn(async () => BB_SESSION);
      await openSessions();
      useWorkspaceStore.setState({ connectHostSession });
      await userEvent.click(screen.getByRole('tab', { name: 'Bitbucket, not connected' }));

      // API token is the default kind, with its own scope vocabulary — including
      // the one scope `GET /user` itself needs.
      expect(screen.getByRole('radio', { name: /API token/ })).toBeChecked();
      expect(screen.getByText('Required Bitbucket API token scopes')).toBeInTheDocument();
      expect(screen.getByText('read:user:bitbucket')).toBeInTheDocument();
      expect(screen.getByText('write:pullrequest:bitbucket')).toBeInTheDocument();
      expect(screen.queryByText(/app_password/)).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /Create an API token on Atlassian/ }),
      ).toHaveAttribute('href', 'https://id.atlassian.com/manage-profile/security/api-tokens');

      // The token alone is not enough: an API token without its email cannot
      // authenticate, so Connect stays disabled until both are present.
      await userEvent.type(screen.getByLabelText('Bitbucket API token'), 'ATATT-secret');
      expect(screen.getByRole('button', { name: 'Connect' })).toBeDisabled();
      await userEvent.type(screen.getByLabelText('Atlassian account email'), 'ada@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

      await waitFor(() =>
        expect(connectHostSession).toHaveBeenCalledWith(
          'ada@example.com:ATATT-secret',
          'bitbucket',
          {
            baseUrl: undefined,
          },
        ),
      );
      // Both fields clear on success.
      expect(screen.getByLabelText('Bitbucket API token')).toHaveValue('');
      expect(screen.getByLabelText('Atlassian account email')).toHaveValue('');
    });

    it('connects Bitbucket with an access token pasted on its own', async () => {
      registerGitProvider('bitbucket', () => ({}) as never);
      const connectHostSession = vi.fn(async () => BB_SESSION);
      await openSessions();
      useWorkspaceStore.setState({ connectHostSession });
      await userEvent.click(screen.getByRole('tab', { name: 'Bitbucket, not connected' }));
      await userEvent.click(screen.getByRole('radio', { name: /Access token/ }));

      // The guidance follows the kind: classic scope names, `account` first,
      // and the link goes to the guide because access tokens have no one page.
      expect(screen.getByText('Required Bitbucket access token scopes')).toBeInTheDocument();
      // The scope line, not the note below it that also names `account`.
      expect(screen.getByText('account', { selector: 'li > code' })).toBeInTheDocument();
      expect(screen.getByText(/verify the token when you connect/)).toBeInTheDocument();
      expect(screen.getByText('pullrequest:write')).toBeInTheDocument();
      expect(screen.queryByText('read:user:bitbucket')).not.toBeInTheDocument();
      expect(
        screen.getByRole('link', { name: /How to create a Bitbucket access token/ }),
      ).toHaveAttribute(
        'href',
        'https://support.atlassian.com/bitbucket-cloud/docs/access-tokens/',
      );
      expect(screen.queryByLabelText('Atlassian account email')).not.toBeInTheDocument();

      await userEvent.type(screen.getByLabelText('Bitbucket access token'), 'ATCTT-secret');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await waitFor(() =>
        expect(connectHostSession).toHaveBeenCalledWith('ATCTT-secret', 'bitbucket', {
          baseUrl: undefined,
        }),
      );
    });

    it('offers no credential type on a host with one credential shape', async () => {
      // GitLab issues PATs only. A credential-type choice there would describe a
      // credential the host does not have.
      registerGitProvider('gitlab', () => ({}) as never);
      await openSessions();
      await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected' }));
      expect(screen.queryByRole('radio')).not.toBeInTheDocument();
      expect(screen.queryByLabelText('Atlassian account email')).not.toBeInTheDocument();
      expect(screen.getByLabelText('GitLab PAT')).toBeInTheDocument();
      expect(screen.getByRole('link', { name: /Create a token on GitLab/ })).toHaveAttribute(
        'href',
        'https://gitlab.com/-/user_settings/personal_access_tokens',
      );
    });

    describe('the server a session connects to', () => {
      // One optional "API base URL" box stood on every host but GitHub. That was
      // untrue for Azure DevOps, whose organisation is in that URL and nowhere
      // else, and it never said what a value looks like.
      function registerOtherHosts(): void {
        registerGitProvider('gitlab', () => ({}) as never);
        registerGitProvider('bitbucket', () => ({}) as never);
        registerGitProvider('azure-devops', () => ({}) as never);
      }

      /** Open Sessions with every host registered and `connectHostSession` stubbed. */
      async function openWithStubbedConnect() {
        registerOtherHosts();
        const connectHostSession = vi.fn(async () => BB_SESSION);
        await openSessions();
        useWorkspaceStore.setState({ connectHostSession });
        return connectHostSession;
      }

      it('asks each host for the address it has, and GitHub for none', async () => {
        registerOtherHosts();
        await openSessions();

        // GitHub: github.com is the only GitHub this connects to.
        expect(screen.getByLabelText('GitHub PAT')).toBeInTheDocument();
        expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('Organisation URL')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected' }));
        const gitlab = screen.getByLabelText('API base URL');
        expect(gitlab).toHaveAttribute('placeholder', 'https://gitlab.example.com/api/v4');
        expect(gitlab).toHaveAttribute('aria-required', 'false');
        expect(gitlab).toHaveAccessibleDescription(
          'Only for a self-managed GitLab. Leave blank for gitlab.com.',
        );

        await userEvent.click(screen.getByRole('tab', { name: 'Bitbucket, not connected' }));
        const bitbucket = screen.getByLabelText('API base URL');
        expect(bitbucket).toHaveAttribute('placeholder', 'https://api.bitbucket.org/2.0');
        expect(bitbucket).toHaveAttribute('aria-required', 'false');
        expect(bitbucket).toHaveAccessibleDescription('Leave blank for Bitbucket Cloud.');

        // Azure DevOps: named for what goes in it, and not optional.
        await userEvent.click(screen.getByRole('tab', { name: 'Azure DevOps, not connected' }));
        expect(screen.queryByLabelText('API base URL')).not.toBeInTheDocument();
        const azure = screen.getByLabelText('Organisation URL');
        expect(azure).toHaveAttribute('placeholder', 'https://dev.azure.com/your-org');
        expect(azure).toHaveAttribute('aria-required', 'true');
        expect(azure).toHaveAccessibleDescription(/address of your Azure DevOps organisation/);
      });

      it('does not connect Azure DevOps without its organisation URL', async () => {
        const connectHostSession = await openWithStubbedConnect();
        await userEvent.click(screen.getByRole('tab', { name: 'Azure DevOps, not connected' }));
        const connect = screen.getByRole('button', { name: 'Connect' });
        const url = screen.getByLabelText('Organisation URL');

        // The token alone is not enough: every call would address nothing.
        await userEvent.type(screen.getByLabelText('Azure DevOps PAT'), 'az-pat');
        expect(connect).toBeDisabled();

        // Not a URL: said before the token is sent anywhere.
        await userEvent.type(url, 'dev.azure.com/acme');
        expect(connect).toBeEnabled();
        await userEvent.click(connect);
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Enter a full URL, like https://dev.azure.com/your-org',
        );

        // The address everyone starts from, with no organisation after it.
        await userEvent.clear(url);
        await userEvent.type(url, 'https://dev.azure.com/');
        await userEvent.click(connect);
        expect(screen.getByRole('alert')).toHaveTextContent(
          'Add your organisation to the URL, like https://dev.azure.com/your-org',
        );
        expect(connectHostSession).not.toHaveBeenCalled();

        // Enter in the field submits, as it does in the token field.
        await userEvent.clear(url);
        await userEvent.type(url, 'https://dev.azure.com/acme/{Enter}');
        await waitFor(() =>
          expect(connectHostSession).toHaveBeenCalledWith('az-pat', 'azure-devops', {
            baseUrl: 'https://dev.azure.com/acme',
          }),
        );
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();
      });

      it('connects a self-managed GitLab at the URL typed, and gitlab.com when it is blank', async () => {
        const connectHostSession = await openWithStubbedConnect();
        await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected' }));

        await userEvent.type(screen.getByLabelText('GitLab PAT'), 'glpat-1');
        await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await waitFor(() =>
          expect(connectHostSession).toHaveBeenLastCalledWith('glpat-1', 'gitlab', {
            baseUrl: undefined,
          }),
        );

        await userEvent.type(screen.getByLabelText('GitLab PAT'), 'glpat-2');
        await userEvent.type(screen.getByLabelText('API base URL'), 'https://gl.acme.dev/api/v4');
        await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await waitFor(() =>
          expect(connectHostSession).toHaveBeenLastCalledWith('glpat-2', 'gitlab', {
            baseUrl: 'https://gl.acme.dev/api/v4',
          }),
        );
      });

      it("keeps a URL typed for one host out of another host's connect", async () => {
        // The form stays mounted while the host strip changes. With one shared
        // value, a URL typed on GitLab's tab was still submitted after a switch
        // to GitHub, whose form shows no field: the GitHub token went to the
        // GitLab server.
        const connectHostSession = await openWithStubbedConnect();
        await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected' }));
        await userEvent.type(screen.getByLabelText('API base URL'), 'https://gl.acme.dev/api/v4');

        // Another host with a field starts empty.
        await userEvent.click(screen.getByRole('tab', { name: 'Bitbucket, not connected' }));
        expect(screen.getByLabelText('API base URL')).toHaveValue('');

        await userEvent.click(screen.getByRole('tab', { name: 'GitHub, not connected' }));
        await userEvent.type(screen.getByLabelText('GitHub PAT'), 'ghp-1');
        await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await waitFor(() =>
          expect(connectHostSession).toHaveBeenCalledWith('ghp-1', 'github', {
            baseUrl: undefined,
          }),
        );

        // And GitLab still holds what was typed for it.
        await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected' }));
        expect(screen.getByLabelText('API base URL')).toHaveValue('https://gl.acme.dev/api/v4');
      });

      it("keeps one host's refusal off another host's form", async () => {
        // One shared message showed "Add your organisation to the URL" under
        // GitLab's form after a switch from Azure DevOps'.
        await openWithStubbedConnect();
        await userEvent.click(screen.getByRole('tab', { name: 'Azure DevOps, not connected' }));
        await userEvent.type(screen.getByLabelText('Azure DevOps PAT'), 'az-pat');
        await userEvent.type(screen.getByLabelText('Organisation URL'), 'https://dev.azure.com');
        await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
        expect(screen.getByRole('alert')).toHaveTextContent(/Add your organisation to the URL/);

        await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected' }));
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        // It is still Azure DevOps' to show, until that form is tried again.
        await userEvent.click(screen.getByRole('tab', { name: 'Azure DevOps, not connected' }));
        expect(screen.getByRole('alert')).toHaveTextContent(/Add your organisation to the URL/);
      });

      it('reports a connect that fails against the host it was sent to', async () => {
        registerOtherHosts();
        // Held open, so the host can be switched while the connect is in flight.
        let fail: (reason: Error) => void = () => {};
        const connectHostSession = vi.fn(
          () =>
            new Promise<never>((_resolve, reject) => {
              fail = reject;
            }),
        );
        await openSessions();
        useWorkspaceStore.setState({ connectHostSession });
        await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected' }));
        await userEvent.type(screen.getByLabelText('GitLab PAT'), 'glpat-1');
        await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
        await waitFor(() => expect(connectHostSession).toHaveBeenCalled());

        await userEvent.click(screen.getByRole('tab', { name: 'Bitbucket, not connected' }));
        await act(async () => {
          fail(new Error('GitLab rejected the token (401).'));
        });
        expect(screen.queryByRole('alert')).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected' }));
        expect(screen.getByRole('alert')).toHaveTextContent('GitLab rejected the token (401).');
      });

      it('names the server on the card of a session that has one', async () => {
        registerOtherHosts();
        await openSessions();
        seedBitbucketSession();
        // Connected to the public host: nothing to name.
        expect(screen.getByText(/Connected as bb-user on Bitbucket/)).toBeInTheDocument();
        expect(screen.queryByText('Server')).not.toBeInTheDocument();

        act(() => {
          const local = useWorkspaceStore.getState().local!;
          useWorkspaceStore.setState({
            local: {
              ...local,
              sessions: {
                ...local.sessions,
                hosts: {
                  'azure-devops': {
                    workspace: {
                      ...BB_SESSION,
                      accountLogin: 'az-user',
                      tokenSecretId: 'sec_az',
                      apiBaseUrl: 'https://dev.azure.com/acme',
                    },
                    links: {},
                  },
                },
              },
            },
          });
        });
        await userEvent.click(screen.getByRole('tab', { name: 'Azure DevOps, connected' }));
        expect(screen.getByText(/Connected as az-user on Azure DevOps/)).toBeInTheDocument();
        expect(screen.getByText('Server').nextElementSibling).toHaveTextContent(
          'https://dev.azure.com/acme',
        );
      });
    });

    describe('with hosts the edition has locked (gitHostAccess)', () => {
      // What a plan without the extra hosts sees. The strip still names every
      // host — it is where the user learns a host exists and why it is not
      // available — but a locked host offers no way to connect it.
      async function openLockedSessions(access: GitHostAccess): Promise<void> {
        await renderWithStore(
          <GitHostAccessProvider value={access}>
            <SecretVaultDockPanel />
          </GitHostAccessProvider>,
        );
        await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
      }

      it('marks a locked host in the strip, keeps it reachable, and offers no connect form', async () => {
        registerGitProvider('gitlab', () => ({}) as never);
        registerGitProvider('bitbucket', () => ({}) as never);
        await openLockedSessions({ lockedHosts: ['gitlab', 'bitbucket'] });

        const strip = screen.getByRole('tablist', { name: 'Session Git host' });
        // ", locked" goes LAST, so a match on the status half still finds the tab.
        expect(
          within(strip)
            .getAllByRole('tab')
            .map((t) => t.getAttribute('aria-label')),
        ).toEqual([
          'GitHub, not connected',
          'GitLab, not connected, locked',
          'Bitbucket, not connected, locked',
        ]);
        // A lock stands in the dot's place on the locked hosts only.
        expect(screen.getByTestId('session-host-lock-gitlab')).toBeInTheDocument();
        expect(screen.getByTestId('session-host-lock-bitbucket')).toBeInTheDocument();
        expect(screen.queryByTestId('session-host-lock-github')).not.toBeInTheDocument();
        // GitHub is untouched.
        expect(screen.getByLabelText('GitHub PAT')).toBeInTheDocument();

        // Not `disabled`: arrow keys still reach a locked host.
        screen.getByRole('tab', { name: 'GitHub, not connected' }).focus();
        await userEvent.keyboard('{ArrowRight}');
        expect(screen.getByRole('tab', { name: 'GitLab, not connected, locked' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(screen.getByText(/GitLab isn.t available on this plan/)).toBeInTheDocument();
        // No scope guidance and no connect form: neither can be acted on.
        expect(screen.queryByText('Required GitLab token scopes')).not.toBeInTheDocument();
        expect(screen.queryByLabelText('GitLab PAT')).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Connect' })).not.toBeInTheDocument();
      });

      it('never locks GitHub, even when told to', async () => {
        registerGitProvider('gitlab', () => ({}) as never);
        await openLockedSessions({ lockedHosts: ['github'] });
        expect(screen.getByRole('tab', { name: 'GitHub, not connected' })).toBeInTheDocument();
        expect(screen.getByLabelText('GitHub PAT')).toBeInTheDocument();
      });

      it("shows the edition's notice in place of the default", async () => {
        registerGitProvider('gitlab', () => ({}) as never);
        await openLockedSessions({
          lockedHosts: ['gitlab'],
          lockedNotice: <p>Included in the paid plan.</p>,
        });
        await userEvent.click(screen.getByRole('tab', { name: 'GitLab, not connected, locked' }));
        expect(screen.getByText('Included in the paid plan.')).toBeInTheDocument();
        expect(screen.queryByText(/isn.t available on this plan/)).not.toBeInTheDocument();
      });

      it('keeps a session saved on a locked host, offering only Disconnect', async () => {
        registerGitProvider('bitbucket', () => ({}) as never);
        await openLockedSessions({ lockedHosts: ['bitbucket'] });
        seedBitbucketSession();

        // Opens on the host that holds the session, as it always has.
        expect(screen.getByRole('tab', { name: 'Bitbucket, connected, locked' })).toHaveAttribute(
          'aria-selected',
          'true',
        );
        expect(screen.getByText(/Saved session: bb-user on Bitbucket/)).toBeInTheDocument();
        expect(screen.getByText(/not used while Bitbucket is locked/)).toBeInTheDocument();
        // No repo on this host, so disconnecting clears nothing else.
        expect(screen.queryByText(/also clears this workspace/)).not.toBeInTheDocument();
        // Test and Update would call the host.
        expect(
          screen.queryByRole('button', { name: 'Test Bitbucket connection' }),
        ).not.toBeInTheDocument();
        expect(screen.queryByRole('button', { name: 'Update token' })).not.toBeInTheDocument();
        expect(screen.queryByText(/Connected as bb-user/)).not.toBeInTheDocument();

        await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        await userEvent.click(screen.getByRole('button', { name: 'Disconnect Bitbucket' }));
        await waitFor(() =>
          expect(
            useWorkspaceStore.getState().local!.sessions.hosts?.bitbucket?.workspace ?? null,
          ).toBeNull(),
        );
      });

      it('says when disconnecting also clears the repo on that host', async () => {
        registerGitProvider('bitbucket', () => ({}) as never);
        await openLockedSessions({ lockedHosts: ['bitbucket'] });
        seedBitbucketSession();
        connectRepoOn('bitbucket');
        expect(
          screen.getByText(/also clears this workspace.s Bitbucket repo and working branch/),
        ).toBeInTheDocument();
        // The confirmation of a locked card names the repo as any other does.
        await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        expect(
          within(screen.getByRole('dialog', { name: 'Disconnect Bitbucket?' })).getByText(
            /acme\/api is on Bitbucket, so it is disconnected from this workspace too/,
          ),
        ).toBeInTheDocument();
      });
    });

    describe('the confirmation before a session is disconnected', () => {
      // Disconnect used to be confirmed by pressing the same button again, which
      // had room to say nothing: not that the workspace's repository goes with
      // the session of the host it is on, nor what an edition resets with it.
      const NOTICE = 'The edition also forgets its folder for this repository.';

      async function openWithNotice(): Promise<void> {
        registerGitProvider('bitbucket', () => ({}) as never);
        await renderWithStore(
          <RepoDisconnectNoticeProvider value={<p>{NOTICE}</p>}>
            <SecretVaultDockPanel />
          </RepoDisconnectNoticeProvider>,
        );
        await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
        seedBitbucketSession();
      }

      const bitbucketSession = () =>
        useWorkspaceStore.getState().local!.sessions.hosts?.bitbucket?.workspace ?? null;

      it('says what goes when the host holds no repository: the token, and nothing else', async () => {
        await openWithNotice();
        await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = within(screen.getByRole('dialog', { name: 'Disconnect Bitbucket?' }));
        expect(
          dialog.getByText(/Removes the saved token for bb-user from this workspace/),
        ).toBeInTheDocument();
        expect(dialog.getByText(/Nothing changes on Bitbucket/)).toBeInTheDocument();
        // No repository goes, so nothing of an edition's does either, and there
        // is nothing for the workspace's document to start over from.
        expect(dialog.queryByText(/disconnected from this workspace too/)).not.toBeInTheDocument();
        expect(dialog.queryByText(NOTICE)).not.toBeInTheDocument();
        expect(dialog.queryByRole('checkbox')).not.toBeInTheDocument();
        // Nothing has happened yet: opening the dialog is not the disconnect.
        expect(bitbucketSession()).not.toBeNull();
      });

      it('names the repository that goes with the session, and shows what the edition resets with it', async () => {
        await openWithNotice();
        connectRepoOn('bitbucket');
        await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = within(screen.getByRole('dialog', { name: 'Disconnect Bitbucket?' }));
        expect(
          dialog.getByText(
            /acme\/api is on Bitbucket, so it is disconnected from this workspace too, and any working branch state for it is discarded/,
          ),
        ).toBeInTheDocument();
        expect(dialog.getByText(NOTICE)).toBeInTheDocument();

        await userEvent.click(dialog.getByRole('button', { name: 'Disconnect Bitbucket' }));
        await waitFor(() => expect(bitbucketSession()).toBeNull());
        expect(useWorkspaceStore.getState().local!.connectedRepo).toBeNull();
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
      });

      it('leaves a repository on another host out of it', async () => {
        await openWithNotice();
        // The workspace's repository is on GitHub: disconnecting Bitbucket keeps it.
        connectRepoOn('github');
        await userEvent.click(screen.getByRole('tab', { name: 'Bitbucket, connected' }));
        await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = within(screen.getByRole('dialog', { name: 'Disconnect Bitbucket?' }));
        expect(dialog.queryByText(/acme\/api/)).not.toBeInTheDocument();
        expect(dialog.queryByText(NOTICE)).not.toBeInTheDocument();
        await userEvent.click(dialog.getByRole('button', { name: 'Disconnect Bitbucket' }));
        await waitFor(() => expect(bitbucketSession()).toBeNull());
        expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe('acme/api');
      });

      it('adds nothing of an edition when none is attached', async () => {
        registerGitProvider('bitbucket', () => ({}) as never);
        await openSessions();
        seedBitbucketSession();
        connectRepoOn('bitbucket');
        await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        const dialog = screen.getByRole('dialog', { name: 'Disconnect Bitbucket?' });
        // Studio's two sentences, and the two buttons.
        expect(dialog.querySelectorAll('p')).toHaveLength(2);
      });

      describe("the option to clear the workspace's Studio data", () => {
        const CLEAR = /Also clear this workspace's Studio data/;
        const requests = () =>
          Object.values(useWorkspaceStore.getState().synced!.collections.requests);
        const snapshots = () => useWorkspaceStore.getState().local!.snapshots.entries;

        /** A session and a repository on Bitbucket, and one request to lose. */
        async function openWithARequest(): Promise<void> {
          await openWithNotice();
          connectRepoOn('bitbucket');
          act(() => {
            useWorkspaceStore.getState().addRequest(null, 'List orders');
          });
          await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        }

        it('is offered unticked, and left so the disconnect keeps the document', async () => {
          await openWithARequest();
          const dialog = within(screen.getByRole('dialog', { name: 'Disconnect Bitbucket?' }));
          expect(dialog.getByRole('checkbox', { name: CLEAR })).not.toBeChecked();

          await userEvent.click(dialog.getByRole('button', { name: 'Disconnect Bitbucket' }));
          await waitFor(() => expect(bitbucketSession()).toBeNull());
          expect(requests().map((r) => r.name)).toEqual(['List orders']);
          expect(snapshots()).toHaveLength(0);
        });

        it('ticked, clears the document behind a snapshot, then disconnects', async () => {
          await openWithARequest();
          const dialog = within(screen.getByRole('dialog', { name: 'Disconnect Bitbucket?' }));
          await userEvent.click(dialog.getByRole('checkbox', { name: CLEAR }));
          await userEvent.click(dialog.getByRole('button', { name: 'Disconnect Bitbucket' }));

          await waitFor(() => expect(bitbucketSession()).toBeNull());
          expect(useWorkspaceStore.getState().local!.connectedRepo).toBeNull();
          expect(requests()).toEqual([]);
          // The way back, holding what was there.
          expect(snapshots()).toHaveLength(1);
          expect(snapshots()[0].triggeredBy).toBe('pre-clear');
          expect(
            Object.values(snapshots()[0].workspaceSyncedSnapshot.collections.requests).map(
              (r) => r.name,
            ),
          ).toEqual(['List orders']);
        });

        it('is unticked again the next time the dialog opens', async () => {
          await openWithARequest();
          await userEvent.click(screen.getByRole('checkbox', { name: CLEAR }));
          await userEvent.click(
            within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
          );
          // Cancelled: nothing went.
          expect(requests()).toHaveLength(1);
          expect(bitbucketSession()).not.toBeNull();

          await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
          expect(screen.getByRole('checkbox', { name: CLEAR })).not.toBeChecked();
        });

        it('keeps the session and the repo when the data could not be cleared, and says why', async () => {
          await openWithARequest();
          // A cap the document does not fit under: no snapshot can be kept, so nothing is cleared.
          act(() => useWorkspaceStore.getState().setSnapshotMaxBytes(1));
          await userEvent.click(screen.getByRole('checkbox', { name: CLEAR }));
          await userEvent.click(screen.getByRole('button', { name: 'Disconnect Bitbucket' }));

          await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
          const toast = useWorkspaceStore.getState().toasts.at(-1)!;
          expect(toast).toMatchObject({ tone: 'error', title: 'Disconnect failed' });
          expect(toast.detail).toMatch(/^Nothing was cleared: the snapshot that would bring/);
          expect(requests()).toHaveLength(1);
          expect(bitbucketSession()).not.toBeNull();
          expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe('acme/api');
        });
      });

      it('keeps the session when the dialog is cancelled', async () => {
        await openWithNotice();
        connectRepoOn('bitbucket');
        await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
        await userEvent.click(
          within(screen.getByRole('dialog')).getByRole('button', { name: 'Cancel' }),
        );
        expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
        expect(bitbucketSession()).not.toBeNull();
        expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe('acme/api');
      });

      it('says so when the disconnect fails, and closes the dialog', async () => {
        await openWithNotice();
        // An Error, then a rejection that is not one: both are said as they are.
        act(() =>
          useWorkspaceStore.setState({
            disconnectHostSession: vi
              .fn()
              .mockRejectedValueOnce(new Error('vault is locked'))
              .mockRejectedValueOnce('no reason given'),
          }),
        );
        for (const detail of ['vault is locked', 'no reason given']) {
          await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
          await userEvent.click(screen.getByRole('button', { name: 'Disconnect Bitbucket' }));
          await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument());
          expect(useWorkspaceStore.getState().toasts.at(-1)).toMatchObject({
            tone: 'error',
            title: 'Disconnect failed',
            detail,
          });
        }
        expect(bitbucketSession()).not.toBeNull();
      });
    });

    describe('scopes and the connection test on a non-GitHub host', () => {
      function seedHostSession(host: 'gitlab' | 'bitbucket', grantedScopes: string[]): void {
        act(() => {
          const local = useWorkspaceStore.getState().local!;
          useWorkspaceStore.setState({
            local: {
              ...local,
              sessions: {
                ...local.sessions,
                hosts: {
                  [host]: {
                    workspace: { ...BB_SESSION, accountLogin: `${host}-user`, grantedScopes },
                    links: {},
                  },
                },
              },
            },
          });
        });
      }

      it('says so when the host reports no scopes, and shows no chips', async () => {
        registerGitProvider('gitlab', () => ({}) as never);
        await openSessions();
        seedHostSession('gitlab', []);

        // The card's own sentence; the connect guidance above it has another.
        expect(
          screen.getByText(/GitLab does not report a token.s scopes, so they cannot be shown/),
        ).toBeVisible();
        expect(screen.queryByText('Required scopes')).not.toBeInTheDocument();
        expect(screen.queryByText(/Required scope\(s\) missing/)).not.toBeInTheDocument();
        // Not in the document at all. The row used to be rendered with the
        // `hidden` attribute, which its own `flex` class overrode in a real
        // browser: a red `api` chip sat under the sentence above.
        expect(screen.queryByLabelText(/scope (present|missing)/)).not.toBeInTheDocument();
      });

      it('checks GitLab for `api` once GitLab reports the token scopes', async () => {
        registerGitProvider('gitlab', () => ({}) as never);
        await openSessions();
        seedHostSession('gitlab', ['read_api', 'read_repository']);

        expect(screen.queryByText(/cannot be shown or checked here/)).not.toBeInTheDocument();
        expect(screen.getByText('Required scopes')).toBeVisible();
        expect(screen.getByLabelText('api scope missing (required)')).toBeVisible();
        expect(screen.getByText(/Required scope\(s\) missing:/)).toHaveTextContent(
          'Required scope(s) missing: api.',
        );
        // `pull_request` is GitHub's word; no other host is asked for it.
        expect(screen.queryByLabelText(/pull_request scope/)).not.toBeInTheDocument();
      });

      it('shows a GitLab token that has `api` as covered', async () => {
        registerGitProvider('gitlab', () => ({}) as never);
        await openSessions();
        seedHostSession('gitlab', ['api']);

        expect(screen.getByLabelText('api scope present')).toBeVisible();
        expect(screen.queryByText(/Required scope\(s\) missing/)).not.toBeInTheDocument();
        // GitLab's guidance names the scope the test looks for, instead of
        // saying nothing can be checked.
        expect(screen.getByText(/Once connected, Test connection checks for/)).toHaveTextContent(
          "These are not checked when you connect. Once connected, Test connection checks for api where GitLab reports the token's scopes; a token missing another one fails at the first clone or push.",
        );
      });

      it('lists reported scopes without a required row where none is required', async () => {
        registerGitProvider('bitbucket', () => ({}) as never);
        await openSessions();
        seedHostSession('bitbucket', ['repository', 'pullrequest']);

        expect(screen.getByText('repository, pullrequest')).toBeVisible();
        expect(screen.queryByText('Required scopes')).not.toBeInTheDocument();
        // The connect guidance still says what is true of connecting to Bitbucket.
        expect(
          screen.getByText(
            /Bitbucket does not report a token.s scopes, so these cannot be checked/,
          ),
        ).toBeVisible();
        expect(screen.queryByText(/cannot be shown or checked here/)).not.toBeInTheDocument();
      });

      it('names the host, and the status it answered with, when it rejects the token', async () => {
        let reject = false;
        registerGitProvider(
          'gitlab',
          () =>
            ({
              getViewer: async () => {
                if (reject) throw new UnauthorizedError('nope', 403);
                return { viewer: { login: 'gl-user', id: 7 }, scopes: { granted: [] } };
              },
            }) as unknown as GitProvider,
        );
        await openSessions();
        await act(async () => {
          await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
        });
        await screen.findByText(/Connected as gl-user on GitLab/);

        await userEvent.click(screen.getByRole('button', { name: 'Test GitLab connection' }));
        expect(
          await screen.findByText('Connection healthy — 1 check passed, 2 could not be checked.'),
        ).toBeVisible();
        expect(
          within(screen.getByRole('list', { name: 'GitLab connection checks' })).getAllByRole(
            'listitem',
          )[1],
        ).toHaveTextContent(
          "Not checked: Scopes — GitLab does not report this token's scopes, so they cannot be checked.",
        );

        reject = true;
        await userEvent.click(screen.getByRole('button', { name: 'Test GitLab connection' }));
        expect(
          await screen.findByText(
            'Token rejected by GitLab (403). The token may be revoked or expired — reconnect to refresh.',
          ),
        ).toBeVisible();
        // A failed test replaces the last report; it does not sit beside it.
        expect(screen.queryByRole('list', { name: 'GitLab connection checks' })).toBeNull();
      });
    });

    it('replaces a Bitbucket token through the same two-field form', async () => {
      registerGitProvider('bitbucket', () => ({}) as never);
      const updateHostToken = vi.fn(async () => BB_SESSION);
      await openSessions();
      seedBitbucketSession();
      useWorkspaceStore.setState({ updateHostToken });

      expect(screen.getByRole('button', { name: 'Test Bitbucket connection' })).toBeInTheDocument();
      await userEvent.click(screen.getByRole('button', { name: 'Update token' }));

      // API token by default: email + token, and Update waits for both.
      await userEvent.type(screen.getByLabelText('New Bitbucket API token'), 'ATATT-new');
      expect(screen.getByRole('button', { name: 'Update' })).toBeDisabled();
      await userEvent.type(screen.getByLabelText('New Atlassian account email'), 'ada@example.com');
      await userEvent.click(screen.getByRole('button', { name: 'Update' }));
      await waitFor(() =>
        expect(updateHostToken).toHaveBeenCalledWith('ada@example.com:ATATT-new', 'bitbucket'),
      );

      // Switching to an access token drops the email field; Cancel clears it all.
      await userEvent.click(screen.getByRole('button', { name: 'Update token' }));
      await userEvent.click(screen.getByRole('radio', { name: /Access token/ }));
      expect(screen.queryByLabelText('New Atlassian account email')).not.toBeInTheDocument();
      await userEvent.type(screen.getByLabelText('New Bitbucket access token'), 'ATCTT-new');
      await userEvent.click(screen.getByRole('button', { name: 'Cancel' }));
      expect(screen.queryByLabelText('New Bitbucket access token')).not.toBeInTheDocument();
      expect(updateHostToken).toHaveBeenCalledTimes(1);
    });
  });

  describe('Vault tab — secret CRUD', () => {
    it('add → list → reveal → delete cycle persists through the store', async () => {
      await renderWithStore(<SecretVaultDockPanel />);

      await userEvent.click(screen.getByRole('button', { name: /New secret/ }));
      await userEvent.type(screen.getByLabelText('New secret label'), 'API_KEY');
      await userEvent.type(screen.getByLabelText('New secret value'), 'abc-123');
      await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

      const list = await screen.findByRole('list', { name: 'Secret entries' });
      // IDB write + crypto round-trip is async; let the list re-render.
      expect(await within(list).findByText('API_KEY')).toBeInTheDocument();
      expect(within(list).getByText('workspace')).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Reveal API_KEY/ }));
      await waitFor(() => expect(screen.getByText('abc-123')).toBeInTheDocument());

      await userEvent.click(screen.getByRole('button', { name: /Delete API_KEY/ }));
      await waitFor(() => {
        const entries = useWorkspaceStore.getState().local!.secretIndex.entries;
        expect(Object.keys(entries)).toHaveLength(0);
      });
    });

    it('rejects duplicate labels with a visible error', async () => {
      await renderWithStore(<SecretVaultDockPanel />);
      await act(async () => {
        await useWorkspaceStore.getState().addSecret({ label: 'TOKEN', value: 'first' });
      });

      await userEvent.click(screen.getByRole('button', { name: /New secret/ }));
      await userEvent.type(screen.getByLabelText('New secret label'), 'TOKEN');
      await userEvent.type(screen.getByLabelText('New secret value'), 'second');
      await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));

      expect(await screen.findByText(/already exists/i)).toBeInTheDocument();
    });

    it('blocks delete on first click when secret has usedIn references, then deletes on confirm', async () => {
      await renderWithStore(<SecretVaultDockPanel />);

      let secretId = '';
      await act(async () => {
        secretId = await useWorkspaceStore.getState().addSecret({
          label: 'TOKEN',
          value: 'sk_test',
        });
      });
      act(() => {
        const reqId = useWorkspaceStore.getState().addRequest(null);
        useWorkspaceStore.getState().setRequestUrl(reqId, 'https://x/{{TOKEN}}');
      });

      const deleteBtn = await screen.findByRole('button', { name: /Delete TOKEN/ });
      expect(deleteBtn).toHaveTextContent(/In use \(1\)/);
      await userEvent.click(deleteBtn);
      expect(screen.getByText(/This secret is used in 1 place\./)).toHaveTextContent(
        'This secret is used in 1 place. Click Confirm to delete anyway, or click outside this row (or press Esc) to cancel.',
      );

      await userEvent.click(screen.getByRole('button', { name: /Delete TOKEN/ }));
      await waitFor(() => {
        const entries = useWorkspaceStore.getState().local!.secretIndex.entries;
        expect(entries[secretId]).toBeUndefined();
      });
    });

    it.each([
      ['no workspace is loaded', { synced: null, local: null }],
      ['only the synced document is loaded', { local: null }],
    ])('lists no encryption keys, and no entries, while %s', async (_case, state) => {
      await renderWithStore(<SecretVaultDockPanel />);
      act(() => {
        useWorkspaceStore.setState(state);
      });
      expect(await screen.findByText(/No secrets yet/)).toBeInTheDocument();
      expect(screen.queryByText(/· not a variable$/)).not.toBeInTheDocument();
    });

    it('marks a secret that encrypts variables as their encryption key, not a variable', async () => {
      await renderWithStore(<SecretVaultDockPanel />);
      expect(
        screen.getByText(/A secret that encrypts environment variables is their/),
      ).toHaveTextContent(
        'A secret that encrypts environment variables is their encryption key, not a variable: it is never sent, so write the variable instead.',
      );

      await act(async () => {
        const s = useWorkspaceStore.getState();
        s.addEnvironment('staging');
        s.setVariables('staging', [
          { key: 'ADMIN_TOKEN', value: 'tok', encrypted: false },
          { key: 'REFRESH_TOKEN', value: 'ref', encrypted: false },
        ]);
        const keyId = await s.addSecret({ label: 'ADMIN_KEY', value: 'slot-value' });
        await s.addSecret({ label: 'PLAIN', value: 'plain-value' });
        await s.bindVariableToSecretKey('staging', 0, keyId);
        await s.bindVariableToSecretKey('staging', 1, keyId);
      });

      const keyLine = await screen.findByText(
        'Encryption key of ADMIN_TOKEN, REFRESH_TOKEN · not a variable',
      );
      expect(keyLine.parentElement).toHaveAttribute(
        'title',
        '{{ADMIN_KEY}} is the encryption key of ADMIN_TOKEN and REFRESH_TOKEN, not a variable, ' +
          'so its value is never sent. Write {{ADMIN_TOKEN}} or {{REFRESH_TOKEN}} to send one of the variables.',
      );
      // Only the key's row says so.
      expect(screen.getAllByText(/· not a variable$/)).toHaveLength(1);
    });

    it('asks before deleting a secret that encrypts variables, names them, and clears them on confirm', async () => {
      await renderWithStore(<SecretVaultDockPanel />);
      let keyId = '';
      await act(async () => {
        const s = useWorkspaceStore.getState();
        s.addEnvironment('staging');
        s.setVariables('staging', [
          { key: 'ADMIN_TOKEN', value: 'tok', encrypted: false },
          { key: 'REFRESH_TOKEN', value: 'ref', encrypted: false },
        ]);
        keyId = await s.addSecret({ label: 'ADMIN_KEY', value: 'slot-value' });
        await s.bindVariableToSecretKey('staging', 0, keyId);
        await s.bindVariableToSecretKey('staging', 1, keyId);
      });

      // Nothing writes {{ADMIN_KEY}}: the two variables it encrypts are its uses.
      const deleteBtn = await screen.findByRole('button', { name: 'Delete ADMIN_KEY' });
      await waitFor(() => expect(deleteBtn).toHaveTextContent('In use (2)'));
      await userEvent.click(screen.getByRole('button', { name: 'Toggle where ADMIN_KEY is used' }));
      const uses = screen.getAllByRole('listitem').filter((li) => li.closest('ul.list-disc'));
      expect(uses.map((li) => li.textContent)).toEqual([
        'environment-var · staging → ADMIN_TOKEN',
        'environment-var · staging → REFRESH_TOKEN',
      ]);

      await userEvent.click(deleteBtn);
      expect(screen.getByText(/This secret is used in 2 places\./)).toHaveTextContent(
        'This secret is used in 2 places. Deleting it clears the values of ADMIN_TOKEN, ' +
          'REFRESH_TOKEN, which it encrypts. Click Confirm to delete anyway, or click outside ' +
          'this row (or press Esc) to cancel.',
      );
      // Not deleted until confirmed.
      expect(useWorkspaceStore.getState().local!.secretIndex.entries[keyId]).toBeDefined();

      await userEvent.click(screen.getByRole('button', { name: 'Delete ADMIN_KEY' }));
      await waitFor(() =>
        expect(useWorkspaceStore.getState().local!.secretIndex.entries[keyId]).toBeUndefined(),
      );
      expect(useWorkspaceStore.getState().synced!.environments.items.staging.variables).toEqual([
        { key: 'ADMIN_TOKEN', value: '', encrypted: false },
        { key: 'REFRESH_TOKEN', value: '', encrypted: false },
      ]);
    });

    it('says the one variable a secret encrypts in the singular', async () => {
      await renderWithStore(<SecretVaultDockPanel />);
      await act(async () => {
        const s = useWorkspaceStore.getState();
        s.addEnvironment('staging');
        s.setVariables('staging', [{ key: 'ADMIN_TOKEN', value: 'tok', encrypted: false }]);
        const keyId = await s.addSecret({ label: 'ADMIN_KEY', value: 'slot-value' });
        await s.bindVariableToSecretKey('staging', 0, keyId);
      });
      await userEvent.click(await screen.findByRole('button', { name: 'Delete ADMIN_KEY' }));
      expect(
        screen.getByText(/Deleting it clears the value of ADMIN_TOKEN, which it encrypts\./),
      ).toBeInTheDocument();
    });

    it('refreshes where a secret is used when a variable is bound without a commit', async () => {
      await renderWithStore(<SecretVaultDockPanel />);
      let keyId = '';
      await act(async () => {
        keyId = await useWorkspaceStore.getState().addSecret({ label: 'KEY', value: 'v' });
      });
      expect(await screen.findByRole('button', { name: 'Delete KEY' })).toHaveTextContent(
        /^Delete$/,
      );

      // A pull or a workspace loaded from disk lands the synced doc as is:
      // no commit, so nothing else recomputes the index.
      act(() => {
        const { synced } = useWorkspaceStore.getState();
        useWorkspaceStore.setState({
          synced: {
            ...synced!,
            environments: {
              ...synced!.environments,
              items: {
                dev: {
                  name: 'dev',
                  variables: [
                    { key: 'TOKEN', value: 'enc:v1:x', encrypted: true, secretKeyId: keyId },
                  ],
                },
              },
            },
          },
        });
      });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Delete KEY' })).toHaveTextContent('In use (1)'),
      );

      // So does a linked workspace's cached snapshot.
      act(() => {
        const { synced, local } = useWorkspaceStore.getState();
        useWorkspaceStore.setState({
          local: {
            ...local!,
            linkedCollections: {
              'lw-1': {
                pulledAt: 't',
                ref: 'HEAD@main',
                collections: synced!.collections,
                environments: {
                  items: {
                    prod: {
                      name: 'prod',
                      variables: [
                        { key: 'TOKEN', value: 'enc:v1:y', encrypted: true, secretKeyId: keyId },
                      ],
                    },
                  },
                  activeName: null,
                  priorityOrder: [],
                },
              },
            },
          },
        });
      });
      await waitFor(() =>
        expect(screen.getByRole('button', { name: 'Delete KEY' })).toHaveTextContent('In use (2)'),
      );
      await userEvent.click(screen.getByRole('button', { name: 'Toggle where KEY is used' }));
      expect(screen.getByText(/lw-1 · prod → TOKEN/)).toBeInTheDocument();
    });

    it('shows the where-used expander once the secret has references', async () => {
      await renderWithStore(<SecretVaultDockPanel />);

      await act(async () => {
        await useWorkspaceStore.getState().addSecret({ label: 'BASE_URL', value: 'http://x' });
      });
      act(() => {
        const id = useWorkspaceStore.getState().addRequest(null);
        useWorkspaceStore.getState().setRequestUrl(id, '{{BASE_URL}}/users');
      });

      const expander = await screen.findByRole('button', {
        name: /Toggle where BASE_URL is used/,
      });
      await userEvent.click(expander);
      // The expanded section lists "<kind> · <request name>"; assert at least
      // one li carries the full text. Multiple ancestors of the matching
      // span will satisfy the predicate, so use findAllByText.
      const matches = await screen.findAllByText(
        (_text, el) =>
          el?.tagName === 'LI' && (el.textContent ?? '').includes('request · New request'),
      );
      expect(matches.length).toBeGreaterThan(0);
    });
  });

  describe('Sessions tab — GitHub PAT flow', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('connect → active session card shows account + scopes', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ login: 'devaprakash', id: 7 }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-oauth-scopes': 'repo, pull_request',
            },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));

      await userEvent.type(screen.getByLabelText('GitHub PAT'), 'ghp_test');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

      expect(await screen.findByText(/Connected as devaprakash/)).toBeInTheDocument();
      expect(screen.getByText('repo, pull_request')).toBeInTheDocument();
    });

    it('does NOT warn when token has only `repo` — classic PATs cover PR creation via `repo`', async () => {
      // Pre-fix this test asserted the opposite: that a `repo`-only token
      // surfaced the "missing pull_request" recommendation. That was wrong
      // — classic PATs don't have a separate `pull_request` scope; `repo`
      // already grants full PR powers (create/list/merge/comment), and
      // GitHub itself accepts `repo` for PR ops at runtime. The session
      // card now reads `canCreatePullRequests` (set to `true` by the scope
      // check on connect) and shows no warning in this state.
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ login: 'me', id: 1 }), {
            status: 200,
            headers: { 'content-type': 'application/json', 'x-oauth-scopes': 'repo' },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));

      await userEvent.type(screen.getByLabelText('GitHub PAT'), 'ghp_test');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await screen.findByText(/Connected as me/);

      // No warning surfaces — capability resolved positively from scope.
      expect(screen.queryByText(/can't create pull requests/i)).not.toBeInTheDocument();
      // The pull_request chip is in the present (green) state because
      // capability is satisfied, even though the literal scope string isn't
      // in the granted list.
      expect(screen.getByLabelText('pull_request scope present')).toBeInTheDocument();
    });

    it('warns when canCreatePullRequests is explicitly false (probe disproved capability)', async () => {
      // Force the false state via setState to model a fine-grained PAT
      // whose probe returned 403. The connect path can't reach this state
      // on its own (REQUIRED_BASE_SCOPES mandates `repo` which auto-passes
      // the scope check), so we set up the post-connect state directly.
      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
      await act(async () => {
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
                  canCreatePullRequests: false,
                },
                links: {},
              },
            },
          },
        });
      });
      expect(await screen.findByText(/can't create pull requests/i)).toBeInTheDocument();
      // Chip flips back to the missing/recommended state when capability is false.
      expect(screen.getByLabelText('pull_request scope missing (recommended)')).toBeInTheDocument();
    });

    it('shows the missing-scope error inline when connect fails on insufficient base scopes', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ login: 'me', id: 1 }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-oauth-scopes': 'public_repo',
            },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));

      await userEvent.type(screen.getByLabelText('GitHub PAT'), 'ghp_bad');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

      expect(
        await screen.findByText(
          (_text, el) => el?.getAttribute('role') === 'alert' && /repo/.test(el.textContent ?? ''),
        ),
      ).toBeInTheDocument();
    });

    it('B.2 test-connection — pass: shows the "Connection healthy" banner and refreshes scopes', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ login: 'me', id: 1 }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-oauth-scopes': 'repo, pull_request',
            },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
      await userEvent.type(screen.getByLabelText('GitHub PAT'), 'tok');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await screen.findByText(/Connected as me/);

      // Required-scope chip is green for `repo`.
      expect(screen.getByLabelText('repo scope present')).toBeInTheDocument();

      // Click "Test connection" — verify it fires another /user call and
      // surfaces the pass banner.
      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));
      expect(await screen.findByText(/Connection healthy/)).toBeVisible();
      // With no repo connected there is nothing to ask about one, and the
      // verdict says a check was left open rather than counting it as passed.
      expect(
        screen.getByText('Connection healthy — 2 checks passed, 1 could not be checked.'),
      ).toBeVisible();
      const checks = within(screen.getByRole('list', { name: 'GitHub connection checks' }));
      expect(checks.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Passed: Token — Signed in as me.',
        'Passed: Scopes — Has repo.',
        'Not checked: Repository — No GitHub repository is connected yet, so access to one was not checked.',
      ]);
    });

    /**
     * GitHub answering by path: the branch and pull-request listings go out
     * together, so a queue of responses would hand each the other's.
     */
    function stubGitHubByPath(
      overrides: Record<
        string,
        { status?: number; body: unknown; headers?: Record<string, string> }
      >,
    ): void {
      const defaults: typeof overrides = {
        '/user': { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo' } },
        '/repos/me/api': {
          body: {
            full_name: 'me/api',
            name: 'api',
            owner: { login: 'me' },
            default_branch: 'main',
            visibility: 'private',
            permissions: { push: true, admin: false },
          },
        },
        '/repos/me/api/branches': { body: [{ name: 'main', commit: { sha: 'a' } }] },
        '/repos/me/api/pulls': { body: [] },
      };
      vi.stubGlobal(
        'fetch',
        vi.fn(async (input: string | URL) => {
          const path = new URL(input).pathname;
          const canned = overrides[path] ?? defaults[path];
          if (!canned) throw new Error(`no canned GitHub response for ${path}`);
          return new Response(JSON.stringify(canned.body), {
            status: canned.status ?? 200,
            headers: { 'content-type': 'application/json', ...(canned.headers ?? {}) },
          });
        }),
      );
    }

    /** Connect a GitHub session and its repo, then open the Sessions tab on it. */
    async function openConnectedGitHubCard(): Promise<void> {
      stubGitHubByPath({});
      // Rendering hydrates the store, which the connect actions need.
      await renderWithStore(<SecretVaultDockPanel />);
      await act(async () => {
        await useWorkspaceStore.getState().connectGitHubSession('tok');
        await useWorkspaceStore.getState().connectRepo('me', 'api');
      });
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
      await screen.findByText(/Connected as me/);
    }

    it('test-connection — with a repo connected, every check is listed and passes', async () => {
      await openConnectedGitHubCard();

      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));

      expect(await screen.findByText('Connection healthy — 6 checks passed.')).toBeVisible();
      const checks = within(screen.getByRole('list', { name: 'GitHub connection checks' }));
      expect(checks.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
        'Passed: Token — Signed in as me.',
        'Passed: Scopes — Has repo.',
        'Passed: Repository — me/api is reachable.',
        'Passed: Push access — This account can push to me/api.',
        'Passed: Branches — Branches can be read.',
        'Passed: Pull requests — Pull requests can be read.',
      ]);
    });

    it('test-connection — a failed check is named, and the connection is not called healthy', async () => {
      await openConnectedGitHubCard();
      // Since connecting: the token lost `repo`, and the account lost push access.
      stubGitHubByPath({
        '/user': { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'gist' } },
        '/repos/me/api': {
          body: {
            full_name: 'me/api',
            name: 'api',
            owner: { login: 'me' },
            default_branch: 'main',
            visibility: 'private',
            permissions: { push: false, admin: false },
          },
        },
      });

      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));

      expect(await screen.findByText('2 of 6 checks failed.')).toBeVisible();
      expect(screen.queryByText(/Connection healthy/)).not.toBeInTheDocument();
      const checks = within(screen.getByRole('list', { name: 'GitHub connection checks' }));
      const rows = checks.getAllByRole('listitem').map((li) => li.textContent);
      expect(rows[1]).toBe(
        'Failed: Scopes — Missing repo. Push to save and pull requests will fail until the token is updated.',
      );
      expect(rows[3]).toBe(
        'Failed: Push access — This account has read-only access to me/api. Push to save will fail.',
      );
      // The card's own scope chip agrees with the checklist: one source, one answer.
      expect(screen.getByLabelText('repo scope missing (required)')).toBeInTheDocument();
    });

    it('test-connection — one check left open and one failed are both counted', async () => {
      await openConnectedGitHubCard();
      stubGitHubByPath({
        '/repos/me/api/branches': { status: 502, body: { message: 'Bad gateway' } },
        '/repos/me/api/pulls': { status: 403, body: { message: 'Resource not accessible' } },
      });

      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));

      expect(
        await screen.findByText('1 of 6 checks failed, 1 could not be checked.'),
      ).toBeVisible();
    });

    it('test-connection — a single passed check reads in the singular', async () => {
      // A classic token with no scopes: the token is real, and that is all.
      stubGitHubByPath({});
      await renderWithStore(<SecretVaultDockPanel />);
      await act(async () => {
        await useWorkspaceStore.getState().connectGitHubSession('tok');
      });
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
      await screen.findByText(/Connected as me/);
      stubGitHubByPath({
        '/user': { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': '' } },
      });

      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));

      expect(
        await screen.findByText('1 of 3 checks failed, 1 could not be checked.'),
      ).toBeVisible();
    });

    it('test-connection — a rate limit on the token check says to try again', async () => {
      await openConnectedGitHubCard();
      stubGitHubByPath({
        '/user': {
          status: 403,
          body: { message: 'API rate limit exceeded' },
          headers: {
            'x-ratelimit-remaining': '0',
            'x-ratelimit-reset': String(Math.floor(Date.now() / 1000) + 60),
          },
        },
      });

      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));

      expect(
        await screen.findByText('GitHub rate-limited the check. Try again in a few minutes.'),
      ).toBeVisible();
      expect(screen.queryByRole('list', { name: 'GitHub connection checks' })).toBeNull();
    });

    it('test-connection — a host error on the token check is shown with its status', async () => {
      await openConnectedGitHubCard();
      stubGitHubByPath({ '/user': { status: 500, body: { message: 'Server on fire' } } });

      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));

      expect(await screen.findByText('GitHub error 500: Server on fire')).toBeVisible();
    });

    it('test-connection — a token missing from the vault asks for a reconnect', async () => {
      await openConnectedGitHubCard();
      const { tokenSecretId } = useWorkspaceStore.getState().local!.sessions.github.workspace!;
      await deleteSecretPayload(tokenSecretId);

      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));

      expect(await screen.findByText('No session to test — reconnect.')).toBeVisible();
    });

    it('B.2 test-connection — fail: 401 surfaces a "Token rejected" banner with reconnect copy', async () => {
      // First call: connect succeeds (granted scopes ok).
      // Second call: verify returns 401 — token revoked between sessions.
      let callIndex = 0;
      const fetchMock = vi.fn(async () => {
        callIndex += 1;
        if (callIndex === 1) {
          return new Response(JSON.stringify({ login: 'me', id: 1 }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-oauth-scopes': 'repo, pull_request',
            },
          });
        }
        return new Response(JSON.stringify({ message: 'Bad credentials' }), {
          status: 401,
          headers: { 'content-type': 'application/json' },
        });
      });
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
      await userEvent.type(screen.getByLabelText('GitHub PAT'), 'tok');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await screen.findByText(/Connected as me/);

      await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));
      expect(await screen.findByText(/Token rejected by GitHub \(401\)/)).toBeVisible();
    });

    it('B.2 partial-scope path: `repo`-only tokens are accepted with no recommended-missing warning', async () => {
      // Pre-fix: this asserted the chip rendered as "missing (recommended)"
      // for `repo`-only tokens. That was based on a literal scope-string
      // check that didn't reflect GitHub's actual auth model — classic
      // PATs with `repo` can create PRs without any separate scope, and
      // the session card now mirrors that reality via `canCreatePullRequests`.
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ login: 'me', id: 1 }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-oauth-scopes': 'repo',
            },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
      await userEvent.type(screen.getByLabelText('GitHub PAT'), 'tok');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await screen.findByText(/Connected as me/);

      // Chip is in the present state because capability resolved to true.
      expect(screen.getByLabelText('pull_request scope present')).toBeInTheDocument();
      // No yellow banner.
      expect(screen.queryByText(/can't create pull requests/i)).not.toBeInTheDocument();
    });

    it('update token — a replacement without `repo` is refused, and the card names the scope', async () => {
      await openConnectedGitHubCard();
      const before = useWorkspaceStore.getState().local!.sessions.github.workspace!;
      // The replacement was created without `repo`.
      stubGitHubByPath({
        '/user': { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'public_repo' } },
      });

      await userEvent.click(screen.getByRole('button', { name: 'Update token' }));
      await userEvent.type(screen.getByLabelText('New GitHub PAT'), 'ghp_no_repo');
      await userEvent.click(screen.getByRole('button', { name: 'Update' }));

      expect(await screen.findByText('New token still missing scope(s): repo')).toHaveAttribute(
        'role',
        'alert',
      );
      // The form stays open for another try, on a session that still works.
      expect(screen.getByLabelText('New GitHub PAT')).toHaveValue('ghp_no_repo');
      expect(useWorkspaceStore.getState().local!.sessions.github.workspace).toEqual(before);
      expect(screen.getByLabelText('repo scope present')).toBeInTheDocument();
    });

    it('update token — a replacement with `repo` is taken, and the form closes', async () => {
      await openConnectedGitHubCard();
      const before = useWorkspaceStore.getState().local!.sessions.github.workspace!;
      stubGitHubByPath({
        '/user': { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, gist' } },
      });

      await userEvent.click(screen.getByRole('button', { name: 'Update token' }));
      await userEvent.type(screen.getByLabelText('New GitHub PAT'), 'ghp_with_repo');
      await userEvent.click(screen.getByRole('button', { name: 'Update' }));

      await waitFor(() => expect(screen.queryByLabelText('New GitHub PAT')).toBeNull());
      expect(screen.queryByRole('alert')).toBeNull();
      const after = useWorkspaceStore.getState().local!.sessions.github.workspace!;
      expect(after.grantedScopes).toEqual(['repo', 'gist']);
      expect(after.tokenSecretId).toBe(before.tokenSecretId);
    });

    // GitHub sends no `x-oauth-scopes` header for a fine-grained token: it has
    // permissions, not scopes. Connect refused every one for lacking `repo`
    // while the token field's own placeholder offered `github_pat_…`.
    describe('a fine-grained token, whose scopes GitHub does not report', () => {
      /** `GET /user` with no scope header; every other path as a healthy repo. */
      const FINE_GRAINED = { '/user': { body: { login: 'me', id: 1 } } };

      it('says what to give one, and that it is not checked on connect', async () => {
        await renderWithStore(<SecretVaultDockPanel />);
        await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));

        expect(screen.getByLabelText('GitHub PAT')).toHaveAttribute(
          'placeholder',
          'ghp_… or github_pat_…',
        );
        expect(screen.getByText(/A fine-grained token/)).toHaveTextContent(
          'A fine-grained token (github_pat_…) has permissions instead of scopes: give it Contents and Pull requests, read and write, on the repository. GitHub does not report those, so they are not checked when you connect — a token missing one fails at the first push or pull request instead.',
        );
      });

      it('connects through the form, and the card shows no scope it could not read', async () => {
        stubGitHubByPath(FINE_GRAINED);
        await renderWithStore(<SecretVaultDockPanel />);
        await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));

        await userEvent.type(screen.getByLabelText('GitHub PAT'), 'github_pat_x');
        await userEvent.click(screen.getByRole('button', { name: 'Connect' }));

        expect(await screen.findByText('Connected as me on GitHub')).toBeVisible();
        expect(screen.queryByRole('alert')).toBeNull();
        expect(
          screen.getByText(/GitHub does not report this token.s scopes, so they cannot be shown/),
        ).toHaveTextContent(
          "GitHub does not report this token's scopes, so they cannot be shown or checked here. A fine-grained token carries permissions instead, and Test connection checks what it can reach.",
        );
        // No chip claims a scope is missing, and nothing warns about one.
        expect(screen.queryByText('Required scopes')).not.toBeInTheDocument();
        expect(screen.queryByLabelText(/scope (present|missing)/)).not.toBeInTheDocument();
        expect(screen.queryByText(/Required scope\(s\) missing/)).not.toBeInTheDocument();
        expect(screen.queryByText(/can't create pull requests/i)).not.toBeInTheDocument();
      });

      it('test-connection leaves the scope check open and checks the repo itself', async () => {
        stubGitHubByPath(FINE_GRAINED);
        await renderWithStore(<SecretVaultDockPanel />);
        await act(async () => {
          await useWorkspaceStore.getState().connectGitHubSession('github_pat_x');
          await useWorkspaceStore.getState().connectRepo('me', 'api');
        });
        await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
        await screen.findByText(/Connected as me/);

        await userEvent.click(screen.getByRole('button', { name: 'Test GitHub connection' }));

        expect(
          await screen.findByText('Connection healthy — 4 checks passed, 2 could not be checked.'),
        ).toBeVisible();
        const checks = within(screen.getByRole('list', { name: 'GitHub connection checks' }));
        expect(checks.getAllByRole('listitem').map((li) => li.textContent)).toEqual([
          'Passed: Token — Signed in as me.',
          "Not checked: Scopes — GitHub does not report this token's scopes, so they cannot be checked. A fine-grained token carries permissions instead, and GitHub does not report those either.",
          'Passed: Repository — me/api is reachable.',
          "Not checked: Push access — This account can push to me/api, but GitHub does not report whether this token's permissions allow it. The first push is the real test.",
          'Passed: Branches — Branches can be read.',
          'Passed: Pull requests — Pull requests can be read.',
        ]);
        // The card still shows no chips after the test refreshed the session.
        expect(screen.queryByLabelText(/scope (present|missing)/)).not.toBeInTheDocument();
      });

      it('still reads a classic token GitHub reported with no scopes as missing `repo`', async () => {
        // An empty list that WAS reported. A session saved before the client
        // said which it was (no `scopesReported`) reads the same way, so
        // nothing already stored changes meaning.
        await renderWithStore(<SecretVaultDockPanel />);
        await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
        const seed = (scopesReported?: boolean) =>
          act(async () => {
            const local = useWorkspaceStore.getState().local!;
            useWorkspaceStore.setState({
              local: {
                ...local,
                sessions: {
                  github: {
                    workspace: {
                      accountLogin: 'me',
                      tokenSecretId: 'sec',
                      grantedScopes: [],
                      ...(scopesReported === undefined ? {} : { scopesReported }),
                      addedAt: 't',
                      lastVerifiedAt: 't',
                      canCreatePullRequests: null,
                    },
                    links: {},
                  },
                },
              },
            });
          });

        for (const scopesReported of [true, undefined]) {
          await seed(scopesReported);
          expect(screen.getByLabelText('repo scope missing (required)')).toBeVisible();
          expect(screen.getByText(/Required scope\(s\) missing:/)).toHaveTextContent(
            'Required scope(s) missing: repo.',
          );
          expect(screen.queryByText(/cannot be shown or checked here/)).not.toBeInTheDocument();
        }

        await seed(false);
        expect(screen.queryByLabelText(/scope (present|missing)/)).not.toBeInTheDocument();
        expect(screen.getByText(/cannot be shown or checked here/)).toBeVisible();
      });
    });

    it('disconnect requires confirmation then clears the session', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ login: 'me', id: 1 }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              'x-oauth-scopes': 'repo, pull_request',
            },
          }),
      );
      vi.stubGlobal('fetch', fetchMock);

      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
      await userEvent.type(screen.getByLabelText('GitHub PAT'), 'tok');
      await userEvent.click(screen.getByRole('button', { name: 'Connect' }));
      await screen.findByText(/Connected as me/);

      await userEvent.click(screen.getByRole('button', { name: 'Disconnect' }));
      // A dialog asks first; the session is there until its button is pressed.
      expect(useWorkspaceStore.getState().local!.sessions.github.workspace).not.toBeNull();
      await userEvent.click(screen.getByRole('button', { name: 'Disconnect GitHub' }));
      await waitFor(() =>
        expect(useWorkspaceStore.getState().local!.sessions.github.workspace).toBeNull(),
      );
    });
  });

  describe('Sessions tab — one-click sign-in availability (honest UI)', () => {
    afterEach(() => {
      __setGitHubDeviceFlowAvailableForTests(null);
    });

    it('shows the "Sign in with GitHub" button where the device-flow relay exists', async () => {
      __setGitHubDeviceFlowAvailableForTests(true);
      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));

      expect(screen.getByRole('button', { name: 'Sign in with GitHub' })).toBeInTheDocument();
      // The token box is the secondary option here ("Or — …").
      expect(screen.getByText(/paste a personal access token/i)).toBeInTheDocument();
      expect(screen.getByLabelText('GitHub PAT')).toBeInTheDocument();
    });

    it('hides the button and promotes the token path where the relay is absent', async () => {
      __setGitHubDeviceFlowAvailableForTests(false);
      await renderWithStore(<SecretVaultDockPanel />);
      await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));

      // No broken one-click button on the static web deploy / desktop build…
      expect(screen.queryByRole('button', { name: 'Sign in with GitHub' })).toBeNull();
      // …and the device-flow blurb is gone with it.
      expect(screen.queryByText(/no client secret stays in the browser/i)).toBeNull();
      // The token path becomes the primary connect method and still works
      // (it calls api.github.com directly, which the browser is allowed to hit).
      expect(screen.getByText(/Connect with a personal access token/i)).toBeInTheDocument();
      expect(screen.getByLabelText('GitHub PAT')).toBeInTheDocument();
      expect(screen.getByRole('button', { name: 'Connect' })).toBeInTheDocument();
    });
  });

  describe('Vault tab — linked-workspace required keys', () => {
    it('surfaces unprovisioned linked secrets in the missing-slots gate with the source label', async () => {
      await renderWithStore(<SecretVaultDockPanel />);
      // Seed a linked workspace whose source declares a slot, plus the
      // matching cached snapshot so the slot's label is available.
      const synced = useWorkspaceStore.getState().synced!;
      const local = useWorkspaceStore.getState().local!;
      act(() => {
        useWorkspaceStore.setState({
          synced: {
            ...synced,
            linkedWorkspaces: {
              ...synced.linkedWorkspaces,
              'lw-vault-test': {
                id: 'lw-vault-test',
                kind: 'private' as const,
                name: 'Payments',
                sourceWorkspaceId: 'src-ws-payments',
                source: {
                  provider: 'github' as const,
                  repoFullName: 'org/payments',
                  branch: 'main',
                  sessionMode: 'workspace' as const,
                },
                scope: ['collections' as const, 'environments' as const],
                pinnedVersion: '1.0.0',
                updatePolicy: 'manual' as const,
                linkedAt: '2026-04-27T00:00:00.000Z',
                requiredSecretKeyIds: ['DB_TOKEN'],
              },
            },
          },
          local: {
            ...local,
            linkedCollections: {
              ...local.linkedCollections,
              'lw-vault-test': {
                pulledAt: '2026-04-27T00:00:00.000Z',
                ref: 'v1.0.0',
                collections: {
                  tree: { id: 'r', type: 'root', children: [] },
                  requests: {},
                  folders: {},
                },
                environments: { items: {}, activeName: null, priorityOrder: [] },
                secretKeys: {
                  DB_TOKEN: {
                    id: 'DB_TOKEN',
                    label: 'Database token',
                    createdAt: 't',
                    salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
                  },
                },
              },
            },
          },
        });
      });

      // The Vault gate now surfaces the linked slot with its label.
      expect(await screen.findByText('Database token')).toBeInTheDocument();
      expect(screen.getByText(/required by linked · Payments/i)).toBeInTheDocument();
      // Provide a value via the password input bound to the linked slot.
      await userEvent.type(
        screen.getByLabelText('Value for Database token (linked)'),
        'super-secret',
      );
      await userEvent.click(screen.getByRole('button', { name: /^Save$/ }));
      // After save, the linked slot has an entry in secretIndex with
      // origin: 'linked' bound to this link, and the missing-gate row
      // disappears.
      await waitFor(() => {
        const entries = Object.values(useWorkspaceStore.getState().local!.secretIndex.entries);
        expect(
          entries.some(
            (e) =>
              e.origin === 'linked' &&
              e.linkedWorkspaceId === 'lw-vault-test' &&
              e.linkedKeyId === 'DB_TOKEN',
          ),
        ).toBe(true);
      });
      // The provisioned row in the regular vault list shows the source's
      // human label — NOT the persisted `link:Payments:DB_TOKEN` form
      // that leaks the slot id. The "linked" badge is still present.
      const list = await screen.findByRole('list', { name: 'Secret entries' });
      expect(within(list).getByText('Database token')).toBeInTheDocument();
      expect(within(list).queryByText(/link:Payments:DB_TOKEN|DB_TOKEN/)).toBeNull();
      expect(within(list).getByText('linked')).toBeInTheDocument();
    });
  });

  describe('Vault tab — passphrase gates (web build)', () => {
    afterEach(() => {
      __setWebBuildForTests(null);
    });

    it('shows the Set-passphrase CTA and hides New secret when no passphrase is set on web', async () => {
      __setWebBuildForTests(true);
      await renderWithStore(<SecretVaultDockPanel />);

      // CTA is visible; New secret button is suppressed until a passphrase
      // is configured.
      expect(screen.getByRole('group', { name: /Set workspace passphrase/ })).toBeInTheDocument();
      expect(screen.getByRole('button', { name: /^Set passphrase$/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /New secret/ })).toBeNull();
    });

    it('clicking Set passphrase flips the store modal state to "setup"', async () => {
      __setWebBuildForTests(true);
      await renderWithStore(<SecretVaultDockPanel />);

      expect(useWorkspaceStore.getState().passphraseModal).toBeNull();
      await userEvent.click(screen.getByRole('button', { name: /^Set passphrase$/ }));
      expect(useWorkspaceStore.getState().passphraseModal).toBe('setup');
    });

    it('once setupPassphrase succeeds the CTA collapses and New secret returns', async () => {
      __setWebBuildForTests(true);
      await renderWithStore(<SecretVaultDockPanel />);

      expect(screen.queryByRole('button', { name: /New secret/ })).toBeNull();
      await act(async () => {
        const result = await useWorkspaceStore.getState().setupPassphrase('a-strong-passphrase');
        expect(result.ok).toBe(true);
      });

      expect(screen.queryByRole('group', { name: /Set workspace passphrase/ })).toBeNull();
      expect(screen.getByRole('button', { name: /New secret/ })).toBeInTheDocument();
    });

    it('shows the Unlock-secrets CTA when secretLockState is locked', async () => {
      __setWebBuildForTests(true);
      await renderWithStore(<SecretVaultDockPanel />);

      // Bring the workspace into the locked state directly. (Simulates a
      // returning user whose synced.secretCrypto exists but whose
      // in-memory key was cleared by restart or idle-lock.)
      await act(async () => {
        await useWorkspaceStore.getState().setupPassphrase('a-strong-passphrase');
        useWorkspaceStore.getState().lockSecrets();
      });

      expect(useWorkspaceStore.getState().secretLockState).toBe('locked');
      expect(screen.getByRole('group', { name: /Unlock workspace secrets/ })).toBeInTheDocument();
      expect(screen.queryByRole('button', { name: /New secret/ })).toBeNull();

      await userEvent.click(screen.getByRole('button', { name: /^Unlock secrets$/ }));
      expect(useWorkspaceStore.getState().passphraseModal).toBe('unlock');
    });
  });
});
