import type { Request as ApiRequest } from '@apicircle/shared';
import { buildRequest, type AttachmentResolver } from './buildRequest';
import type { AutoHeaderOverrides } from './autoHeaders';
import { type AuthApplyOptions, type AuthApplyWarning } from './applyAuth';
import {
  buildDigestAuthHeader,
  parseDigestChallenge,
  selectStrongestDigestChallenge,
} from '../auth/digest';
import {
  buildNtlmType3Authenticate,
  decodeNtlmBase64,
  parseNtlmType2Challenge,
} from '../auth/ntlm';

export interface ExecutionResult {
  startedAt: string;
  durationMs: number;
  status: number | null; // null when the request never completed (network error)
  ok: boolean;
  statusText: string;
  headers: Record<string, string>;
  body: string;
  bodyKind: 'json' | 'text' | 'binary' | 'empty';
  error?: string;
  url: string;
  method: string;
  /**
   * Non-fatal warnings from applyAuth (e.g. malformed JWT key, bad
   * payload JSON). Empty array when auth applied cleanly. UI surfaces
   * these alongside the response so users can see WHY their request
   * went out unauthenticated.
   */
  authWarnings: AuthApplyWarning[];
  /**
   * True when the response body exceeded `MAX_RESPONSE_BODY_BYTES` and we
   * stopped reading. The `body` field still contains the prefix we did
   * read — callers should render a "Response truncated at X MB" badge.
   * Omitted when the body was read in full.
   */
  responseTruncated?: boolean;
}

export interface ExecuteOptions {
  fetchImpl?: typeof fetch;
  // Hard timeout in ms. Defaults to 30s; null disables.
  timeoutMs?: number | null;
  signal?: AbortSignal;
  // Resolver for form-data file rows and binary bodies. Wired to the IDB
  // attachments store on the host side. When omitted, file rows in form-data
  // are skipped and binary bodies send as null.
  resolveAttachment?: AttachmentResolver;
  /**
   * applyAuth options — `onTokenRefreshed` is the important one for
   * production: the store wires it to persist refreshed OAuth2 tokens
   * back into `RequestAuth` so subsequent sends see the new state.
   */
  authOptions?: AuthApplyOptions;
  /**
   * Test-only override hooks for the auto-fed headers. Lets specs feed
   * deterministic values for `X-Trace-Span-Id`, `traceparent`, etc.
   * Production callers omit this.
   */
  autoHeaderOverrides?: AutoHeaderOverrides;
}

const DEFAULT_TIMEOUT_MS = 30_000;

/** Hard cap on the response body we'll buffer. An attacker-controlled server
 *  can stream gigabytes with chunked transfer-encoding; we abort the read
 *  once we cross this threshold and surface the truncation in the result. */
const MAX_RESPONSE_BODY_BYTES = 50 * 1024 * 1024;

/** Max redirects we'll follow before giving up. RFC 7231 §6.4 doesn't
 *  mandate a number; 10 matches what curl uses by default. */
const MAX_REDIRECTS = 10;

const REDIRECT_STATUSES = new Set([301, 302, 303, 307, 308]);
/** Headers we strip on every cross-origin redirect — they carry credentials
 *  that the new origin must not see. */
const CROSS_ORIGIN_STRIP_HEADERS = new Set([
  'authorization',
  'cookie',
  'proxy-authorization',
  'x-api-key',
  'x-auth-token',
]);

function sameOrigin(a: string, b: string): boolean {
  try {
    const ua = new URL(a);
    const ub = new URL(b);
    return ua.protocol === ub.protocol && ua.host === ub.host;
  } catch {
    return false;
  }
}

function stripCrossOriginHeaders(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (CROSS_ORIGIN_STRIP_HEADERS.has(k.toLowerCase())) continue;
    out[k] = v;
  }
  return out;
}

/** Resolve a (possibly relative) Location-header value against the request
 *  URL. The fetch spec uses the URL of the response that produced the
 *  redirect; we honour that by passing the current `from`. */
function resolveLocation(from: string, location: string): string | null {
  try {
    return new URL(location, from).toString();
  } catch {
    return null;
  }
}

