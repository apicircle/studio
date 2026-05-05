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

  return app;
}
