/**
 * Per-grant OAuth2 runners. Each function POSTs to the token endpoint
 * with the body shape RFC 6749 specifies for that grant, and returns a
 * normalized `OAuth2TokenResponse`. Callbacks (browser redirects to
 * `redirect_uri?code=...`) and device-code polling intervals are the
 * caller's job — these runners ONLY exchange.
 *
 * Refresh handling is in `refreshToken()` rather than per-grant: the
 * refresh-token grant is identical regardless of which grant minted the
 * original token.
 */

import { OAuth2TokenError, fetchOAuth2Token, type OAuth2TokenResponse } from './fetchToken';

type ClientAuthMethod = 'header' | 'body';
type FetchImpl = typeof fetch;

export interface ClientCredentialsArgs {
  tokenUrl: string;
  clientId: string;
  clientSecret: string;
  scope?: string;
  clientAuthMethod?: ClientAuthMethod;
  extraParams?: Record<string, string>;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

/** RFC 6749 §4.4 — machine-to-machine, no user. */
export async function runClientCredentials(
  args: ClientCredentialsArgs,
): Promise<OAuth2TokenResponse> {
  const body = new URLSearchParams({ grant_type: 'client_credentials' });
  if (args.scope?.trim()) body.set('scope', args.scope.trim());
  return fetchOAuth2Token({
    tokenUrl: args.tokenUrl,
    body,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    clientAuthMethod: args.clientAuthMethod ?? 'header',
    extraParams: args.extraParams,
    fetchImpl: args.fetchImpl,
    signal: args.signal,
  });
}

export interface RopcArgs {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  username: string;
  password: string;
  scope?: string;
  clientAuthMethod?: ClientAuthMethod;
  extraParams?: Record<string, string>;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

/**
 * RFC 6749 §4.3 — Resource Owner Password Credentials. Marked DEPRECATED
 * in OAuth 2.1; we support it because legacy IdPs still require it for
 * specific testing / migration scenarios. The auth panel surfaces a
 * warning banner about the deprecation.
 */
export async function runRopc(args: RopcArgs): Promise<OAuth2TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'password',
    username: args.username,
    password: args.password,
  });
  if (args.scope?.trim()) body.set('scope', args.scope.trim());
  return fetchOAuth2Token({
    tokenUrl: args.tokenUrl,
    body,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    clientAuthMethod: args.clientAuthMethod ?? 'header',
    extraParams: args.extraParams,
    fetchImpl: args.fetchImpl,
    signal: args.signal,
  });
}

export interface AuthCodeExchangeArgs {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  /** The `code` value the IdP redirected back with. */
  code: string;
  /** Must match the redirect_uri sent in the initial /authorize request. */
  redirectUri: string;
  clientAuthMethod?: ClientAuthMethod;
  extraParams?: Record<string, string>;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

/** RFC 6749 §4.1 — Authorization Code grant. */
export async function exchangeAuthCode(args: AuthCodeExchangeArgs): Promise<OAuth2TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
  });
  return fetchOAuth2Token({
    tokenUrl: args.tokenUrl,
    body,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    clientAuthMethod: args.clientAuthMethod ?? 'header',
    extraParams: args.extraParams,
    fetchImpl: args.fetchImpl,
    signal: args.signal,
  });
}

export interface PkceExchangeArgs extends AuthCodeExchangeArgs {
  /** The verifier we generated when constructing the auth URL. */
  codeVerifier: string;
}

/**
 * RFC 7636 — Authorization Code with PKCE. Same body as plain auth-code
 * plus `code_verifier`. clientSecret is optional (public clients omit it).
 */
export async function exchangePkce(args: PkceExchangeArgs): Promise<OAuth2TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'authorization_code',
    code: args.code,
    redirect_uri: args.redirectUri,
    code_verifier: args.codeVerifier,
  });
  return fetchOAuth2Token({
    tokenUrl: args.tokenUrl,
    body,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    clientAuthMethod: args.clientAuthMethod ?? 'header',
    extraParams: args.extraParams,
    fetchImpl: args.fetchImpl,
    signal: args.signal,
  });
}

