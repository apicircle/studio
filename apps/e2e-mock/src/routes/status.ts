// Returns an arbitrary status code. /status/204 → 204 No Content,
// /status/418 → 418 I'm a teapot, etc. Useful for assertion testing
// (status equals/not-equals/lt/gt) without negotiating real semantics.

import { Hono } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';

export function buildStatusRoutes(): Hono {
  const app = new Hono();

  app.all('/status/:code', (c) => {
    const codeStr = c.req.param('code');
    const code = Number.parseInt(codeStr, 10);
    if (!Number.isFinite(code) || code < 100 || code > 599) {
      return c.json({ error: 'invalid_status', got: codeStr }, 400);
    }
    if (code === 204 || code === 304 || (code >= 100 && code < 200)) {
      return new Response(null, { status: code });
    }
    return c.json({ status: code }, code as ContentfulStatusCode);
  });

  return app;
}
