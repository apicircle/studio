import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { App } from './App';
import { useWorkspaceStore } from './store/workspaceStore';
import type { ExtraPanelDef } from './layout/extraPanels';
import { useSections, type SectionDef } from './layout/sections';

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

  it('keeps a restored panel this build does show', async () => {
    // The other half of the reconcile: only a panel with no tab is moved. A
    // user whose last tab was Mocks relaunches on Mocks, not on the Editor.
    useWorkspaceStore.setState({ activePanel: 'mocks' });
    render(<App />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    expect(useWorkspaceStore.getState().activePanel).toBe('mocks');
    expect(screen.getByRole('button', { name: /^Mocks$/ })).toHaveAttribute('aria-current', 'page');
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

  it('renders the first-run landing + mode groups when sections are registered, and switches mode', async () => {
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

    // The mode's header in the tab strip switches back to Studio, onto the panel
    // Studio was showing under the landing — not its first one.
    await userEvent.click(screen.getByRole('button', { name: /^Studio$/ }));
    expect(useWorkspaceStore.getState().activePanel).toBe('editor');
  });

  it('the first-run landing opens a mode at its first panel, not the one the shell restored', async () => {
    localStorage.removeItem('apicircle:section-landing-done-v1');
    const sections: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace', 'editor'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.discover'] },
    ];
    render(<App sections={sections} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    expect(useWorkspaceStore.getState().activePanel).toBe('editor');

    const dialog = screen.getByRole('dialog', { name: /Choose how you want to start/ });
    await userEvent.click(within(dialog).getByText('Studio'));

    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
  });

  it('renders an edition workspace status in the top bar', async () => {
    render(<App workspaceStatus={<span>ON BRANCH MAIN</span>} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    expect(screen.getByText('ON BRANCH MAIN')).toBeInTheDocument();
  });

  it('registers no landing or mode groups in Studio (no sections — strict no-op)', async () => {
    localStorage.removeItem('apicircle:section-landing-done-v1');
    render(<App />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    expect(screen.queryByRole('dialog', { name: /Choose how you want to start/ })).toBeNull();
    expect(document.querySelector('[data-section-toggle]')).toBeNull();
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
    await userEvent.click(screen.getByRole('button', { name: /^Empty$/ }));
    expect(useWorkspaceStore.getState().activePanel).toBe(before);
  });

  it('cold-launches into the restored section, not a stale core panel', async () => {
    localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
    const sections: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['editor', 'workspace'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.discover', 'help'] },
    ];
    const extraPanels: ExtraPanelDef[] = [
      { id: 'lens.discover', label: 'Index', icon: Compass, Panel: () => <div>Index panel</div> },
    ];
    // First launch to learn the hydrated workspace id (the mode is persisted per id).
    const first = render(<App sections={sections} extraPanels={extraPanels} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    first.unmount();

    // Reproduce the real cold-launch state: Lens is the persisted mode, but the
    // globally-persisted active panel resolves to a core panel (readStoredPanel
    // can't hold a Lens panel id, so it falls back to 'editor').
    localStorage.setItem(`apicircle-v2:active-section:${wsId}`, 'lens');
    useWorkspaceStore.getState().setActivePanel('editor');

    render(<App sections={sections} extraPanels={extraPanels} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    // Restored into Lens mode → 'editor' isn't a Lens panel → land on Lens's
    // first panel instead of showing the Editor body under the Lens tab strip.
    await waitFor(() => expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover'));
  });

  it('cold-launches a restored section onto the first of its panels the shell shows', async () => {
    // The edition lists a panel it has not contributed (yet): the launch lands on
    // the next one that has a body, not on a tab that is not in the strip.
    localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
    const sections: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['editor', 'workspace'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['lens.discover', 'help'] },
    ];
    const first = render(<App sections={sections} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    const wsId = useWorkspaceStore.getState().synced!.workspaceId;
    first.unmount();

    localStorage.setItem(`apicircle-v2:active-section:${wsId}`, 'lens');
    useWorkspaceStore.getState().setActivePanel('editor');

    render(<App sections={sections} />);
    await waitFor(() => screen.getByText('API Circle Studio'));
    await waitFor(() => expect(useWorkspaceStore.getState().activePanel).toBe('help'));
  });

  // An edition opens panels straight through the store — Lens's "Send to Studio
  // Editor" calls `setActivePanel('editor')` while its own section is active — so
  // the unfolded mode group has to follow the panel that is now on screen.
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

    /** A mode's header in the tab strip: unfolded (`aria-expanded`) while it is the active mode. */
    function modeTab(name: RegExp): HTMLElement {
      return within(screen.getByRole('navigation', { name: 'Top navigation' })).getByRole(
        'button',
        { name },
      );
    }

    /** Mounts the two-section shell past the landing and waits for the restored mode. */
    async function renderEdition(): Promise<string> {
      localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
      render(<App sections={sections} extraPanels={extraPanels} />);
      await waitFor(() => expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true'));
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

      expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true');
      expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'false');
      expect(localStorage.getItem(`${SECTION_KEY}${wsId}`)).toBe('studio');
      // The strip shows the section that owns the visible panel...
      expect(screen.getByRole('button', { name: /^Editor$/ })).toBeInTheDocument();
      // ...and following it never moves the panel itself.
      expect(useWorkspaceStore.getState().activePanel).toBe('editor');
    });

    it('opening a Lens panel while the Studio section is active selects Lens', async () => {
      const wsId = await renderEdition();

      openPanel('lens.discover');

      expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'true');
      expect(localStorage.getItem(`${SECTION_KEY}${wsId}`)).toBe('lens');
      expect(screen.getByText('INDEX PANEL BODY')).toBeInTheDocument();
      expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover');
    });

    it('a panel the active section already lists writes nothing', async () => {
      await renderEdition();
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      openPanel('workspace');

      expect(sectionWrites(setItem)).toEqual([]);
      expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true');
      expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
    });

    it('a panel listed in no section leaves the mode alone', async () => {
      await renderEdition();
      await userEvent.click(modeTab(/^Lens$/));
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      openPanel('history');

      expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'true');
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
      expect(document.querySelector('[data-section-toggle]')).toBeNull();
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
      await waitFor(() => expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'true'));
      await waitFor(() => expect(useWorkspaceStore.getState().activePanel).toBe('lens.discover'));

      expect(sectionWrites(setItem)).toEqual([]);
      expect(localStorage.getItem(`${SECTION_KEY}${wsId}`)).toBe('lens');
    });
  });

  // A mode switch used to open the mode's first panel every time, so a trip to
  // the other mode and back cost a second click to get back where you were.
  describe('each mode remembers the panel it was left on', () => {
    const SECTION_KEY = 'apicircle-v2:active-section:';
    const PANEL_KEY = 'apicircle-v2:section-panel:';
    // 'workspace' is listed by both modes; 'lens.gone' is listed with no panel behind it.
    const sections: SectionDef[] = [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace', 'editor', 'env'] },
      {
        id: 'lens',
        label: 'Lens',
        icon: Server,
        panelIds: ['lens.discover', 'lens.review', 'lens.gone', 'workspace'],
      },
    ];
    const extraPanels: ExtraPanelDef[] = [
      { id: 'lens.discover', label: 'Index', icon: Compass, Panel: () => <div>INDEX BODY</div> },
      { id: 'lens.review', label: 'Review', icon: Server, Panel: () => <div>REVIEW BODY</div> },
    ];

    /** A mode's header in the tab strip: unfolded (`aria-expanded`) while it is the active mode. */
    function modeTab(name: RegExp): HTMLElement {
      return within(screen.getByRole('navigation', { name: 'Top navigation' })).getByRole(
        'button',
        { name },
      );
    }

    const activePanel = () => useWorkspaceStore.getState().activePanel;

    function openPanel(panel: string): void {
      act(() => {
        useWorkspaceStore.getState().setActivePanel(panel);
      });
    }

    /** Mounts the two-mode shell past the landing, in Studio on the Editor. */
    async function renderEdition(maxWorkspaces = 1): Promise<string> {
      localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
      render(
        <App sections={sections} extraPanels={extraPanels} workspaceAccess={{ maxWorkspaces }} />,
      );
      await waitFor(() => expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true'));
      return useWorkspaceStore.getState().synced!.workspaceId;
    }

    it('switching modes returns to the panel each was left on', async () => {
      const wsId = await renderEdition();
      openPanel('env');

      await userEvent.click(modeTab(/^Lens$/));
      openPanel('lens.review');
      expect(screen.getByText('REVIEW BODY')).toBeInTheDocument();

      await userEvent.click(modeTab(/^Studio$/));
      expect(activePanel()).toBe('env');
      await userEvent.click(modeTab(/^Lens$/));
      expect(activePanel()).toBe('lens.review');

      expect(localStorage.getItem(`${PANEL_KEY}${wsId}:studio`)).toBe('env');
      expect(localStorage.getItem(`${PANEL_KEY}${wsId}:lens`)).toBe('lens.review');
    });

    it("folding the active mode's tabs moves neither the mode nor the panel", async () => {
      const wsId = await renderEdition();
      openPanel('env');
      const stored = () => ({
        mode: localStorage.getItem(`${SECTION_KEY}${wsId}`),
        studio: localStorage.getItem(`${PANEL_KEY}${wsId}:studio`),
        lens: localStorage.getItem(`${PANEL_KEY}${wsId}:lens`),
      });
      const before = stored();

      // The header of the mode on screen, pressed from one of its own tabs.
      await userEvent.click(modeTab(/^Studio$/));

      expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'false');
      expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'false');
      expect(activePanel()).toBe('env');
      expect(stored()).toEqual(before);

      // The next press brings the tabs back, around the same panel.
      await userEvent.click(modeTab(/^Studio$/));
      expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true');
      expect(activePanel()).toBe('env');
      expect(stored()).toEqual(before);
    });

    it('opens a mode at its first panel until it has been used', async () => {
      await renderEdition();
      await userEvent.click(modeTab(/^Lens$/));
      expect(activePanel()).toBe('lens.discover');
    });

    it('a section id nothing registered moves no panel', async () => {
      // Reached only through the seam, never the tab strip, which renders registered
      // sections alone. The panel on screen has to survive it.
      function ModeProbe() {
        const { setActiveSectionId } = useSections();
        return (
          <button type="button" onClick={() => setActiveSectionId('ghost')}>
            ENTER GHOST
          </button>
        );
      }
      localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
      render(
        <App
          sections={sections}
          extraPanels={[{ id: 'lens.discover', label: 'Index', icon: Compass, Panel: ModeProbe }]}
        />,
      );
      await waitFor(() => expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true'));
      await userEvent.click(modeTab(/^Lens$/));
      expect(activePanel()).toBe('lens.discover');

      await userEvent.click(screen.getByRole('button', { name: 'ENTER GHOST' }));

      expect(activePanel()).toBe('lens.discover');
    });

    it('clicking the mode already active keeps the panel on screen', async () => {
      await renderEdition();
      openPanel('env');
      await userEvent.click(modeTab(/^Studio$/));
      expect(activePanel()).toBe('env');
    });

    it("a panel both modes list is no mode's to remember", async () => {
      const wsId = await renderEdition();
      await userEvent.click(modeTab(/^Lens$/));
      const setItem = vi.spyOn(Storage.prototype, 'setItem');

      openPanel('workspace');

      // Lens lists it, so the mode does not follow it to Studio...
      expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'true');
      expect(setItem.mock.calls.filter(([key]) => key.startsWith(SECTION_KEY))).toEqual([]);
      // ...the strip still shows the Lens tabs beside it...
      expect(screen.getByRole('button', { name: /^Review$/ })).toBeInTheDocument();
      // ...and Lens still remembers the panel of its own it was on.
      expect(localStorage.getItem(`${PANEL_KEY}${wsId}:lens`)).toBe('lens.discover');

      // Studio was left on the Editor, and returns there rather than staying put.
      await userEvent.click(modeTab(/^Studio$/));
      expect(activePanel()).toBe('editor');
      // Lens returns to its own panel, not to the shared page it was showing.
      await userEvent.click(modeTab(/^Lens$/));
      expect(activePanel()).toBe('lens.discover');
      expect(localStorage.getItem(`${PANEL_KEY}${wsId}:studio`)).toBe('editor');
    });

    it('pressing the active mode from a shared panel opens the panel that mode was left on', async () => {
      await renderEdition();
      openPanel('env');
      openPanel('workspace');
      expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true');

      await userEvent.click(modeTab(/^Studio$/));

      expect(activePanel()).toBe('env');
    });

    it('opens a mode at the first panel of its own, never at a shared one', async () => {
      // Studio lists the shared Workspace page first. Entered from Lens with
      // nothing remembered, it opens on the Editor.
      const wsId = await renderEdition();
      await userEvent.click(modeTab(/^Lens$/));
      localStorage.removeItem(`${PANEL_KEY}${wsId}:studio`);

      await userEvent.click(modeTab(/^Studio$/));

      expect(activePanel()).toBe('editor');
    });

    it('a panel opened through the store is the panel shown, whatever its mode remembered', async () => {
      // An edition sending the user to the Editor (Lens's "Send to Studio
      // Editor") must land on the Editor, not on the Studio panel last open.
      const wsId = await renderEdition();
      openPanel('env');
      await userEvent.click(modeTab(/^Lens$/));
      expect(localStorage.getItem(`${PANEL_KEY}${wsId}:studio`)).toBe('env');

      openPanel('editor');

      expect(activePanel()).toBe('editor');
      expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: /^Editor$/ })).toHaveAttribute(
        'aria-current',
        'page',
      );
      // And the Editor is now where Studio was left.
      expect(localStorage.getItem(`${PANEL_KEY}${wsId}:studio`)).toBe('editor');
    });

    it('falls back to the first panel when the remembered one is no longer shown', async () => {
      const wsId = await renderEdition();
      // Remembered by an earlier session, when the edition still contributed it.
      localStorage.setItem(`${PANEL_KEY}${wsId}:lens`, 'lens.gone');

      await userEvent.click(modeTab(/^Lens$/));

      expect(activePanel()).toBe('lens.discover');
    });

    it('a cold launch into a mode restores the panel it was left on', async () => {
      localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
      // The first launch only learns the hydrated workspace id.
      const first = render(<App sections={sections} extraPanels={extraPanels} />);
      await waitFor(() => screen.getByText('API Circle Studio'));
      const wsId = useWorkspaceStore.getState().synced!.workspaceId;
      first.unmount();

      // Lens on Review is what the last session left. The globally stored panel
      // cannot hold an edition id, so the store comes back on a core panel.
      localStorage.setItem(`${SECTION_KEY}${wsId}`, 'lens');
      localStorage.setItem(`${PANEL_KEY}${wsId}:lens`, 'lens.review');
      useWorkspaceStore.getState().setActivePanel('editor');

      render(<App sections={sections} extraPanels={extraPanels} />);
      await waitFor(() => expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'true'));
      await waitFor(() => expect(activePanel()).toBe('lens.review'));
    });

    it('a workspace switch remembers nothing against the new workspace from the old mode', async () => {
      const wsA = await renderEdition(3);
      await userEvent.click(modeTab(/^Lens$/));
      openPanel('lens.review');

      await act(async () => {
        await useWorkspaceStore.getState().createNewWorkspace('Second', 3);
      });
      const wsB = useWorkspaceStore.getState().synced!.workspaceId;
      expect(wsB).not.toBe(wsA);

      // The new workspace has no stored mode, so it opens in Studio at the first
      // panel of its own.
      await waitFor(() => expect(modeTab(/^Studio$/)).toHaveAttribute('aria-expanded', 'true'));
      await waitFor(() => expect(activePanel()).toBe('editor'));
      // The render between the switch and that restore still carried the old
      // workspace's mode (Lens) with the Review panel on screen. Nothing of it
      // may be filed under the new workspace.
      expect(localStorage.getItem(`${PANEL_KEY}${wsB}:lens`)).toBeNull();
      expect(localStorage.getItem(`${PANEL_KEY}${wsB}:studio`)).toBe('editor');
      expect(localStorage.getItem(`${PANEL_KEY}${wsA}:lens`)).toBe('lens.review');
    });

    it('records nothing without sections (Studio standalone)', async () => {
      render(<App />);
      await waitFor(() => screen.getByText('API Circle Studio'));

      openPanel('history');

      expect(Object.keys(localStorage).filter((key) => key.startsWith(PANEL_KEY))).toEqual([]);
    });

    // An edition may contribute a panel only once its account has loaded, which
    // can be after the launch restore ran. Without this the one tab that arrives
    // late would be the one tab a relaunch never returns to.
    describe('a remembered panel the edition contributes only after launch', () => {
      const withoutReview = extraPanels.filter((p) => p.id !== 'lens.review');

      /** Cold-launches into Lens with Review remembered but not contributed yet. */
      async function launchBeforeReviewArrives() {
        localStorage.setItem('apicircle:section-landing-done-v1', 'true'); // skip the landing
        const first = render(<App sections={sections} extraPanels={withoutReview} />);
        await waitFor(() => screen.getByText('API Circle Studio'));
        const wsId = useWorkspaceStore.getState().synced!.workspaceId;
        first.unmount();

        localStorage.setItem(`${SECTION_KEY}${wsId}`, 'lens');
        localStorage.setItem(`${PANEL_KEY}${wsId}:lens`, 'lens.review');
        useWorkspaceStore.getState().setActivePanel('editor');

        const view = render(<App sections={sections} extraPanels={withoutReview} />);
        // Review is not there to land on, so the launch falls back to the first Lens panel.
        await waitFor(() => expect(activePanel()).toBe('lens.discover'));
        return view;
      }

      /** Lets a re-render's effects run, for the cases asserting that nothing moved. */
      const settle = () => act(async () => {});

      it('is restored once it arrives, while the user is still where the launch left them', async () => {
        const view = await launchBeforeReviewArrives();

        view.rerender(<App sections={sections} extraPanels={extraPanels} />);

        await waitFor(() => expect(activePanel()).toBe('lens.review'));
        expect(screen.getByText('REVIEW BODY')).toBeInTheDocument();
      });

      it('waits through a panel change that does not bring it', async () => {
        const view = await launchBeforeReviewArrives();

        view.rerender(<App sections={sections} extraPanels={[...withoutReview]} />);
        await settle();
        expect(activePanel()).toBe('lens.discover');

        view.rerender(<App sections={sections} extraPanels={extraPanels} />);
        await waitFor(() => expect(activePanel()).toBe('lens.review'));
      });

      it('is not restored once the user has opened another panel, even back on the fallback', async () => {
        const view = await launchBeforeReviewArrives();
        openPanel('workspace');
        openPanel('lens.discover');

        view.rerender(<App sections={sections} extraPanels={extraPanels} />);
        await settle();

        expect(activePanel()).toBe('lens.discover');
      });

      it('is not restored after an explicit mode switch', async () => {
        const view = await launchBeforeReviewArrives();
        // Out to Studio and back: Lens is now where the user opened it, by hand.
        await userEvent.click(modeTab(/^Studio$/));
        await userEvent.click(modeTab(/^Lens$/));
        expect(activePanel()).toBe('lens.discover');

        view.rerender(<App sections={sections} extraPanels={extraPanels} />);
        await settle();

        expect(activePanel()).toBe('lens.discover');
      });

      it('is still restored after the tabs were folded away, which is not a move', async () => {
        const view = await launchBeforeReviewArrives();
        // The active mode's header, from one of its own tabs: the strip folds
        // and the user is still exactly where the launch left them.
        await userEvent.click(modeTab(/^Lens$/));
        expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'false');
        expect(activePanel()).toBe('lens.discover');

        view.rerender(<App sections={sections} extraPanels={extraPanels} />);

        await waitFor(() => expect(activePanel()).toBe('lens.review'));
        // And the strip opens again around the tab the restore landed on.
        expect(modeTab(/^Lens$/)).toHaveAttribute('aria-expanded', 'true');
        expect(
          within(screen.getByRole('navigation', { name: 'Top navigation' })).getByRole('button', {
            name: 'Review',
          }),
        ).toHaveAttribute('aria-current', 'page');
      });

      it('restores at most once', async () => {
        const view = await launchBeforeReviewArrives();
        view.rerender(<App sections={sections} extraPanels={extraPanels} />);
        await waitFor(() => expect(activePanel()).toBe('lens.review'));

        // The user goes back to the fallback; a later change to the panel list
        // must not pull them to Review a second time.
        openPanel('lens.discover');
        view.rerender(<App sections={sections} extraPanels={[...extraPanels]} />);
        await settle();

        expect(activePanel()).toBe('lens.discover');
      });
    });
  });

  describe('background refresh and locked Git hosts (gitHostAccess)', () => {
    // The focus / cold-launch refresh pulls the working branch from its host.
    // Nothing runs against a locked host in the background — and because an
    // edition's policy can arrive after hydration, the cold-launch refresh must
    // still happen the moment the host unlocks.
    function seedBranchOn(host: 'github' | 'gitlab', refreshWorkspace: () => Promise<never>): void {
      act(() => {
        const local = useWorkspaceStore.getState().local!;
        useWorkspaceStore.setState({
          refreshWorkspace,
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
            workingBranch: {
              name: 'apicircle/payments-a3f9c2',
              baseBranch: 'main',
              repoFullName: 'acme/api',
              repoOwner: 'acme',
              repoName: 'api',
              headSha: 'abc123',
              createdAt: '2026-09-01T00:00:00.000Z',
              lastPushedSha: null,
              diffSummary: null,
              openPrUrl: null,
              hostKind: host,
            },
          },
        });
      });
    }

    // Never settles: the in-flight guard then holds every later trigger off,
    // so each count below is exactly the number of refreshes the hook started.
    const pending = () => vi.fn(() => new Promise<never>(() => {}));

    it('refreshes a working branch once on launch when nothing is locked', async () => {
      render(<App />);
      await waitFor(() => screen.getByText('API Circle Studio'));
      const refreshWorkspace = pending();
      seedBranchOn('gitlab', refreshWorkspace);
      expect(refreshWorkspace).toHaveBeenCalledTimes(1);
    });

    it('never refreshes a branch on a locked host, then refreshes once it unlocks', async () => {
      const view = render(<App gitHostAccess={{ lockedHosts: ['gitlab'] }} />);
      await waitFor(() => screen.getByText('API Circle Studio'));
      const refreshWorkspace = pending();
      seedBranchOn('gitlab', refreshWorkspace);
      act(() => {
        window.dispatchEvent(new Event('focus'));
        document.dispatchEvent(new Event('visibilitychange'));
      });
      expect(refreshWorkspace).not.toHaveBeenCalled();

      // The policy changes (an entitlement finished loading, say). The skipped
      // probes started no debounce, so the cold-launch refresh runs now.
      view.rerender(<App gitHostAccess={{ lockedHosts: [] }} />);
      expect(refreshWorkspace).toHaveBeenCalledTimes(1);
    });

    it('still refreshes a GitHub branch while other hosts are locked', async () => {
      render(<App gitHostAccess={{ lockedHosts: ['gitlab', 'bitbucket', 'azure-devops'] }} />);
      await waitFor(() => screen.getByText('API Circle Studio'));
      const refreshWorkspace = pending();
      seedBranchOn('github', refreshWorkspace);
      expect(refreshWorkspace).toHaveBeenCalledTimes(1);
    });
  });
});
