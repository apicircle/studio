// Verb-restricted echo: GET /method/get, POST /method/post, etc.
// Returns 405 if a different verb is used. Useful for testing the editor's
// HTTP method picker — every method gets a distinct route to assert
// against.

import { Hono } from 'hono';

const VERBS = ['get', 'post', 'put', 'patch', 'delete', 'head', 'options'] as const;

export function buildMethodRoutes(): Hono {
  const app = new Hono();

  for (const verb of VERBS) {
    const upper = verb.toUpperCase();
    app.all(`/method/${verb}`, (c) => {
      if (c.req.method !== upper) {
        return c.json(
          { error: 'method_not_allowed', expected: upper, got: c.req.method },
          { status: 405, headers: { Allow: upper } },
        );
      }
      return c.json({
        ok: true,
        method: c.req.method,
        path: `/method/${verb}`,
      });
    });
  }

  return app;
}
