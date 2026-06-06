import { act, screen, waitFor } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { BinaryEditor } from './BinaryEditor';
import { renderWithStore } from '../../../test/renderWithStore';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { getAttachment } from '../../persistence/attachments';

function Harness() {
  const id = useWorkspaceStore((s) => s.local?.ui.activeRequestId ?? null);
  const req = useWorkspaceStore((s) => (id ? (s.synced?.collections.requests[id] ?? null) : null));
  if (!req) return null;
  return <BinaryEditor request={req} />;
}

async function setupBinaryRequest(): Promise<string> {
  let id = '';
  act(() => {
    id = useWorkspaceStore.getState().addRequest(null);
    useWorkspaceStore.getState().setRequestBody(id, { type: 'binary', content: '' });
  });
  return id;
}

function getRequest(id: string) {
  return useWorkspaceStore.getState().synced!.collections.requests[id];
}

describe('BinaryEditor', () => {
  it('shows the choose-file CTA when nothing is attached', async () => {
    await renderWithStore(<Harness />);
    await setupBinaryRequest();
    await waitFor(() =>
      expect(screen.getByText(/Choose a file to send as binary body/i)).toBeInTheDocument(),
    );
  });

  // Behavior change (Stage 2 unified-upload rework): a direct binary
  // upload now mints a reusable Global Asset entry — the same flow the
  // Global Assets sidebar uses. The body's attachment carries
  // `globalFileAssetId`, the asset shows up in the library dropdown,
  // and clearing or replacing the binding leaves the bytes alone (the
  // Global Asset is the durability boundary, not the row binding).

  it('picking a file mints a Global Asset, stores the bytes, and binds the body to it', async () => {
    await renderWithStore(<Harness />);
    const id = await setupBinaryRequest();
    const fileInput = await screen.findByLabelText('Binary body file');
    const file = new File(['contents-12345'], 'doc.pdf', { type: 'application/pdf' });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(getRequest(id).body.attachment?.slotId).toBeTruthy();
    });
    const attachment = getRequest(id).body.attachment!;
    expect(attachment.globalFileAssetId).toBeTruthy();
    expect(attachment.filename).toBe('doc.pdf');
    expect(attachment.mimeType).toBe('application/pdf');

    const stored = await getAttachment(attachment.slotId!);
    expect(stored?.filename).toBe('doc.pdf');
    expect(new TextDecoder().decode(stored!.bytes)).toBe('contents-12345');

    // The asset shows up in the workspace-wide Global Assets registry.
    const asset =
      useWorkspaceStore.getState().synced!.globalAssets.files?.[attachment.globalFileAssetId!];
    expect(asset?.slotId).toBe(attachment.slotId);
  });

  it('clearing the binding leaves the Global Asset (and bytes) intact', async () => {
    await renderWithStore(<Harness />);
    const id = await setupBinaryRequest();
    await userEvent.upload(
      await screen.findByLabelText('Binary body file'),
      new File(['x'], 'x.bin', { type: 'application/octet-stream' }),
    );
    await waitFor(() => expect(getRequest(id).body.attachment?.slotId).toBeTruthy());
    const attachment = getRequest(id).body.attachment!;
    const slot = attachment.slotId!;
    const assetId = attachment.globalFileAssetId!;

    await userEvent.click(screen.getByRole('button', { name: 'Clear binary file' }));

    await waitFor(() => expect(getRequest(id).body.attachment?.slotId).toBeUndefined());
    // Asset stays — orphan, shown as Unused; user prunes manually.
    expect(await getAttachment(slot)).not.toBeNull();
    expect(useWorkspaceStore.getState().synced!.globalAssets.files?.[assetId]).toBeDefined();
  });

  it('replacing the binding mints a new Global Asset and leaves the previous one orphaned', async () => {
    await renderWithStore(<Harness />);
    const id = await setupBinaryRequest();
    const input = await screen.findByLabelText('Binary body file');

    await userEvent.upload(
      input,
      new File(['one'], 'one.bin', { type: 'application/octet-stream' }),
    );
    await waitFor(() => expect(getRequest(id).body.attachment?.filename).toBe('one.bin'));
    const firstAttachment = getRequest(id).body.attachment!;

    await userEvent.upload(
      input,
      new File(['two'], 'two.bin', { type: 'application/octet-stream' }),
    );
    await waitFor(() => expect(getRequest(id).body.attachment?.filename).toBe('two.bin'));
    const secondAttachment = getRequest(id).body.attachment!;

    expect(secondAttachment.slotId).not.toBe(firstAttachment.slotId);
    expect(secondAttachment.globalFileAssetId).not.toBe(firstAttachment.globalFileAssetId);
    // Both Global Assets survive; the previous one is now Unused.
    const files = useWorkspaceStore.getState().synced!.globalAssets.files!;
    expect(files[firstAttachment.globalFileAssetId!]).toBeDefined();
    expect(files[secondAttachment.globalFileAssetId!]).toBeDefined();
    expect(await getAttachment(firstAttachment.slotId!)).not.toBeNull();
    expect(await getAttachment(secondAttachment.slotId!)).not.toBeNull();
  });
});
