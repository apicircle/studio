import type { Request as ApiRequest } from '@apicircle/shared';
import { applyAuth, type AuthApplyOptions, type AuthApplyWarning } from './applyAuth';
import { mergeWithAutoHeaders, type AutoHeaderOverrides } from './autoHeaders';

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null;
  /**
   * Non-fatal warnings raised by applyAuth (bad JWT key, malformed
   * payload JSON, etc). executeRequest forwards these into
   * `ExecutionResult.authWarnings` so the UI can surface them alongside
   * the response — without them, a misconfigured JWT silently produces
   * a 401 with no clue why.
   */
  authWarnings: AuthApplyWarning[];
}

/**
 * Resolves an attachment slotId to a Blob (with filename for form-data).
 * The host (UI layer) reads this from its IndexedDB attachments store.
 * Returns null when the attachment is missing — composeBody treats missing
 * attachments as empty fields rather than throwing.
 */
export type AttachmentResolver = (
  slotId: string,
) => Promise<{ blob: Blob; filename: string } | null>;

/**
 * Match URL placeholders in either Express-style (`:name`) or OpenAPI-style
 * (`{name}`). Names follow `[A-Za-z_][\w-]*`. The negative lookbehind/lookahead
 * on `{...}` excludes our `{{var}}` template-variable syntax, which sits
 * between two curlies and would otherwise match incorrectly.
 *
 * We also restrict the scan to the URL's *path portion* (everything before
 * the first `?`) — query values often contain `{{NAME}}` references, and we
 * never want those classified as path params.
 */
const PATH_PLACEHOLDER = /(?::([A-Za-z_][\w-]*)|(?<!\{)\{([A-Za-z_][\w-]*)\}(?!\}))/g;

function splitOnQuery(rawUrl: string): { path: string; rest: string } {
  const q = rawUrl.indexOf('?');
  if (q < 0) return { path: rawUrl, rest: '' };
  return { path: rawUrl.slice(0, q), rest: rawUrl.slice(q) };
}

/**
 * Split a typed URL into the base part (everything before `?`) and a
 * structured query-row list. Used by the editor's URL input to keep the
 * URL field and the Query Params sub-tab in sync — when the user types or
 * pastes `?key=val`, the rows surface in the Params list automatically.
 *
 * Variable references like `{{NAME}}` in keys or values are preserved
 * verbatim — they stay templated and resolve at send time. We use
 * permissive splitting (split on `&` then on the first `=`) rather than
 * `URLSearchParams` because URLSearchParams percent-decodes `{{` into `{{`
 * fine but also collapses whitespace and strips empty keys, which fights
 * the user's intent during in-progress typing.
 */
export function parseUrlQuery(rawUrl: string): {
  base: string;
  query: Array<{ key: string; value: string; enabled: boolean }>;
} {
  const q = rawUrl.indexOf('?');
  if (q < 0) return { base: rawUrl, query: [] };
  const base = rawUrl.slice(0, q);
  const queryString = rawUrl.slice(q + 1);
  // Strip a trailing `#fragment` if present — fragments aren't sent over the
  // wire and would otherwise leak into the last query row's value.
  const hashIdx = queryString.indexOf('#');
  const cleaned = hashIdx >= 0 ? queryString.slice(0, hashIdx) : queryString;
  if (cleaned.length === 0) return { base, query: [] };
  const rows = cleaned.split('&').map((segment) => {
    const eq = segment.indexOf('=');
    const key = eq < 0 ? segment : segment.slice(0, eq);
    const value = eq < 0 ? '' : segment.slice(eq + 1);
    return {
      // Decode percent-encoded keys/values but leave `{{var}}` alone — those
      // never get percent-encoded by Postman/curl pastes.
      key: tryDecode(key),
      value: tryDecode(value),
      enabled: true,
    };
  });
  return { base, query: rows };
}

function tryDecode(s: string): string {
  try {
    return decodeURIComponent(s);
  } catch {
    return s;
  }
}

/**
 * Inverse of `parseUrlQuery`. Renders the structured query rows back into a
 * URL-bar-friendly string, skipping disabled or empty-key rows. Values are
 * left as-is (no double-encoding) — `composeUrl` runs at send time and
 * handles wire encoding properly.
 */
export function composeUrlWithQuery(
  base: string,
  query: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): string {
  const enabled = query.filter((q) => q.enabled && q.key.trim().length > 0);
  if (enabled.length === 0) return base;
  const rendered = enabled.map((q) => `${q.key}=${q.value}`).join('&');
  return `${base}?${rendered}`;
}

/** Extract the placeholder names appearing in a URL, in document order, deduped. */
export function findPathPlaceholders(rawUrl: string): string[] {
  const { path } = splitOnQuery(rawUrl);
  const seen = new Set<string>();
  const out: string[] = [];
  PATH_PLACEHOLDER.lastIndex = 0;
  let m: RegExpExecArray | null;
  while ((m = PATH_PLACEHOLDER.exec(path)) !== null) {
    const name = m[1] ?? m[2];
    if (name && !seen.has(name)) {
      seen.add(name);
      out.push(name);
    }
  }
  return out;
}

