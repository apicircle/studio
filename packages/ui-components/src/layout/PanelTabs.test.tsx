import { act, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { PanelTabs } from './PanelTabs';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SectionsProvider, type SectionsContextValue } from './sections';

describe('PanelTabs', () => {
  it('renders the agreed tab set (no Settings, no Commands, no Link Workspace, no Help)', async () => {
    await renderWithStore(<PanelTabs />);
    const tabs = screen.getAllByRole('button');
    const labels = tabs.map((t) => t.textContent);
    // Link Workspace sits between Workspace and Editor in the registry but is
    // filtered out of the strip: the sharing cluster doesn't ship in v1.
    expect(labels).toEqual([
      'Workspace',
      'Editor',
      'Environments',
      'Execution',
      'History',
      'Mocks',
    ]);
    expect(labels).not.toContain('Link Workspace');
    // The Help Center is opened from the top bar.
    expect(labels).not.toContain('Help Center');
  });

  it('marks no tab current while a top-bar panel is on screen', async () => {
    await renderWithStore(<PanelTabs />);
    act(() => useWorkspaceStore.getState().setActivePanel('help'));
    for (const tab of screen.getAllByRole('button')) {
      expect(tab).not.toHaveAttribute('aria-current');
    }
  });

  it('marks the active tab with aria-current="page"', async () => {
    await renderWithStore(<PanelTabs />);
    // Default is 'editor' per the store default.
    expect(screen.getByRole('button', { name: /Editor/ })).toHaveAttribute('aria-current', 'page');
  });

  it('switches active panel on click', async () => {
    await renderWithStore(<PanelTabs />);
    await userEvent.click(screen.getByRole('button', { name: /^Workspace$/ }));
    expect(useWorkspaceStore.getState().activePanel).toBe('workspace');
  });
});

