// Cookie-based session auth. Two endpoints:
//   POST /auth/cookie/login     — accepts { username, password } JSON,
//                                 issues Set-Cookie: session=<id>; HttpOnly
//   GET  /auth/cookie/protected — gates on the `session` cookie. Returns
//                                 200 if it matches a known session id,
//                                 else 401.
//
// The server keeps an in-memory map of session IDs. Tests typically
// either (a) set the cookie row directly to the well-known id, or
// (b) script a login → protected sequence to test the cookie jar.

import { Hono } from 'hono';

const VALID_USER = 'e2e-cookie-user';
const VALID_PASS = 'e2e-cookie-pass';
const STATIC_SESSION_ID = 'e2e-session-id-static';

const sessions = new Set<string>([STATIC_SESSION_ID]);

export function buildCookieAuthRoutes(): Hono {
  const app = new Hono();

  app.post('/auth/cookie/login', async (c) => {
    let body: { username?: string; password?: string };
    try {
      body = await c.req.json();
    } catch {
      return c.json({ error: 'invalid_json' }, { status: 400 });
    }
    if (body.username !== VALID_USER || body.password !== VALID_PASS) {
      return c.json({ error: 'invalid_credentials' }, { status: 401 });
    }
    const sessionId = `session-${Math.random().toString(36).slice(2, 10)}`;
    sessions.add(sessionId);
    return new Response(JSON.stringify({ ok: true, sessionId }), {
      status: 200,
      headers: {
        'Content-Type': 'application/json',
        'Set-Cookie': `session=${sessionId}; Path=/; HttpOnly; SameSite=Lax`,
      },
    });
  });

  app.get('/auth/cookie/protected', (c) => {
    const cookieHeader = c.req.header('cookie') ?? '';
    let session: string | undefined;
    for (const pair of cookieHeader.split(';')) {
      const idx = pair.indexOf('=');
      if (idx < 0) continue;
      const k = pair.slice(0, idx).trim();
      const v = pair.slice(idx + 1).trim();
      if (k === 'session') session = v;
    }
    if (!session || !sessions.has(session)) {
      return c.json({ error: 'session_required' }, { status: 401 });
    }
    return c.json({ authenticated: true, session });
  });

  return app;
}

export const COOKIE_AUTH = {
  validUser: VALID_USER,
  validPass: VALID_PASS,
  staticSessionId: STATIC_SESSION_ID,
};
