import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { FormDataEditor } from './FormDataEditor';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getAttachment } from '../../persistence/attachments';

// Live-render harness that subscribes to the active request so React
// re-renders whenever the store mutates the body.
function Harness() {
  const id = useWorkspaceStore((s) => s.local?.ui.activeRequestId ?? null);
  const req = useWorkspaceStore((s) => (id ? (s.synced?.collections.requests[id] ?? null) : null));
  if (!req) return null;
  return <FormDataEditor request={req} />;
}

async function setupFormDataRequest(): Promise<string> {
  let id = '';
  act(() => {
    id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore
      .getState()
      .setRequestBody(id, { type: 'form-data', content: '', formRows: [] });
  });
  return id;
}

function getRequest(id: string) {
  return useWorkspaceStore.getState().synced!.collections.requests[id];
}

function fileRow(id: string, index = 0) {
  const row = getRequest(id).body.formRows?.[index];
  if (!row || row.kind !== 'file') throw new Error('expected file row');
  return row;
}

describe('FormDataEditor', () => {
  it('shows the empty-state hint when no rows exist', async () => {
    await renderWithStore(<Harness />);
    await setupFormDataRequest();
    await waitFor(() => expect(screen.getByText(/No fields yet/i)).toBeInTheDocument());
  });

  it('"Add text" appends a text row, persisted to the request', async () => {
    await renderWithStore(<Harness />);
    const id = await setupFormDataRequest();
    await userEvent.click(await screen.findByRole('button', { name: /Add text/i }));
    const rows = getRequest(id).body.formRows ?? [];
    expect(rows).toHaveLength(1);
    expect(rows[0]?.kind).toBe('text');
  });

  it('"Add file" appends a file row with no slot yet', async () => {
    await renderWithStore(<Harness />);
    const id = await setupFormDataRequest();
    await userEvent.click(await screen.findByRole('button', { name: /Add file/i }));
    expect(fileRow(id).slotId).toBeNull();
    expect(screen.getByRole('button', { name: /Choose file/i })).toBeInTheDocument();
  });

  it('picking a file via the input writes the blob to attachments and updates the row', async () => {
    await renderWithStore(<Harness />);
    const id = await setupFormDataRequest();
    await userEvent.click(await screen.findByRole('button', { name: /Add file/i }));

    const fileInput = screen.getByLabelText('Form-data row 1 file');
    const file = new File(['avatar-bytes'], 'avatar.png', { type: 'image/png' });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      const row = fileRow(id);
      expect(row.filename).toBe('avatar.png');
      expect(row.mimeType).toBe('image/png');
      expect(row.slotId).toBeTruthy();
    });

    const slotId = fileRow(id).slotId!;
    const stored = await getAttachment(slotId);
    expect(stored?.filename).toBe('avatar.png');
    expect(new TextDecoder().decode(stored!.bytes)).toBe('avatar-bytes');
  });

  // Behavior change (Stage 2 unified-upload rework): direct file drops
  // now mint a reusable Global Asset entry. Clearing the row unbinds it
  // BUT preserves the asset's bytes — the asset shows up as "Unused" in
  // the Global Assets panel where the user can prune it manually. This
  // matches the user's "let me identify and delete orphans" requirement.

  it('clearing a file unbinds the row but preserves the Global Asset bytes', async () => {
    await renderWithStore(<Harness />);
    const id = await setupFormDataRequest();
    await userEvent.click(await screen.findByRole('button', { name: /Add file/i }));
    await userEvent.upload(
      screen.getByLabelText('Form-data row 1 file'),
      new File(['x'], 'x.bin', { type: 'application/octet-stream' }),
    );
    await waitFor(() => expect(fileRow(id).slotId).toBeTruthy());
    const previousSlot = fileRow(id).slotId!;
    const assetId = fileRow(id).globalFileAssetId!;
    expect(assetId).toBeTruthy();

    await userEvent.click(screen.getByRole('button', { name: /Clear file on form-data row 1/i }));

    await waitFor(() => expect(fileRow(id).slotId).toBeNull());
    // Bytes survive — the Global Asset is now "Unused" and can be
    // pruned through the Global Assets panel confirmation modal.
    expect(await getAttachment(previousSlot)).not.toBeNull();
    expect(useWorkspaceStore.getState().synced!.globalAssets.files?.[assetId]).toBeDefined();
  });

  it('replacing a file mints a new Global Asset and leaves the previous one as Unused', async () => {
    await renderWithStore(<Harness />);
    const id = await setupFormDataRequest();
    await userEvent.click(await screen.findByRole('button', { name: /Add file/i }));
    const fileInput = screen.getByLabelText('Form-data row 1 file');

    await userEvent.upload(fileInput, new File(['one'], 'one.txt', { type: 'text/plain' }));
    await waitFor(() => expect(fileRow(id).filename).toBe('one.txt'));
    const firstAssetId = fileRow(id).globalFileAssetId!;
    const firstSlot = fileRow(id).slotId!;

    await userEvent.upload(
      screen.getByLabelText('Form-data row 1 file'),
      new File(['two'], 'two.txt', { type: 'text/plain' }),
    );
    await waitFor(() => expect(fileRow(id).filename).toBe('two.txt'));
    const secondAssetId = fileRow(id).globalFileAssetId!;
    const secondSlot = fileRow(id).slotId!;

    expect(secondSlot).not.toBe(firstSlot);
    expect(secondAssetId).not.toBe(firstAssetId);
    // Both assets exist; the previous one is now Unused (visible in the
    // Global Assets panel) so the user can decide whether to keep it.
    const files = useWorkspaceStore.getState().synced!.globalAssets.files!;
    expect(files[firstAssetId]).toBeDefined();
    expect(files[secondAssetId]).toBeDefined();
    expect(await getAttachment(firstSlot)).not.toBeNull();
    expect(await getAttachment(secondSlot)).not.toBeNull();
  });

  it('removing a row leaves the asset orphaned in the library, not deleted', async () => {
    await renderWithStore(<Harness />);
    const id = await setupFormDataRequest();
    await userEvent.click(await screen.findByRole('button', { name: /Add file/i }));
    await userEvent.upload(
      screen.getByLabelText('Form-data row 1 file'),
      new File(['x'], 'x.bin', { type: 'application/octet-stream' }),
    );
    await waitFor(() => expect(fileRow(id).slotId).toBeTruthy());
    const slot = fileRow(id).slotId!;
    const assetId = fileRow(id).globalFileAssetId!;

    await userEvent.click(screen.getByRole('button', { name: /Remove form-data row 1/i }));
    await waitFor(() => expect(getRequest(id).body.formRows ?? []).toHaveLength(0));
    // Asset + bytes survive — orphan, surfaced as "Unused" in the panel.
    expect(await getAttachment(slot)).not.toBeNull();
    expect(useWorkspaceStore.getState().synced!.globalAssets.files?.[assetId]).toBeDefined();
  });
});
