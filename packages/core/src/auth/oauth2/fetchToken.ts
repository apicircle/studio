/**
 * The single token-endpoint client used by every OAuth2 grant.
 *
 * RFC 6749 §4 endpoints accept `application/x-www-form-urlencoded` with
 * `grant_type` plus grant-specific fields. Client credentials may go in
 * the Authorization header (`client_secret_basic`) or the body
 * (`client_secret_post`); some IdPs only accept one or the other, so the
 * caller picks via `clientAuthMethod`.
 *
 * On success the IdP returns:
 *
 *   { access_token, token_type, expires_in?, refresh_token?, scope? }
 *
 * On failure (RFC 6749 §5.2):
 *
 *   { error, error_description?, error_uri? }   with HTTP 400/401
 *
 * We surface the failure as an Error whose `.message` includes both
 * `error` and `error_description` so the UI can show "invalid_grant: bad
 * code" without parsing JSON itself. The structured response is also
 * attached to `.cause` for callers who need to dispatch on `error_code`
 * (e.g. device flow's `authorization_pending` / `slow_down` cases).
 */

export interface OAuth2TokenResponse {
  accessToken: string;
  tokenType: string;
  expiresIn?: number;
  refreshToken?: string;
  scope?: string;
  /** Captured raw response — useful for OpenID Connect `id_token` etc. */
  raw: Record<string, unknown>;
}

export interface OAuth2ErrorResponse {
  error: string;
  errorDescription?: string;
  errorUri?: string;
  /** HTTP status the IdP returned (400, 401, 403, …). */
  status: number;
  /** Captured raw body — useful for diagnostics and grant-specific dispatch. */
  raw: Record<string, unknown>;
}

/**
 * Pre-signed client-assertion JWT for `private_key_jwt` client
 * authentication (RFC 7521 §4.2 / RFC 7523 §2.2). The auth tab signs
 * the assertion locally via `signJwt` and passes it here; we add the
 * required `client_assertion` + `client_assertion_type` body fields.
 * Used in place of `clientSecret` — the IdP verifies the assertion
 * against the registered public key.
 */
export interface ClientAssertion {
  /** The signed JWT (header.payload.signature) — output of `signJwt`. */
  jwt: string;
  /** RFC 7523 mandates this exact value. Other types exist (e.g. SAML2) but aren't used here. */
  type?: string;
}

export interface FetchOAuth2TokenArgs {
  tokenUrl: string;
  /**
   * Grant-specific body fields. `grant_type` MUST be set by the caller —
   * this helper doesn't infer it. Value type is `URLSearchParams` so the
   * caller controls the exact wire format and can reuse the same body
   * for retry / refresh paths.
   */
  body: URLSearchParams;
  clientId: string;
  /**
   * Confidential clients only. Public clients (PKCE in a SPA) leave this
   * undefined — the IdP recognizes the client by id alone.
   */
  clientSecret?: string;
  /**
   * Where to put the client credentials. `header` = HTTP Basic with
   * `id:secret`. `body` = `client_id` + `client_secret` URL-form fields.
   * Defaults to `header` (the RFC's preferred method).
   *
   * Ignored when `clientAssertion` is set — assertion takes precedence
   * because mixing both is a misconfiguration the server will reject.
   */
  clientAuthMethod?: 'header' | 'body';
  /**
   * Optional `private_key_jwt` style client authentication. When set,
   * the body carries `client_assertion` + `client_assertion_type` and
   * `clientSecret` is NOT sent. Used by Azure AD, GCP, and any IdP
   * that prefers signed assertions over shared secrets.
   */
  clientAssertion?: ClientAssertion;
  /** Optional extra parameters appended to the body — IdP-specific knobs. */
  extraParams?: Record<string, string>;
  /** Override fetch for tests / desktop bridge. */
  fetchImpl?: typeof fetch;
  /** Per-call abort. Composed with the global request signal upstream. */
  signal?: AbortSignal;
}

/**
 * OAuth2 token endpoint failure. The structured `errorBody` carries the
 * error code (`invalid_grant`, `authorization_pending`, etc) plus
 * `error_description` / `error_uri` and the HTTP status — callers can
 * dispatch on `errorBody.error` for grant-specific behavior (device
 * flow's `authorization_pending` / `slow_down`, refresh re-auth, etc).
 *
 * Naming note: we deliberately don't shadow the standard `Error.cause`
 * field. Callers using TypeScript can still use `instanceof` + the
 * `errorBody` accessor; callers reading the `cause` property get the
 * standard "what was the original exception" semantics.
 */
export class OAuth2TokenError extends Error {
  readonly errorBody: OAuth2ErrorResponse;
  constructor(errorBody: OAuth2ErrorResponse) {
    const desc = errorBody.errorDescription ? `: ${errorBody.errorDescription}` : '';
    super(`${errorBody.error}${desc}`);
    this.name = 'OAuth2TokenError';
    this.errorBody = errorBody;
  }
}

