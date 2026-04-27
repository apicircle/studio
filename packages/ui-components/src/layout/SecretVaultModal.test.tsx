import { act, screen } from '@testing-library/react';
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
    expect(screen.getByText(/AES-GCM encryption is now wired/)).toBeInTheDocument();
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
});
