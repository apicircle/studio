import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { beforeEach, describe, expect, it } from 'vitest';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { GlobalAssetsDockPanel } from './GlobalAssetsDockPanel';

async function hydrate(): Promise<void> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
}

describe('GlobalAssetsDockPanel', () => {
  beforeEach(hydrate);

  it('renders the two sub-tabs', () => {
    render(<GlobalAssetsDockPanel />);
    expect(screen.getByRole('button', { name: /JSON Schemas/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^GraphQL/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /^Files/ })).toBeInTheDocument();
  });

  it('Add JSON Schema appends an entry and selects it', async () => {
    render(<GlobalAssetsDockPanel />);
    await userEvent.click(screen.getByRole('button', { name: 'Add JSON Schema' }));
    const stored = Object.values(useWorkspaceStore.getState().synced!.globalAssets.schemas);
    expect(stored).toHaveLength(1);
    expect(screen.getByLabelText('Schema name')).toBeInTheDocument();
  });

  it('switches to GraphQL tab and adds a definition', async () => {
    render(<GlobalAssetsDockPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^GraphQL/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Add GraphQL schema' }));
    expect(useWorkspaceStore.getState().synced!.globalAssets.graphql).not.toEqual({});
    const kindSelect = screen.getByLabelText('GraphQL kind');
    expect(kindSelect).toHaveValue('sdl');
  });

  it('renaming a schema persists the change', async () => {
    const id = useWorkspaceStore.getState().addGlobalSchema({ name: 'Original' });
    render(<GlobalAssetsDockPanel />);
    await userEvent.click(screen.getByRole('button', { name: /Original/ }));
    const nameInput = screen.getByLabelText('Schema name');
    await userEvent.clear(nameInput);
    await userEvent.type(nameInput, 'Renamed');
    expect(useWorkspaceStore.getState().synced!.globalAssets.schemas[id]?.name).toBe('Renamed');
  });

  it('Delete schema is gated by confirmation', async () => {
    const id = useWorkspaceStore.getState().addGlobalSchema({ name: 'Doomed' });
    render(<GlobalAssetsDockPanel />);
    await userEvent.click(screen.getByRole('button', { name: /Doomed/ }));
    await userEvent.click(screen.getByRole('button', { name: 'Delete schema Doomed' }));
    const dialogs = screen.getAllByRole('dialog');
    const confirmDialog = dialogs[dialogs.length - 1];
    await userEvent.click(within(confirmDialog).getByRole('button', { name: 'Delete' }));
    expect(useWorkspaceStore.getState().synced!.globalAssets.schemas[id]).toBeUndefined();
  });

  it('uploads and edits a reusable file asset', async () => {
    render(<GlobalAssetsDockPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Files/ }));
    const input = screen.getByLabelText('Global file asset');
    const file = new File(['payload'], 'payload.txt', { type: 'text/plain' });
    await userEvent.upload(input, file);

    await waitFor(() =>
      expect(
        Object.values(useWorkspaceStore.getState().synced!.globalAssets.files ?? {}),
      ).toHaveLength(1),
    );
    const stored = Object.values(useWorkspaceStore.getState().synced!.globalAssets.files ?? {});
    expect(stored[0]).toMatchObject({ filename: 'payload.txt', size: 7, mimeType: 'text/plain' });
    expect(screen.getByLabelText('File asset name')).toBeInTheDocument();

    await userEvent.clear(screen.getByLabelText('File asset name'));
    await userEvent.type(screen.getByLabelText('File asset name'), 'Shared payload');
    expect(useWorkspaceStore.getState().synced!.globalAssets.files?.[stored[0].id]?.name).toBe(
      'Shared payload',
    );
  });
});
