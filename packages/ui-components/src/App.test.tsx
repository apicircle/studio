import { render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Compass } from 'lucide-react';
import { App } from './App';
import { useWorkspaceStore } from './store/workspaceStore';
import type { ExtraPanelDef } from './layout/extraPanels';

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

  it('renders an edition-contributed extra panel (tab → content → sidebar) without disturbing core', async () => {
    const Discover: ExtraPanelDef = {
      id: 'lens.discover',
      label: 'Discover',
      icon: Compass,
      hasSidebar: true,
      Panel: () => <div>DISCOVER PANEL BODY</div>,
      Sidebar: () => <div>DISCOVER SIDEBAR BODY</div>,
      SidebarActions: () => <button type="button">Discover action</button>,
    };
    render(<App extraPanels={[Discover]} />);
    await waitFor(() => screen.getByText('API Circle Studio'));

    // Core tabs still present; the extra tab is appended after them.
    expect(screen.getByRole('button', { name: /^Editor$/ })).toBeInTheDocument();
    const discoverTab = screen.getByRole('button', { name: /^Discover$/ });
    expect(discoverTab).toBeInTheDocument();

    // Switch to the extra panel → its content + sidebar + actions render.
    await userEvent.click(discoverTab);
    expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover');
    expect(screen.getByText('DISCOVER PANEL BODY')).toBeInTheDocument();
    expect(screen.getByText('DISCOVER SIDEBAR BODY')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Discover action/ })).toBeInTheDocument();

    // Core still works: back to Workspace clears the extra content.
    await userEvent.click(screen.getByRole('button', { name: /^Workspace$/ }));
    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
    expect(screen.queryByText('DISCOVER PANEL BODY')).not.toBeInTheDocument();
  });
});
