// Tiny IndexedDB wrapper for the two-document workspace schema.
// One database, two object stores: `synced` and `local`. Each store holds a
// single record keyed `'current'`. Writes are serialized via a per-store
// transaction; cross-store atomic writes use one transaction with both stores
// in `readwrite` mode.

const DB_NAME = 'apicircle-workspace';
const DB_VERSION = 1;
export const SYNCED_STORE = 'synced';
export const LOCAL_STORE = 'local';
const KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;

function openDb(): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(SYNCED_STORE)) db.createObjectStore(SYNCED_STORE);
      if (!db.objectStoreNames.contains(LOCAL_STORE)) db.createObjectStore(LOCAL_STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
  return dbPromise;
}

export async function readRecord<T>(store: typeof SYNCED_STORE | typeof LOCAL_STORE): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(KEY);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(req.error);
  });
}

export async function writeRecord<T>(
  store: typeof SYNCED_STORE | typeof LOCAL_STORE,
  value: T,
): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function writeBoth<S, L>(synced: S | null, local: L | null): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SYNCED_STORE, LOCAL_STORE], 'readwrite');
    if (synced !== null) tx.objectStore(SYNCED_STORE).put(synced, KEY);
    if (local !== null) tx.objectStore(LOCAL_STORE).put(local, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SYNCED_STORE, LOCAL_STORE], 'readwrite');
    tx.objectStore(SYNCED_STORE).clear();
    tx.objectStore(LOCAL_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
  });
}
