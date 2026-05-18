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

  it('end-to-end chrome flow: hydrate → switch panel → open vault from rail → switch theme', async () => {
    render(<App />);
    await waitFor(() => screen.getByText('API Circle Studio'));

    // Switch panel: Editor → Workspace
    await userEvent.click(screen.getByRole('button', { name: /^Workspace$/ }));
    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');

    // Open the Vault tab from the right-edge rail.
    await userEvent.click(screen.getByRole('button', { name: /Open Secret Vault/ }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe('vault');
    // Default mode is overlay.
    expect(useWorkspaceStore.getState().rightDock.mode).toBe('overlay');
    expect(screen.getByRole('complementary', { name: /Workspace inspector/ })).toBeInTheDocument();

    // Click the same rail icon to dismiss the dock.
    await userEvent.click(screen.getByRole('button', { name: /Close Secret Vault/ }));
    expect(useWorkspaceStore.getState().rightDock.tab).toBe(null);

    // Switch theme via the Settings popover → Theme row → list.
    await userEvent.click(screen.getByRole('button', { name: /Open workspace settings/ }));
    await userEvent.click(screen.getByRole('button', { name: /Theme:/ }));
    await userEvent.click(screen.getByRole('option', { name: /Midnight Blue/ }));
    expect(useWorkspaceStore.getState().local!.ui.themeId).toBe('midnight-blue');
    expect(document.documentElement.getAttribute('data-theme')).toBe('midnight-blue');
  });
});
