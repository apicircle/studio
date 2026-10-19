import { act, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import type { SecretKeyMeta } from '@apicircle/shared';
import { SecretVaultDockPanel } from './SecretVaultDockPanel';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';

// A slot the workspace declares in Git (`synced.secretKeys`) with no value on
// this device yet — the state a fresh clone lands in. The Vault lists it in
// the "Provide missing secret values" gate, one row per slot, each with its own
// Save. That Save awaits `provideSlotValue`; these tests hold that promise open
// to see the button while it is busy.
const SLOT: SecretKeyMeta = {
  id: 'sk_prod_db',
  label: 'PROD_DB_PASSWORD',
  salt: 'AAAAAAAAAAAAAAAAAAAAAA==',
  createdAt: '2026-10-01T00:00:00.000Z',
};

function declareSlotWithNoLocalValue(): void {
  act(() => {
    const synced = useWorkspaceStore.getState().synced!;
    useWorkspaceStore.setState({
      synced: { ...synced, secretKeys: { ...(synced.secretKeys ?? {}), [SLOT.id]: SLOT } },
    });
  });
}

const gate = () => screen.getByRole('group', { name: 'Provide missing secret values' });

describe('SecretVaultDockPanel — a missing slot value while it is saved', () => {
  it('shows the brand loader on the slot row Save, then leaves the gate once the value is stored', async () => {
    await renderWithStore(<SecretVaultDockPanel />);
    const realProvide = useWorkspaceStore.getState().provideSlotValue;
    let release!: () => void;
    const provideSlotValue = vi.fn(
      (id: string, value: string) =>
        new Promise<boolean>((resolve, reject) => {
          release = () => {
            realProvide(id, value).then(resolve, reject);
          };
        }),
    );
    useWorkspaceStore.setState({ provideSlotValue });
    declareSlotWithNoLocalValue();

    expect(within(gate()).getByText('1 secret value needed')).toBeInTheDocument();
    const input = within(gate()).getByLabelText(`Value for ${SLOT.label}`);
    await userEvent.type(input, 'hunter2-prod');

    const idle = within(gate()).getByRole('button', { name: 'Save' });
    expect(idle).toBeEnabled();
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle.querySelector('svg[data-brand-loader]')).toBeNull();

    await userEvent.click(idle);

    const busy = within(gate()).getByRole('button', { name: 'Saving…' });
    expect(busy).toBeDisabled();
    expect(busy).toHaveAttribute('aria-busy', 'true');
    expect(busy.querySelector('svg[data-brand-loader]')).not.toBeNull();
    expect(provideSlotValue).toHaveBeenCalledWith(SLOT.id, 'hunter2-prod');

    // Enter in the value field does not send it a second time while busy.
    await userEvent.type(input, '{Enter}');
    expect(provideSlotValue).toHaveBeenCalledTimes(1);

    await act(async () => {
      release();
      await provideSlotValue.mock.results[0]!.value;
    });

    // The value is on this device now, so the slot is no longer missing: the
    // gate goes and the slot is an ordinary entry.
    expect(screen.queryByRole('group', { name: 'Provide missing secret values' })).toBeNull();
    expect(screen.queryByRole('button', { name: 'Saving…' })).toBeNull();
    const list = screen.getByRole('list', { name: 'Secret entries' });
    expect(within(list).getByText(SLOT.label)).toBeInTheDocument();
    expect(useWorkspaceStore.getState().local!.secretIndex.entries[SLOT.id]).toMatchObject({
      label: SLOT.label,
      origin: 'workspace',
    });
  });

  it('comes back idle, with the field cleared, when the value was not stored', async () => {
    await renderWithStore(<SecretVaultDockPanel />);
    let finish!: (stored: boolean) => void;
    const provideSlotValue = vi.fn(
      (_id: string, _value: string) =>
        new Promise<boolean>((resolve) => {
          finish = resolve;
        }),
    );
    useWorkspaceStore.setState({ provideSlotValue });
    declareSlotWithNoLocalValue();

    const input = within(gate()).getByLabelText(`Value for ${SLOT.label}`);
    await userEvent.type(input, 'hunter2-prod');
    await userEvent.click(within(gate()).getByRole('button', { name: 'Save' }));
    expect(within(gate()).getByRole('button', { name: 'Saving…' })).toHaveAttribute(
      'aria-busy',
      'true',
    );

    await act(async () => {
      finish(false);
    });

    // Nothing landed, so the slot is still missing and its row is still here,
    // idle again: no loader, not busy, and disabled only because it is empty.
    const idle = within(gate()).getByRole('button', { name: 'Save' });
    expect(idle).not.toHaveAttribute('aria-busy');
    expect(idle.querySelector('svg[data-brand-loader]')).toBeNull();
    expect(idle).toBeDisabled();
    expect(input).toHaveValue('');
    expect(useWorkspaceStore.getState().local!.secretIndex.entries[SLOT.id]).toBeUndefined();
  });
});
