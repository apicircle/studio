import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { App } from './App';
import { useWorkspaceStore } from './store/workspaceStore';
import type { ExtraPanelDef } from './layout/extraPanels';
import type { SectionDef } from './layout/sections';

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

  // Workspace sharing is off, so 'link-workspace' has no tab and no body.
  // `activePanel` is restored from localStorage before the store knows that,
  // which is what these cover.
  it('reconciles a persisted activePanel that this build no longer shows', async () => {
    useWorkspaceStore.setState({ activePanel: 'link-workspace' });
    render(<App />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    await waitFor(() => {
      expect(useWorkspaceStore.getState().activePanel).toBe('editor');
    });
    // The user lands somewhere real rather than on a tab with no strip entry.
    expect(screen.queryByRole('button', { name: 'Link Workspace' })).not.toBeInTheDocument();
  });

  it('leaves an edition-contributed panel id alone', async () => {
    // `lens.discover` is not in VISIBLE_PANELS either, but it is not a CORE
    // panel — stomping it would break the edition whose section owns it. That
    // case belongs to the sections effect, not this one.
    const extraPanels: ExtraPanelDef[] = [
      {
        id: 'lens.discover',
        label: 'Index',
        icon: Compass,
        Panel: () => <div>Index panel</div>,
      },
    ];
    useWorkspaceStore.setState({ activePanel: 'lens.discover' });
    render(<App extraPanels={extraPanels} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover');
  });

  it('renders the first-run landing + mode toggle when sections are registered, and switches mode', async () => {
    localStorage.removeItem('apicircle:section-landing-done-v1');
    const sections: SectionDef[] = [
      {
        id: 'studio',
        label: 'Studio',
        icon: Compass,
        panelIds: [
          'workspace',
          'link-workspace',
          'editor',
          'env',
          'execution',
          'history',
          'mocks',
          'help',
        ],
      },
      {
        id: 'lens',
        label: 'Lens',
        icon: Server,
        description: 'Discover, review, build',
        panelIds: ['lens.discover'],
      },
    ];
    render(<App sections={sections} />);
    await waitFor(() => screen.getByText('API Circle Studio'));

    // First-run landing (>1 section) — one card per section.
    const dialog = screen.getByRole('dialog', { name: /Choose how you want to start/ });
    expect(within(dialog).getByText('Lens')).toBeInTheDocument();

    // Choose Lens → landing dismisses, mode switches, activePanel moves into Lens.
    await userEvent.click(within(dialog).getByText('Lens'));
    expect(
      screen.queryByRole('dialog', { name: /Choose how you want to start/ }),
    ).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover');

    // The always-present top toggle switches back to Studio (activePanel → first Studio panel).
    await userEvent.click(screen.getByRole('tab', { name: /^Studio$/ }));
    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
  });

  it('registers no landing or toggle in Studio (no sections — strict no-op)', async () => {
    localStorage.removeItem('apicircle:section-landing-done-v1');
    render(<App />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    expect(screen.queryByRole('dialog', { name: /Choose how you want to start/ })).toBeNull();
    expect(screen.queryByRole('tablist', { name: /Mode/ })).toBeNull();
  });

  it('leaves the active panel unchanged when switching to a section with no panels', async () => {
    // A section with empty panelIds → no first panel to move to → activePanel stays.
    localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
    const sections: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['editor'] },
      { id: 'empty', label: 'Empty', icon: Server, panelIds: [] },
    ];
    render(<App sections={sections} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    const before = useWorkspaceStore.getState().activePanel;
    await userEvent.click(screen.getByRole('tab', { name: /^Empty$/ }));
    expect(useWorkspaceStore.getState().activePanel).toBe(before);
  });

  it('cold-launches into the restored section, not a stale core panel', async () => {
    localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
    const sections: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['editor', 'workspace'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.discover', 'help'] },
    ];
    // First launch to learn the hydrated workspace id (the mode is persisted per id).
    const first = render(<App sections={sections} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    first.unmount();

    // Reproduce the real cold-launch state: Lens is the persisted mode, but the
    // globally-persisted active panel resolves to a core panel (readStoredPanel
    // can't hold a Lens panel id, so it falls back to 'editor').
    localStorage.setItem(`apicircle-v2:active-section:${wsId}`, 'lens');
    useWorkspaceStore.getState().setActivePanel('editor');

    render(<App sections={sections} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    // Restored into Lens mode → 'editor' isn't a Lens panel → land on Lens's
    // first panel instead of showing the Editor body under the Lens tab strip.
    await waitFor(() => expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover'));
  });

  // An edition opens panels straight through the store — Lens's "Send to Studio
  // Editor" calls `setActivePanel('editor')` while its own section is active — so
  // the Mode toggle has to follow the panel that is now on screen.
  describe('the mode follows the visible panel', () => {
    const SECTION_KEY = 'apicircle-v2:active-section:';
    // 'history' is deliberately in neither section.
    const sections: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace', 'editor'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.discover'] },
    ];
    const extraPanels: ExtraPanelDef[] = [
      {
        id: 'lens.discover',
        label: 'Index',
        icon: Compass,
        Panel: () => <div>INDEX PANEL BODY</div>,
      },
    ];

    function modeTab(name: RegExp): HTMLElement {
      return within(screen.getByRole('tablist', { name: /Mode/ })).getByRole('tab', { name });
    }

    /** Mounts the two-section shell past the landing and waits for the restored mode. */
    async function renderEdition(): Promise<string> {
      localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
      render(<App sections={sections} extraPanels={extraPanels} />);
      await waitFor(() => expect(modeTab(/^Studio$/)).toHaveAttribute('aria-selected', 'true'));
      return useWorkspaceStore.getState().synced!.workspaceId;
    }

    function openPanel(panel: string): void {
      act(() => {
        useWorkspaceStore.getState().setActivePanel(panel);
      });
    }

    /** Every `setItem` call that stored a section, ignoring the store's own panel writes. */
    function sectionWrites(setItem: { mock: { calls: string[][] } }): string[][] {
      return setItem.mock.calls.filter(([key]) => key.startsWith(SECTION_KEY));
    }

    it('opening the editor while the Lens section is active selects Studio and stores it', async () => {
      const wsId = await renderEdition();
      await userEvent.click(modeTab(/^Lens$/));
      expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover');

      openPanel('editor');

      expect(modeTab(/^Studio$/)).toHaveAttribute('aria-selected', 'true');
      expect(modeTab(/^Lens$/)).toHaveAttribute('aria-selected', 'false');
      expect(localStorage.getItem(`${SECTION_KEY}${wsId}`)).toBe('studio');
      // The strip shows the section that owns the visible panel...
      expect(screen.getByRole('button', { name: /^Editor$/ })).toBeInTheDocument();
      // ...and following it never moves the panel itself.
      expect(useWorkspaceStore.getState().activePanel).toBe('editor');
    });

    it('opening a Lens panel while the Studio section is active selects Lens', async () => {
      const wsId = await renderEdition();

      openPanel('lens.discover');

      expect(modeTab(/^Lens$/)).toHaveAttribute('aria-selected', 'true');
      expect(localStorage.getItem(`${SECTION_KEY}${wsId}`)).toBe('lens');
      expect(screen.getByText('INDEX PANEL BODY')).toBeInTheDocument();
      expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover');
    });

    it('a panel the active section already lists writes nothing', async () => {
      await renderEdition();
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      openPanel('workspace');

      expect(sectionWrites(setItem)).toEqual([]);
      expect(modeTab(/^Studio$/)).toHaveAttribute('aria-selected', 'true');
      expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
    });

    it('a panel listed in no section leaves the toggle alone', async () => {
      await renderEdition();
      await userEvent.click(modeTab(/^Lens$/));
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      openPanel('history');

      expect(modeTab(/^Lens$/)).toHaveAttribute('aria-selected', 'true');
      expect(sectionWrites(setItem)).toEqual([]);
      expect(useWorkspaceStore.getState().activePanel).toBe('history');
    });

    it('writes nothing without sections (Studio standalone)', async () => {
      render(<App />);
      await waitFor(() => screen.getByText('API Circle Studio'));
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      openPanel('history');

      expect(sectionWrites(setItem)).toEqual([]);
      expect(Object.keys(localStorage).filter((key) => key.startsWith(SECTION_KEY))).toEqual([]);
      expect(screen.queryByRole('tablist', { name: /Mode/ })).toBeNull();
      expect(useWorkspaceStore.getState().activePanel).toBe('history');
    });

    it('a cold launch into the stored section does not rewrite it', async () => {
      localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
      // The first launch only learns the hydrated workspace id (the mode is stored per id).
      const first = render(<App sections={sections} extraPanels={extraPanels} />);
      await waitFor(() => screen.getByText('API Circle Studio'));
      const wsId = useWorkspaceStore.getState().synced!.workspaceId;
      first.unmount();

      // Lens is the stored mode while the globally stored panel is a core one, so
      // the restore effect moves the panel into Lens as the shell mounts.
      localStorage.setItem(`${SECTION_KEY}${wsId}`, 'lens');
      useWorkspaceStore.getState().setActivePanel('editor');
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      render(<App sections={sections} extraPanels={extraPanels} />);
      await waitFor(() => expect(modeTab(/^Lens$/)).toHaveAttribute('aria-selected', 'true'));
      await waitFor(() => expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover'));

      expect(sectionWrites(setItem)).toEqual([]);
      expect(localStorage.getItem(`${SECTION_KEY}${wsId}`)).toBe('lens');
    });
  });
});
