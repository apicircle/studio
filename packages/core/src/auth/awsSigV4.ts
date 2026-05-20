/**
 * AWS Signature Version 4 — request signing for AWS APIs.
 *
 * SigV4 is per-request HMAC chain over a canonical-request string. The
 * server (or a STS-issued temporary credentials provider) verifies the
 * signature using the same algorithm, so request integrity is end-to-end
 * without any callback / handshake.
 *
 *   canonical = METHOD\nPATH\nQUERY\nHEADERS\nSIGNED_HEADERS\nPAYLOAD_HASH
 *   stringToSign = "AWS4-HMAC-SHA256\n{amzDate}\n{credScope}\n{sha256(canonical)}"
 *   kSigning = HMAC(HMAC(HMAC(HMAC("AWS4{secret}", date), region), service), "aws4_request")
 *   signature = hex(HMAC(kSigning, stringToSign))
 *
 * Two delivery modes:
 *  - `header`: sets `Authorization: AWS4-HMAC-SHA256 Credential=..., SignedHeaders=..., Signature=...`
 *  - `query`: rewrites the URL with `X-Amz-*` query params (presigned URL).
 *
 * Body hashing only runs in `header` mode (presigned URLs always
 * advertise `UNSIGNED-PAYLOAD`). Streaming / chunked bodies fall through
 * to `UNSIGNED-PAYLOAD` because we'd otherwise have to buffer the entire
 * stream before signing.
 */

/**
 * Body shapes we can hash for SigV4 payload signing. Anything we can't
 * read as bytes synchronously goes to `UNSIGNED-PAYLOAD` — AWS accepts
 * that as long as `x-amz-content-sha256: UNSIGNED-PAYLOAD` is in the
 * signed headers. ReadableStream falls into this bucket since draining
 * it before signing would consume the body before fetch can send it.
 */
export type SigV4Body =
  | string
  | ArrayBuffer
  | Uint8Array
  | Blob
  | URLSearchParams
  | FormData
  | ReadableStream<Uint8Array>
  | null
  | undefined;

export interface SigV4SignArgs {
  method: string;
  url: string;
  /** Existing request headers — passed through and merged with SigV4 additions. */
  headers: Record<string, string>;
  /**
   * Body for payload hashing. `string`, `ArrayBuffer`, `Uint8Array`,
   * `Blob`, and `URLSearchParams` are hashed verbatim. `FormData` and
   * `ReadableStream` fall through to `UNSIGNED-PAYLOAD` — AWS accepts
   * that signing mode and many AWS SDKs default to it for streaming.
   */
  body?: SigV4Body;
  accessKeyId: string;
  secretAccessKey: string;
  region: string;
  service: string;
  /** STS-issued session token; copied to `X-Amz-Security-Token`. */
  sessionToken?: string;
  /** Where to put the signature — header (default) or query (presigned URL). */
  addTo?: 'header' | 'query';
  /**
   * S3 specifically does NOT collapse double slashes or normalize dot
   * segments — it treats `bucket/foo//bar` as a different object from
   * `bucket/foo/bar`. Set true when `service: 's3'` to preserve the
   * raw path. Default false (matches non-S3 services like execute-api).
   *
   * If you don't pass this and `service === 's3'`, we auto-enable it —
   * the common case for S3 callers is "preserve my path exactly".
   */
  preservePathSlashes?: boolean;
  /**
   * Override `now` for tests. The amz-date stamp must be the SAME instant
   * used to build the credential scope, so we capture once.
   */
  now?: Date;
}

export interface SigV4SignResult {
  url: string;
  headers: Record<string, string>;
}

const EMPTY_PAYLOAD_HASH = 'e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855';

