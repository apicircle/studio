// Translate a RequestAuth into outbound headers / query / cookies.
//
// Pure function — given a RequestAuth and the partially-built request, it
// returns a new partially-built request with auth applied. The signing
// primitives live in `../auth/*` so this module is mostly orchestration:
// pick the right helper for the auth type and stitch its output into the
// request.
//
// Three categories of auth types:
//   1. Token / shared-secret (bearer, basic, api-key, custom-header,
//      oauth2-*, jwt-bearer, hawk, aws-sigv4): everything we need is in
//      `auth` already; we sign + return one headers object.
//   2. Challenge-response that bootstraps from an unauthenticated send
//      (digest): we send no auth on the first request and let
//      executeRequest's 401-retry loop run buildDigestAuthHeader after
//      reading the server's WWW-Authenticate.
//   3. Challenge-response that bootstraps from a Type-1 Negotiate (ntlm):
//      we attach the Type-1 here so the server immediately challenges
//      with Type-2; executeRequest then computes Type-3 and re-sends.

import type { RequestAuth } from '@apicircle/shared';
import { applyAwsSigV4 } from '../auth/awsSigV4';
import { buildHawkAuthHeader } from '../auth/hawk';
import { signJwt } from '../auth/jwt';
import { buildNtlmType1Negotiate } from '../auth/ntlm';
import { refreshToken as runRefreshToken } from '../auth/oauth2/grants';
import { OAuth2TokenError, type OAuth2TokenResponse } from '../auth/oauth2/fetchToken';

export interface AuthApplyTarget {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null;
}

export interface AuthApplyOptions {
  /**
   * Called when applyAuth refreshes an expired OAuth2 access token. The
   * store wires this to persist the new accessToken / refreshToken /
   * expiresAt onto the request's auth payload — without it the refresh
   * works for THIS request but the next request would re-refresh because
   * the in-memory state didn't catch up.
   */
  onTokenRefreshed?: (
    auth: Extract<
      RequestAuth,
      | { type: 'oauth2-client-credentials' }
      | { type: 'oauth2-auth-code' }
      | { type: 'oauth2-pkce' }
      | { type: 'oauth2-password' }
      | { type: 'oauth2-implicit' }
      | { type: 'oauth2-device' }
    >,
    next: {
      accessToken: string;
      tokenType: string;
      refreshToken?: string;
      expiresAt: number;
      obtainedScope?: string;
    },
  ) => void | Promise<void>;
  /**
   * Test seam for the refresh fetch. When omitted, the global fetch is
   * used (matching production behavior).
   */
  fetchImpl?: typeof fetch;
  /**
   * Refresh tokens when they have less than this many milliseconds left.
   * Default: 60_000 (1 min). Set to 0 to disable proactive refresh.
   */
  refreshLeewayMs?: number;
}

export interface AuthApplyResult {
  url: string;
  headers: Record<string, string>;
  /**
   * Non-fatal warnings raised while applying auth (bad JWT key, malformed
   * payload JSON, etc). The request still goes out — usually unauthenticated
   * — but executeRequest surfaces these to the user so they don't see a
   * mysterious 401 with no clue why their auth config didn't apply.
   */
  warnings?: AuthApplyWarning[];
}

