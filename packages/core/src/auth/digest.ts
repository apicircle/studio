import { md5 } from './_legacyHashes';
import { sha512_256 } from './_sha512_256';

/**
 * HTTP Digest Access Authentication (RFC 7616, supersedes RFC 2617).
 *
 * Digest is a challenge-response scheme: the client makes a request, the
 * server responds 401 with `WWW-Authenticate: Digest ...`, and the client
 * retries with `Authorization: Digest ...` carrying a hash of the
 * credentials + the server-supplied nonce. This module owns the parsing
 * of the challenge directives and the construction of the response
 * header. The challenge round-trip itself lives in `executeRequest` —
 * it's the engine's job to fire the first request, see the 401, call
 * back here, and re-send.
 *
 * Algorithm support: MD5 (default), MD5-sess, SHA-256, SHA-256-sess,
 * SHA-512-256, and the `-sess` variants. MD5 is required for interop
 * with the long tail of legacy servers; the implementation is in the
 * private `_legacyHashes` module so the rest of the codebase doesn't
 * grow new MD5 callsites.
 */

export interface DigestChallenge {
  realm: string;
  nonce: string;
  /** Comma-separated list per RFC 7616; the first one we recognize wins. */
  qop?: string;
  opaque?: string;
  algorithm?: string;
  /** Server-supplied opaque token returned verbatim in the response. */
  domain?: string;
  /** Stale=true means the previous nonce expired but credentials are still valid. */
  stale?: string;
  /** Any directives we don't model end up here for diagnostics. */
  [extra: string]: string | undefined;
}

/**
 * Parse the value of a `WWW-Authenticate: Digest ...` header into its
 * directives. The header may appear with or without the `Digest ` prefix
 * (callers sometimes strip it); both forms work.
 *
 * Quoted values have the surrounding quotes removed; unquoted values are
 * taken as-is up to the next comma or whitespace. Unknown directives are
 * preserved on the returned object so diagnostics can surface them.
 */
export function parseDigestChallenge(header: string): DigestChallenge {
  const stripped = header.replace(/^\s*Digest\s+/i, '');
  const params: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(stripped)) !== null) {
    const key = m[1].toLowerCase();
    const value = m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : (m[3] ?? '');
    params[key] = value;
  }
  return {
    realm: params['realm'] ?? '',
    nonce: params['nonce'] ?? '',
    qop: params['qop'],
    opaque: params['opaque'],
    algorithm: params['algorithm'],
    domain: params['domain'],
    stale: params['stale'],
    ...params,
  };
}

/**
 * Algorithm preference order for multi-challenge servers (RFC 7616 §3.7
 * + RFC 7235 §4.1). When a server offers more than one `WWW-Authenticate:
 * Digest` header, the client SHOULD pick the strongest. We rank
 * SHA-512-256 highest (256-bit truncated SHA-512), then SHA-256, then
 * MD5 last — MD5 is GPU-crackable for weak passwords against a captured
 * nonce so we only fall back to it when the server offers nothing else.
 *
 * The `-sess` variants are equivalent in strength to their base; we
 * preserve the server's choice within an algorithm family.
 */
const ALGO_RANK: Record<string, number> = {
  'sha-512-256': 3,
  'sha-512-256-sess': 3,
  'sha-256': 2,
  'sha-256-sess': 2,
  md5: 1,
  'md5-sess': 1,
};

/**
 * Pick the strongest Digest challenge from a stacked-header response.
 *
 * `wwwAuthHeaders` is the raw value of every `WWW-Authenticate` header the
 * server sent. The `fetch` API folds multiple headers of the same name
 * into a comma-joined string, but `Digest` challenges themselves contain
 * commas (in `qop=auth,auth-int` etc.), so we can't naively split on
 * comma. Instead we look for the literal token `Digest ` at the start of
 * the trimmed string AND inside the string preceded by `, ` (no other
 * authentication scheme uses that prefix). Each split candidate is
 * parsed; we keep the one with the highest algorithm rank.
 *
 * Falls back to a single parse when only one Digest challenge is found,
 * matching the existing single-challenge behaviour byte-for-byte.
 */
