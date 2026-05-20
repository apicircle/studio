// HTTP Basic Auth. /auth/basic — 401 with WWW-Authenticate when missing,
// 200 with `{ authenticated: true, user }` when correct creds match.
// Accepts username/password = e2e-user / e2e-pass.

import { Hono } from 'hono';

const VALID_USER = 'e2e-user';
const VALID_PASS = 'e2e-pass';

function decodeBasic(header: string): { user: string; pass: string } | null {
  const match = /^Basic\s+(\S+)$/i.exec(header);
  if (!match) return null;
  try {
    const decoded = Buffer.from(match[1], 'base64').toString('utf8');
    const idx = decoded.indexOf(':');
    if (idx < 0) return null;
    return { user: decoded.slice(0, idx), pass: decoded.slice(idx + 1) };
  } catch {
    return null;
  }
}

export function buildBasicAuthRoutes(): Hono {
  const app = new Hono();

  app.all('/auth/basic', (c) => {
    const auth = c.req.header('authorization');
    if (!auth) {
      return new Response(JSON.stringify({ error: 'unauthorized' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Basic realm="apicircle-e2e"',
        },
      });
    }
    const creds = decodeBasic(auth);
    if (!creds || creds.user !== VALID_USER || creds.pass !== VALID_PASS) {
      return new Response(JSON.stringify({ error: 'forbidden' }), {
        status: 401,
        headers: {
          'Content-Type': 'application/json',
          'WWW-Authenticate': 'Basic realm="apicircle-e2e"',
        },
      });
    }
    return c.json({ authenticated: true, user: creds.user });
  });

  return app;
}

export const BASIC_VALID = { user: VALID_USER, pass: VALID_PASS };
