import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { PanelTabs } from './PanelTabs';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';

describe('PanelTabs', () => {
  it('renders 7 tabs (no Settings, no Commands)', async () => {
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