export function selectStrongestDigestChallenge(wwwAuthHeader: string): DigestChallenge | null {
  const stripped = wwwAuthHeader.trim();
  if (!stripped) return null;
  // Split on `, Digest ` boundaries — preserves the first challenge as-is
  // and slices subsequent ones. Adding `Digest ` back to each piece so
  // `parseDigestChallenge` can strip the prefix uniformly.
  const pieces = stripped
    .split(/,\s*(?=Digest\s)/i)
    .map((p) => p.trim())
    .filter(Boolean);
  if (pieces.length === 0) return null;
  let best: DigestChallenge | null = null;
  let bestRank = -1;
  for (const piece of pieces) {
    const challenge = parseDigestChallenge(piece);
    if (!challenge.realm || !challenge.nonce) continue;
    const algoRaw = (challenge.algorithm ?? 'MD5').toLowerCase();
    const rank = ALGO_RANK[algoRaw] ?? 0;
    if (rank > bestRank) {
      best = challenge;
      bestRank = rank;
    }
  }
  return best;
}

export interface BuildDigestArgs {
  method: string;
  /** Request URI as it appears on the wire (path + query, not the full URL). */
  uri: string;
  username: string;
  password: string;
  challenge: DigestChallenge;
  /**
   * Override for the client nonce. If omitted, 16 random hex chars are
   * generated via `crypto.getRandomValues`. Tests pass a fixed value to
   * make the resulting header deterministic.
   */
  cnonce?: string;
  /**
   * Nonce-count, per RFC 7616 §3.4. Each request reusing the same server
   * nonce should bump nc; we default to 1 because the engine clears the
   * stored challenge when the server rotates the nonce. 8 hex chars,
   * lowercase.
   */
  nc?: string;
  /**
   * Body for `qop=auth-int` (entity-body hash). Ignored for `qop=auth`.
   * Strings, `Uint8Array`, `ArrayBuffer`, and `Blob` are all hashable;
   * if `null`/`undefined` we still emit auth-int but with the empty-body
   * hash. FormData / ReadableStream callers should serialize first
   * (auth-int requires the EXACT bytes the server will see).
   */
  entityBody?: string | Uint8Array | ArrayBuffer | Blob | null;
}

const SUPPORTED_ALGOS = new Set([
  'md5',
  'md5-sess',
  'sha-256',
  'sha-256-sess',
  'sha-512-256',
  'sha-512-256-sess',
]);

/**
 * Build the `Authorization: Digest ...` header value (without the
 * `Authorization:` prefix — caller prepends it).
 *
 * Returns a string ready to put on the wire. Throws when the challenge
 * specifies an algorithm we don't support; the engine should surface
 * that as a "this server's auth scheme isn't supported yet" error
 * rather than retrying forever.
 */
export async function buildDigestAuthHeader(args: BuildDigestArgs): Promise<string> {
  const { method, uri, username, password, challenge } = args;
  const algorithmRaw = (challenge.algorithm ?? 'MD5').toLowerCase();
  if (!SUPPORTED_ALGOS.has(algorithmRaw)) {
    throw new Error(`Digest algorithm not supported: ${challenge.algorithm}`);
  }
  // Phase 11 hardening: surface a console warning whenever the server
  // selects MD5 (or MD5-sess). MD5 is the spec default but is GPU-
  // crackable for weak passwords — a MITM that swaps nonces effectively
  // gets a free password-cracking oracle. We can't refuse the server's
  // choice (that would break interop with the long tail of legacy
  // appliances that only speak MD5), but we MUST make sure the operator
  // knows what's happening. A future Auth follow-up wires this through
  // the structured `authWarnings` channel and surfaces a UI banner; for
  // now the dev-console message is the visibility floor.
  if (algorithmRaw === 'md5' || algorithmRaw === 'md5-sess') {
    console.warn(
      '[apicircle] Digest auth: server selected MD5 — credentials are vulnerable to ' +
        'GPU offline cracking against the captured nonce. Ask the server operator to ' +
        'offer SHA-256 (RFC 7616) or SHA-512-256.',
    );
  }
  const isSess = algorithmRaw.endsWith('-sess');
  const baseAlgo = algorithmRaw.replace(/-sess$/, '');

  const qop = pickQop(challenge.qop);
  const cnonce = args.cnonce ?? randomHex(8);
  const nc = (args.nc ?? '00000001').toLowerCase();

  const hash = (s: string) => digestHash(baseAlgo, s);

  // HA1: identity hash. `-sess` variants re-hash with the nonces so that
  // the long-term password isn't reused across sessions.
  let ha1 = await hash(`${username}:${challenge.realm}:${password}`);
  if (isSess) ha1 = await hash(`${ha1}:${challenge.nonce}:${cnonce}`);

  // HA2: method + URI (+ entity-body hash for auth-int).
  let ha2: string;
  if (qop === 'auth-int') {
    const bodyBytes = await coerceEntityBody(args.entityBody);
    const bodyHash = await hashBytes(baseAlgo, bodyBytes);
    ha2 = await hash(`${method}:${uri}:${bodyHash}`);
  } else {
    ha2 = await hash(`${method}:${uri}`);
  }

  const response = qop
    ? await hash(`${ha1}:${challenge.nonce}:${nc}:${cnonce}:${qop}:${ha2}`)
    : await hash(`${ha1}:${challenge.nonce}:${ha2}`);

  const parts: string[] = [
    `username="${escapeQuotedString(username)}"`,
    `realm="${escapeQuotedString(challenge.realm)}"`,
    `nonce="${escapeQuotedString(challenge.nonce)}"`,
    `uri="${escapeQuotedString(uri)}"`,
    `response="${response}"`,
  ];
  if (challenge.algorithm) parts.push(`algorithm=${challenge.algorithm}`);
  if (qop) parts.push(`qop=${qop}`, `nc=${nc}`, `cnonce="${escapeQuotedString(cnonce)}"`);
  if (challenge.opaque) parts.push(`opaque="${escapeQuotedString(challenge.opaque)}"`);
  return `Digest ${parts.join(', ')}`;
}

