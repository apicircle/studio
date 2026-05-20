import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import { getAttachment, putAttachment } from '../persistence/attachments';
import { useWorkspaceStore } from './workspaceStore';

// Plan §10.3 attachment-cascade integration: removing a file row from
// a form-data body, switching the body type, or deleting the request
// outright must cascade through to the attachments IDB so we don't
// leak orphan blobs across reloads.

async function seedSlot(slotId: string, bytes = new Uint8Array([1, 2, 3])): Promise<void> {
  await putAttachment({
    slotId,
    filename: `${slotId}.bin`,
    mimeType: 'application/octet-stream',
    size: bytes.length,
    sha256: 'fixture',
    savedAt: '2026-04-27T00:00:00.000Z',
    bytes,
  });
}

describe('attachment cascade — file row → slot → IDB', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it('frees the IDB blob when a file row is removed via setRequestFormRows', async () => {
    const id = useWorkspaceStore.getState().addRequest(null);
    const slotId = 'cascade-slot-A';
    await seedSlot(slotId);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'form-data',
      content: '',
      formRows: [{ kind: 'file', key: 'avatar', slotId, enabled: true, filename: 'a.bin' }],
    });

    expect(await getAttachment(slotId)).not.toBeNull();
    // Replace the rows array with an empty list — the previous slot has
    // no surviving reference, so the store should drop it from IDB.
    useWorkspaceStore.getState().setRequestFormRows(id, []);
    // The drop is async (deleteManyAttachments is fire-and-forget) — give
    // the next microtask cycle a chance to complete.
    await new Promise((r) => setTimeout(r, 0));
    expect(await getAttachment(slotId)).toBeNull();
  });

  it('frees blobs when the request itself is deleted', async () => {
    const id = useWorkspaceStore.getState().addRequest(null);
    const slotA = 'cascade-binary-slot';
    await seedSlot(slotA);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'binary',
      content: '',
      attachment: { slotId: slotA, filename: 'pic.png' },
    });
    expect(await getAttachment(slotA)).not.toBeNull();

    useWorkspaceStore.getState().removeRequest(id);
    await new Promise((r) => setTimeout(r, 0));
    expect(await getAttachment(slotA)).toBeNull();
  });

  it('keeps blobs that are still referenced by the surviving rows', async () => {
    const id = useWorkspaceStore.getState().addRequest(null);
    const keepSlot = 'cascade-keep';
    const dropSlot = 'cascade-drop';
    await seedSlot(keepSlot);
    await seedSlot(dropSlot);
    useWorkspaceStore.getState().setRequestBody(id, {
      type: 'form-data',
      content: '',
      formRows: [
        { kind: 'file', key: 'a', slotId: keepSlot, enabled: true },
        { kind: 'file', key: 'b', slotId: dropSlot, enabled: true },
      ],
    });

    // Drop only the second row.
    useWorkspaceStore
      .getState()
      .setRequestFormRows(id, [{ kind: 'file', key: 'a', slotId: keepSlot, enabled: true }]);
    await new Promise((r) => setTimeout(r, 0));
    expect(await getAttachment(keepSlot)).not.toBeNull();
    expect(await getAttachment(dropSlot)).toBeNull();
  });
});
