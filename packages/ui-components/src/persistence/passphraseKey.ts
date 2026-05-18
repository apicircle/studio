// Workspace-passphrase secret model.
//
// The master AES-GCM key is *derived* from a user-supplied passphrase
// plus a per-workspace salt, so encrypted secret values can travel through
// git unchanged and any teammate who knows the passphrase can decrypt
// them. Lose the passphrase, lose the secrets — there is no recovery.
//
// Storage shape on the workspace (synced.secretCrypto):
//   {
//     kdf:        'pbkdf2-sha256-v1',
//     salt:       base64(16 random bytes),
//     iterations: 600_000,        // OWASP 2023 PBKDF2-HMAC-SHA-256 floor
//     verifier:   base64(HMAC of a fixed sentinel under the derived key)
//   }
//
// The verifier lets us reject a wrong passphrase up front instead of
// failing every decrypt downstream with an opaque "bad tag" error.
//
// The passphrase itself is held only in renderer memory (Zustand store
// field, NOT serialised to IDB). On app restart the user is prompted
// to re-enter it before any secret can be touched.

const PBKDF2_HASH = 'SHA-256';
// PBKDF2 iteration count for newly-created workspaces. Bumped from 600k to
// 1.2M as part of Phase 8: the passphrase verifier ships in the synced doc
// (so any teammate can validate the passphrase without contacting the
// owner), which means the verifier — and therefore an offline brute-force
// oracle — is in every clone of the repo. Doubling the work-factor keeps
// per-attempt cost above ~1s on commodity GPU hardware. Existing workspaces
// keep their original iteration count (it's stamped into `SecretCrypto`).
const PBKDF2_ITERATIONS = 1_200_000;
const SALT_BYTES = 16;
const VERIFIER_SENTINEL = 'apicircle/passphrase-verifier/v1';

export interface SecretCrypto {
  kdf: 'pbkdf2-sha256-v1';
  /** Base64-encoded random salt; 16 bytes. */
  salt: string;
  /** PBKDF2 iteration count baked at workspace-creation time. */
  iterations: number;
  /** Base64-encoded HMAC-SHA256(`apicircle/passphrase-verifier/v1`, key). */
  verifier: string;
}

function base64Encode(bytes: Uint8Array): string {
  let binary = '';
  for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
  return btoa(binary);
}

function base64Decode(b64: string): Uint8Array {
  const binary = atob(b64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

function utf8Bytes(s: string): Uint8Array {
  return new TextEncoder().encode(s);
}

/**
 * Derive an AES-GCM key from a passphrase + salt + iteration count. Pure;
 * no caching here — the caller (the store) holds the unlocked key for
 * the session.
 */
async function deriveKey(
  passphrase: string,
  salt: Uint8Array,
  iterations: number,
): Promise<CryptoKey> {
  // The casts to BufferSource are a TS-only concession: TS 5+ types
  // Uint8Array as generic over ArrayBufferLike (which includes
  // SharedArrayBuffer), while WebCrypto's BufferSource only accepts the
  // non-shared variant. At runtime our buffers are always ArrayBuffer.
  const baseKey = await crypto.subtle.importKey(
    'raw',
    utf8Bytes(passphrase) as BufferSource,
    { name: 'PBKDF2' },
    false,
    ['deriveKey'],
  );
  return crypto.subtle.deriveKey(
    {
      name: 'PBKDF2',
      salt: salt as BufferSource,
      iterations,
      hash: PBKDF2_HASH,
    },
    baseKey,
    { name: 'AES-GCM', length: 256 },
    /* extractable */ false,
    ['encrypt', 'decrypt'],
  );
}

/**
 * Compute the verifier — encrypts a fixed sentinel under the derived key
 * with a zero IV and stores the GCM tag (concatenated with ciphertext).
 * Comparing this against the stored verifier is a constant-cost way to
 * tell a right passphrase from a wrong one without exposing the key.
 *
 * Note: GCM with a zero IV is *fine here* because we use the key for one
 * single byte of input that's always the same — there is no encryption
 * uniqueness requirement. We do NOT reuse this IV for any real ciphertext.
 */
async function computeVerifier(key: CryptoKey): Promise<string> {
  const iv = new Uint8Array(12); // 12 zero bytes — only used here
  const ct = await crypto.subtle.encrypt(
    { name: 'AES-GCM', iv: iv as BufferSource },
    key,
    utf8Bytes(VERIFIER_SENTINEL) as BufferSource,
  );
  return base64Encode(new Uint8Array(ct));
}

/**
 * Initialise the workspace's secret crypto state. Called the first time
 * the user creates a passphrase (new workspace or first secret added in
 * a workspace that hasn't set one).
 *
 * Returns the SecretCrypto blob to persist in workspace.json **and** the
 * derived key so the caller can immediately use it.
 *
 * The `iterations` override exists for tests — production callers should
 * always use the default `PBKDF2_ITERATIONS` (OWASP floor). Tests pin a
 * smaller count so the suite stays fast under parallel load; the
 * algorithm path is identical either way.
 */
export async function initSecretCrypto(
  passphrase: string,
  iterations: number = PBKDF2_ITERATIONS,
): Promise<{ crypto: SecretCrypto; key: CryptoKey }> {
  if (passphrase.length === 0) throw new Error('Passphrase cannot be empty');
  if (iterations < 1) throw new Error('iterations must be >= 1');
  const salt = crypto.getRandomValues(new Uint8Array(SALT_BYTES));
  const key = await deriveKey(passphrase, salt, iterations);
  const verifier = await computeVerifier(key);
  return {
    crypto: {
      kdf: 'pbkdf2-sha256-v1',
      salt: base64Encode(salt),
      iterations,
      verifier,
    },
    key,
  };
}

/**
 * Unlock the workspace given a passphrase + the stored SecretCrypto blob.
 *
 * Returns `{ ok: true, key }` on a successful passphrase match (verifier
 * matches), `{ ok: false }` on any mismatch — wrong passphrase, corrupt
 * blob, unsupported KDF. The caller surfaces the right UX for each.
 */
export async function unlockSecretCrypto(
  passphrase: string,
  blob: SecretCrypto,
): Promise<{ ok: true; key: CryptoKey } | { ok: false; reason: string }> {
  if (blob.kdf !== 'pbkdf2-sha256-v1') {
    return { ok: false, reason: `Unsupported KDF: ${String(blob.kdf)}` };
  }
  let salt: Uint8Array;
  try {
    salt = base64Decode(blob.salt);
  } catch {
    return { ok: false, reason: 'Workspace secret salt is corrupt.' };
  }
  let key: CryptoKey;
  try {
    key = await deriveKey(passphrase, salt, blob.iterations);
  } catch (err) {
    return { ok: false, reason: err instanceof Error ? err.message : 'Key derivation failed' };
  }
  const verifier = await computeVerifier(key);
  if (verifier !== blob.verifier) {
    return { ok: false, reason: 'Wrong passphrase.' };
  }
  return { ok: true, key };
}
