import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { Sidebar } from './Sidebar';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';

describe('Sidebar', () => {
  it('renders the active panel header for sidebar-bearing panels', async () => {
    await renderWithStore(<Sidebar />);
    // Default panel is 'editor'.
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByText('Editor')).toBeInTheDocument();
  });

  it('renders the help panel sidebar after the minor-fixes pass', async () => {
    await renderWithStore(<Sidebar />);
    act(() => useWorkspaceStore.getState().setActivePanel('help'));
    expect(screen.getByRole('complementary')).toBeInTheDocument();
    expect(screen.getByText('Help Center')).toBeInTheDocument();
  });

  it('switches header label when panel changes', async () => {
    await renderWithStore(<Sidebar />);
    act(() => useWorkspaceStore.getState().setActivePanel('workspace'));
    expect(screen.getByText('Workspace')).toBeInTheDocument();
  });
});
