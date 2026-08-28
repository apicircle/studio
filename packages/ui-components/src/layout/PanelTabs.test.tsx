import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { Compass, Server } from 'lucide-react';
import { PanelTabs } from './PanelTabs';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';
import { SectionsProvider, type SectionsContextValue } from './sections';

describe('PanelTabs', () => {
  it('renders the agreed tab set (no Settings, no Commands)', async () => {
    await renderWithStore(<PanelTabs />);
    const tabs = screen.getAllByRole('button');
    const labels = tabs.map((t) => t.textContent);
    expect(labels).toEqual([
      'Workspace',
      'Link Workspace',
      'Editor',
      'Environments',
      'Execution',
      'History',
      'Mocks',
      'Help Center',
    ]);
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
});
