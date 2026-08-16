import { act, screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { RightDock } from './RightDock';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';

const dock = () => screen.queryByRole('complementary', { name: 'Workspace inspector' });

describe('RightDock', () => {
  it('renders nothing when no inspector tab is open', async () => {
    await renderWithStore(<RightDock />);
    expect(dock()).toBeNull();
  });

  it('hides on an edition (non-core) panel even if a tab was left open in Studio mode', async () => {
    await renderWithStore(<RightDock />);
    // Open a tab while on a Studio core panel (the default 'editor')…
    act(() => {
      useWorkspaceStore.getState().toggleRightDockTab('variables');
    });
    expect(dock()).toBeInTheDocument();
    // …then switch to an edition panel (e.g. a Lens panel via extraPanels): the
    // persisted tab must not keep the workspace inspector visible where it doesn't apply.
    act(() => {
      useWorkspaceStore.setState({ activePanel: 'lens.discover' as never });
    });
    expect(dock()).toBeNull();
  });
});
