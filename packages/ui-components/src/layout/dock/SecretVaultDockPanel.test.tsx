import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretVaultDockPanel } from './SecretVaultDockPanel';
import { __setWebBuildForTests } from './webBuild';
import { __setGitHubDeviceFlowAvailableForTests } from './githubDeviceFlow';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { registerGitProvider, resetGitProviderRegistry } from '@apicircle/git';

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
      expect(screen.getByText(/referenced in 1 place/)).toBeInTheDocument();

      await userEvent.click(screen.getByRole('button', { name: /Delete TOKEN/ }));
      await waitFor(() => {
        const entries = useWorkspaceStore.getState().local!.secretIndex.entries;
        expect(entries[secretId]).toBeUndefined();
      });
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
      // Now the button reads "Confirm disconnect"; second click clears it.
      await userEvent.click(screen.getByRole('button', { name: 'Confirm disconnect' }));
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
