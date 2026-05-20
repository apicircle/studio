/**
 * PKCE (Proof Key for Code Exchange — RFC 7636) primitives.
 *
 * Authorization-code grant adds a `code_verifier` (43–128 random URL-safe
 * chars) generated on the client. The auth request carries a derived
 * `code_challenge` (either the verifier itself for `plain`, or
 * `BASE64URL(SHA-256(verifier))` for `S256`); the token-exchange request
 * carries the verifier itself. The server confirms `H(verifier) === challenge`
 * before issuing tokens, neutralizing intercepted authorization codes.
 *
 * S256 is the only method we recommend; `plain` exists in the spec for
 * environments without SHA-256 (basically none today). We support both
 * because some legacy IdPs still negotiate `plain` even when S256 is
 * available.
 */

// 64-character subset of the RFC 7636 unreserved set. The drop from 66
// (the spec's max) to 64 lets us mask with `& 0x3f` instead of `% 66`,
// which avoids modulo bias — `byte % 66` maps values 0..189 to two chars
// each and 190..255 to one char each, so two characters appear ~1.34× more
// often than the rest. Microscopic in 64-byte verifiers, but trivial to fix.
const VERIFIER_ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_';

/**
 * Generate a fresh PKCE code verifier — 43..128 random characters from
 * the unreserved URL set (RFC 3986 §2.3). Default length is 64, well
 * inside the spec's allowed range.
 *
 * Sampling is uniform: we mask each random byte with `& 0x3f` to project
 * onto exactly 64 alphabet positions, so every alphabet character is
 * equally likely. The earlier `% 66` implementation introduced a small
 * but measurable modulo bias.
 */
export function generateCodeVerifier(length: number = 64): string {
  if (length < 43 || length > 128) {
    throw new Error(`PKCE verifier length must be 43..128 (got ${length})`);
  }
  const bytes = new Uint8Array(length);
  crypto.getRandomValues(bytes);
  let out = '';
  for (let i = 0; i < length; i++) {
    out += VERIFIER_ALPHABET[bytes[i] & 0x3f];
  }
  return out;
}

export type PkceMethod = 'S256' | 'plain';

/**
 * Compute the `code_challenge` that pairs with a verifier. The browser's
 * SubtleCrypto handles SHA-256; for `plain` we just echo the verifier.
 */
export async function computeCodeChallenge(
  verifier: string,
  method: PkceMethod = 'S256',
): Promise<string> {
  if (method === 'plain') return verifier;
  const data = new TextEncoder().encode(verifier);
  const hash = await crypto.subtle.digest(
    'SHA-256',
    data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength),
  );
  return base64UrlEncode(new Uint8Array(hash));
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