export async function applyAwsSigV4(args: SigV4SignArgs): Promise<SigV4SignResult> {
  let parsed: URL;
  try {
    parsed = new URL(args.url);
  } catch {
    throw new Error(`AWS SigV4: invalid URL: ${args.url}`);
  }

  const enc = new TextEncoder();
  const now = args.now ?? new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);
  const isQuery = args.addTo === 'query';

  const payloadHash = isQuery ? 'UNSIGNED-PAYLOAD' : await computeBodyHash(args.body);
  const credScope = `${dateStamp}/${args.region}/${args.service}/aws4_request`;

  // Signed headers map — start with host (always signed). In header
  // mode we add x-amz-date + x-amz-content-sha256 (required by S3 /
  // DynamoDB; tolerated everywhere else) and the optional session token.
  // We THEN fold in user-set request headers because real AWS requests
  // routinely require Range / Content-Type / Cache-Control / etc to be
  // in SignedHeaders — without that the server gets a hash mismatch and
  // returns 403 SignatureDoesNotMatch. We exclude `Authorization` (we
  // produce it) and any `host` the caller may have set (we own it).
  const signedMap: Record<string, string> = {
    host: parsed.hostname + (parsed.port ? `:${parsed.port}` : ''),
  };
  if (!isQuery) {
    signedMap['x-amz-date'] = amzDate;
    signedMap['x-amz-content-sha256'] = payloadHash;
    if (args.sessionToken) signedMap['x-amz-security-token'] = args.sessionToken;
  }
  // Fold caller's headers into the signed set. AWS spec normalizes:
  // lowercase header name, trim leading/trailing whitespace, collapse
  // internal whitespace runs to a single space.
  for (const [rawKey, rawValue] of Object.entries(args.headers)) {
    const key = rawKey.toLowerCase();
    if (key === 'authorization' || key === 'host') continue;
    if (key in signedMap) continue; // don't overwrite our own additions
    signedMap[key] = rawValue.replace(/\s+/g, ' ').trim();
  }
  const signedHeaderNames = Object.keys(signedMap).sort();
  const canonicalHeaders = signedHeaderNames.map((k) => `${k}:${signedMap[k]}\n`).join('');
  const signedHeadersList = signedHeaderNames.join(';');

  // Query params — preserve existing + add X-Amz-* in query mode.
  const qEntries: Array<[string, string]> = [];
  parsed.searchParams.forEach((v, k) => qEntries.push([k, v]));
  if (isQuery) {
    qEntries.push(['X-Amz-Algorithm', 'AWS4-HMAC-SHA256']);
    qEntries.push(['X-Amz-Credential', `${args.accessKeyId}/${credScope}`]);
    qEntries.push(['X-Amz-Date', amzDate]);
    qEntries.push(['X-Amz-Expires', '3600']);
    qEntries.push(['X-Amz-SignedHeaders', signedHeadersList]);
    if (args.sessionToken) qEntries.push(['X-Amz-Security-Token', args.sessionToken]);
  }
  qEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
  const canonicalQS = qEntries
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const preserveSlashes = args.preservePathSlashes ?? args.service === 's3';
  const canonicalUri = canonicalizePath(parsed.pathname, preserveSlashes);
  const canonicalReq = [
    args.method.toUpperCase(),
    canonicalUri,
    canonicalQS,
    canonicalHeaders,
    signedHeadersList,
    payloadHash,
  ].join('\n');

  const stringToSign = ['AWS4-HMAC-SHA256', amzDate, credScope, await sha256Hex(canonicalReq)].join(
    '\n',
  );

  // Derive the per-request signing key by chaining HMACs.
  const kDate = await hmacSha256(enc.encode(`AWS4${args.secretAccessKey}`), dateStamp);
  const kRegion = await hmacSha256(kDate, args.region);
  const kService = await hmacSha256(kRegion, args.service);
  const kSigning = await hmacSha256(kService, 'aws4_request');
  const signature = bufToHex(await hmacSha256(kSigning, stringToSign));

  const nextHeaders = { ...args.headers };
  let nextUrl = args.url;

  if (isQuery) {
    qEntries.push(['X-Amz-Signature', signature]);
    qEntries.sort((a, b) => (a[0] < b[0] ? -1 : a[0] > b[0] ? 1 : 0));
    const qs = qEntries
      .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
      .join('&');
    nextUrl = `${parsed.origin}${parsed.pathname}?${qs}${parsed.hash}`;
  } else {
    // Lowercase header names match AWS SDK / boto3 / common request
    // tooling conventions. HTTP headers are case-insensitive, but staying
    // consistent simplifies test assertions and downstream string-match
    // header inspection.
    nextHeaders['x-amz-date'] = amzDate;
    nextHeaders['x-amz-content-sha256'] = payloadHash;
    if (args.sessionToken) nextHeaders['x-amz-security-token'] = args.sessionToken;
    nextHeaders['Authorization'] =
      `AWS4-HMAC-SHA256 Credential=${args.accessKeyId}/${credScope}, SignedHeaders=${signedHeadersList}, Signature=${signature}`;
  }
  return { url: nextUrl, headers: nextHeaders };
}

// ── helpers ────────────────────────────────────────────────────────────────────

