import type { Request as ApiRequest } from '@apicircle-v2/shared';

export interface BuiltRequest {
  url: string;
  method: string;
  headers: Record<string, string>;
  body: BodyInit | null;
}

/**
 * Compose the final URL by merging enabled query params into the request URL.
 * Existing query params on the URL are preserved; param entries are appended.
 *
 * Falls back to manual concatenation when the URL is not parseable (e.g.
 * contains template placeholders like `{{BASE_URL}}/foo`). In that case, env-
 * resolution should run first (P3) — but we still surface a usable URL.
 */
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

  // Fallback: append as a query string, respecting existing '?'
  const query = enabled
    .map((p) => `${encodeURIComponent(p.key)}=${encodeURIComponent(p.value)}`)
    .join('&');
  if (query.length === 0) return rawUrl;
  return rawUrl.includes('?') ? `${rawUrl}&${query}` : `${rawUrl}?${query}`;
}

/**
 * Reduce header rows to a single Record<string,string>, dropping disabled and
 * empty-key entries. Later entries with the same (case-insensitive) name win
 * — same semantics as `new Headers()` in the browser.
 */
export function composeHeaders(
  rows: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const row of rows) {
    if (!row.enabled) continue;
    const k = row.key.trim();
    if (!k) continue;
    out[k] = row.value;
  }
  return out;
}

/**
 * Serialize a request body for fetch(). For 'none' returns null. For 'json'
 * returns the trimmed string as-is (we don't validate JSON here — the editor
 * does that and the assertion layer can flag invalid responses).
 *
 * 'urlencoded' content is parsed as `key=value\nkey=value` lines (matches what
 * the editor renders).
 *
 * 'form-data', 'binary', and 'graphql' are stubbed for P2 — the executor
 * forwards the raw string and the user's Content-Type header. Full editors
 * for these land later.
 */
export function composeBody(body: ApiRequest['body']): BodyInit | null {
  if (body.type === 'none') return null;
  if (
    body.type === 'json' ||
    body.type === 'text' ||
    body.type === 'xml' ||
    body.type === 'graphql'
  ) {
    return body.content;
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
  // form-data and binary — defer to a later phase. Forward the raw content so
  // the request is at least sendable.
  return body.content;
}

export function buildRequest(req: ApiRequest): BuiltRequest {
  return {
    url: composeUrl(req.url, req.query),
    method: req.method,
    headers: composeHeaders(req.headers),
    body: composeBody(req.body),
  };
}
