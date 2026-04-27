import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { ThemePicker } from './ThemePicker';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';

describe('ThemePicker', () => {
  it('shows the current theme label on the trigger', async () => {
    await renderWithStore(<ThemePicker />);
    expect(screen.getByRole('button', { name: /Choose theme/ })).toHaveTextContent('Studio Dark');
  });

  it('opens listbox on click and lists all 6 themes', async () => {
    await renderWithStore(<ThemePicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose theme/ }));
    const list = screen.getByRole('listbox');
    expect(list).toBeInTheDocument();
    expect(screen.getAllByRole('option')).toHaveLength(6);
  });

  it('selecting an option updates the store and closes the listbox', async () => {
    await renderWithStore(<ThemePicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose theme/ }));
    await userEvent.click(screen.getByRole('option', { name: /Paper Light/ }));
    expect(useWorkspaceStore.getState().local!.ui.themeId).toBe('paper-light');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('Escape closes the listbox without changing the theme', async () => {
    await renderWithStore(<ThemePicker />);
    await userEvent.click(screen.getByRole('button', { name: /Choose theme/ }));
    await userEvent.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
    expect(useWorkspaceStore.getState().local!.ui.themeId).toBe('studio-dark');
  });
});
