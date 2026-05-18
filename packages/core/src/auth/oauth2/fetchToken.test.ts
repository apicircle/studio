import { describe, expect, it, vi } from 'vitest';
import { OAuth2TokenError, fetchOAuth2Token } from './fetchToken';

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

describe('fetchOAuth2Token', () => {
  it('sends Authorization: Basic header when clientAuthMethod="header"', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ access_token: 'tk', token_type: 'Bearer' }));
    await fetchOAuth2Token({
      tokenUrl: 'https://idp.example.com/token',
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      clientId: 'client-1',
      clientSecret: 'shh',
      clientAuthMethod: 'header',
      fetchImpl,
    });
    const headers = (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    // base64("client-1:shh") = Y2xpZW50LTE6c2hh
    expect(headers['Authorization']).toBe('Basic Y2xpZW50LTE6c2ho');
    // Body still carries client_id (some IdPs require it even with Basic auth).
    const body = (fetchImpl.mock.calls[0]?.[1]?.body ?? '') as string;
    expect(body).toContain('client_id=client-1');
  });

  it('sends client_id + client_secret in the body when clientAuthMethod="body"', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ access_token: 'tk', token_type: 'Bearer' }));
    await fetchOAuth2Token({
      tokenUrl: 'https://idp.example.com/token',
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      clientId: 'client-1',
      clientSecret: 'shh',
      clientAuthMethod: 'body',
      fetchImpl,
    });
    const headers = (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined();
    const body = (fetchImpl.mock.calls[0]?.[1]?.body ?? '') as string;
    expect(body).toContain('client_id=client-1');
    expect(body).toContain('client_secret=shh');
  });

  it('parses access_token + token_type + expires_in + refresh_token + scope', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      jsonResponse({
        access_token: 'tk',
        token_type: 'Bearer',
        expires_in: 3600,
        refresh_token: 'rt',
        scope: 'read write',
      }),
    );
    const out = await fetchOAuth2Token({
      tokenUrl: 'https://idp.example.com/token',
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      clientId: 'client-1',
      clientSecret: 'shh',
      fetchImpl,
    });
    expect(out.accessToken).toBe('tk');
    expect(out.tokenType).toBe('Bearer');
    expect(out.expiresIn).toBe(3600);
    expect(out.refreshToken).toBe('rt');
    expect(out.scope).toBe('read write');
  });

  it('throws OAuth2TokenError with the IdP error / error_description on a 400', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        jsonResponse({ error: 'invalid_grant', error_description: 'code expired' }, 400),
      );
    let thrown: unknown;
    try {
      await fetchOAuth2Token({
        tokenUrl: 'https://idp.example.com/token',
        body: new URLSearchParams({ grant_type: 'authorization_code', code: 'expired' }),
        clientId: 'c',
        clientSecret: 's',
        fetchImpl,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(OAuth2TokenError);
    expect((thrown as OAuth2TokenError).message).toBe('invalid_grant: code expired');
    expect((thrown as OAuth2TokenError).errorBody.error).toBe('invalid_grant');
    expect((thrown as OAuth2TokenError).errorBody.status).toBe(400);
  });

  it('throws when the IdP returns a 200 with no access_token', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ token_type: 'Bearer' }));
    await expect(
      fetchOAuth2Token({
        tokenUrl: 'https://idp.example.com/token',
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        clientId: 'c',
        clientSecret: 's',
        fetchImpl,
      }),
    ).rejects.toThrow(/no access_token/i);
  });

  it('falls back to parsing WWW-Authenticate Bearer error when body is non-JSON', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response('', {
        status: 401,
        headers: {
          'www-authenticate':
            'Bearer error="invalid_token", error_description="The access token expired"',
        },
      }),
    );
    let thrown: unknown;
    try {
      await fetchOAuth2Token({
        tokenUrl: 'https://idp.example.com/token',
        body: new URLSearchParams({ grant_type: 'refresh_token', refresh_token: 'old' }),
        clientId: 'c',
        clientSecret: 's',
        fetchImpl,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(OAuth2TokenError);
    expect((thrown as OAuth2TokenError).errorBody.error).toBe('invalid_token');
    expect((thrown as OAuth2TokenError).errorBody.errorDescription).toBe(
      'The access token expired',
    );
  });

  it('sends client_assertion + client_assertion_type when private_key_jwt is supplied', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(jsonResponse({ access_token: 'tk', token_type: 'Bearer' }));
    await fetchOAuth2Token({
      tokenUrl: 'https://idp.example.com/token',
      body: new URLSearchParams({ grant_type: 'client_credentials' }),
      clientId: 'client-id',
      // clientSecret is INTENTIONALLY set — assertion should take precedence.
      clientSecret: 'should-be-ignored',
      clientAssertion: { jwt: 'eyJ.eyJ.sig' },
      fetchImpl,
    });
    const headers = (fetchImpl.mock.calls[0]?.[1]?.headers ?? {}) as Record<string, string>;
    expect(headers['Authorization']).toBeUndefined(); // no Basic; secret was ignored
    const body = (fetchImpl.mock.calls[0]?.[1]?.body ?? '') as string;
    expect(body).toContain('client_id=client-id');
    expect(body).toContain(
      'client_assertion_type=urn%3Aietf%3Aparams%3Aoauth%3Aclient-assertion-type%3Ajwt-bearer',
    );
    expect(body).toContain('client_assertion=eyJ.eyJ.sig');
    expect(body).not.toContain('client_secret');
  });

  it('throws on a non-JSON error body with a clear "invalid_response" code', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(new Response('Server Error', { status: 500 }));
    let thrown: unknown;
    try {
      await fetchOAuth2Token({
        tokenUrl: 'https://idp.example.com/token',
        body: new URLSearchParams({ grant_type: 'client_credentials' }),
        clientId: 'c',
        clientSecret: 's',
        fetchImpl,
      });
    } catch (err) {
      thrown = err;
    }
    expect((thrown as OAuth2TokenError).errorBody.error).toBe('invalid_response');
    expect((thrown as OAuth2TokenError).errorBody.status).toBe(500);
  });
});