/**
 * Substitute `:name` and `{name}` placeholders in a URL's path with the
 * matching values from `pathParams`. The query string passes through
 * untouched — a `{{var}}` in there is a variable reference, not a path
 * placeholder. Missing keys substitute to empty string; the Editor surfaces
 * unbound placeholders as a UI warning, not a runtime error.
 */
export function applyPathParams(rawUrl: string, pathParams: Record<string, string>): string {
  const { path, rest } = splitOnQuery(rawUrl);
  PATH_PLACEHOLDER.lastIndex = 0;
  const substituted = path.replace(PATH_PLACEHOLDER, (_full, exprName, braceName) => {
    const name = (exprName ?? braceName) as string;
    const value = pathParams[name];
    return value === undefined ? '' : encodeURIComponent(value);
  });
  return substituted + rest;
}

// RFC 7230 §3.2.6 "token" — valid characters for an HTTP header field-name.
// Rejecting names outside this set keeps a `{{var}}` resolution that ends up
// containing `:` or a control char from corrupting the wire format / smuggling
// a second header line on a future native HTTP layer.
const HEADER_TOKEN_RE = /^[A-Za-z0-9!#$%&'*+\-.^_`|~]+$/;

/** Strip ASCII control characters (CR/LF/NUL/etc.) from a value that's about
 *  to be put on an HTTP wire. RFC 7230 forbids CR/LF in header values; CR/LF
 *  in a Cookie value also breaks the `; key=value; …` framing. Body content
 *  goes through a different code path and is NOT sanitised here — line
 *  breaks in a JSON / text body are legitimate. */
function sanitizeWireValue(v: string): string {
  // Strip everything ASCII < 0x20 except HT (0x09 — tab, occasionally legit
  // inside header values per the spec). Strictly speaking even tab in a
  // header value is questionable; we keep it to avoid surprising the user.
  // 0x7F (DEL) is also stripped.
  // eslint-disable-next-line no-control-regex -- intentional: stripping CTLs is the whole point
  return v.replace(/[\x00-\x08\x0A-\x1F\x7F]/g, '');
}

/**
 * Build a `Cookie` header value from a list of name/value pairs. Skips
 * disabled or empty-key rows. Returns the empty string when nothing applies.
 * Per RFC 6265, cookie values may not contain CTL chars or `;` (which is the
 * row separator) — we strip CTLs and also strip `;` from values to keep the
 * row framing intact when a {{var}} resolves to something containing one.
 */
export function composeCookieHeader(
  rows: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): string {
  return rows
    .filter((r) => r.enabled && r.key.trim().length > 0)
    .map((r) => {
      // The key has already been trimmed; strip any CTLs and `;` / `=` /
      // whitespace it might have picked up from a variable resolution.
      // eslint-disable-next-line no-control-regex -- intentional: stripping CTLs is the whole point
      const safeKey = r.key.trim().replace(/[\x00-\x20;=]/g, '');
      const safeValue = sanitizeWireValue(r.value).replace(/;/g, '');
      return `${safeKey}=${safeValue}`;
    })
    .filter((s) => s.length > 1) // `=` alone after sanitisation is meaningless
    .join('; ');
}

export function composeUrl(
  rawUrl: string,
  params: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): string {
  const enabled = params.filter((p) => p.enabled && p.key.trim().length > 0);
  if (enabled.length === 0) return rawUrl;

  let parsed: URL | null = null;
  try {
    parsed = new URL(rawUrl);
  } catch {
    parsed = null;
  }
  if (parsed) {
    for (const p of enabled) parsed.searchParams.append(p.key, p.value);
    return parsed.toString();
  }

  const query = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&');
  if (query.length === 0) return rawUrl;
  return rawUrl.includes('?') ? `${rawUrl}&${query}` : `${rawUrl}?${query}`;
}

export function composeHeaders(
  rows: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.enabled) continue;
    const k = row.key.trim();
    if (!k) continue;
    // Reject header names that don't fit RFC 7230's token grammar. A
    // resolved `{{var}}` could otherwise carry `:` / CR/LF / space and
    // smuggle a second header on a future native HTTP layer. Browser
    // fetch already throws on this — defending here gives us deterministic
    // skip-the-row behaviour AND covers any future non-fetch executor.
    if (!HEADER_TOKEN_RE.test(k)) continue;
    out[k] = sanitizeWireValue(row.value);
  }
  return out;
}

/**
 * Strip Content-Type from a header set. Used for form-data and binary bodies
 * where the browser must set Content-Type itself (multipart boundary, blob's
 * own type) — a manually-set header would corrupt the request.
 */
function stripContentType(headers: Record<string, string>): Record<string, string> {
  const out: Record<string, string> = {};
  for (const [k, v] of Object.entries(headers)) {
    if (k.trim().toLowerCase() === 'content-type') continue;
    out[k] = v;
  }
  return out;
}

/**
 * Serialize a request body for fetch(). Async because form-data and binary
 * may need to read attachment blobs from the host's storage layer.
 */
