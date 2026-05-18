// Composes the full e2e mock server. Returned object includes:
//   - app: the Hono application
//   - capture: shared introspection buffer (so tests can clear it)
//   - close: tears down the OAuth2 IdP that runs as a sibling node:http server
//
// All routes mount under the same Hono instance with the introspection
// middleware applied first so every captured request is observable via
// /__inspect/last.

import { Hono } from 'hono';
import { cors } from 'hono/cors';
import { captureMiddleware, RequestCapture } from './introspection';
import { buildAnythingRoutes } from './routes/anything';
import { buildMethodRoutes } from './routes/method';
import { buildStatusRoutes } from './routes/status';
import { buildDelayRoutes } from './routes/delay';
import { buildJsonPathRoutes } from './routes/jsonPath';
import { buildBinaryRoutes } from './routes/binary';
import { buildUploadRoutes } from './routes/upload';
import { buildCookieRoutes } from './routes/cookies';
import { buildCompressionRoutes } from './routes/compression';
import { buildCachingRoutes } from './routes/caching';
import { buildStreamingRoutes } from './routes/streaming';
import { buildRedirectRoutes } from './routes/redirect';
import { buildHoldRoutes } from './routes/hold';
import { buildGithubRoutes } from './routes/github';
import { buildBasicAuthRoutes } from './routes/auth/basic';
import { buildBearerAuthRoutes } from './routes/auth/bearer';
import { buildApiKeyAuthRoutes } from './routes/auth/apiKey';
import { buildCookieAuthRoutes } from './routes/auth/cookie';
import { buildDigestAuthRoutes } from './routes/auth/digest';
import { buildNtlmAuthRoutes } from './routes/auth/ntlm';
import { buildHawkAuthRoutes } from './routes/auth/hawk';
import { buildAwsSigV4AuthRoutes } from './routes/auth/awsSigV4';
import { buildJwtBearerAuthRoutes } from './routes/auth/jwtBearer';
import { buildOAuth2Routes } from './routes/oauth2';

export interface E2eMockServer {
  app: Hono;
  capture: RequestCapture;
  /** Shut down sibling resources (OAuth2 IdP). Hono's HTTP listener is closed by the host. */
  close: () => Promise<void>;
}

export async function buildE2eMockServer(): Promise<E2eMockServer> {
  const capture = new RequestCapture();
  const app = new Hono();

  // CORS: the web app's fetch reaches us across origins
  // (http://localhost:5174 → http://localhost:5176). Permissive because
  // only e2e clients ever talk to this server.
  app.use(
    '*',
    cors({
      origin: (origin) => origin ?? '*',
      allowMethods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'],
      allowHeaders: ['*'],
      exposeHeaders: ['*'],
      credentials: true,
    }),
  );

  // Health check — Playwright's webServer waits on this.
  app.get('/__health', (c) => c.json({ ok: true, ts: new Date().toISOString() }));

  // Introspection.
  app.use('*', captureMiddleware(capture));
  app.get('/__inspect/last', (c) => {
    const n = Number.parseInt(c.req.query('n') ?? '1', 10) || 1;
    return c.json({ entries: capture.last(n) });
  });
  app.delete('/__inspect', (c) => {
    capture.clear();
    return c.json({ cleared: true });
  });

  // Body / echo / status / utility routes.
  app.route('/', buildAnythingRoutes());
  app.route('/', buildMethodRoutes());
  app.route('/', buildStatusRoutes());
  app.route('/', buildDelayRoutes());
  app.route('/', buildJsonPathRoutes());
  app.route('/', buildBinaryRoutes());
  app.route('/', buildUploadRoutes());
  app.route('/', buildCookieRoutes());

  // Protocol extensions (S5).
  app.route('/', buildCompressionRoutes());
  app.route('/', buildCachingRoutes());
  app.route('/', buildStreamingRoutes());
  app.route('/', buildRedirectRoutes());
  app.route('/', buildHoldRoutes());

  // GitHub REST API mock (S4) — exposed under `/_gh/*` + `/__gh/*` (control plane).
  app.route('/', buildGithubRoutes());

  // Auth.
  app.route('/', buildBasicAuthRoutes());
  app.route('/', buildBearerAuthRoutes());
  app.route('/', buildApiKeyAuthRoutes());
  app.route('/', buildCookieAuthRoutes());
  app.route('/', buildDigestAuthRoutes());
  app.route('/', buildNtlmAuthRoutes());
  app.route('/', buildHawkAuthRoutes());
  app.route('/', buildAwsSigV4AuthRoutes());
  app.route('/', buildJwtBearerAuthRoutes());

  // OAuth2 — proxies to a sibling node:http IdP.
  const oauth2 = await buildOAuth2Routes();
  app.route('/', oauth2.app);

  return {
    app,
    capture,
    close: async () => {
      await oauth2.idp.close();
    },
  };
}
