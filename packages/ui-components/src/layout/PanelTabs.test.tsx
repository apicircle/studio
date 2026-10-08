import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { PanelTabs } from './PanelTabs';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SectionsProvider, type SectionsContextValue } from './sections';

describe('PanelTabs', () => {
  it('renders the agreed tab set (no Settings, no Commands, no Link Workspace)', async () => {
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
      'Help Center',
    ]);
    expect(labels).not.toContain('Link Workspace');
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

  it('opens a mode when its header is pressed, the active one included', async () => {
    const setActiveSectionId = vi.fn();
    await renderWithStore(
      <SectionsProvider value={{ ...value, setActiveSectionId }}>
        <PanelTabs />
      </SectionsProvider>,
    );
    await userEvent.click(header('Lens'));
    expect(setActiveSectionId).toHaveBeenLastCalledWith('lens');
    await userEvent.click(header('Studio'));
    expect(setActiveSectionId).toHaveBeenLastCalledWith('studio');
    // A header opens a mode; it is never itself the panel on screen.
    expect(header('Studio')).not.toHaveAttribute('aria-current');
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
      const { container } = await renderWithStore(
        <SectionsProvider value={onlyShared}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(strip(container)).toEqual(['Workspace', '|', 'Studio', 'Lens']);
      // Unfolded, with nothing to show: no empty group, and nothing to control.
      expect(header('Studio')).toHaveAttribute('aria-expanded', 'true');
      expect(header('Studio')).not.toHaveAttribute('aria-controls');
      expect(screen.queryByRole('group')).toBeNull();
    });
  });
});
