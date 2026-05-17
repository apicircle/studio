// httpbin-style /anything endpoint. Echoes the entire request envelope
// back as JSON so e2e tests can assert against it without hitting the
// introspection endpoint. Both `/` and `/anything` route here.

import { Hono } from 'hono';
import type { Context } from 'hono';
import type { CapturedBody } from '../introspection';

export function buildAnythingRoutes(): Hono {
  const app = new Hono();

  const handler = (c: Context) => {
    const url = new URL(c.req.url);
    const query: Record<string, string> = {};
    for (const [k, v] of url.searchParams.entries()) {
      query[k] = query[k] ? `${query[k]},${v}` : v;
    }
    const headers: Record<string, string> = {};
    for (const [k, v] of Object.entries(c.req.header())) {
      headers[k.toLowerCase()] = v;
    }
    const cookies: Record<string, string> = {};
    const cookieHeader = c.req.header('cookie');
    if (cookieHeader) {
      for (const pair of cookieHeader.split(';')) {
        const idx = pair.indexOf('=');
        if (idx < 0) continue;
        const k = pair.slice(0, idx).trim();
        const v = pair.slice(idx + 1).trim();
        if (k) cookies[k] = v;
      }
    }
    // Reuse the body the introspection middleware already parsed.
    const body: CapturedBody = c.get('capturedBody') ?? { kind: 'empty' };

    return c.json({
      method: c.req.method,
      url: c.req.url,
      path: url.pathname,
      query,
      headers,
      cookies,
      body,
    });
  };

  app.all('/', handler);
  app.all('/anything', handler);
  app.all('/anything/*', handler);
  return app;
}
