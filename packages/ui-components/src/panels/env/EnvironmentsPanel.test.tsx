import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { tryParsePayload } from '@apicircle-v2/core';
import { EnvironmentsPanel } from './EnvironmentsPanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

describe('EnvironmentsPanel', () => {
  it('shows the empty-state when no environments exist', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    expect(screen.getByText(/Create an environment from the sidebar/i)).toBeInTheDocument();
  });

  it('renders the priority-order list with the active marker', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().addEnvironment('prod');
      useWorkspaceStore.getState().setActiveEnvironment('dev');
    });
    const priority = await screen.findByRole('list', { name: 'Priority order' });
    expect(priority).toHaveTextContent('1.');
    expect(priority).toHaveTextContent('dev');
    expect(priority).toHaveTextContent('prod');
    expect(priority).toHaveTextContent('active');
  });

  it('move-up reorders priority', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().addEnvironment('prod');
    });
    await screen.findByRole('list', { name: 'Priority order' });
    await userEvent.click(screen.getByLabelText('Move prod up'));
    expect(useWorkspaceStore.getState().synced!.environments.priorityOrder).toEqual([
      'prod',
      'dev',
    ]);
  });

  it('add variable + commit value persists a plain row', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().setActiveEnvironment('dev');
    });
    await screen.findByRole('group', { name: 'Variables for dev' });
    await userEvent.click(screen.getByRole('button', { name: /Add variable/ }));

    const keyInput = screen.getByLabelText('Variable key');
    const valueInput = screen.getByLabelText('Variable value');
    await userEvent.type(keyInput, 'BASE_URL');
    await userEvent.type(valueInput, 'https://api.example.com');
    // Blur commits the value via the store.
    await userEvent.tab();

    await waitFor(() => {
      const env = useWorkspaceStore.getState().synced!.environments.items.dev;
      expect(env.variables[0]).toEqual({
        key: 'BASE_URL',
        value: 'https://api.example.com',
        encrypted: false,
      });
    });
  });

  it('toggling a row to encrypted then committing stores ciphertext (enc:v1: prefix)', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().setActiveEnvironment('dev');
      useWorkspaceStore.getState().addVariableRow('dev');
      useWorkspaceStore
        .getState()
        .setVariables('dev', [{ key: 'TOKEN', value: '', encrypted: false }]);
    });
    await screen.findByRole('group', { name: 'Variables for dev' });

    // Toggle Plain → Encrypted, then commit a value.
    await userEvent.click(screen.getByRole('button', { name: 'Toggle encrypted' }));
    const valueInput = screen.getByLabelText('Variable value');
    await userEvent.type(valueInput, 'super-secret');
    await userEvent.tab();

    await waitFor(() => {
      const v = useWorkspaceStore.getState().synced!.environments.items.dev.variables[0];
      expect(v.encrypted).toBe(true);
      expect(v.value.startsWith('enc:v1:')).toBe(true);
      expect(tryParsePayload(v.value)).not.toBeNull();
    });
  });
});
