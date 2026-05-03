/**
 * JWT (RFC 7519) signing — Bearer token generation.
 *
 * This is the "self-signed assertion" variant of `jwt-bearer` auth: the
 * client mints a JWT signed with its own key, then sends it as
 * `Authorization: Bearer <jwt>`. Different from OAuth2 JWT-bearer flow
 * (RFC 7523) where the JWT is exchanged at a token endpoint for an
 * access token — that flow goes through `auth/oauth2/grants.ts` and
 * uses this signer to mint the assertion.
 *
 * Algorithms:
 *  - HS256 / HS384 / HS512: HMAC with shared secret (most common).
 *  - RS256 / RS384 / RS512: RSA-SHA — caller supplies a private key
 *    in PKCS#8 PEM. Imported via `crypto.subtle.importKey`.
 *  - ES256 / ES384 / ES512: ECDSA-P256/384/521 — same PKCS#8 path.
 *  - **none**: refused. Always reject `alg: "none"` regardless of caller
 *    intent — RFC 8725 §3.1 calls this out as the canonical JWT mistake.
 *
 * The header `typ` defaults to `"JWT"`; callers can override via the
 * `additionalHeaders` arg to set e.g. `kid` for key discovery.
 */

export type JwtAlgorithm =
  | 'HS256'
  | 'HS384'
  | 'HS512'
  | 'RS256'
  | 'RS384'
  | 'RS512'
  | 'PS256'
  | 'PS384'
  | 'PS512'
  | 'ES256'
  | 'ES384'
  | 'ES512'
  | 'EdDSA';

export interface JwtSignArgs {
  /** Signing algorithm — must match the key material in `secretOrKey`. */
  algorithm: JwtAlgorithm;
  /**
   * Shared secret for HMAC (HS256/384/512) or PEM-encoded PKCS#8
   * private key for RSA / ECDSA. For HMAC, plain UTF-8 strings work;
   * for asymmetric, the PEM must include the BEGIN/END markers.
   */
  secretOrKey: string;
  /** Token claims. `iat` is auto-added when missing; `exp` is left to the caller. */
  payload: Record<string, unknown>;
  /** Extra header fields beyond `alg` and `typ` (e.g. `kid`, `cty`). */
  additionalHeaders?: Record<string, unknown>;
}

const HMAC_ALGS: Readonly<Record<string, string>> = {
  HS256: 'SHA-256',
  HS384: 'SHA-384',
  HS512: 'SHA-512',
};

const RSA_ALGS: Readonly<Record<string, string>> = {
  RS256: 'SHA-256',
  RS384: 'SHA-384',
  RS512: 'SHA-512',
};

/**
 * RSA-PSS (RFC 7518 §3.5). Salt length per spec is `hLen` — the hash
 * function's digest length in bytes (32 for SHA-256, 48 for SHA-384,
 * 64 for SHA-512). WebCrypto's RSA-PSS expects the salt length in bytes.
 */
const RSA_PSS_ALGS: Readonly<Record<string, { hash: string; saltLength: number }>> = {
  PS256: { hash: 'SHA-256', saltLength: 32 },
  PS384: { hash: 'SHA-384', saltLength: 48 },
  PS512: { hash: 'SHA-512', saltLength: 64 },
};

const EC_CURVES: Readonly<Record<string, { hash: string; namedCurve: string }>> = {
  ES256: { hash: 'SHA-256', namedCurve: 'P-256' },
  ES384: { hash: 'SHA-384', namedCurve: 'P-384' },
  ES512: { hash: 'SHA-512', namedCurve: 'P-521' },
};

export async function signJwt(args: JwtSignArgs): Promise<string> {
  const header = {
    alg: args.algorithm,
    typ: 'JWT',
    ...(args.additionalHeaders ?? {}),
  };
  // RFC 8725 §3.1 — never honor `alg: "none"`. We reject it even if
  // someone explicitly passes it; the only safe behavior is to refuse.
  if ((args.algorithm as string).toLowerCase() === 'none') {
    throw new Error('JWT alg "none" is not supported (RFC 8725 §3.1)');
  }
  const payload: Record<string, unknown> = { iat: Math.floor(Date.now() / 1000), ...args.payload };

  const headerSegment = base64UrlEncode(new TextEncoder().encode(JSON.stringify(header)));
  const payloadSegment = base64UrlEncode(new TextEncoder().encode(JSON.stringify(payload)));
  const signingInput = `${headerSegment}.${payloadSegment}`;

  const sigBytes = await sign(args.algorithm, args.secretOrKey, signingInput);
  return `${signingInput}.${base64UrlEncode(new Uint8Array(sigBytes))}`;
}

