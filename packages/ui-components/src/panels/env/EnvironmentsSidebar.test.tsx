import { act, fireEvent, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EnvironmentsSidebar } from './EnvironmentsSidebar';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

const toolbarNew = () => screen.getByLabelText('New environment');

describe('EnvironmentsSidebar', () => {
  it('shows the empty-state when no environments exist', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    expect(screen.getByText(/No environments yet/i)).toBeInTheDocument();
  });

  it('typing a name + Enter creates the env', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    await userEvent.click(toolbarNew());
    const input = screen.getByLabelText('Environment name');
    await userEvent.type(input, 'dev');
    await userEvent.keyboard('{Enter}');

    const synced = useWorkspaceStore.getState().synced!;
    expect(synced.environments.items).toHaveProperty('dev');
  });

  it('checkbox adds/removes an env from the global priority layer', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().addEnvironment('prod');
      // Reset priority — addEnvironment seeds it; clear so we test toggling.
      useWorkspaceStore.getState().setPriorityOrder([]);
    });
    const list = screen.getByRole('list', { name: 'Environments' });
    await userEvent.click(
      within(list).getByRole('checkbox', { name: /Add dev from global environment layer/i }),
    );
    expect(useWorkspaceStore.getState().synced!.environments.priorityOrder).toEqual(['dev']);
    await userEvent.click(
      within(list).getByRole('checkbox', { name: /Remove dev from global environment layer/i }),
    );
    expect(useWorkspaceStore.getState().synced!.environments.priorityOrder).toEqual([]);
  });

  it('clicking the env name sets envFocus', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().addEnvironment('prod');
    });
    await userEvent.click(screen.getByLabelText('Edit variables in prod'));
    expect(useWorkspaceStore.getState().envFocus).toBe('prod');
  });

  it('delete button removes the env after confirmation', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
    });
    const originalConfirm = window.confirm;
    window.confirm = () => true;
    try {
      await userEvent.click(screen.getByLabelText('Delete dev'));
    } finally {
      window.confirm = originalConfirm;
    }
    expect(useWorkspaceStore.getState().synced!.environments.items).not.toHaveProperty('dev');
  });

  it('drag-and-drop reorders the priority layer', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().addEnvironment('prod');
    });
    const list = screen.getByRole('list', { name: 'Environments' });
    const items = within(list).getAllByRole('listitem');
    const devRow = items.find((el) => el.getAttribute('data-env-name') === 'dev')!;
    const prodRow = items.find((el) => el.getAttribute('data-env-name') === 'prod')!;
    fireEvent.dragStart(prodRow);
    fireEvent.dragOver(devRow);
    fireEvent.drop(devRow);
    expect(useWorkspaceStore.getState().synced!.environments.priorityOrder).toEqual([
      'prod',
      'dev',
    ]);
  });

  it('priority number badge is no longer rendered next to selected envs', async () => {
    await renderWithStore(<EnvironmentsSidebar />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
    });
    expect(screen.queryByTitle(/Priority 1/i)).toBeNull();
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
