import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SecretVaultDockPanel } from './SecretVaultDockPanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

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
    expect(screen.getByText(/repo/)).toBeInTheDocument();
    expect(screen.getByText(/pull_request/)).toBeInTheDocument();
    // Connect form is visible when no session is active.
    expect(screen.getByLabelText('GitHub PAT')).toBeInTheDocument();
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

    it('warns inline when the connected token lacks pull_request scope', async () => {
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

      // B.2 reworded the warning copy from "does not include" to
      // "Recommended scope(s) missing" — same intent, clearer phrasing.
      expect(await screen.findByText(/Recommended scope\(s\) missing/i)).toBeInTheDocument();
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

    it('B.2 missing required-scope warning surfaces when token only has narrower scopes', async () => {
      const fetchMock = vi.fn(
        async () =>
          new Response(JSON.stringify({ login: 'me', id: 1 }), {
            status: 200,
            headers: {
              'content-type': 'application/json',
              // Tease apart the partial-scope path: token has repo but no pull_request.
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

      // The pull_request chip is in the missing/recommended state.
      expect(screen.getByLabelText('pull_request scope missing (recommended)')).toBeInTheDocument();
      // The yellow "Recommended scope(s) missing" banner surfaces.
      expect(screen.getByText(/Recommended scope\(s\) missing/)).toBeInTheDocument();
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
      await waitFor(() => expect(useWorkspaceStore.getState().local!.sessions.github).toBeNull());
    });
  });
});