function pickQop(qopHeader: string | undefined): 'auth' | 'auth-int' | '' {
  if (!qopHeader) return '';
  const options = qopHeader.split(',').map((s) => s.trim().toLowerCase());
  // Prefer auth over auth-int because auth-int requires hashing the
  // request body which most clients don't do; servers that support both
  // accept either.
  if (options.includes('auth')) return 'auth';
  if (options.includes('auth-int')) return 'auth-int';
  return '';
}

async function digestHash(baseAlgo: string, input: string): Promise<string> {
  if (baseAlgo === 'md5') return md5(input);
  return hashBytes(baseAlgo, new TextEncoder().encode(input));
}

async function hashBytes(baseAlgo: string, bytes: Uint8Array): Promise<string> {
  if (baseAlgo === 'md5') {
    // MD5 over raw bytes — feed the bytes as a Latin-1 string so md5()'s
    // string-mode walks each byte as a code point. This matches the
    // standard interpretation: MD5 is byte-oriented; UTF-8 string input
    // is just bytes that happen to be UTF-8.
    let s = '';
    for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
    return md5(s);
  }
  if (baseAlgo === 'sha-512-256') {
    // FIPS 180-4 SHA-512/256 — distinct from a naive truncation of
    // SHA-512 because it uses different IVs. RFC 7616 §3.5.1 mandates
    // this exact variant for `algorithm=SHA-512-256` Digest challenges.
    return sha512_256(bytes);
  }
  // SHA-256 (RFC 7616 §3.5.1) — WebCrypto handles this natively.
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  const out = new Uint8Array(hash);
  return Array.from(out, (b) => b.toString(16).padStart(2, '0')).join('');
}

async function coerceEntityBody(
  body: string | Uint8Array | ArrayBuffer | Blob | null | undefined,
): Promise<Uint8Array> {
  if (body == null) return new Uint8Array(0);
  if (typeof body === 'string') return new TextEncoder().encode(body);
  if (body instanceof Uint8Array) return body;
  if (body instanceof ArrayBuffer) return new Uint8Array(body);
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    return new Uint8Array(await body.arrayBuffer());
  }
  // Unknown body shape — refuse rather than silently hashing
  // `[object Object]`. The typed contract above is exhaustive, so reaching
  // here means the caller passed something the type system didn't catch
  // (FormData, ReadableStream, …). Auth-int requires the EXACT bytes the
  // server will see, so a wrong hash here is worse than a clear error.
  throw new Error(
    `Digest auth-int: unsupported entity-body type ${typeof body === 'object' && body !== null ? body.constructor.name : typeof body}; serialize to string/Uint8Array/ArrayBuffer/Blob first`,
  );
}

function randomHex(byteLen: number): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

/** Escape backslashes and double-quotes for RFC 7616 quoted-string values. */
function escapeQuotedString(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}
