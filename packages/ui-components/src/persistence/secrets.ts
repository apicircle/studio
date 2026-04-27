// Secret Vault IDB store. Holds the actual encrypted value for each
// vault entry, keyed by the secret's id. Metadata (label, origin,
// usedIn[]) lives in `WorkspaceLocal.secretIndex` — this store is the
// payload side of the index.
//
// Encrypted values never round-trip through Git: only the local browser
// holds the master key needed to decrypt them.

import type { EncryptedPayload } from '@apicircle-v2/core';

const DB_NAME = 'apicircle-secret-vault';
const DB_VERSION = 1;
const STORE = 'entries';

let dbPromise: Promise<IDBDatabase> | null = null;

export function __resetSecretsForTests(): void {
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
    req.onerror = () => reject(req.error ?? new Error('secrets DB open failed'));
  });
  return dbPromise;
}

export async function putSecretPayload(id: string, payload: EncryptedPayload): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(payload, id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('secret put failed'));
  });
}

export async function getSecretPayload(id: string): Promise<EncryptedPayload | null> {
  const db = await openDb();
  return new Promise<EncryptedPayload | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(id);
    req.onsuccess = () => resolve((req.result as EncryptedPayload | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('secret get failed'));
  });
}

export async function deleteSecretPayload(id: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).delete(id);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('secret delete failed'));
  });
}
