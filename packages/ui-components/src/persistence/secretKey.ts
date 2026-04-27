// Master AES-GCM key for the local browser. Used to encrypt:
//   - environment-variable values flagged `encrypted: true`
//   - Secret Vault entries
//
// The key never leaves this machine. On first use we generate it and persist
// the JWK in a tiny IndexedDB store; subsequent sessions import it back.
// Lose-the-key recovery is intentionally not provided in v2 P3 — users who
// reinstall the app will need to re-enter their secrets. A "team-shared
// passphrase" model can be layered on top in a later phase.

import { exportKey, generateAesKey, importKey } from '@apicircle-v2/core';

const DB_NAME = 'apicircle-secret-key';
const DB_VERSION = 1;
const STORE = 'master-key';
const KEY = 'current';

let dbPromise: Promise<IDBDatabase> | null = null;
let cachedKey: CryptoKey | null = null;

export function __resetSecretKeyForTests(): void {
  dbPromise = null;
  cachedKey = null;
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
    req.onerror = () => reject(req.error ?? new Error('secret-key DB open failed'));
  });
  return dbPromise;
}

async function readJwk(): Promise<JsonWebKey | null> {
  const db = await openDb();
  return new Promise<JsonWebKey | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as JsonWebKey | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('secret-key read failed'));
  });
}

async function writeJwk(jwk: JsonWebKey): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(jwk, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('secret-key write failed'));
  });
}

/**
 * Get the master key, generating + persisting one on first call. Cached in
 * memory for the lifetime of the page; reset between tests via the helper
 * above. Concurrent callers share the same in-flight promise.
 */
export async function getMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const existing = await readJwk();
  if (existing) {
    cachedKey = await importKey(existing);
    return cachedKey;
  }
  const fresh = await generateAesKey();
  await writeJwk(await exportKey(fresh));
  cachedKey = fresh;
  return fresh;
}
