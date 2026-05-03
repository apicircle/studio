import { describe, expect, it, vi } from 'vitest';
import { OAuth2TokenError } from './fetchToken';
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

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

function bodyParams(call: Parameters<typeof fetch>): URLSearchParams {
  return new URLSearchParams((call[1]?.body ?? '') as string);
}

describe('runClientCredentials', () => {
  it('POSTs grant_type=client_credentials with the configured scope', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ access_token: 'tk', token_type: 'Bearer', expires_in: 60 }));
    const out = await runClientCredentials({
      tokenUrl: 'https://idp/token',
      clientId: 'c',
      clientSecret: 's',
      scope: 'read',
      fetchImpl,
    });
    const body = bodyParams(fetchImpl.mock.calls[0]!);
    expect(body.get('grant_type')).toBe('client_credentials');
    expect(body.get('scope')).toBe('read');
    expect(out.accessToken).toBe('tk');
    expect(out.expiresIn).toBe(60);
  });
});

describe('runRopc', () => {
  it('POSTs grant_type=password with username + password', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ access_token: 'tk', token_type: 'Bearer' }));
    await runRopc({
      tokenUrl: 'https://idp/token',
      clientId: 'c',
      clientSecret: 's',
      username: 'alice',
      password: 'hunter2',
      fetchImpl,
    });
    const body = bodyParams(fetchImpl.mock.calls[0]!);
    expect(body.get('grant_type')).toBe('password');
    expect(body.get('username')).toBe('alice');
    expect(body.get('password')).toBe('hunter2');
  });
});

describe('exchangeAuthCode', () => {
  it('POSTs grant_type=authorization_code with code + redirect_uri', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ access_token: 'tk', token_type: 'Bearer' }));
    await exchangeAuthCode({
      tokenUrl: 'https://idp/token',
      clientId: 'c',
      clientSecret: 's',
      code: 'abc',
      redirectUri: 'https://app/callback',
      fetchImpl,
    });
    const body = bodyParams(fetchImpl.mock.calls[0]!);
    expect(body.get('grant_type')).toBe('authorization_code');
    expect(body.get('code')).toBe('abc');
    expect(body.get('redirect_uri')).toBe('https://app/callback');
  });
});

describe('exchangePkce', () => {
  it('adds code_verifier to the auth-code body', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ access_token: 'tk', token_type: 'Bearer' }));
    await exchangePkce({
      tokenUrl: 'https://idp/token',
      clientId: 'c',
      code: 'abc',
      redirectUri: 'https://app/callback',
      codeVerifier: 'verifier-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx',
      fetchImpl,
    });
    const body = bodyParams(fetchImpl.mock.calls[0]!);
    expect(body.get('code_verifier')).toBe('verifier-xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx');
  });
});

describe('refreshToken', () => {
  it('POSTs grant_type=refresh_token with refresh_token + scope', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ access_token: 'new-tk', token_type: 'Bearer' }));
    const out = await refreshToken({
      tokenUrl: 'https://idp/token',
      clientId: 'c',
      clientSecret: 's',
      refreshToken: 'rt',
      scope: 'read',
      fetchImpl,
    });
    const body = bodyParams(fetchImpl.mock.calls[0]!);
    expect(body.get('grant_type')).toBe('refresh_token');
    expect(body.get('refresh_token')).toBe('rt');
    expect(body.get('scope')).toBe('read');
    expect(out.accessToken).toBe('new-tk');
  });

  it('propagates a rotated refresh_token when the IdP issues one', async () => {
    // RFC 6749 §6 lets the IdP rotate the refresh_token on each refresh
    // (Auth0, Okta with rotation enabled, etc). The store / caller is
    // responsible for persisting the new value over the old one — but
    // we MUST surface it via OAuth2TokenResponse.refreshToken.
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        access_token: 'new-tk',
        token_type: 'Bearer',
        refresh_token: 'rt-rotated-v2',
        expires_in: 3600,
      }),
    );
    const out = await refreshToken({
      tokenUrl: 'https://idp/token',
      clientId: 'c',
      clientSecret: 's',
      refreshToken: 'rt-original',
      fetchImpl,
    });
    expect(out.refreshToken).toBe('rt-rotated-v2');
  });
});