async function sign(
  algorithm: JwtAlgorithm,
  secretOrKey: string,
  signingInput: string,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const data = enc.encode(signingInput);
  const dataBuf = data.buffer.slice(data.byteOffset, data.byteOffset + data.byteLength);

  if (algorithm in HMAC_ALGS) {
    const keyBytes = enc.encode(secretOrKey);
    const keyBuf = keyBytes.buffer.slice(
      keyBytes.byteOffset,
      keyBytes.byteOffset + keyBytes.byteLength,
    );
    const key = await crypto.subtle.importKey(
      'raw',
      keyBuf,
      { name: 'HMAC', hash: HMAC_ALGS[algorithm] },
      false,
      ['sign'],
    );
    return crypto.subtle.sign('HMAC', key, dataBuf);
  }

  if (algorithm in RSA_ALGS) {
    const key = await importPkcs8(secretOrKey, {
      name: 'RSASSA-PKCS1-v1_5',
      hash: RSA_ALGS[algorithm],
    });
    return crypto.subtle.sign('RSASSA-PKCS1-v1_5', key, dataBuf);
  }

  if (algorithm in RSA_PSS_ALGS) {
    const { hash, saltLength } = RSA_PSS_ALGS[algorithm];
    const key = await importPkcs8(secretOrKey, { name: 'RSA-PSS', hash });
    return crypto.subtle.sign({ name: 'RSA-PSS', saltLength }, key, dataBuf);
  }

  if (algorithm === 'EdDSA') {
    // RFC 8037 — JWS with Ed25519. WebCrypto's Ed25519 support landed
    // in modern browsers (Chrome 113+, Firefox 130+, Safari 17+) and
    // Node 22+. The PKCS#8 PEM the user pastes must encode an Ed25519
    // private key (OID 1.3.101.112).
    const key = await importPkcs8(secretOrKey, { name: 'Ed25519' });
    return crypto.subtle.sign('Ed25519', key, dataBuf);
  }

  if (algorithm in EC_CURVES) {
    const { hash, namedCurve } = EC_CURVES[algorithm];
    const key = await importPkcs8(secretOrKey, { name: 'ECDSA', namedCurve });
    // ECDSA over JWT is JWS-style: r || s, fixed-length (curve-specific).
    const sig = await crypto.subtle.sign({ name: 'ECDSA', hash }, key, dataBuf);
    return sig;
  }

  throw new Error(`JWT algorithm not supported: ${algorithm}`);
}

async function importPkcs8(
  pem: string,
  algorithm: { name: string; hash?: string; namedCurve?: string },
): Promise<CryptoKey> {
  // Encrypted PKCS#8 PEMs (`BEGIN ENCRYPTED PRIVATE KEY`) wrap the
  // private key with a passphrase-derived key — WebCrypto can't import
  // them. Surface a clear actionable error rather than confusing the
  // user with a base64-decode failure on the encrypted blob.
  if (/-----BEGIN ENCRYPTED [A-Z ]+-----/.test(pem)) {
    throw new Error(
      'JWT: encrypted PEM keys are not supported. Decrypt with `openssl pkcs8 -in key.pem -out plain.pem` and paste the unencrypted form.',
    );
  }
  // RSA PKCS#1 PEMs (`BEGIN RSA PRIVATE KEY`) are NOT PKCS#8 — WebCrypto
  // requires PKCS#8. Catch the common confusion explicitly.
  if (/-----BEGIN RSA PRIVATE KEY-----/.test(pem)) {
    throw new Error(
      'JWT: PKCS#1 RSA PEM (`BEGIN RSA PRIVATE KEY`) is not supported. Convert with `openssl pkcs8 -topk8 -in key.pem -out pkcs8.pem -nocrypt`.',
    );
  }
  // Extract the BEGIN/END envelope's contents — everything outside
  // those markers (Bag Attributes, comments, blank lines) is ignored.
  // If the markers are missing, fall back to "use the whole input"
  // so a user pasting raw base64 still works.
  const envelope = /-----BEGIN [A-Z ]+-----([\s\S]*?)-----END [A-Z ]+-----/.exec(pem);
  const body = envelope ? envelope[1] : pem;
  const stripped = body.replace(/\s+/g, '');
  if (!stripped) {
    throw new Error('JWT: PEM key is empty after stripping headers/whitespace');
  }
  let der: Uint8Array;
  try {
    const raw = atob(stripped);
    der = new Uint8Array(raw.length);
    for (let i = 0; i < raw.length; i++) der[i] = raw.charCodeAt(i);
  } catch {
    throw new Error('JWT: PEM key is not valid base64');
  }
  return crypto.subtle.importKey(
    'pkcs8',
    der.buffer.slice(der.byteOffset, der.byteOffset + der.byteLength) as ArrayBuffer,
    algorithm,
    false,
    ['sign'],
  );
}

function base64UrlEncode(bytes: Uint8Array): string {
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
