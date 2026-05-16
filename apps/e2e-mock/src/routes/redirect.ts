// Redirect endpoints. Used by network-conditions tests + redirect-policy
// tests on the request panel.
//
//   GET /redirect/:n            301-redirects through a chain of n hops,
//                               last hop returns /anything (so wire shape
//                               is observable). `n` capped at 20.
//   GET /redirect-loop          Always redirects to itself — for
//                               max-hops-cap assertions on the client.
//   GET /redirect-to?url=…      Single redirect to an arbitrary URL.
//
// Codes chosen: 301 (permanent) and 302 (temporary) — the most-asserted
// values in the workbook. Add 307/308 if a spec needs them later.

import { Hono } from 'hono';

const MAX_HOPS = 20;

export function buildRedirectRoutes(): Hono {
  const app = new Hono();

  app.get('/redirect/:n', (c) => {
    const n = Math.min(Math.max(0, Number.parseInt(c.req.param('n'), 10) || 0), MAX_HOPS);
    const code = (c.req.query('code') ?? '302') === '301' ? 301 : 302;
    if (n === 0) {
      return new Response(JSON.stringify({ ok: true, redirected: true }), {
        status: 200,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, {
      status: code,
      headers: { location: `/redirect/${n - 1}` },
    });
  });

  app.get('/redirect-loop', () => {
    return new Response(null, {
      status: 302,
      headers: { location: '/redirect-loop' },
    });
  });

  app.get('/redirect-to', (c) => {
    const url = c.req.query('url');
    if (!url) {
      return new Response(JSON.stringify({ error: 'missing url query' }), {
        status: 400,
        headers: { 'content-type': 'application/json' },
      });
    }
    return new Response(null, { status: 302, headers: { location: url } });
  });

  return app;
}