describe('requestDeviceAuthorization', () => {
  it('parses device_code, user_code, verification_uri, interval', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      json({
        device_code: 'dc-1',
        user_code: 'ABCD-EFGH',
        verification_uri: 'https://idp/device',
        interval: 5,
        expires_in: 600,
      }),
    );
    const out = await requestDeviceAuthorization({
      deviceAuthorizationUrl: 'https://idp/device_authorization',
      clientId: 'c',
      scope: 'read',
      fetchImpl,
    });
    expect(out.deviceCode).toBe('dc-1');
    expect(out.userCode).toBe('ABCD-EFGH');
    expect(out.verificationUri).toBe('https://idp/device');
    expect(out.interval).toBe(5);
  });

  it('throws when device_code is missing', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(json({ user_code: 'X' }));
    await expect(
      requestDeviceAuthorization({
        deviceAuthorizationUrl: 'https://idp/device_authorization',
        clientId: 'c',
        fetchImpl,
      }),
    ).rejects.toThrow(/missing device_code/i);
  });
});

describe('pollDeviceFlow', () => {
  function fakeScheduler() {
    const sleeps: number[] = [];
    return {
      sleeps,
      sleep: async (ms: number) => {
        sleeps.push(ms);
      },
      now: () => 0,
    };
  }

  it('polls until the IdP returns a token, sleeping the configured interval', async () => {
    const sched = fakeScheduler();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: 'authorization_pending' }, 400))
      .mockResolvedValueOnce(json({ error: 'authorization_pending' }, 400))
      .mockResolvedValueOnce(json({ access_token: 'tk', token_type: 'Bearer' }));
    const out = await pollDeviceFlow({
      tokenUrl: 'https://idp/token',
      clientId: 'c',
      deviceCode: 'dc-1',
      intervalSeconds: 5,
      fetchImpl,
      scheduler: sched,
    });
    expect(out.accessToken).toBe('tk');
    expect(fetchImpl).toHaveBeenCalledTimes(3);
    expect(sched.sleeps).toEqual([5000, 5000]);
  });

  it('bumps the interval by 5s on slow_down per RFC 8628', async () => {
    const sched = fakeScheduler();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(json({ error: 'slow_down' }, 400))
      .mockResolvedValueOnce(json({ access_token: 'tk', token_type: 'Bearer' }));
    await pollDeviceFlow({
      tokenUrl: 'https://idp/token',
      clientId: 'c',
      deviceCode: 'dc-1',
      intervalSeconds: 5,
      fetchImpl,
      scheduler: sched,
    });
    // 5 + 5 = 10s after slow_down.
    expect(sched.sleeps).toEqual([10000]);
  });

  it('throws on access_denied / expired_token', async () => {
    const sched = fakeScheduler();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(json({ error: 'access_denied' }, 400));
    await expect(
      pollDeviceFlow({
        tokenUrl: 'https://idp/token',
        clientId: 'c',
        deviceCode: 'dc-1',
        intervalSeconds: 5,
        fetchImpl,
        scheduler: sched,
      }),
    ).rejects.toMatchObject({ errorBody: { error: 'access_denied' } });
  });

  it('honors maxWaitMs by throwing expired_token when exceeded', async () => {
    let nowValue = 0;
    const sched = {
      sleep: async (ms: number) => {
        nowValue += ms;
      },
      now: () => nowValue,
    };
    // mockImplementation rather than mockResolvedValue: each call returns
    // a FRESH Response. Reusing the same Response across calls fails on
    // the 2nd .json() because Response bodies are single-shot streams.
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => json({ error: 'authorization_pending' }, 400));
    let thrown: unknown;
    try {
      await pollDeviceFlow({
        tokenUrl: 'https://idp/token',
        clientId: 'c',
        deviceCode: 'dc-1',
        intervalSeconds: 5,
        maxWaitMs: 10_000,
        fetchImpl,
        scheduler: sched,
      });
    } catch (err) {
      thrown = err;
    }
    expect(thrown).toBeInstanceOf(OAuth2TokenError);
    expect((thrown as OAuth2TokenError).errorBody.error).toBe('expired_token');
  });
});

describe('buildAuthorizeUrl', () => {
  it('builds a /authorize URL with response_type, scope, state, and PKCE extras', () => {
    const url = buildAuthorizeUrl({
      authorizeUrl: 'https://idp/authorize',
      clientId: 'c',
      redirectUri: 'https://app/callback',
      responseType: 'code',
      scope: 'read write',
      state: 'xyz',
      extraParams: { code_challenge: 'abc', code_challenge_method: 'S256' },
    });
    const parsed = new URL(url);
    expect(parsed.searchParams.get('client_id')).toBe('c');
    expect(parsed.searchParams.get('redirect_uri')).toBe('https://app/callback');
    expect(parsed.searchParams.get('response_type')).toBe('code');
    expect(parsed.searchParams.get('scope')).toBe('read write');
    expect(parsed.searchParams.get('state')).toBe('xyz');
    expect(parsed.searchParams.get('code_challenge')).toBe('abc');
    expect(parsed.searchParams.get('code_challenge_method')).toBe('S256');
  });
});
