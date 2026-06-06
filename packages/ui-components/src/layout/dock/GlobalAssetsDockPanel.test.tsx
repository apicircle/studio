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

  // Regression: after deleting the currently-selected file asset, the
  // editor view used to stay mounted pointing at the now-invalid id and
  // render its empty state — which the user read as "the screen
  // broke." A useEffect in the panel now watches the selected id
  // against the live registries and auto-clears it on disappearance.
  it('clears the selection when the currently-selected file asset is deleted', async () => {
    const id = await useWorkspaceStore
      .getState()
      .addGlobalFileAsset(new File(['x'], 'doomed.bin', { type: 'application/octet-stream' }), {
        name: 'Doomed file',
      });
    render(<GlobalAssetsDockPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^Files/ }));
    // Open the asset's detail view — the editor mounts with the name input.
    await userEvent.click(screen.getByRole('button', { name: /Doomed file/ }));
    expect(screen.getByLabelText('File asset name')).toBeInTheDocument();

    // Delete via the store (covers UI delete, MCP `assets.delete_file`,
    // and external-write paths uniformly — they all funnel through the
    // synced doc dropping the asset entry).
    await act(async () => {
      await useWorkspaceStore.getState().removeGlobalFileAsset(id);
    });

    // The editor unmounts; the right pane returns to the list / empty
    // hint instead of being stranded on an invalid id.
    await waitFor(() => expect(screen.queryByLabelText('File asset name')).not.toBeInTheDocument());
  });

  it('clears the selection when the currently-selected GraphQL definition is deleted', async () => {
    // Same auto-clear behaviour for the Schemas + GraphQL tabs since
    // they share the `selectedId` slot.
    const id = useWorkspaceStore.getState().addGlobalGraphQL({ name: 'Doomed gql' });
    render(<GlobalAssetsDockPanel />);
    await userEvent.click(screen.getByRole('button', { name: /^GraphQL/ }));
    await userEvent.click(screen.getByRole('button', { name: /Doomed gql/ }));
    expect(screen.getByLabelText('GraphQL schema name')).toBeInTheDocument();

    // `removeGlobalGraphQL` is synchronous, so the act() callback is
    // sync — `act(() => {...})` returns void, not a Promise, and
    // `await void` trips `@typescript-eslint/await-thenable`. No await.
    act(() => {
      useWorkspaceStore.getState().removeGlobalGraphQL(id);
    });

    await waitFor(() =>
      expect(screen.queryByLabelText('GraphQL schema name')).not.toBeInTheDocument(),
    );
  });
});
