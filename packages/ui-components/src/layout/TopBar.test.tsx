import { screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { TopBar } from './TopBar';
import { renderWithStore } from '../../test/renderWithStore';
import { useWorkspaceStore } from '../store/workspaceStore';

describe('TopBar', () => {
  it('renders app brand', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByText('API Circle Studio')).toBeInTheDocument();
  });

  it('shows workspace name when set', async () => {
    await renderWithStore(<TopBar />);
    // Default name from createEmptyWorkspace.
    expect(screen.getByText('/ My Workspace')).toBeInTheDocument();
  });

  it('opens the secret vault when its button is clicked', async () => {
    await renderWithStore(<TopBar />);
    await userEvent.click(screen.getByRole('button', { name: /Open Secret Vault/ }));
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(true);
  });

  it('renders the theme picker', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByRole('button', { name: /Choose theme/ })).toBeInTheDocument();
  });

  it('renders the font picker next to the theme picker', async () => {
    await renderWithStore(<TopBar />);
    expect(screen.getByRole('button', { name: /Choose font family/ })).toBeInTheDocument();
  });

  it('opens the Global Assets library from the top bar', async () => {
    await renderWithStore(<TopBar />);
    await userEvent.click(screen.getByRole('button', { name: /Open Global Assets library/ }));
    expect(useWorkspaceStore.getState().globalAssetsOpen).toBe(true);
  });
});