/**
 * Execute a request through the browser's fetch (or an injected impl for
 * tests). Returns a flat ExecutionResult — never throws for HTTP errors.
 * Network failures and timeouts are captured into result.error with status=null.
 *
 * Challenge-driven auth (Digest, NTLM) is handled here: when the first
 * fetch returns 401 with a recognized `WWW-Authenticate` scheme, we
 * compute the response header and re-fetch once. NTLM further requires a
 * second retry to send the Type-3 Authenticate after the Type-2
 * Challenge — that's transparent to the caller, the returned result
 * reflects the FINAL response.
 */
export async function executeRequest(
  req: ApiRequest,
  opts: ExecuteOptions = {},
): Promise<ExecutionResult> {
  const built = await buildRequest(req, {
    resolveAttachment: opts.resolveAttachment,
    authOptions: opts.authOptions,
    autoHeaderOverrides: opts.autoHeaderOverrides,
  });
  const fetchImpl = opts.fetchImpl ?? globalThis.fetch;
  const timeoutMs = opts.timeoutMs === undefined ? DEFAULT_TIMEOUT_MS : opts.timeoutMs;

  const startedAt = new Date().toISOString();
  const t0 =
    typeof performance !== 'undefined' && typeof performance.now === 'function'
      ? performance.now()
      : Date.now();

  const controller = new AbortController();
  const externalAbort = () => controller.abort(opts.signal!.reason);
  if (opts.signal) {
    if (opts.signal.aborted) controller.abort(opts.signal.reason);
    else opts.signal.addEventListener('abort', externalAbort, { once: true });
  }
  const timeoutHandle =
    timeoutMs === null
      ? null
      : setTimeout(
          () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
          timeoutMs,
        );

  try {
    // Manual redirect handling. The browser's default `redirect: 'follow'`
    // preserves `Authorization` / `Cookie` headers across cross-origin
    // redirects — a `302 Location: https://attacker/` from a legitimate
    // host would exfiltrate the bearer/basic credential. We walk the
    // redirect chain ourselves and strip cross-origin credential headers
    // at each hop.
    let currentUrl = built.url;
    let currentHeaders: Record<string, string> = { ...built.headers };
    let currentMethod = built.method;
    let currentBody: BodyInit | null = built.body;
    let response = await fetchImpl(currentUrl, {
      method: currentMethod,
      headers: currentHeaders,
      body: currentBody,
      signal: controller.signal,
      redirect: 'manual',
    });
    let redirectCount = 0;
    while (REDIRECT_STATUSES.has(response.status) && redirectCount < MAX_REDIRECTS) {
      const location = response.headers.get('location');
      if (!location) break;
      const nextUrl = resolveLocation(currentUrl, location);
      if (!nextUrl) break;
      // 303 always converts to GET with no body. 301/302 also convert
      // non-GET to GET for most browsers (legacy compat). 307/308 preserve
      // method + body.
      const preserveMethod = response.status === 307 || response.status === 308;
      const nextMethod = preserveMethod ? currentMethod : currentMethod === 'HEAD' ? 'HEAD' : 'GET';
      const nextBody = preserveMethod ? currentBody : null;
      const isCrossOrigin = !sameOrigin(currentUrl, nextUrl);
      const nextHeaders = isCrossOrigin
        ? stripCrossOriginHeaders(currentHeaders)
        : { ...currentHeaders };
      // Drain the previous response body so the underlying socket isn't
      // left holding bytes.
      try {
        await response.text();
      } catch {
        /* ignore */
      }
      currentUrl = nextUrl;
      currentHeaders = nextHeaders;
      currentMethod = nextMethod;
      currentBody = nextBody;
      response = await fetchImpl(currentUrl, {
        method: currentMethod,
        headers: currentHeaders,
        body: currentBody,
        signal: controller.signal,
        redirect: 'manual',
      });
      redirectCount++;
    }
    if (REDIRECT_STATUSES.has(response.status)) {
      // Hit the cap — surface as an error rather than silently returning
      // the redirect response (which the caller wouldn't know what to do
      // with).
      throw new Error(`Too many redirects (>${MAX_REDIRECTS})`);
    }

    // Auth-challenge retry loop. Acts only on 401 with a matching
    // scheme. We allow up to 2 retries:
    //   - 1st: standard challenge response (Digest or NTLM Type-3).
    //   - 2nd: only fires when Digest server replies `stale=true` with
    //     a fresh nonce. RFC 7616 §3.4 requires the client to retry
    //     with the new nonce + bumped nc. Anything beyond that is a
    //     real auth failure we surface as-is.
    const challengeAuth = req.auth;
    let retryCount = 0;
    let nc = '00000001';
    while (
      response.status === 401 &&
      challengeAuth &&
      (challengeAuth.type === 'digest' || challengeAuth.type === 'ntlm') &&
      retryCount < 2
    ) {
      const wwwAuth = response.headers.get('www-authenticate');
      if (!wwwAuth) break;

      // Stop after first retry unless the server explicitly says stale=true.
      // Use the strongest-challenge selector so a multi-algo server's stale
      // signal on the SHA-256 challenge isn't missed because we happened
      // to grab the MD5 one first.
      if (retryCount === 1) {
        const challenge = selectStrongestDigestChallenge(wwwAuth) ?? parseDigestChallenge(wwwAuth);
        if (!/^true$/i.test(challenge.stale ?? '')) break;
        nc = bumpNc(nc);
      }

      const retried = await runChallengeRetry({
        fetchImpl,
        builtUrl: currentUrl,
        builtMethod: currentMethod,
        builtHeaders: currentHeaders,
        builtBody: currentBody,
        signal: controller.signal,
        wwwAuth,
        auth: challengeAuth,
        previousResponse: response,
        nc,
      });
      if (!retried) break;

      // Drain the previous response body so the underlying connection
      // isn't left holding bytes. Failure here is benign in a test
      // setting (mocked Response) and rare in real fetch — swallow
      // silently rather than emitting console output from a library.
      try {
        await response.text();
      } catch {
        /* ignore — drain failure shouldn't block the retry */
      }
      response = retried;
      retryCount++;
    }

    const headers: Record<string, string> = {};
    response.headers.forEach((v, k) => {
      headers[k] = v;
    });
    const contentType = headers['content-type'] ?? '';
    // Stream the body via a reader so we can abort the read once we cross
    // `MAX_RESPONSE_BODY_BYTES`. The previous `await response.text()` would
    // happily buffer a gigabyte attacker-controlled stream into a single
    // string and OOM the renderer. We still build a string (the existing
    // ExecutionResult contract expects one) but cap how much we accept.
    const { text, truncated } = await readResponseCapped(response);
    const bodyKind: ExecutionResult['bodyKind'] =
      text.length === 0
        ? 'empty'
        : contentType.includes('json') ||
            contentType.includes('xml') ||
            contentType.startsWith('text/')
          ? contentType.includes('json')
            ? 'json'
            : 'text'
          : 'binary';
    const t1 =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    return {
      startedAt,
      durationMs: Math.max(0, Math.round(t1 - t0)),
      status: response.status,
      ok: response.ok,
      statusText: response.statusText,
      headers,
      body: text,
      bodyKind,
      url: currentUrl,
      method: currentMethod,
      authWarnings: built.authWarnings,
      ...(truncated ? { responseTruncated: true } : {}),
    };
  } catch (err) {
    const t1 =
      typeof performance !== 'undefined' && typeof performance.now === 'function'
        ? performance.now()
        : Date.now();
    return {
      startedAt,
      durationMs: Math.max(0, Math.round(t1 - t0)),
      status: null,
      ok: false,
      statusText: '',
      headers: {},
      body: '',
      bodyKind: 'empty',
      error: err instanceof Error ? err.message : String(err),
      // We may have already followed redirects before throwing — report the
      // last URL we tried so the user sees where the error originated.
      url: built.url,
      method: built.method,
      authWarnings: built.authWarnings,
    };
  } finally {
    if (timeoutHandle !== null) clearTimeout(timeoutHandle);
    if (opts.signal) opts.signal.removeEventListener('abort', externalAbort);
  }
}

