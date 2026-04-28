// Translate a RequestAuth into outbound headers / query / cookies.
//
// Pure function — given a RequestAuth and the partially-built request, it
// returns a new partially-built request with auth applied. Crypto-heavy
// schemes (AWS SigV4, Hawk, JWT-HS) use WebCrypto when available and a
// portable JS fallback elsewhere; deferred 401-challenge schemes (Digest,
// NTLM) only stash credentials — actual challenge handling happens in
// executeRequest's retry loop and is tracked separately.

import type { RequestAuth } from '@apicircle/shared';

export interface AuthApplyTarget {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null;
}

export interface AuthApplyResult {
  url: string;
  headers: Record<string, string>;
}

function setHeader(
  headers: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  // Replace any existing header with the same name (case-insensitive) so a
  // stale Authorization from the headers tab doesn't ride alongside auth.
  const lower = key.toLowerCase();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) out[k] = v;
  }
  out[key] = value;
  return out;
}

function appendQueryParam(rawUrl: string, key: string, value: string): string {
  try {
    const parsed = new URL(rawUrl);
    parsed.searchParams.append(key, value);
    return parsed.toString();
  } catch {
    const sep = rawUrl.includes('?') ? '&' : '?';
    return `${rawUrl}${sep}${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  }
}

function appendCookie(
  headers: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  const existing = Object.entries(headers).find(([k]) => k.toLowerCase() === 'cookie');
  const pair = `${encodeURIComponent(key)}=${encodeURIComponent(value)}`;
  if (existing) {
    const [k, v] = existing;
    return { ...headers, [k]: `${v}; ${pair}` };
  }
  return { ...headers, Cookie: pair };
}

// Reach for Buffer through globalThis so the web bundle (which doesn't
// include node types) still typechecks. Modern Node ≥18 exposes btoa
// natively, so the fallback only fires on truly ancient runtimes.
function nodeBufferToBase64(input: string | Uint8Array): string {
  const buf = (
    globalThis as unknown as {
      Buffer?: {
        from: (data: string | Uint8Array, encoding?: string) => { toString: (e: string) => string };
      };
    }
  ).Buffer;
  if (!buf) throw new Error('Neither btoa nor Buffer is available in this runtime');
  if (typeof input === 'string') return buf.from(input, 'utf8').toString('base64');
  return buf.from(input).toString('base64');
}

function base64(text: string): string {
  if (typeof btoa === 'function') {
    // btoa expects Latin-1; encodeURIComponent → escape lifts UTF-8 input
    // through that gauntlet without losing bytes.
    return btoa(unescape(encodeURIComponent(text)));
  }
  return nodeBufferToBase64(text);
}

function base64UrlFromBytes(bytes: Uint8Array): string {
  let bin = '';
  for (let i = 0; i < bytes.byteLength; i++) bin += String.fromCharCode(bytes[i]);
  const b64 = typeof btoa === 'function' ? btoa(bin) : nodeBufferToBase64(bytes);
  return b64.replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function utf8Bytes(text: string): Uint8Array {
  return new TextEncoder().encode(text);
}

// `Uint8Array<ArrayBufferLike>` and `BufferSource` are subtly different
// under strict TS because Uint8Array's underlying buffer can be a
// SharedArrayBuffer in theory. Tightening the slice into a fresh
// ArrayBuffer-backed view satisfies the SubtleCrypto signature without
// changing runtime behavior.
function asBufferSource(bytes: Uint8Array): ArrayBuffer {
  const buf = new ArrayBuffer(bytes.byteLength);
  new Uint8Array(buf).set(bytes);
  return buf;
}

async function hmacSha(
  algorithm: 'SHA-1' | 'SHA-256' | 'SHA-384' | 'SHA-512',
  keyBytes: Uint8Array,
  data: Uint8Array,
): Promise<Uint8Array> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) {
    throw new Error('WebCrypto SubtleCrypto is required for HMAC-based auth');
  }
  const key = await subtle.importKey(
    'raw',
    asBufferSource(keyBytes),
    { name: 'HMAC', hash: algorithm },
    false,
    ['sign'],
  );
  const sig = await subtle.sign('HMAC', key, asBufferSource(data));
  return new Uint8Array(sig);
}

async function sha256Hex(data: Uint8Array | string): Promise<string> {
  const subtle = globalThis.crypto?.subtle;
  if (!subtle) throw new Error('WebCrypto required for SHA-256');
  const buf = typeof data === 'string' ? utf8Bytes(data) : data;
  const hash = await subtle.digest('SHA-256', asBufferSource(buf));
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

function bytesToHex(bytes: Uint8Array): string {
  return [...bytes].map((b) => b.toString(16).padStart(2, '0')).join('');
}

// --- AWS Signature v4 ----------------------------------------------------

async function applyAwsSigV4(
  target: AuthApplyTarget,
  auth: Extract<RequestAuth, { type: 'aws-sigv4' }>,
): Promise<AuthApplyResult> {
  if (!auth.accessKeyId || !auth.secretAccessKey || !auth.region || !auth.service) {
    return { url: target.url, headers: target.headers };
  }
  const url = new URL(target.url);
  const method = target.method.toUpperCase();
  const now = new Date();
  const amzDate = now.toISOString().replace(/[:-]|\.\d{3}/g, '');
  const dateStamp = amzDate.slice(0, 8);

  const headers: Record<string, string> = { ...target.headers };
  // Host is required in the canonical headers.
  headers['x-amz-date'] = amzDate;
  headers['host'] = url.host;
  if (auth.sessionToken) headers['x-amz-security-token'] = auth.sessionToken;

  // Canonical request bits.
  const canonicalUri = url.pathname || '/';
  const sortedParams = [...url.searchParams.entries()].sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  );
  const canonicalQuery = sortedParams
    .map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`)
    .join('&');

  const headerEntries = Object.entries(headers)
    .map(([k, v]) => [k.toLowerCase(), v.replace(/\s+/g, ' ').trim()] as [string, string])
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  const canonicalHeaders = headerEntries.map(([k, v]) => `${k}:${v}\n`).join('');
  const signedHeaders = headerEntries.map(([k]) => k).join(';');

  const bodyText = typeof target.body === 'string' ? target.body : target.body == null ? '' : '';
  const payloadHash = await sha256Hex(bodyText);

  const canonicalRequest = [
    method,
    canonicalUri,
    canonicalQuery,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join('\n');

  const credScope = `${dateStamp}/${auth.region}/${auth.service}/aws4_request`;
  const stringToSign = [
    'AWS4-HMAC-SHA256',
    amzDate,
    credScope,
    await sha256Hex(canonicalRequest),
  ].join('\n');

  const kDate = await hmacSha(
    'SHA-256',
    utf8Bytes(`AWS4${auth.secretAccessKey}`),
    utf8Bytes(dateStamp),
  );
  const kRegion = await hmacSha('SHA-256', kDate, utf8Bytes(auth.region));
  const kService = await hmacSha('SHA-256', kRegion, utf8Bytes(auth.service));
  const kSigning = await hmacSha('SHA-256', kService, utf8Bytes('aws4_request'));
  const signature = bytesToHex(await hmacSha('SHA-256', kSigning, utf8Bytes(stringToSign)));

  if (auth.addTo === 'query') {
    let nextUrl = appendQueryParam(target.url, 'X-Amz-Algorithm', 'AWS4-HMAC-SHA256');
    nextUrl = appendQueryParam(nextUrl, 'X-Amz-Credential', `${auth.accessKeyId}/${credScope}`);
    nextUrl = appendQueryParam(nextUrl, 'X-Amz-Date', amzDate);
    nextUrl = appendQueryParam(nextUrl, 'X-Amz-SignedHeaders', signedHeaders);
    nextUrl = appendQueryParam(nextUrl, 'X-Amz-Signature', signature);
    if (auth.sessionToken)
      nextUrl = appendQueryParam(nextUrl, 'X-Amz-Security-Token', auth.sessionToken);
    return { url: nextUrl, headers: target.headers };
  }
  const authHeader = `AWS4-HMAC-SHA256 Credential=${auth.accessKeyId}/${credScope}, SignedHeaders=${signedHeaders}, Signature=${signature}`;
  return {
    url: target.url,
    headers: setHeader(headers, 'Authorization', authHeader),
  };
}

// --- Hawk ---------------------------------------------------------------

async function applyHawk(
  target: AuthApplyTarget,
  auth: Extract<RequestAuth, { type: 'hawk' }>,
): Promise<AuthApplyResult> {
  if (!auth.hawkId || !auth.hawkKey) return { url: target.url, headers: target.headers };
  const parsed = (() => {
    try {
      return new URL(target.url);
    } catch {
      return null;
    }
  })();
  if (!parsed) return { url: target.url, headers: target.headers };

  const ts = Math.floor(Date.now() / 1000).toString();
  // 12 random url-safe chars; collision risk is irrelevant per Hawk spec.
  const nonce = base64UrlFromBytes(crypto.getRandomValues(new Uint8Array(8))).slice(0, 12);
  const port = parsed.port || (parsed.protocol === 'https:' ? '443' : '80');
  const resource = parsed.pathname + parsed.search;
  const normalized = `hawk.1.header\n${ts}\n${nonce}\n${target.method.toUpperCase()}\n${resource}\n${parsed.hostname}\n${port}\n\n${auth.ext ?? ''}\n`;

  const algo = auth.algorithm === 'sha1' ? 'SHA-1' : 'SHA-256';
  const macBytes = await hmacSha(algo, utf8Bytes(auth.hawkKey), utf8Bytes(normalized));
  const mac = base64UrlFromBytes(macBytes).replace(/-/g, '+').replace(/_/g, '/');
  const padded = mac + '='.repeat((4 - (mac.length % 4)) % 4);

  const headerVal = `Hawk id="${auth.hawkId}", ts="${ts}", nonce="${nonce}"${auth.ext ? `, ext="${auth.ext}"` : ''}, mac="${padded}"`;
  return {
    url: target.url,
    headers: setHeader(target.headers, 'Authorization', headerVal),
  };
}

// --- JWT (HS algorithms — sign locally with WebCrypto) -----------------

async function buildJwtToken(
  auth: Extract<RequestAuth, { type: 'jwt-bearer' }>,
): Promise<string | null> {
  if (auth.token.trim().length > 0) return auth.token.trim();
  if (!auth.algorithm.startsWith('HS')) return null;
  let payload: unknown;
  let extraHeaders: Record<string, unknown> = {};
  try {
    payload = JSON.parse(auth.payload || '{}') as unknown;
    if (auth.jwtHeaders.trim())
      extraHeaders = JSON.parse(auth.jwtHeaders) as Record<string, unknown>;
  } catch {
    return null;
  }
  const headerObj = { typ: 'JWT', alg: auth.algorithm, ...extraHeaders };
  const headerB64 = base64UrlFromBytes(utf8Bytes(JSON.stringify(headerObj)));
  const payloadB64 = base64UrlFromBytes(utf8Bytes(JSON.stringify(payload)));
  const signingInput = `${headerB64}.${payloadB64}`;
  const algo: 'SHA-256' | 'SHA-384' | 'SHA-512' =
    auth.algorithm === 'HS256' ? 'SHA-256' : auth.algorithm === 'HS384' ? 'SHA-384' : 'SHA-512';
  const sig = await hmacSha(algo, utf8Bytes(auth.secretOrKey || ''), utf8Bytes(signingInput));
  return `${signingInput}.${base64UrlFromBytes(sig)}`;
}

// --- Public entry point -------------------------------------------------

export async function applyAuth(
  target: AuthApplyTarget,
  auth: RequestAuth,
): Promise<AuthApplyResult> {
  switch (auth.type) {
    case 'none':
    case 'inherit': // inheritance is resolved upstream; if we still see it here, do nothing
      return { url: target.url, headers: target.headers };

    case 'bearer': {
      if (!auth.token.trim()) return { url: target.url, headers: target.headers };
      return {
        url: target.url,
        headers: setHeader(target.headers, 'Authorization', `Bearer ${auth.token.trim()}`),
      };
    }

    case 'basic': {
      const credentials = `${auth.username}:${auth.password}`;
      return {
        url: target.url,
        headers: setHeader(target.headers, 'Authorization', `Basic ${base64(credentials)}`),
      };
    }

    case 'api-key': {
      if (!auth.key.trim()) return { url: target.url, headers: target.headers };
      if (auth.addTo === 'query') {
        return { url: appendQueryParam(target.url, auth.key, auth.value), headers: target.headers };
      }
      if (auth.addTo === 'cookie') {
        return { url: target.url, headers: appendCookie(target.headers, auth.key, auth.value) };
      }
      return { url: target.url, headers: setHeader(target.headers, auth.key, auth.value) };
    }

    case 'custom-header': {
      if (!auth.key.trim()) return { url: target.url, headers: target.headers };
      return { url: target.url, headers: setHeader(target.headers, auth.key, auth.value) };
    }

    case 'oauth2-client-credentials':
    case 'oauth2-auth-code':
    case 'oauth2-pkce':
    case 'oauth2-password':
    case 'oauth2-implicit':
    case 'oauth2-device': {
      if (!auth.accessToken.trim()) return { url: target.url, headers: target.headers };
      const tokenType = auth.tokenType?.trim() || 'Bearer';
      return {
        url: target.url,
        headers: setHeader(
          target.headers,
          'Authorization',
          `${tokenType} ${auth.accessToken.trim()}`,
        ),
      };
    }

    case 'aws-sigv4':
      return applyAwsSigV4(target, auth);

    case 'hawk':
      return applyHawk(target, auth);

    case 'jwt-bearer': {
      const token = await buildJwtToken(auth);
      if (!token) return { url: target.url, headers: target.headers };
      return {
        url: target.url,
        headers: setHeader(target.headers, 'Authorization', `Bearer ${token}`),
      };
    }

    case 'digest':
    case 'ntlm': {
      // Challenge-based — the server must respond 401 with a challenge
      // before credentials can be applied. v2's executeRequest doesn't yet
      // implement the challenge retry; the credentials are stashed in the
      // workspace for a future P-phase. Send the request unauthenticated
      // and surface the 401 to the user as-is.
      return { url: target.url, headers: target.headers };
    }
  }
}
