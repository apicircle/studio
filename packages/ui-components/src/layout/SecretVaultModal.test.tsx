import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { SecretVaultModal } from './SecretVaultModal';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';

describe('SecretVaultModal', () => {
  it('does not render when secretVaultOpen is false', async () => {
    await renderWithStore(<SecretVaultModal />);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });

  it('renders Vault tab content by default when opened', async () => {
    await renderWithStore(<SecretVaultModal />);
    act(() => useWorkspaceStore.getState().openSecretVault());
    expect(screen.getByRole('dialog', { name: /Secret Vault/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Vault/ })).toHaveAttribute('aria-current', 'page');
    expect(screen.getByText(/Cross-workspace named secrets/)).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /New secret/ })).toBeInTheDocument();
  });

  it('switches to Sessions tab and shows required scope guidance', async () => {
    await renderWithStore(<SecretVaultModal />);
    act(() => useWorkspaceStore.getState().openSecretVault());
    await userEvent.click(screen.getByRole('button', { name: /Sessions/ }));
    expect(screen.getByRole('button', { name: /Sessions/ })).toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByText(/repo/)).toBeInTheDocument();
    expect(screen.getByText(/pull_request/)).toBeInTheDocument();
  });

  it('Escape closes the modal', async () => {
    await renderWithStore(<SecretVaultModal />);
    act(() => useWorkspaceStore.getState().openSecretVault());
    await userEvent.keyboard('{Escape}');
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(false);
  });

  describe('Vault tab — secret CRUD', () => {
    it('add → list → reveal → delete cycle persists through the store', async () => {
      await renderWithStore(<SecretVaultModal />);
      act(() => useWorkspaceStore.getState().openSecretVault());

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
      await renderWithStore(<SecretVaultModal />);
      act(() => useWorkspaceStore.getState().openSecretVault());
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
      await renderWithStore(<SecretVaultModal />);
      act(() => useWorkspaceStore.getState().openSecretVault());

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
      await renderWithStore(<SecretVaultModal />);
      act(() => useWorkspaceStore.getState().openSecretVault());

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
});
