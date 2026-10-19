import { act, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { EnvironmentsPanel } from './EnvironmentsPanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

type AddSecretArgs = Parameters<ReturnType<typeof useWorkspaceStore.getState>['addSecret']>[0];

/** A `dev` environment with one plain variable, and the picker opened on it in "new key" mode. */
async function openCreateKeyFormOnApiToken(): Promise<HTMLElement> {
  await renderWithStore(<EnvironmentsPanel />);
  act(() => {
    const s = useWorkspaceStore.getState();
    s.addEnvironment('dev');
    s.setVariables('dev', [{ key: 'API_TOKEN', value: 'sk_live_abc', encrypted: false }]);
  });
  await screen.findByRole('group', { name: 'Variables for dev' });
  await userEvent.click(screen.getByRole('button', { name: 'Encrypt' }));
  const picker = await screen.findByRole('dialog', {
    name: 'Pick or create a Secret Vault key',
  });
  expect(within(picker).getByText('No secret keys yet — create one below.')).toBeInTheDocument();
  await userEvent.click(within(picker).getByRole('button', { name: 'New secret key' }));
  await userEvent.type(within(picker).getByLabelText('Secret key label'), 'PROD_API_TOKEN');
  await userEvent.type(within(picker).getByLabelText('Secret key value'), 'team-slot-passphrase');
  return picker;
}

describe('EnvironmentsPanel — creating a Secret Vault key from the picker', () => {
  it('shows the brand loader on Create & bind while the key is created, then binds the variable and closes', async () => {
    const realAddSecret = useWorkspaceStore.getState().addSecret;
    let release!: () => void;
    const addSecret = vi.fn(
      (args: AddSecretArgs) =>
        new Promise<string>((resolve, reject) => {
          release = () => {
            realAddSecret(args).then(resolve, reject);
          };
        }),
    );
    const picker = await openCreateKeyFormOnApiToken();
    useWorkspaceStore.setState({ addSecret });

    const idle = within(picker).getByRole('button', { name: 'Create & bind' });
    expect(idle).toBeEnabled();
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle.querySelector('svg[data-brand-loader]')).toBeNull();

    await userEvent.click(idle);

    const busy = within(picker).getByRole('button', { name: 'Creating…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.querySelector('svg[data-brand-loader]')).not.toBeNull();
    expect(addSecret).toHaveBeenCalledWith({
      label: 'PROD_API_TOKEN',
      value: 'team-slot-passphrase',
      origin: 'workspace',
    });

    let createdId = '';
    await act(async () => {
      release();
      createdId = await addSecret.mock.results[0]!.value;
    });
    expect(createdId).not.toBe('');

    // The new key is picked: the picker closes and the row is bound to it.
    expect(screen.queryByRole('dialog', { name: 'Pick or create a Secret Vault key' })).toBeNull();
    await waitFor(() => {
      const v = useWorkspaceStore.getState().synced!.environments.items.dev!.variables[0]!;
      expect(v.encrypted).toBe(true);
      expect(v.secretKeyId).toBe(createdId);
    });
    expect(screen.getByLabelText('Variable value (bound to secret key)')).toHaveTextContent(
      'PROD_API_TOKEN',
    );
  });

  it('comes back idle, with the form kept, when no key was created', async () => {
    let finish!: (id: string) => void;
    const addSecret = vi.fn(
      (_args: AddSecretArgs) =>
        new Promise<string>((resolve) => {
          finish = resolve;
        }),
    );
    const picker = await openCreateKeyFormOnApiToken();
    useWorkspaceStore.setState({ addSecret });

    await userEvent.click(within(picker).getByRole('button', { name: 'Create & bind' }));
    expect(within(picker).getByRole('button', { name: 'Creating…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    // `addSecret` answers '' when there is no workspace to put the key in.
    await act(async () => {
      finish('');
    });

    // Nothing to bind, so the picker stays open on the same form, idle again.
    const idle = within(picker).getByRole('button', { name: 'Create & bind' });
    expect(idle).toBeEnabled();
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle.querySelector('svg[data-brand-loader]')).toBeNull();
    expect(within(picker).getByLabelText('Secret key label')).toHaveValue('PROD_API_TOKEN');
    const v = useWorkspaceStore.getState().synced!.environments.items.dev!.variables[0]!;
    expect(v).toEqual({ key: 'API_TOKEN', value: 'sk_live_abc', encrypted: false });
  });
});
