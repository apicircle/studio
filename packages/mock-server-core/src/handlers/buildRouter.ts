// Build a Hono app from a MockServer's resolved endpoints + overrides.
//
// Path conversion: OpenAPI uses `{id}` for path params; Hono uses `:id`.
// Translation is a single regex.
//
// Match precedence: more-specific routes first. Hono matches in
// registration order, so we sort the endpoint list by path-specificity
// (literal segments beat parameterised ones).
//
// Per-endpoint override layering: when `MockServer.overrides[id]` exists,
// its non-undefined fields shadow the source endpoint at request time.
// This lets users tweak status / body / delay without re-parsing the
// source spec.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { MockEndpoint, MockEndpointOverride, MockServer } from '@apicircle/shared';
import { buildCors } from '../cors';

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
    const handler = makeHandler(endpoint, server.overrides[endpoint.id], opts);
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

function makeHandler(
  endpoint: MockEndpoint,
  override: MockEndpointOverride | undefined,
  opts: BuildRouterOptions,
) {
  return async (c: Context) => {
    opts.onRequest?.({
      endpointId: endpoint.id,
      method: endpoint.method,
      path: endpoint.pathPattern,
    });
    const status = override?.status ?? endpoint.status;
    const body = override?.body ?? endpoint.body;
    const headers = override?.headers ?? endpoint.headers;
    const delayMs = override?.delayMs ?? endpoint.delayMs;
    if (delayMs && delayMs > 0) {
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    for (const h of headers) {
      c.header(h.key, h.value);
    }
    return c.body(body, status as 200);
  };
}

/**
 * Translate OpenAPI path templates (`/pets/{id}/items/{itemId}`) to Hono
 * route patterns (`/pets/:id/items/:itemId`). Hono treats `:` as the
 * param prefix; the OpenAPI braces are unsupported.
 */
export function openApiPathToHono(path: string): string {
  return path.replace(/\{([^}]+)\}/g, ':$1');
}
