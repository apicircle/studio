// Tiny IndexedDB wrapper for the multi-workspace schema. One database,
// three object stores:
//
//   `synced`   — keyed by workspaceId, holds `WorkspaceSynced` per workspace.
//   `local`    — keyed by workspaceId, holds `WorkspaceLocal` per workspace.
//   `registry` — keyed by 'meta', holds the workspace registry +
//                activeWorkspaceId. Single record.
//
// Pre-B.6 the synced/local stores were keyed by the literal `'current'`,
// holding a single workspace. The version-3 upgrade reads any pre-existing
// `current` record on each store, re-keys it under its own workspaceId,
// and seeds a registry entry. Existing single-workspace data round-trips
// without loss.

const DB_NAME = 'apicircle-workspace';
const DB_VERSION = 3;
export const SYNCED_STORE = 'synced';
export const LOCAL_STORE = 'local';
export const REGISTRY_STORE = 'registry';
const REGISTRY_KEY = 'meta';
/** Legacy single-workspace key used pre-B.6. We migrate records keyed by this. */
const LEGACY_KEY = 'current';

export interface WorkspaceRegistryEntry {
  id: string;
  name: string;
  /** ISO timestamp of the last switch-to or create event. Drives ordering in pickers. */
  lastOpenedAt: string;
  /** ISO timestamp the entry was first registered. */
  createdAt: string;
}

export interface WorkspaceRegistry {
  schemaVersion: 1;
  activeWorkspaceId: string | null;
  workspaces: WorkspaceRegistryEntry[];
}

let dbPromise: Promise<IDBDatabase> | null = null;

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
    req.onupgradeneeded = (event) => {
      const db = req.result;
      const tx = req.transaction;
      if (!db.objectStoreNames.contains(SYNCED_STORE)) db.createObjectStore(SYNCED_STORE);
      if (!db.objectStoreNames.contains(LOCAL_STORE)) db.createObjectStore(LOCAL_STORE);
      if (!db.objectStoreNames.contains(REGISTRY_STORE)) db.createObjectStore(REGISTRY_STORE);

      // v3 (B.6) migration: re-key any legacy `'current'` record under
      // its own workspaceId, and seed the registry. Idempotent — safe
      // to re-run if v3 was partially applied earlier.
      if (event.oldVersion < 3 && tx) {
        migrateLegacyToMultiWorkspace(tx);
      }
    };
    req.onsuccess = () => {
      const db = req.result;
      db.onversionchange = () => {
        db.close();
        dbPromise = null;
      };
      resolve(db);
    };
    req.onerror = () => reject(asError(req.error, 'IndexedDB open failed'));
  });
  return dbPromise;
}

function migrateLegacyToMultiWorkspace(tx: IDBTransaction): void {
  const syncedStore = tx.objectStore(SYNCED_STORE);
  const localStore = tx.objectStore(LOCAL_STORE);
  const registryStore = tx.objectStore(REGISTRY_STORE);
  const syncedReq = syncedStore.get(LEGACY_KEY);
  const localReq = localStore.get(LEGACY_KEY);
  Promise.all([
    new Promise<unknown>((res) => {
      syncedReq.onsuccess = () => res(syncedReq.result);
      syncedReq.onerror = () => res(null);
    }),
    new Promise<unknown>((res) => {
      localReq.onsuccess = () => res(localReq.result);
      localReq.onerror = () => res(null);
    }),
  ])
    .then(([syncedLegacy, localLegacy]) => {
      const synced = syncedLegacy as { workspaceId?: string; workspaceName?: string } | null;
      const local = localLegacy as { workspaceId?: string } | null;
      const id = synced?.workspaceId ?? local?.workspaceId;
      if (!id) return;
      // Re-key under workspaceId, drop the legacy `'current'` entries. We
      // strip `workspaceName` off the synced doc on the way through —
      // newer schemas keep the workspace's display name on the local
      // registry entry only (the migration uses the legacy name as a
      // seed for that entry, then drops the field from the git-tracked
      // doc).
      if (synced) {
        const { workspaceName: _legacyName, ...syncedClean } = synced;
        void _legacyName;
        syncedStore.put(syncedClean, id);
      }
      if (local) localStore.put(local, id);
      syncedStore.delete(LEGACY_KEY);
      localStore.delete(LEGACY_KEY);
      const now = new Date().toISOString();
      const registry: WorkspaceRegistry = {
        schemaVersion: 1,
        activeWorkspaceId: id,
        workspaces: [
          {
            id,
            name: synced?.workspaceName ?? 'My Workspace',
            lastOpenedAt: now,
            createdAt: now,
          },
        ],
      };
      registryStore.put(registry, REGISTRY_KEY);
    })
    .catch(() => {
      /* migration is best-effort; failures fall through to the no-record boot path */
    });
}

export async function readRecord<T>(
  store: typeof SYNCED_STORE | typeof LOCAL_STORE,
  workspaceId: string,
): Promise<T | null> {
  const db = await openDb();
  return new Promise<T | null>((resolve, reject) => {
    const tx = db.transaction(store, 'readonly');
    const req = tx.objectStore(store).get(workspaceId);
    req.onsuccess = () => resolve((req.result as T | undefined) ?? null);
    req.onerror = () => reject(asError(req.error, 'IndexedDB read failed'));
  });
}

export async function writeRecord<T extends { workspaceId: string }>(
  store: typeof SYNCED_STORE | typeof LOCAL_STORE,
  value: T,
): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(store, 'readwrite');
    tx.objectStore(store).put(value, value.workspaceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB write failed'));
    tx.onabort = () => reject(asError(tx.error, 'IndexedDB write aborted'));
  });
}

export async function writeBoth<
  S extends { workspaceId: string },
  L extends { workspaceId: string },
>(synced: S | null, local: L | null): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SYNCED_STORE, LOCAL_STORE], 'readwrite');
    if (synced !== null) tx.objectStore(SYNCED_STORE).put(synced, synced.workspaceId);
    if (local !== null) tx.objectStore(LOCAL_STORE).put(local, local.workspaceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB writeBoth failed'));
    tx.onabort = () => reject(asError(tx.error, 'IndexedDB writeBoth aborted'));
  });
}

export async function deleteWorkspaceRecords(workspaceId: string): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SYNCED_STORE, LOCAL_STORE], 'readwrite');
    tx.objectStore(SYNCED_STORE).delete(workspaceId);
    tx.objectStore(LOCAL_STORE).delete(workspaceId);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB delete failed'));
  });
}

export async function readRegistry(): Promise<WorkspaceRegistry | null> {
  const db = await openDb();
  return new Promise<WorkspaceRegistry | null>((resolve, reject) => {
    const tx = db.transaction(REGISTRY_STORE, 'readonly');
    const req = tx.objectStore(REGISTRY_STORE).get(REGISTRY_KEY);
    req.onsuccess = () => resolve((req.result as WorkspaceRegistry | undefined) ?? null);
    req.onerror = () => reject(asError(req.error, 'IndexedDB registry read failed'));
  });
}

export async function writeRegistry(registry: WorkspaceRegistry): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(REGISTRY_STORE, 'readwrite');
    tx.objectStore(REGISTRY_STORE).put(registry, REGISTRY_KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB registry write failed'));
  });
}

export async function clearAll(): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction([SYNCED_STORE, LOCAL_STORE, REGISTRY_STORE], 'readwrite');
    tx.objectStore(SYNCED_STORE).clear();
    tx.objectStore(LOCAL_STORE).clear();
    tx.objectStore(REGISTRY_STORE).clear();
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(asError(tx.error, 'IndexedDB clearAll failed'));
  });
}
