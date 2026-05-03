/**
 * Hawk authentication scheme (https://github.com/mozilla/hawk).
 *
 * Hawk uses an HMAC of a normalized request string keyed by a shared
 * secret. Unlike Digest / NTLM there's no challenge round-trip — every
 * request is signed independently using:
 *
 *   normalized = "hawk.1.header\n{ts}\n{nonce}\n{METHOD}\n{path?query}\n
 *                 {host-lc}\n{port}\n{payload-hash}\n{ext}\n"
 *   mac        = base64(HMAC-{algorithm}(secret, normalized))
 *
 * We default to SHA-256 (the modern recommendation); SHA-1 is supported
 * for interop with legacy Hawk servers. Body-payload hashing is a future
 * extension — for now we always pass an empty payload-hash, which the
 * server must verify by setting `Hash: ""` or skipping payload validation.
 */

export interface HawkSignArgs {
  method: string;
  /**
   * Full request URL — we extract scheme/host/port/path/query from this
   * since the normalized string needs lowercase host + numeric port.
   */
  url: string;
  hawkId: string;
  hawkKey: string;
  algorithm?: 'sha256' | 'sha1';
  /**
   * Override for the timestamp (Unix seconds). Tests pass a fixed value;
   * production callers either omit (use `Date.now()`) or apply
   * `timestampOffset` to compensate for client-server clock skew.
   */
  timestamp?: number;
  /**
   * 8 hex chars by default; tests pass a fixed value. The server tracks
   * (id, ts, nonce) tuples to detect replay, so even fixed tests are
   * one-shot.
   */
  nonce?: string;
  /** Optional `app=` and `dlg=` directives for delegated requests. */
  app?: string;
  delegation?: string;
  /** Optional `ext=` directive for application-specific data. */
  ext?: string;
  /**
   * Optional payload + content-type for body-binding. When present, the
   * normalized request string includes a `hash=BASE64(H(payload))` line
   * AND we emit a `hash="…"` directive in the Authorization header.
   * Servers configured with body-binding reject requests that lack this;
   * leaving the field undefined preserves the prior behavior (server
   * must accept body-less signing).
   */
  payload?: {
    body: string | ArrayBuffer | Uint8Array;
    contentType: string;
  };
}

export async function buildHawkAuthHeader(args: HawkSignArgs): Promise<string> {
  let parsed: URL;
  try {
    parsed = new URL(args.url);
  } catch {
    throw new Error(`Hawk: invalid URL: ${args.url}`);
  }

  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const ts = String(args.timestamp ?? Math.floor(Date.now() / 1000));
  const nonce = args.nonce ?? randomHex(4);
  const ext = args.ext ?? '';
  const resource = `${parsed.pathname}${parsed.search}${parsed.hash}`;
  const algorithm = args.algorithm ?? 'sha256';
  const subtleAlgo = algorithm === 'sha1' ? 'SHA-1' : 'SHA-256';

  // Optional payload-hash per Hawk spec §3.2.5: H = base64(SHA(
  //   "hawk.1.payload\n" + content-type + "\n" + body + "\n"
  // )). Body-bound servers verify the request body matches by re-running
  // the same hash. When `args.payload` is undefined we emit an empty
  // payload-hash line — the server must be configured to accept that.
  let payloadHash = '';
  if (args.payload) {
    const normalizedContentType =
      args.payload.contentType.split(';')[0]?.trim().toLowerCase() ?? '';
    const bodyText = bodyToString(args.payload.body);
    const payloadString = `hawk.1.payload\n${normalizedContentType}\n${bodyText}\n`;
    const payloadBytes = new TextEncoder().encode(payloadString);
    const hashBuf = await crypto.subtle.digest(
      subtleAlgo,
      payloadBytes.buffer.slice(
        payloadBytes.byteOffset,
        payloadBytes.byteOffset + payloadBytes.byteLength,
      ),
    );
    payloadHash = bufToBase64(hashBuf);
  }

  // RFC-style normalized string. Every component is on its own line and
  // a trailing newline closes the buffer (required by the spec).
  const normalized =
    [
      'hawk.1.header',
      ts,
      nonce,
      args.method.toUpperCase(),
      resource,
      parsed.hostname.toLowerCase(),
      port,
      payloadHash,
      ext,
    ].join('\n') + '\n';

  const macBuf = await hmacSign(subtleAlgo, args.hawkKey, normalized);
  const mac = bufToBase64(macBuf);

  // Field order follows the Hawk reference impl: id, ts, nonce, optional
  // hash / ext / app / dlg directives, mac last. RFC doesn't mandate the
  // order but every interop server we've tested parses in this sequence
  // and a few brittle ones reject anything else.
  const parts = [
    `id="${escapeQuoted(args.hawkId)}"`,
    `ts="${ts}"`,
    `nonce="${escapeQuoted(nonce)}"`,
  ];
  if (payloadHash) parts.push(`hash="${payloadHash}"`);
  if (ext) parts.push(`ext="${escapeQuoted(ext)}"`);
  if (args.app) parts.push(`app="${escapeQuoted(args.app)}"`);
  if (args.delegation) parts.push(`dlg="${escapeQuoted(args.delegation)}"`);
  parts.push(`mac="${mac}"`);
  return `Hawk ${parts.join(', ')}`;
}

async function hmacSign(
  algorithm: 'SHA-256' | 'SHA-1',
  key: string,
  message: string,
): Promise<ArrayBuffer> {
  const enc = new TextEncoder();
  const keyBytes = enc.encode(key);
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    keyBytes.buffer.slice(keyBytes.byteOffset, keyBytes.byteOffset + keyBytes.byteLength),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const msgBytes = enc.encode(message);
  return crypto.subtle.sign(
    'HMAC',
    cryptoKey,
    msgBytes.buffer.slice(msgBytes.byteOffset, msgBytes.byteOffset + msgBytes.byteLength),
  );
}

function bufToBase64(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let s = '';
  for (let i = 0; i < bytes.length; i++) s += String.fromCharCode(bytes[i]);
  return btoa(s);
}

function randomHex(byteLen: number): string {
  const buf = new Uint8Array(byteLen);
  crypto.getRandomValues(buf);
  return Array.from(buf, (b) => b.toString(16).padStart(2, '0')).join('');
}

function escapeQuoted(s: string): string {
  return s.replace(/\\/g, '\\\\').replace(/"/g, '\\"');
}

/**
 * Coerce a payload body shape into a UTF-8 string for hashing. Hawk's
 * payload-hash spec (§3.2.5) is byte-oriented; we treat strings as UTF-8
 * and ArrayBuffer / Uint8Array as raw bytes decoded with the default
 * decoder. Other body shapes (FormData / ReadableStream) are not
 * supported here — callers should serialize to a string before signing.
 */
function bodyToString(body: string | ArrayBuffer | Uint8Array): string {
  if (typeof body === 'string') return body;
  const bytes = body instanceof Uint8Array ? body : new Uint8Array(body);
  return new TextDecoder().decode(bytes);
}
