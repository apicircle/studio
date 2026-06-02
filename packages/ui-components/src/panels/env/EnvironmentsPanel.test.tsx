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

  it('Unbind opens a confirm when decryption fails; confirm clears the value', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    let secretId = '';
    await act(async () => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore
        .getState()
        .setVariables('dev', [{ key: 'API_TOKEN', value: 'sk_live_abc', encrypted: false }]);
      secretId = await useWorkspaceStore.getState().addSecret({
        label: 'PROD_TOKEN',
        value: 'right-passphrase',
        origin: 'workspace',
      });
      const ok = await useWorkspaceStore.getState().bindVariableToSecretKey('dev', 0, secretId);
      expect(ok).toBe(true);
    });
    await screen.findByRole('group', { name: 'Variables for dev' });

    // Replace the local slot value with a different plaintext. The
    // ciphertext from the original bind will no longer decrypt with this
    // value, so the soft unbind path will refuse.
    await act(async () => {
      await useWorkspaceStore.getState().provideSlotValue(secretId, 'wrong-passphrase');
    });

    // Click Unbind — soft path refuses → confirm dialog should appear.
    await userEvent.click(screen.getByRole('button', { name: 'Unbind secret key' }));
    const confirmDialog = await screen.findByRole('dialog', { name: 'Unbind anyway?' });
    expect(confirmDialog).toBeInTheDocument();

    // Confirm — force-unbind clears the value and drops the binding.
    await userEvent.click(within(confirmDialog, /Unbind and clear value/i));
    await waitFor(() => {
      const v = useWorkspaceStore.getState().synced!.environments.items.dev.variables[0];
      expect(v.encrypted).toBe(false);
      expect(v.secretKeyId).toBeUndefined();
      expect(v.value).toBe('');
      expect(v.key).toBe('API_TOKEN');
    });
  });

  it('Unbind succeeds without a confirm when this device has the matching slot value', async () => {
    await renderWithStore(<EnvironmentsPanel />);
    let secretId = '';
    await act(async () => {
      useWorkspaceStore.getState().addEnvironment('dev');
      useWorkspaceStore
        .getState()
        .setVariables('dev', [{ key: 'API_TOKEN', value: 'sk_live_xyz', encrypted: false }]);
      secretId = await useWorkspaceStore.getState().addSecret({
        label: 'PROD_TOKEN',
        value: 'team-passphrase',
        origin: 'workspace',
      });
      const ok = await useWorkspaceStore.getState().bindVariableToSecretKey('dev', 0, secretId);
      expect(ok).toBe(true);
    });
    await screen.findByRole('group', { name: 'Variables for dev' });

    await userEvent.click(screen.getByRole('button', { name: 'Unbind secret key' }));

    // No confirm — happy path decrypts and lands the plaintext.
    await waitFor(() => {
      const v = useWorkspaceStore.getState().synced!.environments.items.dev.variables[0];
      expect(v.encrypted).toBe(false);
      expect(v.secretKeyId).toBeUndefined();
      expect(v.value).toBe('sk_live_xyz');
    });
    expect(screen.queryByRole('dialog', { name: 'Unbind anyway?' })).toBeNull();
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
