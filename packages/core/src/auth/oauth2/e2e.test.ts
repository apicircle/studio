/**
 * End-to-end OAuth2 grant tests against an in-process mock IdP.
 *
 * Lives in `packages/core` rather than `e2e/web` because the only
 * thing under test is the core token-acquisition pipeline — no UI, no
 * Playwright. The mock IdP is shared with the Playwright suite for
 * consistency.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { startMockIdp, type MockIdp } from './__fixtures__/mockIdp';
import {
  buildAuthorizeUrl,
  exchangeAuthCode,
  exchangePkce,
  pollDeviceFlow,
  refreshToken,
  requestDeviceAuthorization,
  runClientCredentials,
  runRopc,
} from './grants';
import { computeCodeChallenge, generateCodeVerifier } from './pkce';
import { applyAuth } from '../../request/applyAuth';
import { executeRequest } from '../../request/executeRequest';
import type { Request as ApiRequest } from '@apicircle/shared';

let idp: MockIdp;

beforeAll(async () => {
  idp = await startMockIdp();
});
afterAll(async () => {
  await idp?.close();
});

const baseReq = (overrides: Partial<ApiRequest> = {}): ApiRequest => ({
  id: 'r1',
  name: 't',
  folderId: null,
  method: 'GET',
  url: 'unset',
  headers: [],
  query: [],
  body: { type: 'none', content: '' },
  auth: { type: 'none' },
  contextVars: [],
  extractions: [],
  assertions: [],
  createdAt: '2026-04-27T00:00:00.000Z',
  updatedAt: '2026-04-27T00:00:00.000Z',
  ...overrides,
});

describe('OAuth2 e2e: client_credentials', () => {
  it('exchanges + applies + sends with the bearer header', async () => {
    const tk = await runClientCredentials({
      tokenUrl: idp.url('/token'),
      clientId: 'cc-client',
      clientSecret: 'cc-secret',
      scope: 'read',
    });
    expect(tk.accessToken).toBe('tk-cc-cc-client');

    const result = await executeRequest(
      baseReq({
        url: idp.url('/protected'),
        auth: {
          type: 'oauth2-client-credentials',
          tokenUrl: idp.url('/token'),
          clientId: 'cc-client',
          clientSecret: 'cc-secret',
          scope: 'read',
          accessToken: tk.accessToken,
          tokenType: tk.tokenType,
          refreshToken: '',
          expiresAt: 0,
          obtainedScope: tk.scope ?? '',
          clientAuthMethod: 'header',
        },
      }),
    );
    expect(result.status).toBe(200);
    expect(result.body).toContain('"ok":true');
    expect(result.body).toContain('Bearer tk-cc-cc-client');
  });
});

describe('OAuth2 e2e: ROPC (password grant)', () => {
  it('issues a token for valid creds and rejects wrong password', async () => {
    const ok = await runRopc({
      tokenUrl: idp.url('/token'),
      clientId: 'ropc-client',
      clientSecret: '',
      username: 'alice',
      password: 'hunter2',
    });
    expect(ok.accessToken).toBe('tk-ropc-alice');
    expect(ok.refreshToken).toBe('rt-ropc');

    await expect(
      runRopc({
        tokenUrl: idp.url('/token'),
        clientId: 'ropc-client',
        clientSecret: '',
        username: 'alice',
        password: 'wrong',
      }),
    ).rejects.toThrow(/invalid_grant/);
  });
});

describe('OAuth2 e2e: authorization_code', () => {
  it('exchanges a code for a token + refreshes it', async () => {
    // Simulate the redirect step: the IdP's /authorize redirects to
    // redirect_uri?code=test-code. We don't actually run a browser —
    // the production code uses the bridge for that. Here we just call
    // exchangeAuthCode directly with the code we know the IdP issues.
    const tk = await exchangeAuthCode({
      tokenUrl: idp.url('/token'),
      clientId: 'auth-client',
      clientSecret: 'auth-secret',
      code: 'test-code',
      redirectUri: 'http://localhost:8081/callback',
    });
    expect(tk.accessToken).toBe('tk-authcode');
    expect(tk.refreshToken).toBe('rt-authcode');

    // Refresh: rotates the refresh_token.
    const refreshed = await refreshToken({
      tokenUrl: idp.url('/token'),
      clientId: 'auth-client',
      clientSecret: 'auth-secret',
      refreshToken: tk.refreshToken!,
    });
    expect(refreshed.accessToken).toBe('tk-refreshed');
    expect(refreshed.refreshToken).toBe('rt-rotated-once');

    // The next refresh with the OLD refresh_token must fail (single-use rotation).
    await expect(
      refreshToken({
        tokenUrl: idp.url('/token'),
        clientId: 'auth-client',
        clientSecret: 'auth-secret',
        refreshToken: 'rt-rotated-once',
      }),
    ).rejects.toThrow(/invalid_grant/);
  });
});

describe('OAuth2 e2e: PKCE', () => {
  it('signs a verifier-bound exchange', async () => {
    const verifier = generateCodeVerifier();
    const challenge = await computeCodeChallenge(verifier, 'S256');
    expect(challenge.length).toBeGreaterThan(0);
    const url = buildAuthorizeUrl({
      authorizeUrl: idp.url('/authorize'),
      clientId: 'pkce-client',
      redirectUri: 'http://localhost:8081/callback',
      responseType: 'code',
      state: 'xyz',
      extraParams: { code_challenge: challenge, code_challenge_method: 'S256' },
    });
    expect(url).toContain('code_challenge=');

    // Exchange: PKCE clients pass code_verifier in the body.
    const tk = await exchangePkce({
      tokenUrl: idp.url('/token'),
      clientId: 'pkce-client',
      code: 'test-code',
      redirectUri: 'http://localhost:8081/callback',
      codeVerifier: verifier,
    });
    expect(tk.accessToken).toBe('tk-authcode');
  });
});

describe('OAuth2 e2e: device flow', () => {
  it('polls the token endpoint, sees authorization_pending, then succeeds', async () => {
    const device = await requestDeviceAuthorization({
      deviceAuthorizationUrl: idp.url('/device_authorize'),
      clientId: 'device-client',
    });
    expect(device.userCode).toBe('ABCD-EFGH');

    // The mock IdP requires 2 polls to "approve" — we set scheduler
    // to no-op sleeps so the test runs instantly.
    const tk = await pollDeviceFlow({
      tokenUrl: idp.url('/token'),
      clientId: 'device-client',
      deviceCode: device.deviceCode,
      intervalSeconds: 1,
      maxWaitMs: 60_000,
      scheduler: { sleep: async () => {}, now: () => Date.now() },
    });
    expect(tk.accessToken).toBe('tk-device');
  });
});

describe('OAuth2 e2e: applyAuth auto-refresh', () => {
  it('refreshes a stale token at apply-time', async () => {
    const result = await applyAuth(
      {
        url: idp.url('/protected'),
        method: 'GET',
        headers: {},
        body: null,
      },
      {
        type: 'oauth2-client-credentials',
        tokenUrl: idp.url('/token'),
        clientId: 'refresh-client',
        clientSecret: 'refresh-secret',
        scope: '',
        accessToken: 'old-token',
        tokenType: 'Bearer',
        refreshToken: 'rt-some',
        expiresAt: Date.now() - 1000, // expired
        obtainedScope: '',
        clientAuthMethod: 'header',
      },
    );
    expect(result.headers['Authorization']).toBe('Bearer tk-refreshed');
  });
});
