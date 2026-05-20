// Conditional-GET endpoints. The body's ETag + Last-Modified are fixed
// per path so the same client can re-fetch and get a 304. Tests exercise
// the response panel's cache-hint surface and the request panel's
// auto-resend with If-None-Match / If-Modified-Since.

import { Hono } from 'hono';

const BODY = JSON.stringify({ cached: true, when: '2026-01-01T00:00:00Z' });
const ETAG = '"e2e-mock-etag-v1"';
const LAST_MODIFIED = 'Wed, 01 Jan 2026 00:00:00 GMT';
const EXPIRES_OLD = 'Thu, 01 Jan 1970 00:00:00 GMT';

function bodyEtag(text: string): string {
  let hash = 0;
  for (let i = 0; i < text.length; i += 1) {
    hash = (hash * 31 + text.charCodeAt(i)) >>> 0;
  }
  return `"e2e-body-${text.length}-${hash.toString(16)}"`;
}

export function buildCachingRoutes(): Hono {
  const app = new Hono();

  app.get('/cache/etag', (c) => {
    const inm = c.req.header('if-none-match');
    if (inm && inm === ETAG) {
      return new Response(null, { status: 304, headers: { etag: ETAG } });
    }
    return new Response(BODY, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: ETAG,
        'cache-control': 'max-age=60',
      },
    });
  });

  app.get('/cache/last-modified', (c) => {
    const ims = c.req.header('if-modified-since');
    if (ims && ims === LAST_MODIFIED) {
      return new Response(null, {
        status: 304,
        headers: { 'last-modified': LAST_MODIFIED },
      });
    }
    return new Response(BODY, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'last-modified': LAST_MODIFIED,
        'cache-control': 'max-age=60',
      },
    });
  });

  // no-store: control case — always returns 200 + body regardless of
  // conditional headers, with Cache-Control: no-store.
  app.get('/cache/no-store', () => {
    return new Response(BODY, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'no-store',
      },
    });
  });

  app.get('/cache/private', () => {
    return new Response(BODY, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'private, max-age=60',
      },
    });
  });

  app.get('/cache/public', () => {
    return new Response(BODY, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        'cache-control': 'public, max-age=60',
      },
    });
  });

  app.post('/cache/etag-body', async (c) => {
    const text = await c.req.text();
    return new Response(BODY, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        etag: bodyEtag(text),
      },
    });
  });

  app.get('/cache/expires-old', () => {
    return new Response(BODY, {
      status: 200,
      headers: {
        'content-type': 'application/json',
        expires: EXPIRES_OLD,
      },
    });
  });

  return app;
}
