// IndexedDB store for binary file attachments referenced by request bodies.
// Lives in its own database so the workspace DB schema doesn't have to bump
// when attachment storage evolves.
//
// Bytes are stored as Uint8Array rather than Blob. TypedArrays round-trip
// through IndexedDB's structured clone in every environment (including
// fake-indexeddb under jsdom, where Blob class identity is otherwise lost).
// The Blob is reconstructed on demand via `materializeAttachment` when the
// executor needs to feed it to fetch().

const DB_NAME = 'apicircle-attachments';
const DB_VERSION = 1;
const STORE = 'blobs';

export interface AttachmentRecord {
  slotId: string;
  filename: string;
  mimeType: string;
  size: number;
  // SHA-256 hex digest of `bytes`. Mirrored into the synced doc so the CLI
  // and teammates can verify integrity without trusting the IDB cache.
  sha256: string;
  savedAt: string;
  bytes: Uint8Array;
}

let dbPromise: Promise<IDBDatabase> | null = null;

export function __resetAttachmentsForTests(): void {
  dbPromise = null;
}

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('attachments DB open failed'));
  });
  return dbPromise;
}

export async function putAttachment(record: AttachmentRecord): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(record, record.slotId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('attachment put failed'));
  });
}

export async function getAttachment(slotId: string): Promise<AttachmentRecord | null> {
  const db = await openDb();
  return new Promise<AttachmentRecord | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(slotId);
    req.onsuccess = () => resolve((req.result as AttachmentRecord | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('attachment get failed'));
  });
}

export async function deleteAttachment(slotId: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(slotId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('attachment delete failed'));
  });
}

export async function deleteManyAttachments(slotIds: string[]): Promise<void> {
  if (slotIds.length === 0) return;
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    const store = tx.objectStore(STORE);
    for (const id of slotIds) store.delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('attachment bulk delete failed'));
  });
}

/**
 * Read a File's bytes. Prefers the standard `File.arrayBuffer()` and falls
 * back to FileReader in environments (notably jsdom) where the method is
 * absent on the File constructor.
 */
export async function bytesFromFile(file: File): Promise<Uint8Array> {
  if (typeof file.arrayBuffer === 'function') {
    return new Uint8Array(await file.arrayBuffer());
  }
  return new Promise<Uint8Array>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(new Uint8Array(reader.result as ArrayBuffer));
    reader.onerror = () => reject(reader.error ?? new Error('FileReader failed'));
    reader.readAsArrayBuffer(file);
  });
}

/**
 * Build an AttachmentRecord from a File picked through `<input type="file">`.
 * The caller passes the slotId so it can be stored in the request body's
 * reference at the same time. Computes a SHA-256 hex digest in the same
 * pass so the synced doc can carry it for integrity checks.
 */
export async function createAttachmentFromFile(
  file: File,
  slotId: string,
): Promise<AttachmentRecord> {
  const bytes = await bytesFromFile(file);
  return {
    slotId,
    filename: file.name,
    mimeType: file.type || 'application/octet-stream',
    size: file.size,
    sha256: await sha256Hex(bytes),
    savedAt: new Date().toISOString(),
    bytes,
  };
}

async function sha256Hex(bytes: Uint8Array): Promise<string> {
  // SubtleCrypto.digest accepts BufferSource. Cast the Uint8Array to satisfy
  // TS 5.9's `Uint8Array<ArrayBufferLike>` typing without re-wrapping the
  // buffer (jsdom rejects detached `.buffer` references on round-trip).
  const source = bytes as unknown as BufferSource;
  const digest = await crypto.subtle.digest('SHA-256', source);
  return [...new Uint8Array(digest)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

/** Materialize an AttachmentRecord into a Blob for fetch(). */
export function materializeAttachment(record: AttachmentRecord): Blob {
  // TS 5.9 typed `Uint8Array` as `Uint8Array<ArrayBufferLike>` which is not
  // directly assignable to `BlobPart`. Wrapping in a fresh view normalizes
  // the buffer to `ArrayBuffer` so the BlobPart shape is satisfied.
  const view = new Uint8Array(record.bytes);
  return new Blob([view.buffer], { type: record.mimeType });
}