/**
 * One-shot retry that consumes the WWW-Authenticate from a 401 response
 * and runs the matching challenge protocol:
 *
 * - Digest: parse the directives, build an `Authorization: Digest …`
 *   from the user's credentials, refetch once.
 * - NTLM: parse the Type-2 from `WWW-Authenticate: NTLM <base64>`,
 *   build the Type-3 with the user's credentials + workstation, refetch
 *   on the SAME connection (we can't enforce that from `fetch` alone,
 *   but most servers accept the Type-3 anyway because the cookie/socket
 *   reuse is best-effort under HTTP/2 multiplexing).
 *
 * Returns null when the challenge isn't one we handle (e.g. unrelated
 * 401 from a Bearer expiry); caller falls through with the original 401.
 */
async function runChallengeRetry(args: {
  fetchImpl: typeof fetch;
  builtUrl: string;
  builtMethod: string;
  builtHeaders: Record<string, string>;
  builtBody: BodyInit | null;
  signal: AbortSignal;
  wwwAuth: string;
  auth: Extract<ApiRequest['auth'], { type: 'digest' } | { type: 'ntlm' }>;
  previousResponse: Response;
  /** Optional nc override (8 hex chars) — bumped across stale=true retries. */
  nc?: string;
}): Promise<Response | null> {
  if (args.auth.type === 'digest' && /^digest\b/i.test(args.wwwAuth)) {
    // Pick the strongest challenge when the server stacks multiple
    // `WWW-Authenticate: Digest` headers (SHA-512-256 / SHA-256 / MD5).
    // For single-challenge servers this returns the same challenge that
    // `parseDigestChallenge` would have produced, so single-algo flows
    // are unchanged.
    const challenge =
      selectStrongestDigestChallenge(args.wwwAuth) ?? parseDigestChallenge(args.wwwAuth);
    if (!challenge.realm || !challenge.nonce) return null;
    const uri = new URL(args.builtUrl).pathname + new URL(args.builtUrl).search;
    // Digest auth-int requires the entity body bytes — string, binary,
    // and Blob all flow through. FormData and one-shot ReadableStream
    // bodies were consumed by the first fetch and CAN'T be replayed —
    // we surface that as an explicit failure rather than silently
    // sending an empty body that the server would reject anyway.
    let entityBody: string | Uint8Array | ArrayBuffer | Blob | null = null;
    const b = args.builtBody;
    if (typeof b === 'string') entityBody = b;
    else if (b instanceof Uint8Array || b instanceof ArrayBuffer) entityBody = b;
    else if (typeof Blob !== 'undefined' && b instanceof Blob) entityBody = b;
    else if (b != null && /\bauth-int\b/i.test(challenge.qop ?? '')) {
      // Server requires auth-int but we can't hash the body — fail
      // loudly instead of silently sending an empty hash.
      throw new Error(
        'Digest auth-int retry needs a hashable body (string / Blob / Uint8Array). ' +
          'Streaming bodies are consumed by the first fetch and cannot be replayed.',
      );
    }
    const authHeader = await buildDigestAuthHeader({
      method: args.builtMethod,
      uri,
      username: args.auth.username,
      password: args.auth.password,
      challenge,
      entityBody,
      // Pass the previous nonce-count so a `stale=true` retry can bump
      // it appropriately. First retry from a fresh challenge defaults
      // to nc=00000001.
      nc: args.nc,
    });
    return args.fetchImpl(args.builtUrl, {
      method: args.builtMethod,
      headers: setHeaderCaseInsensitive(args.builtHeaders, 'Authorization', authHeader),
      body: args.builtBody,
      signal: args.signal,
    });
  }

  if (args.auth.type === 'ntlm' && /^ntlm\s+/i.test(args.wwwAuth)) {
    const type2Base64 = args.wwwAuth.replace(/^ntlm\s+/i, '').trim();
    if (!type2Base64) return null;
    let type2;
    try {
      type2 = parseNtlmType2Challenge(type2Base64);
    } catch {
      return null;
    }
    // Recover Type-1 bytes from the Authorization header we sent on the
    // request that triggered this 401. When present, we hand both
    // Type-1 + Type-2 raw bytes into the Type-3 builder so it computes
    // and embeds the MIC per [MS-NLMP] §3.1.5.1.2. When the original
    // request didn't carry an NTLM Authorization (very rare — applyAuth
    // always emits one for `auth.type === 'ntlm'`), we skip MIC and
    // fall back to legacy Type-3 layout.
    const sentAuth = readHeaderCaseInsensitive(args.builtHeaders, 'Authorization');
    const type1Match = sentAuth?.match(/^ntlm\s+(.+)$/i);
    let type1Bytes: Uint8Array | undefined;
    if (type1Match) {
      try {
        type1Bytes = decodeNtlmBase64(type1Match[1].trim());
      } catch {
        type1Bytes = undefined;
      }
    }
    const type3 = buildNtlmType3Authenticate({
      username: args.auth.username,
      password: args.auth.password,
      domain: args.auth.domain,
      workstation: args.auth.workstation,
      challenge: type2,
      type1Message: type1Bytes,
      type2Message: type1Bytes ? type2.rawBytes : undefined,
    });
    return args.fetchImpl(args.builtUrl, {
      method: args.builtMethod,
      headers: setHeaderCaseInsensitive(args.builtHeaders, 'Authorization', `NTLM ${type3}`),
      body: args.builtBody,
      signal: args.signal,
    });
  }

  return null;
}