export async function composeBody(
  body: ApiRequest['body'],
  resolveAttachment?: AttachmentResolver,
): Promise<BodyInit | null> {
  if (body.type === 'none') return null;

  if (body.type === 'json' || body.type === 'text' || body.type === 'xml') {
    return body.content;
  }

  if (body.type === 'graphql') {
    // Standard GraphQL-over-HTTP envelope: `{ "query": string, "variables": object|null }`.
    // The variables pane in the editor is plain JSON; if it doesn't parse,
    // we send `null` so the server reports the parse error rather than the
    // request silently failing on our side.
    let variables: unknown = undefined;
    if (body.variables && body.variables.trim().length > 0) {
      try {
        variables = JSON.parse(body.variables);
      } catch {
        variables = null;
      }
    }
    return JSON.stringify({
      query: body.content,
      ...(variables !== undefined ? { variables } : {}),
    });
  }

  if (body.type === 'urlencoded') {
    const params = new URLSearchParams();
    for (const line of body.content.split(/\r?\n/)) {
      const eq = line.indexOf('=');
      if (eq === -1) continue;
      const key = line.slice(0, eq).trim();
      const value = line.slice(eq + 1);
      if (!key) continue;
      params.append(key, value);
    }
    return params.toString();
  }

  if (body.type === 'form-data') {
    const fd = new FormData();
    for (const row of body.formRows ?? []) {
      if (!row.enabled || !row.key.trim()) continue;
      if (row.kind === 'text') {
        fd.append(row.key, row.value);
      } else if (row.slotId && resolveAttachment) {
        const file = await resolveAttachment(row.slotId);
        if (file) fd.append(row.key, file.blob, file.filename);
      }
    }
    return fd;
  }

  if (body.type === 'binary') {
    if (body.attachment?.slotId && resolveAttachment) {
      const file = await resolveAttachment(body.attachment.slotId);
      if (file) return file.blob;
    }
    return null;
  }

  return null;
}

export interface BuildRequestOptions {
  resolveAttachment?: AttachmentResolver;
  /**
   * applyAuth options — most importantly the `onTokenRefreshed`
   * callback that lets the store persist refreshed OAuth2 tokens.
   * Forwarded as-is.
   */
  authOptions?: AuthApplyOptions;
  /**
   * Test-only override hooks for the auto-fed headers. Lets specs feed
   * deterministic values for `X-Trace-Span-Id`, `traceparent`, and
   * `X-Client-Platform`. Production callers omit this.
   */
  autoHeaderOverrides?: AutoHeaderOverrides;
}

export async function buildRequest(
  req: ApiRequest,
  opts: BuildRequestOptions = {},
): Promise<BuiltRequest> {
  const baseHeaders = composeHeaders(req.headers);
  // Merge cookies into a single Cookie header. A user-set Cookie row in the
  // headers list wins (no override) — that's the natural escape hatch when
  // someone wants full control over the wire format.
  const headers = ((): Record<string, string> => {
    const cookieValue = composeCookieHeader(req.cookies ?? []);
    if (!cookieValue) return baseHeaders;
    const hasUserCookie = Object.keys(baseHeaders).some((k) => k.toLowerCase() === 'cookie');
    return hasUserCookie ? baseHeaders : { ...baseHeaders, Cookie: cookieValue };
  })();
  // GET and HEAD requests cannot carry a body on the fetch transport —
  // the WHATWG `Request` constructor throws `TypeError: Request with
  // GET/HEAD method cannot have body`. If the user configured a body and
  // then switched the method, drop the body silently rather than letting
  // the whole send fail. (Other tools — Postman, curl — behave the same.)
  const methodAllowsBody = req.method !== 'GET' && req.method !== 'HEAD';
  const body = methodAllowsBody ? await composeBody(req.body, opts.resolveAttachment) : null;
  // Strip the Content-Type header when it describes a payload that won't
  // reach the wire:
  //  - form-data / binary: fetch must set Content-Type itself (multipart
  //    boundary, Blob's own type) — a user-set value would corrupt it;
  //  - GET / HEAD carrying a configured body: the body was just dropped
  //    above, so its body-type Content-Type now describes nothing.
  // A Content-Type with no body behind it (`body.type === 'none'`) is a
  // plain user-set header — keep it; the browser sends it on GET too.
  const stripBodyContentType =
    req.body.type === 'form-data' ||
    req.body.type === 'binary' ||
    (!methodAllowsBody && req.body.type !== 'none');
  const sanitizedHeaders = stripBodyContentType ? stripContentType(headers) : headers;
  const urlWithPath = applyPathParams(req.url, req.pathParams ?? {});
  const url = composeUrl(urlWithPath, req.query);

  // Auth runs last — schemes like AWS SigV4 read the final URL + headers +
  // body to compute their signature. Older synced docs may lack `auth`;
  // workspace store hydration normalises it, but be defensive here too.
  const auth = req.auth ?? { type: 'none' };
  const applied = await applyAuth(
    { url, method: req.method, headers: sanitizedHeaders, body },
    auth,
    opts.authOptions,
  );

  return {
    url: applied.url,
    method: req.method,
    headers: mergeWithAutoHeaders(applied.headers, opts.autoHeaderOverrides),
    body,
    authWarnings: applied.warnings ?? [],
  };
}