export interface DeviceAuthorizationResponse {
  deviceCode: string;
  userCode: string;
  verificationUri: string;
  /** Optional convenience URI with the user_code already embedded. */
  verificationUriComplete?: string;
  /** Seconds the device should poll the token endpoint. */
  interval: number;
  /** Seconds before deviceCode expires. */
  expiresIn: number;
  raw: Record<string, unknown>;
}

export interface DeviceAuthorizationArgs {
  deviceAuthorizationUrl: string;
  clientId: string;
  clientSecret?: string;
  scope?: string;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

/**
 * RFC 8628 §3.1 — Device Authorization Request. Returns the device_code
 * + user_code so the caller can show the user_code + verification URI to
 * a human, then poll the token endpoint with `pollDeviceFlow`.
 */
export async function requestDeviceAuthorization(
  args: DeviceAuthorizationArgs,
): Promise<DeviceAuthorizationResponse> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const body = new URLSearchParams({ client_id: args.clientId });
  if (args.scope?.trim()) body.set('scope', args.scope.trim());
  if (args.clientSecret) body.set('client_secret', args.clientSecret);

  const response = await fetchImpl(args.deviceAuthorizationUrl, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded',
      Accept: 'application/json',
    },
    body: body.toString(),
    signal: args.signal,
  });

  let raw: Record<string, unknown> = {};
  try {
    raw = (await response.json()) as Record<string, unknown>;
  } catch {
    throw new OAuth2TokenError({
      error: 'invalid_response',
      errorDescription: 'Device authorization endpoint returned non-JSON',
      status: response.status,
      raw,
    });
  }

  if (!response.ok || typeof raw['error'] === 'string') {
    throw new OAuth2TokenError({
      error: typeof raw['error'] === 'string' ? raw['error'] : 'invalid_response',
      errorDescription:
        typeof raw['error_description'] === 'string' ? raw['error_description'] : undefined,
      status: response.status,
      raw,
    });
  }

  if (typeof raw['device_code'] !== 'string' || typeof raw['user_code'] !== 'string') {
    throw new OAuth2TokenError({
      error: 'invalid_response',
      errorDescription: 'Device authorization response missing device_code or user_code',
      status: response.status,
      raw,
    });
  }

  return {
    deviceCode: raw['device_code'],
    userCode: raw['user_code'],
    verificationUri:
      (raw['verification_uri'] as string | undefined) ??
      (raw['verification_url'] as string | undefined) ??
      '',
    verificationUriComplete:
      typeof raw['verification_uri_complete'] === 'string'
        ? raw['verification_uri_complete']
        : undefined,
    interval: typeof raw['interval'] === 'number' ? raw['interval'] : 5,
    expiresIn: typeof raw['expires_in'] === 'number' ? raw['expires_in'] : 600,
    raw,
  };
}

export interface PollDeviceFlowArgs {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  deviceCode: string;
  /** Initial poll interval in seconds. Bumped to `interval + 5` on `slow_down`. */
  intervalSeconds: number;
  /** Max overall wait. When elapsed, throws an `OAuth2TokenError` of error="expired_token". */
  maxWaitMs?: number;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
  /**
   * Optional progress callback fired on every poll cycle. UI uses this
   * to update the visible "still waiting…" indicator and tick down the
   * remaining time. Receives `{ pollCount, elapsedMs, lastError }` —
   * `lastError` is set when the IdP responded `slow_down` so the UI
   * can hint the user to wait.
   */
  onPoll?: (info: { pollCount: number; elapsedMs: number; lastError?: string }) => void;
  /** Test seam — overrides `setTimeout` / `Date.now` for fake clocks. */
  scheduler?: {
    sleep: (ms: number) => Promise<void>;
    now: () => number;
  };
}

const DEVICE_GRANT_TYPE = 'urn:ietf:params:oauth:grant-type:device_code';

/**
 * RFC 8628 §3.4 — poll the token endpoint until the user authorizes the
 * device, then return the token. Honors `authorization_pending` /
 * `slow_down` / `access_denied` / `expired_token`.
 */
