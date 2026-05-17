// Mounts the existing OAuth2 mock IdP at `/oauth2/*`. The IdP itself is a
// node:http server (see packages/core/src/auth/oauth2/__fixtures__/mockIdp.ts);
// we start it on its own dynamic port and proxy requests through.
//
// Why proxy instead of porting the IdP into Hono: the IdP already covers
// every grant + protected-resource endpoint and is exercised by the
// existing OAuth2 e2e tests. Reimplementing it here would duplicate ~400
// lines of well-tested logic. The proxy adds ~20ms per request which is
// fine for e2e.

import { Hono } from 'hono';
import { startMockIdp, type MockIdp } from '@apicircle/core/test/mock-idp';

export interface OAuth2Mount {
  app: Hono;
  /** The mockIdp handle — caller must `close()` it on shutdown. */
  idp: MockIdp;
}

export async function buildOAuth2Routes(): Promise<OAuth2Mount> {
  const idp = await startMockIdp();
  const app = new Hono();

  // Forward all /oauth2/* paths to the IdP, stripping the prefix.
  app.all('/oauth2/*', async (c) => {
    const url = new URL(c.req.url);
    // /oauth2/token → /token, /oauth2/authorize?... → /authorize?...
    const idpPath = url.pathname.replace(/^\/oauth2/, '');
    const targetUrl = idp.url(idpPath) + url.search;

    // Forward headers (excluding hop-by-hop).
    const forwardHeaders = new Headers();
    for (const [k, v] of Object.entries(c.req.header())) {
      const lower = k.toLowerCase();
      if (lower === 'host' || lower === 'connection' || lower === 'content-length') continue;
      forwardHeaders.set(k, v);
    }

    const init: RequestInit = {
      method: c.req.method,
      headers: forwardHeaders,
      // Body — only attach for methods that allow it.
      body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : await c.req.arrayBuffer(),
      redirect: 'manual', // /authorize emits 302 redirects we want to forward as-is
    };
    const upstream = await fetch(targetUrl, init);

    const responseHeaders = new Headers();
    upstream.headers.forEach((v, k) => responseHeaders.set(k, v));
    return new Response(upstream.body, {
      status: upstream.status,
      statusText: upstream.statusText,
      headers: responseHeaders,
    });
  });

  return { app, idp };
}
