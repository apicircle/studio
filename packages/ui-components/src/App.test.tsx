import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { App } from './App';
import { useWorkspaceStore } from './store/workspaceStore';

describe('App', () => {
  it('shows loading state, then renders the chrome once hydrated', async () => {
    render(<App />);
    expect(screen.getByText(/Loading workspace/)).toBeInTheDocument();
    await waitFor(() => {
      expect(screen.getByText('API Circle Studio')).toBeInTheDocument();
    });
    // PanelTabs renders 7 buttons. TopBar renders 2 (Secret Vault, Theme).
    expect(useWorkspaceStore.getState().ready).toBe(true);
  });

  it('end-to-end chrome flow: hydrate → switch panel → open vault → switch theme', async () => {
    render(<App />);
    await waitFor(() => screen.getByText('API Circle Studio'));

    // Switch panel: Editor → Workspace
    await userEvent.click(screen.getByRole('button', { name: /^Workspace$/ }));
    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');

    // Open Secret Vault from top bar
    await userEvent.click(screen.getByRole('button', { name: /Open Secret Vault/ }));
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(true);
    expect(screen.getByRole('dialog', { name: /Secret Vault/ })).toBeInTheDocument();

    // Close and switch theme
    await userEvent.keyboard('{Escape}');
    await userEvent.click(screen.getByRole('button', { name: /Choose theme/ }));
    await userEvent.click(screen.getByRole('option', { name: /Midnight Blue/ }));
    expect(useWorkspaceStore.getState().local!.ui.themeId).toBe('midnight-blue');
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight-blue');
  });
});
