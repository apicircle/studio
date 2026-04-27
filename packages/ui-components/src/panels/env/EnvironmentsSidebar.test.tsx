import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EnvironmentsSidebar } from './EnvironmentsSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const toolbarNew = () => screen.getByLabelText('New environment');

describe('EnvironmentsSidebar', () => {
  it('shows the empty-state when no environments exist', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    // Open the section first.
    act(() => useWorkspaceStore.getState().toggleSidebarSection('env.list'));
    expect(screen.getByText(/No environments yet/i)).toBeInTheDocument();
  });

  it('typing a name + Enter creates and activates the env', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    await userEvent.click(toolbarNew());
    const input = screen.getByLabelText('Environment name');
    await userEvent.type(input, 'dev');
    await userEvent.keyboard('{Enter}');

    const synced = useWorkspaceStore.getState().synced!;
    expect(synced.environments.items).toHaveProperty('dev');
    expect(synced.environments.activeName).toBe('dev');
  });

  it('clicking an env toggles active status', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => useWorkspaceStore.getState().toggleSidebarSection('env.list'));
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().addEnvironment('prod');
    });
    const list = screen.getByRole('list', { name: 'Environments' });
    await userEvent.click(within(list).getByRole('button', { name: /Activate dev/ }));
    expect(useWorkspaceStore.getState().synced!.environments.activeName).toBe('dev');
    await userEvent.click(within(list).getByRole('button', { name: /Deactivate dev/ }));
    expect(useWorkspaceStore.getState().synced!.environments.activeName).toBeNull();
  });

  it('delete button removes the env', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => useWorkspaceStore.getState().toggleSidebarSection('env.list'));
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
    });
    await userEvent.click(screen.getByLabelText('Delete dev'));
    expect(useWorkspaceStore.getState().synced!.environments.items).not.toHaveProperty('dev');
  });

  it('Escape on the new-name input cancels without creating', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    await userEvent.click(toolbarNew());
    const input = screen.getByLabelText('Environment name');
    await userEvent.type(input, 'wip');
    await userEvent.keyboard('{Escape}');
    expect(useWorkspaceStore.getState().synced!.environments.items).not.toHaveProperty('wip');
  });
});
