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

  // Remote-side cleanup: when a Global File Asset that's on the remote
  // (working / base branch) is removed locally, the slotId must be
  // queued in `pendingAttachmentDeletes` so the next push emits a
  // `{path, sha: null}` tree entry. Without this queue, the orphan blob
  // would stay on the remote forever and the PR merge would carry it
  // into main. These tests pin every branch of the UI store action.
  describe('removeGlobalFileAsset — pendingAttachmentDeletes queue', () => {
    it('queues the slotId when the asset had a workingBranchRef', async () => {
      const file = new File([new Uint8Array([5, 5, 5])], 'rem.bin', {
        type: 'application/octet-stream',
      });
      const assetId = await useWorkspaceStore.getState().addGlobalFileAsset(file);
      // Stamp a workingBranchRef directly (simulates the post-push state).
      const synced = useWorkspaceStore.getState().synced!;
      useWorkspaceStore.setState({
        synced: {
          ...synced,
          globalAssets: {
            ...synced.globalAssets,
            files: {
              ...synced.globalAssets.files,
              [assetId]: {
                ...synced.globalAssets.files![assetId],
                workingBranchRef: {
                  branchName: 'apicircle/wb-test',
                  blobSha: 'blob-stamp',
                  commitSha: 'commit-stamp',
                  verifiedAt: '2026-06-06T00:00:00.000Z',
                },
              },
            },
          },
        },
      });
      const slotId = useWorkspaceStore.getState().synced!.globalAssets.files![assetId].slotId;

      await useWorkspaceStore.getState().removeGlobalFileAsset(assetId);

      const after = useWorkspaceStore.getState();
      // Asset gone from registry, blob queued for remote deletion.
      expect(after.synced!.globalAssets.files?.[assetId]).toBeUndefined();
      expect(after.local!.pendingAttachmentDeletes).toContain(slotId);
      // pendingFileUploads + IDB bytes already freed by the existing
      // cascade — pin those too so the regression covers the full delete.
      expect(after.local!.pendingFileUploads?.[assetId]).toBeUndefined();
      expect(await getAttachment(slotId)).toBeNull();
    });

    it('queues the slotId when the asset had only a baseBranchRef', async () => {
      // Post-cleanup-invariant state: working ref dropped, base ref the
      // sole source of truth. Deleting must still queue the remote
      // delete so the blob is removed from main on the next push.
      const file = new File([new Uint8Array([6, 6, 6])], 'rem.bin', {
        type: 'application/octet-stream',
      });
      const assetId = await useWorkspaceStore.getState().addGlobalFileAsset(file);
      const synced = useWorkspaceStore.getState().synced!;
      useWorkspaceStore.setState({
        synced: {
          ...synced,
          globalAssets: {
            ...synced.globalAssets,
            files: {
              ...synced.globalAssets.files,
              [assetId]: {
                ...synced.globalAssets.files![assetId],
                workingBranchRef: null,
                baseBranchRef: {
                  branchName: 'main',
                  blobSha: 'blob-on-main',
                  verifiedAt: '2026-06-06T00:00:00.000Z',
                },
              },
            },
          },
        },
      });
      const slotId = useWorkspaceStore.getState().synced!.globalAssets.files![assetId].slotId;

      await useWorkspaceStore.getState().removeGlobalFileAsset(assetId);

      expect(useWorkspaceStore.getState().local!.pendingAttachmentDeletes).toContain(slotId);
    });

    it('does NOT queue a remote delete for a local-only asset (no push refs)', async () => {
      // The asset was uploaded but never pushed — bytes are only in
      // local IDB, there is no remote tree entry to delete. Queueing
      // would waste a tree entry on the next push.
      const file = new File([new Uint8Array([7, 7, 7])], 'local.bin', {
        type: 'application/octet-stream',
      });
      const assetId = await useWorkspaceStore.getState().addGlobalFileAsset(file);
      const slotId = useWorkspaceStore.getState().synced!.globalAssets.files![assetId].slotId;
      const queueBefore = useWorkspaceStore.getState().local!.pendingAttachmentDeletes ?? [];

      await useWorkspaceStore.getState().removeGlobalFileAsset(assetId);

      const queueAfter = useWorkspaceStore.getState().local!.pendingAttachmentDeletes ?? [];
      expect(queueAfter).not.toContain(slotId);
      // The local-only asset still had its IDB bytes freed.
      expect(await getAttachment(slotId)).toBeNull();
      // Sanity: queue length unchanged for the slots NOT involved.
      expect(queueAfter.length).toBe(queueBefore.length);
    });

    it('dedupes — calling removeGlobalFileAsset cannot queue the same slot twice', async () => {
      // Defensive: a user double-clicking delete shouldn't grow the
      // queue. The asset can only be deleted ONCE (second call returns
      // early because the asset is no longer in the registry), but if
      // somehow the slot ended up queued twice it would be a wasted
      // tree entry. The store helper itself dedupes.
      const file = new File([new Uint8Array([8, 8, 8])], 'dup.bin', {
        type: 'application/octet-stream',
      });
      const assetId = await useWorkspaceStore.getState().addGlobalFileAsset(file);
      const synced = useWorkspaceStore.getState().synced!;
      useWorkspaceStore.setState({
        synced: {
          ...synced,
          globalAssets: {
            ...synced.globalAssets,
            files: {
              ...synced.globalAssets.files,
              [assetId]: {
                ...synced.globalAssets.files![assetId],
                workingBranchRef: {
                  branchName: 'wb',
                  blobSha: 'b',
                  verifiedAt: '2026-06-06T00:00:00.000Z',
                },
              },
            },
          },
        },
      });
      const slotId = useWorkspaceStore.getState().synced!.globalAssets.files![assetId].slotId;

      await useWorkspaceStore.getState().removeGlobalFileAsset(assetId);
      // Second call is a no-op (asset no longer exists); even if the
      // queue helper got called again with the same slotId, dedupe
      // prevents a duplicate.
      await useWorkspaceStore.getState().removeGlobalFileAsset(assetId);

      const queue = useWorkspaceStore.getState().local!.pendingAttachmentDeletes ?? [];
      const matching = queue.filter((s) => s === slotId);
      expect(matching).toHaveLength(1);
    });
  });
});