describe('PanelTabs with one section', () => {
  it("stays one flat run of that section's tabs, with no mode header", async () => {
    const { container } = await renderWithStore(
      <SectionsProvider
        value={{
          sections: [
            { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace', 'editor'] },
          ],
          activeSectionId: 'studio',
          setActiveSectionId: () => {},
        }}
      >
        <PanelTabs />
      </SectionsProvider>,
    );
    expect(screen.getAllByRole('button').map((t) => t.textContent)).toEqual([
      'Workspace',
      'Editor',
    ]);
    expect(container.querySelector('[data-section-toggle]')).toBeNull();
    expect(container.querySelector('[data-tab-divider]')).toBeNull();
  });
});

describe('PanelTabs with sections', () => {
  const value: SectionsContextValue = {
    sections: [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace', 'editor', 'mocks'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['history'] },
    ],
    activeSectionId: 'studio',
    setActiveSectionId: () => {},
  };

  /** The strip left to right as text, with `|` where the divider sits. */
  function strip(container: HTMLElement): string[] {
    return [...container.querySelectorAll('nav button, nav [data-tab-divider]')].map((el) =>
      el.hasAttribute('data-tab-divider') ? '|' : (el.textContent ?? ''),
    );
  }

  const header = (name: string) => screen.getByRole('button', { name });

  it('unfolds the active mode to its own tabs and folds the other to its header', async () => {
    const { container } = await renderWithStore(
      <SectionsProvider value={value}>
        <PanelTabs />
      </SectionsProvider>,
    );
    expect(strip(container)).toEqual(['Studio', 'Workspace', 'Editor', 'Mocks', 'Lens']);
    expect(header('Studio')).toHaveAttribute('aria-expanded', 'true');
    expect(header('Lens')).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByRole('button', { name: 'History' })).toBeNull();
  });

  it('unfolds the other mode, in the same line, when it is the active one', async () => {
    const { container } = await renderWithStore(
      <SectionsProvider value={{ ...value, activeSectionId: 'lens' }}>
        <PanelTabs />
      </SectionsProvider>,
    );
    expect(strip(container)).toEqual(['Studio', 'Lens', 'History']);
    expect(header('Studio')).toHaveAttribute('aria-expanded', 'false');
    expect(header('Lens')).toHaveAttribute('aria-expanded', 'true');
  });

  it('keeps a folded mode in reach when the strip is too narrow for the unfolded one', async () => {
    const { container } = await renderWithStore(
      <SectionsProvider value={value}>
        <PanelTabs />
      </SectionsProvider>,
    );
    const group = (id: string) => container.querySelector(`[data-section-group="${id}"]`);
    // The strip scrolls sideways when it does not fit. The folded mode's header
    // pins to the edge it would otherwise scroll past, over the tabs behind it;
    // the unfolded run scrolls with the strip.
    expect(group('lens')).toHaveClass('sticky', 'left-0', 'right-0', 'bg-card', 'z-10');
    expect(group('studio')).not.toHaveClass('sticky');
  });

  it('unfolds the first mode for a mode id nothing registered', async () => {
    await renderWithStore(
      <SectionsProvider value={{ ...value, activeSectionId: 'ghost' }}>
        <PanelTabs />
      </SectionsProvider>,
    );
    expect(header('Studio')).toHaveAttribute('aria-expanded', 'true');
    expect(header('Lens')).toHaveAttribute('aria-expanded', 'false');
  });

  it("opens another mode when its header is pressed, and leaves this one's tabs alone", async () => {
    const setActiveSectionId = vi.fn();
    const { container } = await renderWithStore(
      <SectionsProvider value={{ ...value, setActiveSectionId }}>
        <PanelTabs />
      </SectionsProvider>,
    );
    await userEvent.click(header('Lens'));
    expect(setActiveSectionId).toHaveBeenCalledTimes(1);
    expect(setActiveSectionId).toHaveBeenLastCalledWith('lens');
    // Opening is App's move to make: until the mode changes the strip is as it was.
    expect(strip(container)).toEqual(['Studio', 'Workspace', 'Editor', 'Mocks', 'Lens']);
    // A header opens a mode; with a tab on screen it is never itself the page.
    expect(header('Studio')).not.toHaveAttribute('aria-current');
    expect(header('Lens')).not.toHaveAttribute('aria-current');
  });

  describe("the active mode's header", () => {
    const chevron = (name: string) => header(name).querySelector('[data-section-chevron]');

    it('folds its tabs away on a press from one of its own, and moves nothing else', async () => {
      const setActiveSectionId = vi.fn();
      const { container } = await renderWithStore(
        <SectionsProvider value={{ ...value, setActiveSectionId }}>
          <PanelTabs />
        </SectionsProvider>,
      );
      // Default is 'editor' per the store default: one of Studio's own tabs.
      await userEvent.click(header('Studio'));

      expect(strip(container)).toEqual(['Studio', 'Lens']);
      expect(header('Studio')).toHaveAttribute('aria-expanded', 'false');
      expect(header('Studio')).not.toHaveAttribute('aria-controls');
      expect(screen.queryByRole('group')).toBeNull();
      // Folding is not navigation: the mode and the panel on screen stay put.
      expect(setActiveSectionId).not.toHaveBeenCalled();
      expect(useWorkspaceStore.getState().activePanel).toBe('editor');
      // With its tab out of sight the header is what marks the page on screen.
      expect(header('Studio')).toHaveAttribute('aria-current', 'true');
      expect(header('Lens')).not.toHaveAttribute('aria-current');
      // A header alone is pinned in reach, whichever mode it belongs to.
      expect(container.querySelector('[data-section-group="studio"]')).toHaveClass('sticky');
    });

    it('brings the tabs back on the next press', async () => {
      const setActiveSectionId = vi.fn();
      const { container } = await renderWithStore(
        <SectionsProvider value={{ ...value, setActiveSectionId }}>
          <PanelTabs />
        </SectionsProvider>,
      );
      await userEvent.click(header('Studio'));
      await userEvent.click(header('Studio'));

      expect(strip(container)).toEqual(['Studio', 'Workspace', 'Editor', 'Mocks', 'Lens']);
      expect(header('Studio')).toHaveAttribute('aria-expanded', 'true');
      expect(header('Studio')).not.toHaveAttribute('aria-current');
      expect(screen.getByRole('button', { name: 'Editor' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(setActiveSectionId).not.toHaveBeenCalled();
    });

    it('shows the tabs again when another panel opens, and stays open on the way back', async () => {
      const { container } = await renderWithStore(
        <SectionsProvider value={value}>
          <PanelTabs />
        </SectionsProvider>,
      );
      await userEvent.click(header('Studio'));
      expect(strip(container)).toEqual(['Studio', 'Lens']);

      // Opened some other way than a tab: a shortcut, or a link inside a panel.
      act(() => useWorkspaceStore.getState().setActivePanel('mocks'));
      expect(strip(container)).toEqual(['Studio', 'Workspace', 'Editor', 'Mocks', 'Lens']);
      expect(screen.getByRole('button', { name: 'Mocks' })).toHaveAttribute('aria-current', 'page');

      // The fold belonged to that visit; returning to the panel does not repeat it.
      act(() => useWorkspaceStore.getState().setActivePanel('editor'));
      expect(strip(container)).toEqual(['Studio', 'Workspace', 'Editor', 'Mocks', 'Lens']);
      expect(header('Studio')).toHaveAttribute('aria-expanded', 'true');
    });

    it('shows the tabs again when the mode changes, and stays open on the way back', async () => {
      const tree = (activeSectionId: string) => (
        <SectionsProvider value={{ ...value, activeSectionId }}>
          <PanelTabs />
        </SectionsProvider>
      );
      const { container, rerender } = await renderWithStore(tree('studio'));
      await userEvent.click(header('Studio'));
      expect(strip(container)).toEqual(['Studio', 'Lens']);

      rerender(tree('lens'));
      expect(strip(container)).toEqual(['Studio', 'Lens', 'History']);
      expect(header('Lens')).toHaveAttribute('aria-expanded', 'true');

      rerender(tree('studio'));
      expect(strip(container)).toEqual(['Studio', 'Workspace', 'Editor', 'Mocks', 'Lens']);
    });

    it('points its chevron left over its tabs and right once they are folded', async () => {
      await renderWithStore(
        <SectionsProvider value={value}>
          <PanelTabs />
        </SectionsProvider>,
      );
      // One icon that turns, not two that swap: the turn is what gets animated.
      expect(chevron('Studio')).toHaveClass('lucide-chevron-right', 'rotate-180');
      expect(chevron('Lens')).toHaveClass('lucide-chevron-right');
      expect(chevron('Lens')).not.toHaveClass('rotate-180');
      // Decoration: the state is the button's own `aria-expanded`.
      expect(chevron('Studio')).toHaveAttribute('aria-hidden', 'true');

      await userEvent.click(header('Studio'));
      expect(chevron('Studio')).not.toHaveClass('rotate-180');
    });

    it('holds the turn and the reveal still for a reader who asked for less motion', async () => {
      await renderWithStore(
        <SectionsProvider value={value}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(chevron('Studio')).toHaveClass(
        'transition-transform',
        'motion-reduce:transition-none',
      );
      expect(screen.getByRole('group', { name: 'Studio panels' })).toHaveClass(
        'transition-[grid-template-columns,opacity]',
        'motion-reduce:transition-none',
      );
    });

    it('says what a press will do, in each state', async () => {
      await renderWithStore(
        <SectionsProvider value={value}>
          <PanelTabs />
        </SectionsProvider>,
      );
      await userEvent.hover(header('Studio'));
      expect(header('Studio')).toHaveAccessibleDescription('Hide Studio tabs');
      await userEvent.hover(header('Lens'));
      expect(header('Lens')).toHaveAccessibleDescription('Open Lens');

      await userEvent.click(header('Studio'));
      await userEvent.hover(header('Studio'));
      expect(header('Studio')).toHaveAccessibleDescription('Show Studio tabs');
      // The hint describes the header; its name is still the mode's alone.
      expect(header('Studio')).toHaveAccessibleName('Studio');
    });

    it('is drawn as a button whether its tabs are showing, folded, or another mode is', async () => {
      await renderWithStore(
        <SectionsProvider value={value}>
          <PanelTabs />
        </SectionsProvider>,
      );
      // Unfolded: a neutral handle, so the accent stays with the tab on screen.
      expect(header('Studio')).toHaveClass('border', 'border-border-strong', 'bg-card');
      expect(header('Studio')).not.toHaveClass('bg-accent/15');
      // Another mode: the same outline, on the ordinary button fill.
      expect(header('Lens')).toHaveClass('border', 'border-border-strong', 'bg-surface');

      await userEvent.click(header('Studio'));
      // Folded over the page on screen: the accent that page's tab would carry.
      expect(header('Studio')).toHaveClass('border', 'border-accent/40', 'bg-accent/15');
      expect(header('Studio')).not.toHaveClass('border-border-strong');
    });
  });

  it("names the unfolded mode's tabs as one group the header controls", async () => {
    await renderWithStore(
      <SectionsProvider
        value={{
          ...value,
          sections: [
            { id: 'ed.studio', label: 'Studio', icon: Compass, panelIds: ['editor', 'mocks'] },
            { id: 'ed.lens', label: 'Lens', icon: Server, panelIds: ['history'] },
          ],
          activeSectionId: 'ed.studio',
        }}
      >
        <PanelTabs />
      </SectionsProvider>,
    );
    const group = screen.getByRole('group', { name: 'Studio panels' });
    expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual([
      'Editor',
      'Mocks',
    ]);
    // An id is a valid target whatever characters the section's id carries.
    expect(group.id).toBe('panel-tabs-section-ed-studio');
    expect(header('Studio')).toHaveAttribute('aria-controls', group.id);
    // A folded mode has nothing on screen to point at.
    expect(header('Lens')).not.toHaveAttribute('aria-controls');
    expect(screen.queryByRole('group', { name: 'Lens panels' })).toBeNull();
  });

  it('marks the tab on screen inside its group, and switches panel on click', async () => {
    await renderWithStore(
      <SectionsProvider value={value}>
        <PanelTabs />
      </SectionsProvider>,
    );
    // Default is 'editor' per the store default.
    expect(screen.getByRole('button', { name: 'Editor' })).toHaveAttribute('aria-current', 'page');
    await userEvent.click(screen.getByRole('button', { name: 'Mocks' }));
    expect(useWorkspaceStore.getState().activePanel).toBe('mocks');
  });

  it('renders no divider when no panel is shared between sections', async () => {
    const { container } = await renderWithStore(
      <SectionsProvider value={value}>
        <PanelTabs />
      </SectionsProvider>,
    );
    expect(container.querySelector('[data-tab-divider]')).toBeNull();
  });

  describe('a panel listed by both sections', () => {
    const shared: SectionsContextValue = {
      ...value,
      sections: [
        { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace', 'editor'] },
        { id: 'lens', label: 'Lens', icon: Server, panelIds: ['history', 'workspace'] },
      ],
    };

    it('sits ahead of the mode groups in both modes, set off by a divider', async () => {
      const studio = await renderWithStore(
        <SectionsProvider value={shared}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(strip(studio.container)).toEqual(['Workspace', '|', 'Studio', 'Editor', 'Lens']);
      studio.unmount();

      // It belongs to neither group, so it keeps its slot when the mode changes.
      const lens = await renderWithStore(
        <SectionsProvider value={{ ...shared, activeSectionId: 'lens' }}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(strip(lens.container)).toEqual(['Workspace', '|', 'Studio', 'Lens', 'History']);
    });

    it("is no group's tab: neither mode lists it among its own", async () => {
      await renderWithStore(
        <SectionsProvider value={shared}>
          <PanelTabs />
        </SectionsProvider>,
      );
      const group = screen.getByRole('group', { name: 'Studio panels' });
      expect([...group.querySelectorAll('button')].map((b) => b.textContent)).toEqual(['Editor']);
    });

    it('leaves the active mode unfolded while it is the panel on screen', async () => {
      useWorkspaceStore.getState().setActivePanel('workspace');
      await renderWithStore(
        <SectionsProvider value={{ ...shared, activeSectionId: 'lens' }}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(screen.getByRole('button', { name: 'Workspace' })).toHaveAttribute(
        'aria-current',
        'page',
      );
      expect(header('Lens')).toHaveAttribute('aria-expanded', 'true');
      expect(screen.getByRole('button', { name: 'History' })).not.toHaveAttribute('aria-current');
    });

    it('opens the active mode from the shared page, where a press folds nothing', async () => {
      useWorkspaceStore.getState().setActivePanel('workspace');
      const setActiveSectionId = vi.fn();
      const { container } = await renderWithStore(
        <SectionsProvider value={{ ...shared, setActiveSectionId }}>
          <PanelTabs />
        </SectionsProvider>,
      );
      await userEvent.hover(header('Studio'));
      expect(header('Studio')).toHaveAccessibleDescription('Open Studio');

      await userEvent.click(header('Studio'));
      // The shared page is no tab of Studio's: the press goes to Studio itself,
      // and App lands it on the panel Studio was left on.
      expect(setActiveSectionId).toHaveBeenCalledTimes(1);
      expect(setActiveSectionId).toHaveBeenLastCalledWith('studio');
      expect(strip(container)).toEqual(['Workspace', '|', 'Studio', 'Editor', 'Lens']);
      expect(header('Studio')).toHaveAttribute('aria-expanded', 'true');
    });

    it('hides the divider from assistive technology', async () => {
      const { container } = await renderWithStore(
        <SectionsProvider value={shared}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(container.querySelector('[data-tab-divider]')).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders a mode with no tabs of its own as its header alone', async () => {
      const onlyShared: SectionsContextValue = {
        ...shared,
        sections: [
          { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace'] },
          { id: 'lens', label: 'Lens', icon: Server, panelIds: ['workspace'] },
        ],
      };
      const setActiveSectionId = vi.fn();
      const { container } = await renderWithStore(
        <SectionsProvider value={{ ...onlyShared, setActiveSectionId }}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(strip(container)).toEqual(['Workspace', '|', 'Studio', 'Lens']);
      // Unfolded, with nothing to show: no empty group, and nothing to control.
      expect(header('Studio')).toHaveAttribute('aria-expanded', 'true');
      expect(header('Studio')).not.toHaveAttribute('aria-controls');
      expect(screen.queryByRole('group')).toBeNull();
      // The header is all there is of the mode on screen, so it carries the mark,
      // and its chevron never turns to tabs that are not there.
      expect(header('Studio')).toHaveAttribute('aria-current', 'true');
      expect(header('Studio').querySelector('[data-section-chevron]')).not.toHaveClass(
        'rotate-180',
      );

      // With no tabs to fold, a press is still "open this mode".
      await userEvent.click(header('Studio'));
      expect(setActiveSectionId).toHaveBeenLastCalledWith('studio');
      expect(header('Studio')).toHaveAttribute('aria-expanded', 'true');
    });
  });
});
