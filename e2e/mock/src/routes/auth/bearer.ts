// Bearer token endpoint. Accepts `Authorization: Bearer e2e-bearer-token`.
// Anything else returns 401 with WWW-Authenticate: Bearer (RFC 6750).

import { Hono } from 'hono';

export const VALID_BEARER = 'e2e-bearer-token';

export function buildBearerAuthRoutes(): Hono {
  const app = new Hono();

  app.all('/auth/bearer', (c) => {
    const auth = c.req.header('authorization') ?? '';
    const match = /^Bearer\s+(\S+)$/i.exec(auth);
    if (!match) {
      return new Response(JSON.stringify({ error: 'invalid_token' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Bearer realm="apicircle-e2e"',
        },
      });
    }
    if (match[1] !== VALID_BEARER) {
      return new Response(JSON.stringify({ error: 'invalid_token', got: match[1] }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': `Bearer error="invalid_token"`,
        },
      });
    }
    return c.json({ authenticated: true, token: match[1] });
  });

  return app;
}