async function computeBodyHash(body: SigV4Body): Promise<string> {
  if (body == null) return EMPTY_PAYLOAD_HASH;
  if (typeof body === 'string') return sha256HexBuf(new TextEncoder().encode(body));
  if (body instanceof ArrayBuffer) return sha256HexBuf(new Uint8Array(body));
  if (body instanceof Uint8Array) return sha256HexBuf(body);
  if (typeof Blob !== 'undefined' && body instanceof Blob) {
    const ab = await body.arrayBuffer();
    return sha256HexBuf(new Uint8Array(ab));
  }
  if (typeof URLSearchParams !== 'undefined' && body instanceof URLSearchParams) {
    return sha256HexBuf(new TextEncoder().encode(body.toString()));
  }
  // FormData / ReadableStream — can't be deterministically hashed
  // pre-fetch (FormData boundary is generated by fetch, ReadableStream
  // is one-shot). AWS accepts UNSIGNED-PAYLOAD in these cases as long
  // as the magic constant is in the signed headers.
  return 'UNSIGNED-PAYLOAD';
}

/**
 * Canonicalize a request path per AWS SigV4 §6 (Task 1).
 *
 * Rules (general services):
 *  - Empty path becomes "/".
 *  - Each segment is URI-encoded with the unreserved set per RFC 3986
 *    (preserving `/`, encoding everything else). Components ALREADY
 *    percent-encoded by the user pass through — we don't double-encode.
 *  - "." segments are removed; ".." segments collapse the previous
 *    segment.
 *  - Leading slash is preserved; trailing slash is preserved.
 *  - Empty segments (consecutive `/`) are collapsed to one.
 *
 * S3 mode (`preserveSlashes: true`):
 *  - Empty segments are PRESERVED — S3 treats `bucket/foo//bar` as a
 *    distinct object key from `bucket/foo/bar`. The canonical URI must
 *    match the raw path bytes for the signature to validate against
 *    what S3 actually stored.
 *  - "." and ".." segments are still encoded as path components
 *    (S3 doesn't apply RFC 3986 dot-segment removal).
 */
function canonicalizePath(path: string, preserveSlashes: boolean): string {
  if (!path || path === '') return '/';
  if (preserveSlashes) {
    // Encode each segment but keep all separators verbatim (including
    // empty segments from `//`).
    return path
      .split('/')
      .map((seg) => awsUriEncode(seg, /* preserveSlash */ false))
      .join('/');
  }
  const isAbsolute = path.startsWith('/');
  const trailingSlash = path.endsWith('/') && path !== '/';
  const segments: string[] = [];
  for (const seg of path.split('/')) {
    if (seg === '' || seg === '.') continue;
    if (seg === '..') {
      segments.pop();
      continue;
    }
    segments.push(awsUriEncode(seg, /* preserveSlash */ false));
  }
  let out = (isAbsolute ? '/' : '') + segments.join('/');
  if (trailingSlash && !out.endsWith('/')) out += '/';
  if (!out) out = '/';
  return out;
}

/**
 * URI-encode per AWS SigV4 spec — same as RFC 3986 unreserved set
 * (`A-Z a-z 0-9 - _ . ~`). `encodeURIComponent` covers most of this but
 * leaves `!*'()` un-encoded, so we patch those.
 */
function awsUriEncode(s: string, preserveSlash: boolean): string {
  let encoded = encodeURIComponent(s).replace(
    /[!'()*]/g,
    (c) => `%${c.charCodeAt(0).toString(16).toUpperCase()}`,
  );
  if (preserveSlash) encoded = encoded.replace(/%2F/g, '/');
  return encoded;
}

async function sha256Hex(input: string): Promise<string> {
  return sha256HexBuf(new TextEncoder().encode(input));
}

async function sha256HexBuf(bytes: Uint8Array): Promise<string> {
  const buf = bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength,
  ) as ArrayBuffer;
  const hash = await crypto.subtle.digest('SHA-256', buf);
  return bufToHex(hash);
}

async function hmacSha256(key: Uint8Array | ArrayBuffer, message: string): Promise<ArrayBuffer> {
  const keyBuf =
    key instanceof Uint8Array
      ? (key.buffer.slice(key.byteOffset, key.byteOffset + key.byteLength) as ArrayBuffer)
      : key;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBuf,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const msg = new TextEncoder().encode(message);
  const msgBuf = msg.buffer.slice(msg.byteOffset, msg.byteOffset + msg.byteLength);
  return crypto.subtle.sign('HMAC', cryptoKey, msgBuf);
}

function bufToHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf), (b) => b.toString(16).padStart(2, '0')).join('');
}
