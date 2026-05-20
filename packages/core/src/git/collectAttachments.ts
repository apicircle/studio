import type { WorkspaceSynced } from '@apicircle/shared';

// Attachment slots referenced by the synced doc. Push (P4.3b) walks
// every request body and bundles each referenced blob into the same
// Git Tree commit as workspace.json — so the repo always carries a
// self-consistent snapshot.

export interface AttachmentSlotRef {
  slotId: string;
  sha256?: string;
  filename?: string;
  mimeType?: string;
  size?: number;
}

/**
 * Walk every request in the synced doc and return one entry per unique
 * attachment slotId it references. Form-data file rows and the binary
 * body's attachment ref both contribute. Duplicates (same slotId
 * referenced twice — defensive only; slot ids are normally unique) are
 * collapsed; the first occurrence wins.
 */
export function collectAttachmentSlots(synced: WorkspaceSynced): AttachmentSlotRef[] {
  const seen = new Map<string, AttachmentSlotRef>();
  for (const req of Object.values(synced.collections.requests)) {
    if (req.body.type === 'form-data' && req.body.formRows) {
      for (const row of req.body.formRows) {
        if (row.kind === 'file' && row.slotId && !seen.has(row.slotId)) {
          seen.set(row.slotId, {
            slotId: row.slotId,
            sha256: row.sha256,
            filename: row.filename,
            mimeType: row.mimeType,
            size: row.size,
          });
        }
      }
    }
    if (req.body.type === 'binary') {
      const ref = req.body.attachment;
      if (ref?.slotId && !seen.has(ref.slotId)) {
        seen.set(ref.slotId, {
          slotId: ref.slotId,
          sha256: ref.sha256,
          filename: ref.filename,
          mimeType: ref.mimeType,
          size: ref.size,
        });
      }
    }
  }
  return [...seen.values()];
}
