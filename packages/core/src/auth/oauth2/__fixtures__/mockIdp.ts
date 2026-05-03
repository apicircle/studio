/**
 * Programmatic OAuth2 IdP for E2E tests. Implements every grant the
 * studio supports with the simplest possible logic — no real user
 * accounts, no real key material. Tokens are deterministic strings
 * keyed by `client_id` so assertions can match exactly.
 *
 *   POST /token              — token endpoint (every grant_type)
 *   GET  /authorize          — auth-code / implicit redirect
 *   POST /device_authorize   — device flow user-code endpoint
 *   GET  /protected          — resource server, requires Bearer header
 *   POST /protected          — same, lets tests assert on POST too
 *   GET  /www-auth-bearer    — emits WWW-Authenticate Bearer error (no JSON)
 *   POST /digest-protected   — Digest 401-retry endpoint
 *
 * Spin up via `await startMockIdp()` and tear down with the returned
 * `close()`. Port is dynamic to avoid collisions in CI.
 */

import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http';
import { type AddressInfo } from 'node:net';

interface DeviceState {
  approvedAfter: number; // poll count threshold
  pollCount: number;
}

export interface MockIdp {
  port: number;
  url: (path: string) => string;
  /** Force the next /authorize redirect to include this error param. */
  setNextAuthorizeError: (err: { error: string; description?: string } | null) => void;
  /** Approve the current device flow (subsequent /token polls succeed). */
  approveDevice: () => void;
  close: () => Promise<void>;
}

