import { beforeEach, describe, expect, it } from 'vitest';
import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { FontPicker } from './FontPicker';
import { useWorkspaceStore } from '../store/workspaceStore';
import { renderWithStore } from '../../test/renderWithStore';

beforeEach(() => {
  document.documentElement.removeAttribute('data-font');
  document.documentElement.style.removeProperty('--app-font');
  document.head.querySelectorAll('link[data-apicircle-font]').forEach((el) => el.remove());
});

describe('FontPicker', () => {
  it('opens the dropdown on click', async () => {
    await renderWithStore(<FontPicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose font family/ }));
    expect(screen.getByRole('listbox', { name: /Font families/ })).toBeInTheDocument();
  });

  it('groups Monospace and Sans-serif sections', async () => {
    await renderWithStore(<FontPicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose font family/ }));
    expect(screen.getByText('Monospace')).toBeInTheDocument();
    expect(screen.getByText('Sans-serif')).toBeInTheDocument();
  });

  it('writes the choice to local.ui.fontId and updates the trigger label', async () => {
    await renderWithStore(<FontPicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose font family/ }));
    await userEvent.click(screen.getByRole('option', { name: /JetBrains Mono/ }));
    // Workspace-bound persistence (parity with theme).
    expect(useWorkspaceStore.getState().local!.ui.fontId).toBe('jetbrains-mono');
    expect(screen.getByRole('button', { name: /Choose font family/ })).toHaveTextContent(
      'JetBrains Mono',
    );
  });

  it('closes the dropdown on Escape', async () => {
    await renderWithStore(<FontPicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose font family/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox', { name: /Font families/ })).not.toBeInTheDocument();
  });

  it('hydrates from local.ui.fontId on mount', async () => {
    // Hydrate first, then mutate the store BEFORE mounting the
    // component so the picker reads `inter` as the workspace's seeded
    // value at first render.
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
      const state = useWorkspaceStore.getState();
      useWorkspaceStore.setState({
        local: { ...state.local!, ui: { ...state.local!.ui, fontId: 'inter' } },
      });
    });
    render(<FontPicker />);
    expect(screen.getByRole('button', { name: /Choose font family/ })).toHaveTextContent('Inter');
  });
});