export interface AuthApplyWarning {
  /** Stable code so callers can match without parsing message strings. */
  code:
    | 'jwt-payload-json-invalid'
    | 'jwt-headers-json-invalid'
    | 'jwt-sign-failed'
    | 'hawk-url-invalid'
    | 'oauth2-refresh-failed';
  /** Human-readable message — safe to surface in the UI. */
  message: string;
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

/**
 * Inspect an OAuth2 auth's expiry; if it's within `refreshLeewayMs` of
 * now AND a refreshToken is on file, swap in a freshly-refreshed token.
 * Failures are silent — applyAuth still tries to apply whatever token
 * we have, the user gets a 401, and the auth panel surfaces the
 * staleness via the token-state summary.
 *
 * Returns the refreshed auth (caller swaps it in for the rest of the
 * apply pass), or null when no refresh fired.
 */
/**
 * In-flight refresh dedupe map. Keyed by `tokenUrl|clientId|refreshToken`
 * so two concurrent sends with the same expiring token coalesce into a
 * single POST against the IdP. Without this, N parallel sends with an
 * expired token = N parallel refresh requests, which most IdPs rate-
 * limit and which wastes a refresh_token if the IdP rotates them per
 * call. The map is process-local; cleared as soon as the refresh
 * settles either way.
 */
const inflightRefreshes = new Map<string, Promise<OAuth2TokenResponse>>();

async function maybeAutoRefresh(
  auth: RequestAuth,
  opts: AuthApplyOptions,
  warnings: AuthApplyWarning[],
): Promise<RequestAuth | null> {
  if (
    auth.type !== 'oauth2-client-credentials' &&
    auth.type !== 'oauth2-auth-code' &&
    auth.type !== 'oauth2-pkce' &&
    auth.type !== 'oauth2-password' &&
    auth.type !== 'oauth2-device'
  ) {
    return null;
  }
  // implicit doesn't issue refresh_tokens — skip.
  const expiresAt = (auth as { expiresAt?: number }).expiresAt ?? 0;
  if (expiresAt <= 0) return null;
  const leeway = opts.refreshLeewayMs ?? 60_000;
  if (Date.now() + leeway < expiresAt) return null;
  const refreshTokenValue = (auth as { refreshToken?: string }).refreshToken ?? '';
  if (!refreshTokenValue.trim()) return null;
  try {
    const dedupeKey = `${auth.tokenUrl}|${auth.clientId}|${refreshTokenValue}`;
    const existing = inflightRefreshes.get(dedupeKey);
    const refreshPromise =
      existing ??
      runRefreshToken({
        tokenUrl: auth.tokenUrl,
        clientId: auth.clientId,
        clientSecret: (auth as { clientSecret?: string }).clientSecret || undefined,
        refreshToken: refreshTokenValue,
        scope: (auth as { scope?: string }).scope || undefined,
        fetchImpl: opts.fetchImpl,
      });
    if (!existing) {
      inflightRefreshes.set(dedupeKey, refreshPromise);
      // Always clear the entry once the promise settles, success or
      // failure. We MUST attach a catch as well — otherwise a refresh
      // rejection would propagate as an unhandled-rejection warning
      // (we await `refreshPromise` directly below, but the fan-out
      // `.finally(...)` here is its own promise chain that needs
      // explicit error consumption).
      refreshPromise
        .catch(() => {
          /* ignored — caller awaits the original promise and surfaces */
        })
        .finally(() => {
          inflightRefreshes.delete(dedupeKey);
        });
    }
    const next = await refreshPromise;
    const merged = {
      ...auth,
      accessToken: next.accessToken,
      tokenType: next.tokenType,
      refreshToken: next.refreshToken ?? refreshTokenValue,
      expiresAt: next.expiresIn ? Date.now() + next.expiresIn * 1000 : 0,
      obtainedScope: next.scope ?? (auth as { obtainedScope?: string }).obtainedScope ?? '',
    } as RequestAuth;
    if (opts.onTokenRefreshed) {
      try {
        await opts.onTokenRefreshed(
          merged as Parameters<NonNullable<AuthApplyOptions['onTokenRefreshed']>>[0],
          {
            accessToken: next.accessToken,
            tokenType: next.tokenType,
            refreshToken: next.refreshToken,
            expiresAt: next.expiresIn ? Date.now() + next.expiresIn * 1000 : 0,
            obtainedScope: next.scope,
          },
        );
      } catch {
        // Persistence failures shouldn't block the request — the
        // refreshed token still applies for THIS send.
      }
    }
    return merged;
  } catch (err) {
    // Refresh failed — surface to the user via authWarnings so they can
    // see WHY their request went out unauthenticated. Falls through with
    // the original (stale) token; the request will hit a 401 but at
    // least the user has a clear refresh-failure message in the panel.
    const message =
      err instanceof OAuth2TokenError
        ? `OAuth2 token refresh failed: ${err.message}`
        : `OAuth2 token refresh failed: ${err instanceof Error ? err.message : String(err)}`;
    warnings.push({ code: 'oauth2-refresh-failed', message });
    return null;
  }
}

/** Read a header by name case-insensitively. */
function findHeaderValue(headers: Record<string, string>, key: string): string | undefined {
  const lower = key.toLowerCase();
  for (const [k, v] of Object.entries(headers)) {
    if (k.toLowerCase() === lower) return v;
  }
  return undefined;
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

// btoa exists everywhere we run today (browsers, Node ≥ 18). The Buffer
// fallback is kept for the unlikely case of a sandbox that strips both —
// we'd rather degrade with a clear message than silently send no auth.
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

// ── jwt-bearer plumbing ────────────────────────────────────────────────────────

/**
 * Either return the user-supplied pre-computed token, or sign a fresh
 * one using the algorithm + key the auth config specifies. Returns the
 * token plus any warnings raised along the way (malformed JSON, signing
 * failure). Token is null when there's nothing to send; warnings are
 * non-empty when the config was malformed in a way the user should see.
 */
async function buildJwtToken(
  auth: Extract<RequestAuth, { type: 'jwt-bearer' }>,
): Promise<{ token: string | null; warnings: AuthApplyWarning[] }> {
  const warnings: AuthApplyWarning[] = [];
  if (auth.token.trim().length > 0) return { token: auth.token.trim(), warnings };
  if (!auth.algorithm || !auth.secretOrKey) return { token: null, warnings };
  let payload: Record<string, unknown> = {};
  let extraHeaders: Record<string, unknown> = {};
  if (auth.payload.trim()) {
    try {
      payload = JSON.parse(auth.payload) as Record<string, unknown>;
    } catch (err) {
      warnings.push({
        code: 'jwt-payload-json-invalid',
        message: `JWT payload is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { token: null, warnings };
    }
  }
  if (auth.jwtHeaders.trim()) {
    try {
      extraHeaders = JSON.parse(auth.jwtHeaders) as Record<string, unknown>;
    } catch (err) {
      warnings.push({
        code: 'jwt-headers-json-invalid',
        message: `JWT additional-headers is not valid JSON: ${err instanceof Error ? err.message : String(err)}`,
      });
      return { token: null, warnings };
    }
  }
  try {
    const token = await signJwt({
      algorithm: auth.algorithm,
      secretOrKey: auth.secretOrKey,
      payload,
      additionalHeaders: extraHeaders,
    });
    return { token, warnings };
  } catch (err) {
    warnings.push({
      code: 'jwt-sign-failed',
      message: `JWT signing failed: ${err instanceof Error ? err.message : String(err)}`,
    });
    return { token: null, warnings };
  }
}

// ── Public entry point ────────────────────────────────────────────────────────

export async function applyAuth(
  target: AuthApplyTarget,
  auth: RequestAuth,
  opts: AuthApplyOptions = {},
): Promise<AuthApplyResult> {
  // Warnings collected as we go — emitted on the result so executeRequest
  // can surface them in `ExecutionResult.authWarnings` (UI displays
  // them next to the response). Refresh failures, JWT signing errors,
  // and Hawk URL parse failures all flow through here.
  const warnings: AuthApplyWarning[] = [];

  // Auto-refresh OAuth2 tokens that are expired or about to expire. The
  // refresh fires BEFORE the auth-injection switch below so the refreshed
  // accessToken is what we end up putting on the wire.
  const refreshed = await maybeAutoRefresh(auth, opts, warnings);
  if (refreshed) auth = refreshed;

  const result = await applyAuthBody(target, auth, opts, warnings);
  if (warnings.length > 0) {
    return {
      ...result,
      warnings: [...(result.warnings ?? []), ...warnings],
    };
  }
  return result;
}

/**
 * Inner switch — split out from `applyAuth` so the outer wrapper can
 * combine post-refresh warnings with per-type warnings without
 * re-walking the auth shape.
 */
async function applyAuthBody(
  target: AuthApplyTarget,
  auth: RequestAuth,
  opts: AuthApplyOptions,
  warnings: AuthApplyWarning[],
): Promise<AuthApplyResult> {
  void warnings; // body-level switch doesn't push warnings today; refresh + JWT helpers do.
  void opts;
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

    case 'aws-sigv4': {
      if (!auth.accessKeyId || !auth.secretAccessKey || !auth.region || !auth.service) {
        return { url: target.url, headers: target.headers };
      }
      // Pass the body through as-is — the signer accepts every BodyInit
      // shape and falls back to UNSIGNED-PAYLOAD for FormData /
      // ReadableStream where pre-fetch hashing isn't possible.
      const signed = await applyAwsSigV4({
        method: target.method,
        url: target.url,
        headers: target.headers,
        body: target.body as Parameters<typeof applyAwsSigV4>[0]['body'],
        accessKeyId: auth.accessKeyId,
        secretAccessKey: auth.secretAccessKey,
        region: auth.region,
        service: auth.service,
        sessionToken: auth.sessionToken || undefined,
        addTo: auth.addTo,
      });
      return { url: signed.url, headers: signed.headers };
    }

    case 'hawk': {
      if (!auth.hawkId || !auth.hawkKey) return { url: target.url, headers: target.headers };
      try {
        // When bindPayload is on AND the body is hashable, fold the body
        // into the MAC. We pull the content-type from the request's own
        // headers (case-insensitively); if the body is FormData /
        // ReadableStream we can't hash pre-fetch — silently fall back to
        // header-only signing, same as Hawk reference clients.
        let payload: { body: string | ArrayBuffer | Uint8Array; contentType: string } | undefined;
        if (auth.bindPayload && target.body != null) {
          const ct = findHeaderValue(target.headers, 'content-type') ?? 'application/octet-stream';
          if (typeof target.body === 'string') payload = { body: target.body, contentType: ct };
          else if (target.body instanceof ArrayBuffer)
            payload = { body: target.body, contentType: ct };
          else if (target.body instanceof Uint8Array)
            payload = { body: target.body, contentType: ct };
          else if (typeof URLSearchParams !== 'undefined' && target.body instanceof URLSearchParams)
            payload = {
              body: target.body.toString(),
              contentType: 'application/x-www-form-urlencoded',
            };
        }
        const headerValue = await buildHawkAuthHeader({
          method: target.method,
          url: target.url,
          hawkId: auth.hawkId,
          hawkKey: auth.hawkKey,
          algorithm: auth.algorithm,
          ext: auth.ext,
          payload,
        });
        return {
          url: target.url,
          headers: setHeader(target.headers, 'Authorization', headerValue),
        };
      } catch {
        // Malformed URL etc. — let the request fly without auth.
        return { url: target.url, headers: target.headers };
      }
    }

    case 'jwt-bearer': {
      const { token, warnings } = await buildJwtToken(auth);
      if (!token) {
        return { url: target.url, headers: target.headers, warnings };
      }
      return {
        url: target.url,
        headers: setHeader(target.headers, 'Authorization', `Bearer ${token}`),
        warnings: warnings.length ? warnings : undefined,
      };
    }

    case 'digest':
      // Digest is challenge-driven: send unauthenticated. executeRequest's
      // 401-retry path inspects WWW-Authenticate, runs buildDigestAuthHeader,
      // and re-fetches with the right Authorization on its own.
      return { url: target.url, headers: target.headers };

    case 'ntlm': {
      // NTLM bootstraps from a Type-1 Negotiate so the server immediately
      // returns 401 + Type-2 challenge. Sending nothing would let the
      // server respond with a generic auth-required error that's
      // indistinguishable from "credentials wrong"; emitting Type-1
      // explicitly lights up the handshake.
      const type1 = buildNtlmType1Negotiate(auth.domain, auth.workstation);
      return {
        url: target.url,
        headers: setHeader(target.headers, 'Authorization', `NTLM ${type1}`),
      };
    }
  }
}