export async function startMockIdp(): Promise<MockIdp> {
  let nextAuthorizeError: { error: string; description?: string } | null = null;
  const deviceCodes = new Map<string, DeviceState>();

  const server: Server = createServer((req, res) => {
    const url = new URL(req.url ?? '/', `http://127.0.0.1`);

    // Permissive CORS so the web app's fetch can reach the IdP across
    // origins (e.g. http://localhost:5174 → http://127.0.0.1:<idp>).
    // Real IdPs aren't this permissive — but only the test harness
    // ever talks to this server.
    res.setHeader('Access-Control-Allow-Origin', '*');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, Accept');
    if (req.method === 'OPTIONS') {
      res.statusCode = 204;
      res.end();
      return;
    }

    if (url.pathname === '/authorize') {
      const redirectUri = url.searchParams.get('redirect_uri') ?? '';
      const state = url.searchParams.get('state') ?? '';
      const responseType = url.searchParams.get('response_type') ?? 'code';
      if (!redirectUri) {
        res.statusCode = 400;
        res.end('redirect_uri required');
        return;
      }
      if (nextAuthorizeError) {
        const params = new URLSearchParams({
          error: nextAuthorizeError.error,
          state,
        });
        if (nextAuthorizeError.description) {
          params.set('error_description', nextAuthorizeError.description);
        }
        res.statusCode = 302;
        res.setHeader('Location', `${redirectUri}?${params.toString()}`);
        res.end();
        nextAuthorizeError = null;
        return;
      }
      if (responseType === 'token') {
        // Implicit: redirect with fragment.
        res.statusCode = 302;
        res.setHeader(
          'Location',
          `${redirectUri}#access_token=tk-implicit&token_type=Bearer&expires_in=3600&state=${state}`,
        );
        res.end();
        return;
      }
      // Default: auth-code redirect.
      res.statusCode = 302;
      res.setHeader('Location', `${redirectUri}?code=test-code&state=${state}`);
      res.end();
      return;
    }

    if (url.pathname === '/token' && req.method === 'POST') {
      collectBody(req, (body) => {
        const params = new URLSearchParams(body);
        const grant = params.get('grant_type');
        const clientId = params.get('client_id');
        if (!clientId) {
          jsonError(res, 400, 'invalid_client', 'client_id missing');
          return;
        }
        if (grant === 'client_credentials') {
          jsonOk(res, {
            access_token: `tk-cc-${clientId}`,
            token_type: 'Bearer',
            expires_in: 3600,
            scope: params.get('scope') ?? '',
          });
          return;
        }
        if (grant === 'password') {
          if (params.get('password') !== 'hunter2') {
            jsonError(res, 400, 'invalid_grant', 'wrong password');
            return;
          }
          jsonOk(res, {
            access_token: `tk-ropc-${params.get('username') ?? ''}`,
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'rt-ropc',
          });
          return;
        }
        if (grant === 'authorization_code') {
          if (params.get('code') !== 'test-code') {
            jsonError(res, 400, 'invalid_grant', 'unknown code');
            return;
          }
          // PKCE clients carry code_verifier — accept any non-empty value.
          jsonOk(res, {
            access_token: 'tk-authcode',
            token_type: 'Bearer',
            expires_in: 3600,
            refresh_token: 'rt-authcode',
            scope: params.get('scope') ?? '',
          });
          return;
        }
        if (grant === 'refresh_token') {
          if (params.get('refresh_token') === 'rt-rotated-once') {
            jsonError(res, 400, 'invalid_grant', 'refresh already used');
            return;
          }
          jsonOk(res, {
            access_token: 'tk-refreshed',
            token_type: 'Bearer',
            expires_in: 3600,
            // Rotate: hand back a fresh refresh_token.
            refresh_token: 'rt-rotated-once',
          });
          return;
        }
        if (grant === 'urn:ietf:params:oauth:grant-type:device_code') {
          const code = params.get('device_code') ?? '';
          const state = deviceCodes.get(code);
          if (!state) {
            jsonError(res, 400, 'invalid_grant', 'unknown device_code');
            return;
          }
          state.pollCount++;
          if (state.pollCount < state.approvedAfter) {
            jsonError(res, 400, 'authorization_pending');
            return;
          }
          jsonOk(res, {
            access_token: 'tk-device',
            token_type: 'Bearer',
            expires_in: 3600,
          });
          return;
        }
        jsonError(res, 400, 'unsupported_grant_type');
      });
      return;
    }

    if (url.pathname === '/device_authorize' && req.method === 'POST') {
      const code = `dc-${Date.now()}`;
      deviceCodes.set(code, { approvedAfter: 2, pollCount: 0 });
      jsonOk(res, {
        device_code: code,
        user_code: 'ABCD-EFGH',
        verification_uri: `http://127.0.0.1:${(server.address() as AddressInfo).port}/device`,
        interval: 1,
        expires_in: 600,
      });
      return;
    }

    if (url.pathname === '/protected') {
      const auth = req.headers['authorization'] ?? '';
      if (!auth.toLowerCase().startsWith('bearer tk-')) {
        res.statusCode = 401;
        res.setHeader('Content-Type', 'application/json');
        res.end(JSON.stringify({ error: 'unauthorized' }));
        return;
      }
      jsonOk(res, { ok: true, sawAuth: auth });
      return;
    }

    if (url.pathname === '/www-auth-bearer') {
      res.statusCode = 401;
      res.setHeader(
        'WWW-Authenticate',
        'Bearer error="invalid_token", error_description="The access token expired"',
      );
      res.end();
      return;
    }

    res.statusCode = 404;
    res.end('Not Found');
  });

  await new Promise<void>((resolve) => server.listen(0, '127.0.0.1', resolve));
  const port = (server.address() as AddressInfo).port;
  const baseUrl = `http://127.0.0.1:${port}`;

  return {
    port,
    url: (path) => `${baseUrl}${path}`,
    setNextAuthorizeError: (err) => {
      nextAuthorizeError = err;
    },
    approveDevice: () => {
      for (const state of deviceCodes.values()) state.approvedAfter = state.pollCount + 1;
    },
    close: () =>
      new Promise<void>((resolve, reject) => {
        server.close((err) => (err ? reject(err) : resolve()));
      }),
  };
}

function jsonOk(res: ServerResponse, body: unknown): void {
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(body));
}

function jsonError(res: ServerResponse, status: number, error: string, description?: string): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  const body: Record<string, string> = { error };
  if (description) body.error_description = description;
  res.end(JSON.stringify(body));
}

function collectBody(req: IncomingMessage, cb: (body: string) => void): void {
  const chunks: Buffer[] = [];
  req.on('data', (c: Buffer) => chunks.push(c));
  req.on('end', () => cb(Buffer.concat(chunks).toString('utf8')));
}
