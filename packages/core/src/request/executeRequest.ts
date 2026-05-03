import type { Request as ApiRequest } from '@apicircle/shared';
import { buildRequest, type AttachmentResolver, type RuntimeIdentity } from './buildRequest';
import { type AuthApplyOptions, type AuthApplyWarning } from './applyAuth';
import { buildDigestAuthHeader, parseDigestChallenge } from '../auth/digest';
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
  // Identity for the auto-fed APICircle headers. CLI / desktop pass their own.
  runtime?: RuntimeIdentity;
  /**
   * applyAuth options — `onTokenRefreshed` is the important one for
   * production: the store wires it to persist refreshed OAuth2 tokens
   * back into `RequestAuth` so subsequent sends see the new state.
   */
  authOptions?: AuthApplyOptions;
}

const DEFAULT_TIMEOUT_MS = 30_000;

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
    runtime: opts.runtime,
    authOptions: opts.authOptions,
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
    let response = await fetchImpl(built.url, {
      method: built.method,
      headers: built.headers,
      body: built.body,
      signal: controller.signal,
    });

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
      if (retryCount === 1) {
        const challenge = parseDigestChallenge(wwwAuth);
        if (!/^true$/i.test(challenge.stale ?? '')) break;
        nc = bumpNc(nc);
      }

      const retried = await runChallengeRetry({
        fetchImpl,
        builtUrl: built.url,
        builtMethod: built.method,
        builtHeaders: built.headers,
        builtBody: built.body,
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
    const text = await response.text();
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
      url: built.url,
      method: built.method,
      authWarnings: built.authWarnings,
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
    const challenge = parseDigestChallenge(args.wwwAuth);
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
