// Master AES-GCM key for the local browser. Used to encrypt:
//   - environment-variable values flagged `encrypted: true`
//   - Secret Vault entries
//
// The key never leaves this machine. On first use we generate it and persist
// the JWK in a tiny IndexedDB store; subsequent sessions import it back.
// Lose-the-key recovery is intentionally not provided in v2 P3 — users who
// reinstall the app will need to re-enter their secrets. A "team-shared
// passphrase" model can be layered on top in a later phase.
//
// Desktop: when `globalThis.apicircleDesktop` is present (Electron preload),
// the JWK is wrapped with the OS keychain via `safeStorage` before it
// touches IndexedDB. Web has no bridge → JWK lands in IDB unwrapped, same
// as today. Both paths share the same `getMasterKey()` API.

import { exportKey, generateAesKey, importKey } from '@apicircle/core';
import { getNativeSecretBridge } from './nativeSecretBridge';

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

/**
 * Stored shape on the desktop is a base64 ciphertext (prefixed with a
 * marker so we can spot the format on a future migration). On web it's
 * the JWK object directly.
 */
type StoredKey = JsonWebKey | { __nativeWrapped: true; ciphertext: string };

async function readStored(): Promise<StoredKey | null> {
  const db = await openDb();
  return new Promise<StoredKey | null>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readonly');
    const req = tx.objectStore(STORE).get(KEY);
    req.onsuccess = () => resolve((req.result as StoredKey | undefined) ?? null);
    req.onerror = () => reject(req.error ?? new Error('secret-key read failed'));
  });
}

async function writeStored(value: StoredKey): Promise<void> {
  const db = await openDb();
  return new Promise<void>((resolve, reject) => {
    const tx = db.transaction(STORE, 'readwrite');
    tx.objectStore(STORE).put(value, KEY);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error ?? new Error('secret-key write failed'));
  });
}

/**
 * Get the master key, generating + persisting one on first call. Cached in
 * memory for the lifetime of the page; reset between tests via the helper
 * above. Concurrent callers share the same in-flight promise.
 *
 * On desktop (when the native bridge is available) the JWK is wrapped
 * with the OS keychain before persistence. The wrapping is transparent
 * to callers — both web and desktop paths return a usable CryptoKey.
 */
export async function getMasterKey(): Promise<CryptoKey> {
  if (cachedKey) return cachedKey;
  const bridge = getNativeSecretBridge();
  const useBridge = bridge !== null && (await bridge.isEncryptionAvailable());

  const stored = await readStored();
  if (stored) {
    const jwk = await unwrapStoredKey(stored, bridge, useBridge);
    if (jwk) {
      cachedKey = await importKey(jwk);
      return cachedKey;
    }
    // Stored payload couldn't be unwrapped (cross-machine copy, rotated
    // platform key, etc) — fall through to generate a fresh one. We don't
    // try to preserve old encrypted env vars / vault entries because they
    // can't be decrypted anyway.
  }

  const fresh = await generateAesKey();
  const jwk = await exportKey(fresh);
  await writeStored(await wrapJwk(jwk, bridge, useBridge));
  cachedKey = fresh;
  return fresh;
}

async function unwrapStoredKey(
  stored: StoredKey,
  bridge: ReturnType<typeof getNativeSecretBridge>,
  useBridge: boolean,
): Promise<JsonWebKey | null> {
  if ('__nativeWrapped' in stored) {
    if (!bridge || !useBridge) return null; // can't unwrap without the bridge
    try {
      const json = await bridge.decryptString(stored.ciphertext);
      return JSON.parse(json) as JsonWebKey;
    } catch {
      return null;
    }
  }
  return stored;
}

async function wrapJwk(
  jwk: JsonWebKey,
  bridge: ReturnType<typeof getNativeSecretBridge>,
  useBridge: boolean,
): Promise<StoredKey> {
  if (!bridge || !useBridge) return jwk;
  const ciphertext = await bridge.encryptString(JSON.stringify(jwk));
  return { __nativeWrapped: true, ciphertext };
}
