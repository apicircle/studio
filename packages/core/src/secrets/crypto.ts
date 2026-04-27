// AES-GCM encryption helpers used by:
//   - Encrypted environment variables (ciphertext lives in workspace.json,
//     pushed to Git; decryption key never leaves the local browser).
//   - Secret Vault entries (ciphertext in IDB only, never pushed).
//
// All helpers take a CryptoKey as input — key generation + persistence is
// the host's responsibility (see ui-components/persistence/secretKey.ts).

const IV_BYTES = 12; // 96-bit IV is the recommended size for AES-GCM
const ALG = 'AES-GCM';

export interface EncryptedPayload {
  iv: string; // base64
  ciphertext: string; // base64
}

/**
 * Encrypt a UTF-8 string with the given AES-GCM key. Returns base64-encoded
 * iv + ciphertext, safe to embed in JSON / push to Git.
 */
export async function encryptString(plaintext: string, key: CryptoKey): Promise<EncryptedPayload> {
  const iv = crypto.getRandomValues(new Uint8Array(IV_BYTES));
  const data = new TextEncoder().encode(plaintext);
  const cipher = await crypto.subtle.encrypt(
    { name: ALG, iv: iv as unknown as BufferSource },
    key,
    data,
  );
  return {
    iv: bytesToBase64(iv),
    ciphertext: bytesToBase64(new Uint8Array(cipher)),
  };
}

/**
 * Decrypt a payload produced by `encryptString`. Throws on bad key, tampered
 * ciphertext, or malformed input.
 */
export async function decryptString(payload: EncryptedPayload, key: CryptoKey): Promise<string> {
  const iv = base64ToBytes(payload.iv);
  const ciphertext = base64ToBytes(payload.ciphertext);
  const plain = await crypto.subtle.decrypt(
    { name: ALG, iv: iv as unknown as BufferSource },
    key,
    ciphertext as unknown as BufferSource,
  );
  return new TextDecoder().decode(plain);
}

/**
 * Generate a fresh AES-GCM 256-bit key. The host persists it (typically as
 * a JWK in IndexedDB) so subsequent sessions can decrypt prior values.
 */
export function generateAesKey(): Promise<CryptoKey> {
  return crypto.subtle.generateKey({ name: ALG, length: 256 }, true, ['encrypt', 'decrypt']);
}

/** Export an AES-GCM key as a JSON Web Key (for IDB storage). */
export async function exportKey(key: CryptoKey): Promise<JsonWebKey> {
  return crypto.subtle.exportKey('jwk', key);
}

/** Import an AES-GCM key previously exported via `exportKey`. */
export function importKey(jwk: JsonWebKey): Promise<CryptoKey> {
  return crypto.subtle.importKey('jwk', jwk, { name: ALG }, true, ['encrypt', 'decrypt']);
}

/**
 * Serialize an EncryptedPayload to a single string we can store in
 * `Environment.variables[i].value`. The schema is `enc:v1:<iv>:<ciphertext>`
 * — versioned so we can rotate algorithms later without ambiguity.
 */
export function serializePayload(payload: EncryptedPayload): string {
  return `enc:v1:${payload.iv}:${payload.ciphertext}`;
}

export function tryParsePayload(value: string): EncryptedPayload | null {
  if (!value.startsWith('enc:v1:')) return null;
  const parts = value.split(':');
  if (parts.length !== 4) return null;
  return { iv: parts[2], ciphertext: parts[3] };
}

// --- internal --------------------------------------------------------------

function bytesToBase64(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) binary += String.fromCharCode(b);
  return btoa(binary);
}

function base64ToBytes(b64: string): Uint8Array {
  const binary = atob(b64);
  const out = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) out[i] = binary.charCodeAt(i);
  return out;
}