export async function fetchOAuth2Token(args: FetchOAuth2TokenArgs): Promise<OAuth2TokenResponse> {
  const fetchImpl = args.fetchImpl ?? globalThis.fetch;
  const headers: Record<string, string> = {
    'Content-Type': 'application/x-www-form-urlencoded',
    Accept: 'application/json',
  };
  const method = args.clientAuthMethod ?? 'header';

  // Clone body so caller's URLSearchParams stays unchanged after we
  // append `client_id`/`client_secret`/extraParams.
  const body = new URLSearchParams(args.body.toString());

  if (args.clientAssertion) {
    // private_key_jwt: signed assertion takes precedence over secret.
    // RFC 7521 §4.2 mandates both fields in the body.
    body.set('client_id', args.clientId);
    body.set(
      'client_assertion_type',
      args.clientAssertion.type ?? 'urn:ietf:params:oauth:client-assertion-type:jwt-bearer',
    );
    body.set('client_assertion', args.clientAssertion.jwt);
  } else if (method === 'header' && args.clientSecret) {
    headers['Authorization'] = `Basic ${base64(`${args.clientId}:${args.clientSecret}`)}`;
    // Public clients still need to identify themselves in body — RFC 6749 §3.2.1.
    body.set('client_id', args.clientId);
  } else {
    body.set('client_id', args.clientId);
    if (args.clientSecret) body.set('client_secret', args.clientSecret);
  }

  if (args.extraParams) {
    for (const [k, v] of Object.entries(args.extraParams)) body.set(k, v);
  }

  const response = await fetchImpl(args.tokenUrl, {
    method: 'POST',
    headers,
    body: body.toString(),
    signal: args.signal,
  });

  let raw: Record<string, unknown> = {};
  let parsedJson = false;
  try {
    raw = (await response.json()) as Record<string, unknown>;
    parsedJson = true;
  } catch {
    parsedJson = false;
  }

  // RFC 6750 §3 — the IdP MAY return errors via `WWW-Authenticate: Bearer
  // error="..."` with no JSON body. Parse that as a fallback so users
  // don't see "invalid_response: non-JSON" when the IdP is well-behaved
  // by spec but didn't include a JSON body.
  if (!parsedJson && !response.ok) {
    const wwwAuth = response.headers.get('www-authenticate');
    const parsed = wwwAuth ? parseBearerAuthError(wwwAuth) : null;
    if (parsed) {
      throw new OAuth2TokenError({
        error: parsed.error,
        errorDescription: parsed.errorDescription,
        errorUri: parsed.errorUri,
        status: response.status,
        raw: { ...parsed },
      });
    }
    throw new OAuth2TokenError({
      error: 'invalid_response',
      errorDescription: `IdP returned non-JSON ${response.status} response`,
      status: response.status,
      raw,
    });
  }
  if (!parsedJson) {
    throw new OAuth2TokenError({
      error: 'invalid_response',
      errorDescription: 'IdP returned non-JSON success response',
      status: response.status,
      raw,
    });
  }

  if (!response.ok || typeof raw['error'] === 'string') {
    throw new OAuth2TokenError({
      error: typeof raw['error'] === 'string' ? raw['error'] : 'invalid_grant',
      errorDescription:
        typeof raw['error_description'] === 'string' ? raw['error_description'] : undefined,
      errorUri: typeof raw['error_uri'] === 'string' ? raw['error_uri'] : undefined,
      status: response.status,
      raw,
    });
  }

  if (typeof raw['access_token'] !== 'string') {
    throw new OAuth2TokenError({
      error: 'invalid_response',
      errorDescription: 'Token endpoint returned no access_token',
      status: response.status,
      raw,
    });
  }

  return {
    accessToken: raw['access_token'],
    tokenType: typeof raw['token_type'] === 'string' ? raw['token_type'] : 'Bearer',
    expiresIn: typeof raw['expires_in'] === 'number' ? raw['expires_in'] : undefined,
    refreshToken: typeof raw['refresh_token'] === 'string' ? raw['refresh_token'] : undefined,
    scope: typeof raw['scope'] === 'string' ? raw['scope'] : undefined,
    raw,
  };
}

/**
 * Extract `error="..."` / `error_description="..."` / `error_uri="..."`
 * directives from a `WWW-Authenticate: Bearer ...` header value. Returns
 * null when the header isn't a Bearer challenge or carries no error
 * directive — callers fall back to the generic invalid_response error.
 */
function parseBearerAuthError(
  wwwAuth: string,
): { error: string; errorDescription?: string; errorUri?: string } | null {
  if (!/^bearer\b/i.test(wwwAuth.trim())) return null;
  const directives: Record<string, string> = {};
  const re = /(\w+)\s*=\s*(?:"((?:[^"\\]|\\.)*)"|([^\s,]+))/g;
  let m: RegExpExecArray | null;
  while ((m = re.exec(wwwAuth)) !== null) {
    directives[m[1].toLowerCase()] =
      m[2] !== undefined ? m[2].replace(/\\(.)/g, '$1') : (m[3] ?? '');
  }
  if (!directives['error']) return null;
  return {
    error: directives['error'],
    errorDescription: directives['error_description'],
    errorUri: directives['error_uri'],
  };
}

function base64(text: string): string {
  // UTF-8 → base64. `btoa` is byte-oriented (Latin-1), so we have to encode
  // the string to bytes first. The previous `btoa(unescape(encodeURIComponent(text)))`
  // hack relied on the deprecated `unescape` global; this path uses
  // `TextEncoder` instead, which is the standard since ES2017 and is
  // present in every runtime we ship into.
  if (typeof btoa === 'function' && typeof TextEncoder !== 'undefined') {
    const bytes = new TextEncoder().encode(text);
    let binary = '';
    for (let i = 0; i < bytes.length; i++) binary += String.fromCharCode(bytes[i]);
    return btoa(binary);
  }
  // Same Node/Buffer fallback shape as applyAuth — kept defensive.
  const buf = (
    globalThis as unknown as {
      Buffer?: { from: (data: string, encoding?: string) => { toString: (e: string) => string } };
    }
  ).Buffer;
  if (!buf) throw new Error('Neither btoa nor Buffer is available in this runtime');
  return buf.from(text, 'utf8').toString('base64');
}
