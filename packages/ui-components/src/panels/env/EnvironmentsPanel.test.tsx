import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { EnvironmentsPanel } from './EnvironmentsPanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

describe('EnvironmentsPanel', () => {
  it('shows the empty-state when no environments exist', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    expect(screen.getByText(/Create an environment from the sidebar/i)).toBeInTheDocument();
  });

  it('shows layer position chip when the focused env is in the priority layer', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().addEnvironment('prod');
    });
    await screen.findByRole('group', { name: 'Variables for dev' });
    expect(screen.getByText(/Layer position 1 of 2/i)).toBeInTheDocument();
  });

  it('add variable + commit value persists a plain row', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    act(() => {
      useWorkspaceStore.getState().addEnvironment('dev');
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
      expect(env.variables[0]).toMatchObject({
        key: 'BASE_URL',
        value: 'https://api.example.com',
        encrypted: false,
      });
    });
  });

  it('binding a variable to a vault secret key locks the value field and stores secretKeyId', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    let secretId = '';
    await act(async () => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore.getState().addVariableRow('dev');
      secretId = await useWorkspaceStore.getState().addSecret({
        label: 'PROD_TOKEN',
        value: 'super-secret',
        origin: 'workspace',
      });
    });
    await screen.findByRole('group', { name: 'Variables for dev' });

    // Open the picker via the "Encrypt" button.
    await userEvent.click(screen.getByRole('button', { name: 'Encrypt' }));
    const dialog = await screen.findByRole('dialog', {
      name: /Pick or create a Secret Vault key/i,
    });
    await userEvent.click(within(dialog, /PROD_TOKEN/i));

    await waitFor(() => {
      const v = useWorkspaceStore.getState().synced!.environments.items.dev.variables[0];
      expect(v.encrypted).toBe(true);
      expect(v.secretKeyId).toBe(secretId);
      // Value carries the AES-GCM ciphertext encrypted under the slot's
      // derived key, not an empty string. That's what allows teammates with
      // the same slot value to decrypt the same row.
      expect(v.value.startsWith('enc:v1:')).toBe(true);
    });
    // Synced labels map should include the bound key + per-slot salt so
    // collaborators can recompute the same derived key.
    const meta = useWorkspaceStore.getState().synced!.secretKeys?.[secretId];
    expect(meta?.label).toBe('PROD_TOKEN');
    expect(typeof meta?.salt).toBe('string');
    expect(meta?.salt.length).toBeGreaterThan(0);
  });
});

// Helper: click the first button-like element inside a container whose text
// matches the regex. Inlined to keep the file dependency-free.
function within(container: HTMLElement, pattern: RegExp): HTMLElement {
  const matches = Array.from(container.querySelectorAll('button')).filter((el) =>
    pattern.test(el.textContent ?? ''),
  );
  if (matches.length === 0) throw new Error(`no button matched ${pattern}`);
  return matches[0] as HTMLElement;
}
