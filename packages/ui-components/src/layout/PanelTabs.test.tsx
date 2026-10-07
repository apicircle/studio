import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
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

describe('PanelTabs with sections', () => {
  const value: SectionsContextValue = {
    sections: [
      { id: 'studio', label: 'Studio', icon: Compass, panelIds: ['workspace', 'editor', 'mocks'] },
      { id: 'lens', label: 'Lens', icon: Server, panelIds: ['history'] },
    ],
    activeSectionId: 'studio',
    setActiveSectionId: () => {},
  };

  it("shows only the active section's panels", async () => {
    await renderWithStore(
      <SectionsProvider value={value}>
        <PanelTabs />
      </SectionsProvider>,
    );
    const labels = screen.getAllByRole('button').map((t) => t.textContent);
    expect(labels).toEqual(['Workspace', 'Editor', 'Mocks']);
    expect(labels).not.toContain('History');
  });

  it('shows the other section when it is active', async () => {
    await renderWithStore(
      <SectionsProvider value={{ ...value, activeSectionId: 'lens' }}>
        <PanelTabs />
      </SectionsProvider>,
    );
    expect(screen.getAllByRole('button').map((t) => t.textContent)).toEqual(['History']);
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

    /** The strip as text, with `|` where a divider sits. */
    function strip(container: HTMLElement): string[] {
      return [...container.querySelectorAll('nav > *')].map((el) =>
        el.hasAttribute('data-tab-divider') ? '|' : (el.textContent ?? ''),
      );
    }

    it('stays in the strip in both modes, in its own position, set off by a divider', async () => {
      const studio = await renderWithStore(
        <SectionsProvider value={shared}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(strip(studio.container)).toEqual(['Workspace', '|', 'Editor']);
      studio.unmount();

      // The strip follows the shell's panel order, not the section's own list,
      // so the shared tab keeps the slot it has in the other mode.
      const lens = await renderWithStore(
        <SectionsProvider value={{ ...shared, activeSectionId: 'lens' }}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(strip(lens.container)).toEqual(['Workspace', '|', 'History']);
    });

    it('hides the divider from assistive technology', async () => {
      const { container } = await renderWithStore(
        <SectionsProvider value={shared}>
          <PanelTabs />
        </SectionsProvider>,
      );
      expect(container.querySelector('[data-tab-divider]')).toHaveAttribute('aria-hidden', 'true');
    });

    it('renders no divider after a shared tab that ends the strip', async () => {
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
      expect(strip(container)).toEqual(['Workspace']);
    });
  });
});
