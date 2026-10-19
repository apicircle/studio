import { act, render, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { ImportModal } from './ImportModal';

type AddSecretArgs = Parameters<ReturnType<typeof useWorkspaceStore.getState>['addSecret']>[0];

// An API Circle environment export with one encrypted row whose vault slot
// (`PROD_TOKEN`) does not exist in the destination, so importing it lands on
// the "Provide secret values" step — as in ImportModal.test.tsx's "switches to
// the bind step when an env import has unresolved encrypted bindings".
const ENVELOPE = {
  apicircleEnvironment: 1,
  name: 'with-secrets',
  variables: [
    { key: 'API_BASE', value: 'https://api.example.com', encrypted: false },
    {
      key: 'TOKEN',
      encrypted: true,
      secretKeyId: 'sec_origin',
      secret: { label: 'PROD_TOKEN' },
    },
  ],
};

/** Same paste helper as ImportModal.test.tsx: `userEvent.type` reads `{` as a key. */
function pasteInto(textarea: HTMLElement, value: string): void {
  const setter = Object.getOwnPropertyDescriptor(
    window.HTMLTextAreaElement.prototype,
    'value',
  )!.set!;
  setter.call(textarea, value);
  textarea.dispatchEvent(new Event('input', { bubbles: true }));
}

const toasts = () => useWorkspaceStore.getState().toasts;

describe('ImportModal — the bind step while it binds', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
      // Binding needs an unlocked vault; without one the step only offers
      // "Set passphrase" and Bind stays disabled.
      const setup = await useWorkspaceStore.getState().setupPassphrase('a-strong-passphrase');
      expect(setup.ok).toBe(true);
    });
  });

  it('shows the brand loader on Bind while the slot is created, then binds the row and closes', async () => {
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
    useWorkspaceStore.setState({ addSecret });
    const onClose = vi.fn();
    render(<ImportModal open onClose={onClose} />);
    pasteInto(screen.getByLabelText('Import source'), JSON.stringify(ENVELOPE));
    expect(await screen.findByText(/API Circle environment\)/)).toBeInTheDocument();
    await userEvent.click(screen.getByRole('button', { name: 'Import' }));
    expect(screen.getByText(/1 secret binding for/i)).toBeInTheDocument();

    // Nothing filled yet: the button says so and cannot be pressed.
    const empty = screen.getByRole('button', { name: 'Bind & finish' });
    expect(empty).toBeDisabled();
    expect(empty).not.toHaveAttribute('aria-busy');

    const value = screen.getByLabelText('Secret value for PROD_TOKEN');
    await userEvent.type(value, 'team-slot-passphrase');
    const idle = screen.getByRole('button', { name: 'Bind 1 & finish' });
    expect(idle).toBeEnabled();
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle.querySelector('svg[data-brand-loader]')).toBeNull();

    await userEvent.click(idle);

    const busy = screen.getByRole('button', { name: 'Binding…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.querySelector('svg[data-brand-loader]')).not.toBeNull();
    // Nothing else on the step can be changed mid-bind.
    expect(screen.getByRole('button', { name: 'Skip & finish' })).toBeDisabled();
    expect(value).toBeDisabled();
    expect(addSecret).toHaveBeenCalledWith({
      label: 'PROD_TOKEN',
      value: 'team-slot-passphrase',
      origin: 'workspace',
    });
    expect(onClose).not.toHaveBeenCalled();
    // Escape does not skip a bind that is already under way.
    await userEvent.keyboard('{Escape}');
    expect(onClose).not.toHaveBeenCalled();
    expect(toasts().some((t) => /skipped/i.test(t.title ?? ''))).toBe(false);

    let slotId = '';
    await act(async () => {
      release();
      slotId = await addSecret.mock.results[0]!.value;
    });
    expect(slotId).not.toBe('');

    // Once the bind lands the modal closes and says what it bound.
    await waitFor(() => expect(onClose).toHaveBeenCalledTimes(1));
    expect(toasts()).toContainEqual(
      expect.objectContaining({ tone: 'success', title: 'Bound 1 secret' }),
    );
    const token = useWorkspaceStore
      .getState()
      .synced!.environments.items['with-secrets']!.variables.find((v) => v.key === 'TOKEN')!;
    expect(token.encrypted).toBe(true);
    expect(token.secretKeyId).toBe(slotId);
    expect(token.value.startsWith('enc:v1:')).toBe(true);
  });
});