export async function pollDeviceFlow(args: PollDeviceFlowArgs): Promise<OAuth2TokenResponse> {
  const sleep = args.scheduler?.sleep ?? ((ms: number) => new Promise((r) => setTimeout(r, ms)));
  const now = args.scheduler?.now ?? (() => Date.now());
  const start = now();
  let interval = args.intervalSeconds;
  let pollCount = 0;

  while (true) {
    pollCount++;
    args.onPoll?.({ pollCount, elapsedMs: now() - start });
    if (args.signal?.aborted) {
      throw new OAuth2TokenError({
        error: 'aborted',
        errorDescription: 'Device flow polling was aborted',
        status: 0,
        raw: {},
      });
    }
    if (args.maxWaitMs !== undefined && now() - start > args.maxWaitMs) {
      throw new OAuth2TokenError({
        error: 'expired_token',
        errorDescription: 'Device flow exceeded maxWaitMs',
        status: 0,
        raw: {},
      });
    }

    const body = new URLSearchParams({
      grant_type: DEVICE_GRANT_TYPE,
      device_code: args.deviceCode,
    });
    try {
      return await fetchOAuth2Token({
        tokenUrl: args.tokenUrl,
        body,
        clientId: args.clientId,
        clientSecret: args.clientSecret,
        clientAuthMethod: 'body',
        fetchImpl: args.fetchImpl,
        signal: args.signal,
      });
    } catch (err) {
      if (!(err instanceof OAuth2TokenError)) throw err;
      if (err.errorBody.error === 'authorization_pending') {
        await sleep(interval * 1000);
        continue;
      }
      if (err.errorBody.error === 'slow_down') {
        interval += 5;
        await sleep(interval * 1000);
        continue;
      }
      // expired_token / access_denied / invalid_grant / etc — terminal.
      throw err;
    }
  }
}

export interface RefreshTokenArgs {
  tokenUrl: string;
  clientId: string;
  clientSecret?: string;
  refreshToken: string;
  /** Some IdPs require the original scope on refresh. */
  scope?: string;
  clientAuthMethod?: ClientAuthMethod;
  extraParams?: Record<string, string>;
  fetchImpl?: FetchImpl;
  signal?: AbortSignal;
}

/**
 * RFC 6749 §6 — refresh a previously obtained token. Identical wire
 * shape regardless of the grant that minted the original token; the
 * caller decides when to call it (typical heuristic: when
 * `expiresAt < now + 60s`).
 */
export async function refreshToken(args: RefreshTokenArgs): Promise<OAuth2TokenResponse> {
  const body = new URLSearchParams({
    grant_type: 'refresh_token',
    refresh_token: args.refreshToken,
  });
  if (args.scope?.trim()) body.set('scope', args.scope.trim());
  return fetchOAuth2Token({
    tokenUrl: args.tokenUrl,
    body,
    clientId: args.clientId,
    clientSecret: args.clientSecret,
    clientAuthMethod: args.clientAuthMethod ?? 'header',
    extraParams: args.extraParams,
    fetchImpl: args.fetchImpl,
    signal: args.signal,
  });
}

/**
 * Build the `/authorize` URL the user is redirected to for auth-code or
 * implicit flows. PKCE callers append `code_challenge` + `code_challenge_method`
 * via `extraParams`. Doesn't open a browser — that's the host bridge's job.
 */
export function buildAuthorizeUrl(args: {
  authorizeUrl: string;
  clientId: string;
  redirectUri: string;
  responseType: 'code' | 'token';
  scope?: string;
  state?: string;
  extraParams?: Record<string, string>;
}): string {
  const url = new URL(args.authorizeUrl);
  url.searchParams.set('client_id', args.clientId);
  url.searchParams.set('redirect_uri', args.redirectUri);
  url.searchParams.set('response_type', args.responseType);
  if (args.scope) url.searchParams.set('scope', args.scope);
  if (args.state) url.searchParams.set('state', args.state);
  if (args.extraParams) {
    for (const [k, v] of Object.entries(args.extraParams)) url.searchParams.set(k, v);
  }
  return url.toString();
}
