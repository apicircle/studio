// Build a Hono app from a MockServer's resolved endpoints.
//
// Path conversion: OpenAPI uses `{id}` for path params; Hono uses `:id`.
// Translation is a single regex.
//
// Match precedence: more-specific routes first. Hono matches in
// registration order, so we sort the endpoint list by path-specificity
// (literal segments beat parameterised ones).
//
// Per-request pipeline:
//   request → evaluateValidation → evaluateResponseRules → applyMultipliers → respond
//
// The legacy `MockServer.overrides` map is intentionally NOT consulted
// here — it was the pre-rules-redesign override layer; the new editor
// produces `requestValidation` + `responseRules` + `defaultResponse`
// instead.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { MockEndpoint, MockResponseConfig, MockServer } from '@apicircle/shared';
import { buildCors } from '../cors';
import { evaluateValidation } from '../validation/evaluate';
import { evaluateResponseRules, type RequestContext } from '../rules/evaluate';
import { applyMultipliers } from '../response/applyMultipliers';

export interface BuildRouterOptions {
  /** Called whenever a request hits a mock endpoint — used to tick
   * `MockRuntimeEntry.requestCount` from the host process. */
  onRequest?: (ctx: { endpointId: string; method: string; path: string }) => void;
}

export function buildRouter(server: MockServer, opts: BuildRouterOptions = {}): Hono {
  const app = new Hono();

  const corsMiddleware = buildCors(server.cors);
  if (corsMiddleware) app.use('*', corsMiddleware);

  // Sort: more-specific routes register first. Endpoints without a `{`
  // param are strictly more specific than those with one.
  const sorted = [...server.endpoints].sort((a, b) => {
    const aHasParam = /\{/.test(a.pathPattern);
    const bHasParam = /\{/.test(b.pathPattern);
    if (aHasParam !== bHasParam) return aHasParam ? 1 : -1;
    // Then prefer longer paths (more segments).
    return b.pathPattern.length - a.pathPattern.length;
  });

  for (const endpoint of sorted) {
    const honoPath = openApiPathToHono(endpoint.pathPattern);
    const handler = makeHandler(endpoint, opts);
    switch (endpoint.method) {
      case 'GET':
        app.get(honoPath, handler);
        break;
      case 'POST':
        app.post(honoPath, handler);
        break;
      case 'PUT':
        app.put(honoPath, handler);
        break;
      case 'PATCH':
        app.patch(honoPath, handler);
        break;
      case 'DELETE':
        app.delete(honoPath, handler);
        break;
      case 'HEAD':
      case 'OPTIONS':
        app.on(endpoint.method, honoPath, handler);
        break;
    }
  }

  // 404 fallback — always JSON so curl users see a structured response.
  app.notFound((c) =>
    c.json(
      {
        error: 'No mock endpoint matches this path',
        method: c.req.method,
        path: new URL(c.req.url).pathname,
      },
      404,
    ),
  );

  return app;
}

function makeHandler(endpoint: MockEndpoint, opts: BuildRouterOptions) {
  return async (c: Context) => {
    opts.onRequest?.({
      endpointId: endpoint.id,
      method: endpoint.method,
      path: endpoint.pathPattern,
    });

    const ctx = await buildRequestContext(c);

    // 1) Pre-validation gates fire first; the first failing rule wins.
    const failResponse = evaluateValidation(endpoint, ctx);
    if (failResponse) {
      return await respond(c, failResponse, ctx);
    }

    // 2) Conditional response rules — first matching rule wins, falling
    //    through to defaultResponse otherwise.
    const matched = evaluateResponseRules(endpoint, ctx);
    return await respond(c, matched, ctx);
  };
}

async function buildRequestContext(c: Context): Promise<RequestContext> {
  const url = new URL(c.req.url);
  const queryEntries = Array.from(url.searchParams.entries());
  // Use Object.create(null) so user-controlled keys like `__proto__` or
  // `constructor` can't shadow prototype members. Downstream rule evaluators
  // do property reads on these dicts; a polluted prototype would surprise them.
  const query: Record<string, string> = Object.create(null);
  for (const [k, v] of queryEntries) {
    // First value wins on repeated keys — mirrors Hono's `c.req.query()`
    // behavior and matches what most APIs treat as canonical.
    if (!(k in query)) query[k] = v;
  }
  const headers: Record<string, string> = Object.create(null);
  for (const [k, v] of c.req.raw.headers.entries()) {
    headers[k.toLowerCase()] = v;
  }
  // c.req.param() returns all path params for this matched route. Hono returns
  // a plain object; copy onto a null-prototype dict so consumers can't be
  // tripped by an attacker setting `__proto__` as a path-param name.
  const honoParams: Record<string, string> = c.req.param();
  const pathParams: Record<string, string> = Object.create(null);
  for (const k of Object.keys(honoParams)) {
    pathParams[k] = honoParams[k];
  }
  const cookies = parseCookieHeader(headers['cookie']);

  // Body parsing is best-effort: only attempt JSON parse when the
  // Content-Type advertises JSON. Other body types stay opaque (string)
  // because validation rules don't currently target them.
  let bodyJson: unknown = undefined;
  let bodyText = '';
  const ct = headers['content-type'] ?? '';
  if (ct.toLowerCase().includes('json')) {
    try {
      bodyText = await c.req.text();
      bodyJson = bodyText ? (JSON.parse(bodyText) as unknown) : undefined;
    } catch {
      // Malformed JSON — leave bodyJson undefined; validation rules that
      // require body presence will still see bodyText.
    }
  } else {
    try {
      bodyText = await c.req.text();
    } catch {
      // ignore
    }
  }

  return { query, pathParams, headers, cookies, bodyText, bodyJson };
}

function parseCookieHeader(cookieHeader: string | undefined): Record<string, string> {
  const out: Record<string, string> = Object.create(null);
  if (!cookieHeader) return out;
  for (const part of cookieHeader.split(';')) {
    const eq = part.indexOf('=');
    if (eq === -1) continue;
    const k = part.slice(0, eq).trim();
    const v = part.slice(eq + 1).trim();
    if (k && !(k in out)) out[k] = v;
  }
  return out;
}

async function respond(
  c: Context,
  response: MockResponseConfig,
  ctx: RequestContext,
): Promise<Response> {
  if (response.delayMs && response.delayMs > 0) {
    await new Promise((resolve) => setTimeout(resolve, response.delayMs));
  }

  const finalResponse = applyMultipliers(response, ctx);

  // Track whether the user-configured headers already pin Content-Type — if
  // they don't, we derive one from `body.type` so the browser can't MIME-sniff
  // a JSON/text body into HTML (XSS risk for any consumer that loads the
  // mock URL in an <iframe> or <script src>).
  let userSetContentType = false;
  for (const h of finalResponse.headers) {
    if (!h.enabled) continue;
    if (!h.key.trim()) continue;
    if (h.key.toLowerCase() === 'content-type') userSetContentType = true;
    c.header(h.key, h.value);
  }

  const body = finalResponse.body;
  if (!userSetContentType) {
    const defaultCt = defaultContentTypeFor(body.type);
    if (defaultCt) c.header('Content-Type', defaultCt);
  }
  // Belt-and-braces: tell browsers not to override the declared type. Without
  // this header, even a correct Content-Type can be sniffed away by old IE-
  // compatible heuristics in some Chromium edge cases.
  c.header('X-Content-Type-Options', 'nosniff');

  // No body / 204-style: respond with empty body and the configured status.
  if (body.type === 'none') {
    return c.body(null, finalResponse.status as 200);
  }
  if (body.type === 'binary' || body.type === 'form-data') {
    // The runtime doesn't materialize attachments yet — emit an empty body
    // so the headers + status still go out.
    return c.body(null, finalResponse.status as 200);
  }
  return c.body(body.content, finalResponse.status as 200);
}

function defaultContentTypeFor(bodyType: MockResponseConfig['body']['type']): string | null {
  switch (bodyType) {
    case 'json':
      return 'application/json; charset=utf-8';
    case 'text':
      return 'text/plain; charset=utf-8';
    case 'binary':
      return 'application/octet-stream';
    case 'form-data':
      return 'multipart/form-data';
    case 'none':
    default:
      return null;
  }
}

/**
 * Translate OpenAPI path templates (`/pets/{id}/items/{itemId}`) to Hono
 * route patterns (`/pets/:id/items/:itemId`). Hono treats `:` as the
 * param prefix; the OpenAPI braces are unsupported.
 *
 * Manual O(n) scan instead of `path.replace(/\{[^}]+\}/g, …)` so we don't
 * trip CodeQL's polynomial-regex detector on user-supplied paths from
 * imported OpenAPI specs.
 */
export function openApiPathToHono(path: string): string {
  let out = '';
  let i = 0;
  while (i < path.length) {
    if (path[i] === '{') {
      const close = path.indexOf('}', i + 1);
      if (close === -1) {
        out += path.slice(i);
        break;
      }
      out += ':' + path.slice(i + 1, close);
      i = close + 1;
    } else {
      out += path[i];
      i++;
    }
  }
  return out;
}
