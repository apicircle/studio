// Cookie round-trip endpoints. Tests can:
//   GET /cookies/set/<name>/<value>   → server emits Set-Cookie
//   GET /cookies                       → echoes current Cookie header back
//
// Used in the cookie-params spec to prove user-set cookie rows reach the
// wire and that the existing /anything echo also surfaces them.

import { Hono } from 'hono';

export function buildCookieRoutes(): Hono {
  const app = new Hono();

  app.get('/cookies', (c) => {
    const cookieHeader = c.req.header('cookie') ?? '';
    const cookies: Record<string, string> = {};
    for (const pair of cookieHeader.split(';')) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k) cookies[k] = v;
    }
    return c.json({ cookies });
  });

  app.get('/cookies/set/:name/:value', (c) => {
    const name = c.req.param('name');
    const value = c.req.param('value');
    return new Response(JSON.stringify({ set: { [name]: value } }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${name}=${value}; Path=/`,
      },
    });
  });

  // Attribute-flexible Set-Cookie endpoint for cookie-matrix tests.
  // Query: ?name=...&value=...&attrs=Path=/api;Secure;HttpOnly;Max-Age=0;SameSite=Strict
  // The attrs string is appended verbatim to `<name>=<value>` so callers
  // control the full attribute list. Use this when /cookies/set's
  // hard-coded `Path=/` isn't enough.
  app.get('/cookies/set-attrs', (c) => {
    const name = c.req.query('name') ?? 'sid';
    const value = c.req.query('value') ?? 'v';
    const attrs = c.req.query('attrs') ?? 'Path=/';
    return new Response(JSON.stringify({ set: { [name]: value }, attrs }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `${name}=${value}; ${attrs}`,
      },
    });
  });

  return app;
}
