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

  it('picking a file stores it and shows filename + size', async () => {
    await renderWithStore(<Harness />);
    const id = await setupBinaryRequest();
    const fileInput = await screen.findByLabelText('Binary body file');
    const file = new File(['contents-12345'], 'doc.pdf', { type: 'application/pdf' });
    await userEvent.upload(fileInput, file);

    await waitFor(() => {
      expect(getRequest(id).body.attachment?.slotId).toBeTruthy();
    });
    expect(screen.getByText('doc.pdf')).toBeInTheDocument();
    expect(screen.getByText(/application\/pdf/)).toBeInTheDocument();

    const slot = getRequest(id).body.attachment!.slotId!;
    const stored = await getAttachment(slot);
    expect(stored?.filename).toBe('doc.pdf');
    expect(new TextDecoder().decode(stored!.bytes)).toBe('contents-12345');
  });

  it('clearing the file detaches it and frees the blob', async () => {
    await renderWithStore(<Harness />);
    const id = await setupBinaryRequest();
    await userEvent.upload(
      await screen.findByLabelText('Binary body file'),
      new File(['x'], 'x.bin', { type: 'application/octet-stream' }),
    );
    await waitFor(() => expect(getRequest(id).body.attachment?.slotId).toBeTruthy());
    const slot = getRequest(id).body.attachment!.slotId!;

    await userEvent.click(screen.getByRole('button', { name: 'Clear binary file' }));

    await waitFor(() => expect(getRequest(id).body.attachment?.slotId).toBeUndefined());
    expect(await getAttachment(slot)).toBeNull();
  });

  it('replacing the file frees the previous blob and stores the new one', async () => {
    await renderWithStore(<Harness />);
    const id = await setupBinaryRequest();
    const input = await screen.findByLabelText('Binary body file');

    await userEvent.upload(
      input,
      new File(['one'], 'one.bin', { type: 'application/octet-stream' }),
    );
    await waitFor(() => expect(getRequest(id).body.attachment?.filename).toBe('one.bin'));
    const firstSlot = getRequest(id).body.attachment!.slotId!;

    await userEvent.upload(
      input,
      new File(['two'], 'two.bin', { type: 'application/octet-stream' }),
    );
    await waitFor(() => expect(getRequest(id).body.attachment?.filename).toBe('two.bin'));
    const secondSlot = getRequest(id).body.attachment!.slotId!;

    expect(secondSlot).not.toBe(firstSlot);
    expect(await getAttachment(firstSlot)).toBeNull();
    expect(await getAttachment(secondSlot)).not.toBeNull();
  });
});
