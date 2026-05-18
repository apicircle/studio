import type { Request as ApiRequest } from '@apicircle/shared';
import { describe, expect, it, vi } from 'vitest';
import { runClientCredentials } from './grants';
import { executeRequest } from '../../request/executeRequest';

/**
 * End-to-end OAuth2 chain test: token endpoint exchange → applyAuth →
 * executeRequest. Each layer is unit-tested separately, but the chain
 * is where bugs hide — a token whose `tokenType` is `bearer` (lowercase)
 * shouldn't be coerced to `Bearer` (or vice versa); a `null` body
 * shouldn't break SigV4-style "body-aware" auth types; and so on.
 */

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

const baseReq = (overrides: Partial<ApiRequest> = {}): ApiRequest => ({
  id: 'r1',
  name: 't',
  folderId: null,
  method: 'GET',
  url: 'https://api.example.com/users',
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

describe('OAuth2 grants → applyAuth → executeRequest', () => {
  it('client_credentials: token endpoint → store → resource server', async () => {
    // Simulate the two distinct fetches: the token endpoint exchange and
    // the eventual resource-server call. We share a single fetchImpl
    // mock that dispatches by URL so the sequence is realistic.
    const fetchImpl = vi.fn<typeof fetch>(async (input) => {
      const url = typeof input === 'string' ? input : (input as Request).url;
      if (url.startsWith('https://idp.example/token')) {
        return jsonResponse({
          access_token: 'tk-from-cc',
          token_type: 'Bearer',
          expires_in: 3600,
        });
      }
      return jsonResponse({ id: 1 });
    });

    // Step 1: exchange.
    const tokenOut = await runClientCredentials({
      tokenUrl: 'https://idp.example/token',
      clientId: 'c',
      clientSecret: 's',
      scope: 'read',
      fetchImpl,
    });
    expect(tokenOut.accessToken).toBe('tk-from-cc');

    // Step 2: send a request whose auth references that token.
    const result = await executeRequest(
      baseReq({
        auth: {
          type: 'oauth2-client-credentials',
          tokenUrl: 'https://idp.example/token',
          clientId: 'c',
          clientSecret: 's',
          scope: 'read',
          accessToken: tokenOut.accessToken,
          tokenType: tokenOut.tokenType,
          refreshToken: '',
          expiresAt: 0,
          obtainedScope: tokenOut.scope ?? '',
          clientAuthMethod: 'header',
        },
      }),
      { fetchImpl },
    );
    expect(result.status).toBe(200);

    // Step 3: prove the resource fetch carried the bearer token.
    const resourceCall = fetchImpl.mock.calls.find(
      ([input]) =>
        (typeof input === 'string' ? input : (input as Request).url) ===
        'https://api.example.com/users',
    );
    expect(resourceCall).toBeDefined();
    const headers = (resourceCall![1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBe('Bearer tk-from-cc');
  });

  it('preserves the IdP-supplied tokenType case (e.g. "Bearer" vs "DPoP")', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        jsonResponse({ access_token: 'tk-dpop', token_type: 'DPoP', expires_in: 60 }),
      )
      .mockResolvedValueOnce(jsonResponse({ ok: true }));

    const tokenOut = await runClientCredentials({
      tokenUrl: 'https://idp.example/token',
      clientId: 'c',
      clientSecret: 's',
      fetchImpl,
    });
    expect(tokenOut.tokenType).toBe('DPoP');

    await executeRequest(
      baseReq({
        auth: {
          type: 'oauth2-client-credentials',
          tokenUrl: 'https://idp.example/token',
          clientId: 'c',
          clientSecret: 's',
          scope: '',
          accessToken: tokenOut.accessToken,
          tokenType: 'DPoP',
          refreshToken: '',
          expiresAt: 0,
          obtainedScope: '',
          clientAuthMethod: 'header',
        },
      }),
      { fetchImpl },
    );
    const resourceHeaders = (fetchImpl.mock.calls[1]![1]?.headers ?? {}) as Record<string, string>;
    expect(resourceHeaders['Authorization']).toBe('DPoP tk-dpop');
  });
});
