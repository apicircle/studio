// Accepts an API key in any of the three locations the editor supports:
//   - Header (default name: X-API-Key, configurable via ?keyName=)
//   - Query  (default name: api_key)
//   - Cookie (default name: apikey)
//
// Each variant lives at /auth/api-key/<location>. Tests pick the route
// matching the editor's `addTo` setting.

import { Hono } from 'hono';

export const VALID_API_KEY = 'e2e-api-key-secret';

export function buildApiKeyAuthRoutes(): Hono {
  const app = new Hono();

  app.all('/auth/api-key/header', (c) => {
    const headerName = c.req.query('keyName') ?? 'x-api-key';
    const got = c.req.header(headerName);
    if (!got || got !== VALID_API_KEY) {
      return c.json({ error: 'invalid_api_key', expected: 'header', headerName }, { status: 401 });
    }
    return c.json({ authenticated: true, location: 'header', headerName });
  });

  app.all('/auth/api-key/query', (c) => {
    const paramName = c.req.query('keyName') ?? 'api_key';
    const got = c.req.query(paramName);
    if (!got || got !== VALID_API_KEY) {
      return c.json({ error: 'invalid_api_key', expected: 'query', paramName }, { status: 401 });
    }
    return c.json({ authenticated: true, location: 'query', paramName });
  });

  app.all('/auth/api-key/cookie', (c) => {
    const cookieName = c.req.query('keyName') ?? 'apikey';
    const cookieHeader = c.req.header('cookie') ?? '';
    let got: string | undefined;
    for (const pair of cookieHeader.split(';')) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k === cookieName) got = v;
    }
    if (!got || got !== VALID_API_KEY) {
      return c.json({ error: 'invalid_api_key', expected: 'cookie', cookieName }, { status: 401 });
    }
    return c.json({ authenticated: true, location: 'cookie', cookieName });
  });

  return app;
}
