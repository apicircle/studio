import { act, fireEvent, screen } from '@testing-library/react';
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

  it('as an overlay, closes on a press outside it but not on a toast or a dialog', async () => {
    await renderWithStore(
      <>
        <RightDock />
        <div data-toast-viewport="">
          <button type="button">Dismiss</button>
        </div>
        <div role="dialog">
          <button type="button">Inside a dialog</button>
        </div>
        <button type="button">Elsewhere</button>
      </>,
    );
    act(() => {
      useWorkspaceStore.getState().setRightDockMode('overlay');
      useWorkspaceStore.getState().toggleRightDockTab('assets');
    });
    // The listener is attached a tick after opening.
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
    });
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Dismiss' }));
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Inside a dialog' }));
    expect(dock()).toBeInTheDocument();
    fireEvent.pointerDown(screen.getByRole('button', { name: 'Elsewhere' }));
    expect(dock()).toBeNull();
  });
});
