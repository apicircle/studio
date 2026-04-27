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

/**
 * Test-only: drop the cached DB connection so the next call to openDb()
 * re-opens against whichever IndexedDB factory is currently installed
 * globally (e.g. a fresh fake-indexeddb instance per test).
 *
 * Not exported from the package barrel — internal to test setup.
 */
export function __resetDbForTests(): void {
  dbPromise = null;
}

function asError(value: DOMException | Error | null, fallback: string): Error {
  if (value instanceof Error) return value;
  return new Error(fallback);
}

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
    req.onerror = () => reject(asError(req.error, 'IndexedDB open failed'));
  });
  return dbPromise;
}

export async function readRecord<T>(
  store: typeof SYNCED_STORE | typeof LOCAL_STORE,
): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(KEY);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(asError(req.error, 'IndexedDB read failed'));
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
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB write failed'));
    tx.onabort = () => reject(asError(tx.error, 'IndexedDB write aborted'));
  });
}

export async function writeBoth<S, L>(synced: S | null, local: L | null): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SYNCED_STORE, LOCAL_STORE], 'readwrite');
    if (synced !== null) tx.objectStore(SYNCED_STORE).put(synced, KEY);
    if (local !== null) tx.objectStore(LOCAL_STORE).put(local, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB writeBoth failed'));
    tx.onabort = () => reject(asError(tx.error, 'IndexedDB writeBoth aborted'));
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SYNCED_STORE, LOCAL_STORE], 'readwrite');
    tx.objectStore(SYNCED_STORE).clear();
    tx.objectStore(LOCAL_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB clearAll failed'));
  });
}