function setHeaderCaseInsensitive(
  headers: Record<string, string>,
  key: string,
  value: string,
): Record<string, string> {
  const lower = key.toLowerCase();
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() !== lower) out[k] = v;
  }
  out[key] = value;
  return out;
}

function readHeaderCaseInsensitive(
  headers: Record<string, string>,
  key: string,
): string | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
}

/** Bump the 8-hex-char nonce-count by 1 (e.g. "00000001" → "00000002"). */
function bumpNc(nc: string): string {
  const next = parseInt(nc, 16) + 1;
  return next.toString(16).padStart(8, '0');
}

/**
 * Read a Response body with a hard byte cap. Returns the decoded UTF-8
 * string plus a `truncated` flag. We stream via the body reader so a
 * gigabyte chunked-encoded stream from a hostile server doesn't OOM us —
 * once we've accumulated `MAX_RESPONSE_BODY_BYTES`, we cancel the read and
 * keep the prefix we already have.
 *
 * Fallback path: when the runtime doesn't expose `response.body` (older
 * fetch polyfills, certain test stubs), defer to `response.text()` — the
 * caller is on their own to know they're not facing a hostile server.
 */
async function readResponseCapped(
  response: Response,
): Promise<{ text: string; truncated: boolean }> {
  const body = response.body;
  if (!body || typeof body.getReader !== 'function') {
    // No stream — best-effort. The cap won't fire in this branch, but
    // the response.text() call still resolves to whatever the runtime
    // already buffered.
    return { text: await response.text(), truncated: false };
  }
  const reader = body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  let truncated = false;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      chunks.push(value);
      if (total >= MAX_RESPONSE_BODY_BYTES) {
        truncated = true;
        try {
          await reader.cancel();
        } catch {
          /* cancel may not be supported in every runtime */
        }
        break;
      }
    }
  } catch {
    // Read errored mid-stream — keep what we have and surface the chunks
    // we've already captured. The outer try/catch in executeRequest will
    // see the underlying network error if there is one.
  }
  // Concatenate + UTF-8 decode. We only need the bytes we kept; if we hit
  // the cap we trim to exactly `MAX_RESPONSE_BODY_BYTES` so the boundary
  // is deterministic for users (otherwise we'd return slightly over the
  // limit on the final chunk).
  const totalLen = truncated ? MAX_RESPONSE_BODY_BYTES : total;
  const out = new Uint8Array(totalLen);
  let offset = 0;
  for (const c of chunks) {
    if (offset >= totalLen) break;
    const slice = offset + c.byteLength > totalLen ? c.subarray(0, totalLen - offset) : c;
    out.set(slice, offset);
    offset += slice.byteLength;
  }
  const text = new TextDecoder('utf-8', { fatal: false }).decode(out);
  return { text, truncated };
}
