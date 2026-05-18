import { describe, expect, it, vi } from 'vitest';
import type { RequestAuth } from '@apicircle/shared';
import { applyAuth } from './applyAuth';

const baseTarget = {
  url: 'https://api.example.com/users?limit=10',
  method: 'GET',
  headers: { 'X-Existing': '1' },
  body: null as BodyInit | null,
};

describe('applyAuth', () => {
  it('passes through when type is none', async () => {
    const result = await applyAuth(baseTarget, { type: 'none' });
    expect(result.headers).toEqual(baseTarget.headers);
    expect(result.url).toBe(baseTarget.url);
  });

  it('passes through when type is inherit (resolved upstream)', async () => {
    const result = await applyAuth(baseTarget, { type: 'inherit' });
    expect(result.headers).toEqual(baseTarget.headers);
  });

  it('adds a Bearer Authorization header', async () => {
    const auth: RequestAuth = { type: 'bearer', token: 'abc-123' };
    const { headers } = await applyAuth(baseTarget, auth);
    expect(headers.Authorization).toBe('Bearer abc-123');
    expect(headers['X-Existing']).toBe('1');
  });

  it('skips bearer when token is empty', async () => {
    const result = await applyAuth(baseTarget, { type: 'bearer', token: '   ' });
    expect(result.headers.Authorization).toBeUndefined();
  });

  it('replaces a stale Authorization header (case-insensitive)', async () => {
    const target = { ...baseTarget, headers: { authorization: 'Bearer old' } };
    const result = await applyAuth(target, { type: 'bearer', token: 'new' });
    expect(Object.keys(result.headers)).not.toContain('authorization');
    expect(result.headers.Authorization).toBe('Bearer new');
  });

  it('encodes Basic auth as base64(user:pass)', async () => {
    const auth: RequestAuth = { type: 'basic', username: 'aladdin', password: 'open sesame' };
    const { headers } = await applyAuth(baseTarget, auth);
    expect(headers.Authorization).toBe('Basic YWxhZGRpbjpvcGVuIHNlc2FtZQ==');
  });

  it('handles UTF-8 in Basic auth', async () => {
    const auth: RequestAuth = { type: 'basic', username: 'müller', password: '😀' };
    const { headers } = await applyAuth(baseTarget, auth);
    expect(headers.Authorization).toBe('Basic bcO8bGxlcjrwn5iA');
  });

  it('api-key adds to header by default', async () => {
    const auth: RequestAuth = { type: 'api-key', key: 'X-API-Key', value: 'k1', addTo: 'header' };
    const { headers, url } = await applyAuth(baseTarget, auth);
    expect(headers['X-API-Key']).toBe('k1');
    expect(url).toBe(baseTarget.url);
  });

  it('api-key adds to query when addTo=query', async () => {
    const auth: RequestAuth = { type: 'api-key', key: 'token', value: 'k1', addTo: 'query' };
    const { url } = await applyAuth(baseTarget, auth);
    expect(url).toContain('token=k1');
  });

  it('api-key adds to Cookie header when addTo=cookie', async () => {
    const auth: RequestAuth = { type: 'api-key', key: 'sid', value: 'abc', addTo: 'cookie' };
    const { headers } = await applyAuth(baseTarget, auth);
    expect(headers.Cookie).toBe('sid=abc');
  });

  it('appends to an existing Cookie header', async () => {
    const target = { ...baseTarget, headers: { Cookie: 'prev=1' } };
    const { headers } = await applyAuth(target, {
      type: 'api-key',
      key: 'sid',
      value: 'abc',
      addTo: 'cookie',
    });
    expect(headers.Cookie).toBe('prev=1; sid=abc');
  });

  it('custom-header sets the named header', async () => {
    const auth: RequestAuth = { type: 'custom-header', key: 'X-Custom', value: 'v' };
    const { headers } = await applyAuth(baseTarget, auth);
    expect(headers['X-Custom']).toBe('v');
  });

  it('OAuth2 modes inject the stored access token', async () => {
    const cases: RequestAuth[] = [
      {
        type: 'oauth2-client-credentials',
        tokenUrl: '',
        clientId: '',
        clientSecret: '',
        scope: '',
        clientAuthMethod: 'header',
        accessToken: 'a',
        tokenType: 'Bearer',
        refreshToken: '',
        expiresAt: null,
        obtainedScope: '',
      },
      {
        type: 'oauth2-implicit',
        authUrl: '',
        clientId: '',
        redirectUri: '',
        scope: '',
        accessToken: 'b',
        tokenType: 'DPoP',
        expiresAt: null,
        obtainedScope: '',
      },
    ];
    for (const auth of cases) {
      const { headers } = await applyAuth(baseTarget, auth);
      expect(headers.Authorization).toMatch(/^(Bearer|DPoP) /);
    }
  });

  it('Digest sends unauthenticated — executeRequest fills in the response after seeing 401', async () => {
    const digestResult = await applyAuth(baseTarget, {
      type: 'digest',
      username: 'u',
      password: 'p',
    });
    expect(digestResult.headers.Authorization).toBeUndefined();
  });

  it('NTLM emits the Type-1 Negotiate so the server immediately challenges with Type-2', async () => {
    const ntlmResult = await applyAuth(baseTarget, {
      type: 'ntlm',
      username: 'u',
      password: 'p',
      domain: 'CORP',
      workstation: 'WS01',
    });
    // Type-1 message is base64-encoded and starts with the NTLMSSP signature.
    expect(ntlmResult.headers.Authorization).toMatch(/^NTLM [A-Za-z0-9+/=]+$/);
    const b64 = ntlmResult.headers.Authorization!.replace(/^NTLM /, '');
    const bytes = Uint8Array.from(atob(b64), (c) => c.charCodeAt(0));
    expect(Array.from(bytes.slice(0, 8))).toEqual([78, 84, 76, 77, 83, 83, 80, 0]);
    expect(bytes[8]).toBe(1); // message type 1 = Negotiate
  });

  it('JWT HS256 signs locally and sends a Bearer token', async () => {
    const auth: RequestAuth = {
      type: 'jwt-bearer',
      algorithm: 'HS256',
      secretOrKey: 'topsecret',
      payload: '{"sub":"u1"}',
      jwtHeaders: '{}',
      token: '',
    };
    const { headers } = await applyAuth(baseTarget, auth);
    expect(headers.Authorization).toMatch(
      /^Bearer [A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/,
    );
  });

  it('JWT RS256 signs with a generated keypair', async () => {
    // Round-trip via WebCrypto: generate a fresh RSA keypair, export as
    // PKCS#8 PEM, hand it to applyAuth, and verify the resulting token
    // validates against the matching public key. Proves the asymmetric
    // signing path through applyAuth → signJwt → SubtleCrypto works
    // end-to-end (the signing path lacks a published deterministic
    // fixture, so the round-trip IS the regression vector).
    const { privateKey, publicKey } = await crypto.subtle.generateKey(
      {
        name: 'RSASSA-PKCS1-v1_5',
        modulusLength: 2048,
        publicExponent: new Uint8Array([1, 0, 1]),
        hash: 'SHA-256',
      },
      true,
      ['sign', 'verify'],
    );
    const der = new Uint8Array(await crypto.subtle.exportKey('pkcs8', privateKey));
    let bin = '';
    for (let i = 0; i < der.length; i++) bin += String.fromCharCode(der[i]!);
    const pem = `-----BEGIN PRIVATE KEY-----\n${btoa(bin)
      .match(/.{1,64}/g)
      ?.join('\n')}\n-----END PRIVATE KEY-----`;

    const auth: RequestAuth = {
      type: 'jwt-bearer',
      algorithm: 'RS256',
      secretOrKey: pem,
      payload: '{"sub":"rs-test"}',
      jwtHeaders: '{}',
      token: '',
    };
    const { headers } = await applyAuth(baseTarget, auth);
    const m = /^Bearer ([^.]+)\.([^.]+)\.(.+)$/.exec(headers.Authorization ?? '');
    expect(m).not.toBeNull();
    const [, h, p, s] = m!;
    const sig = Uint8Array.from(
      atob(s.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - (s.length % 4)) % 4)),
      (c) => c.charCodeAt(0),
    );
    const signed = new TextEncoder().encode(`${h}.${p}`);
    const ok = await crypto.subtle.verify(
      'RSASSA-PKCS1-v1_5',
      publicKey,
      sig.buffer.slice(sig.byteOffset, sig.byteOffset + sig.byteLength) as ArrayBuffer,
      signed.buffer.slice(signed.byteOffset, signed.byteOffset + signed.byteLength) as ArrayBuffer,
    );
    expect(ok).toBe(true);
  });

  it('JWT surfaces a "jwt-payload-json-invalid" warning when payload JSON is malformed', async () => {
    const auth: RequestAuth = {
      type: 'jwt-bearer',
      algorithm: 'HS256',
      secretOrKey: 'k',
      payload: '{not valid json',
      jwtHeaders: '{}',
      token: '',
    };
    const result = await applyAuth(baseTarget, auth);
    expect(result.headers.Authorization).toBeUndefined();
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]?.code).toBe('jwt-payload-json-invalid');
  });

  it('JWT surfaces a "jwt-sign-failed" warning when the key is invalid for the algorithm', async () => {
    const auth: RequestAuth = {
      type: 'jwt-bearer',
      algorithm: 'RS256',
      secretOrKey: 'not a real PEM key',
      payload: '{"sub":"x"}',
      jwtHeaders: '{}',
      token: '',
    };
    const result = await applyAuth(baseTarget, auth);
    expect(result.headers.Authorization).toBeUndefined();
    expect(result.warnings![0]?.code).toBe('jwt-sign-failed');
  });

  it('JWT honors a pre-computed token', async () => {
    const auth: RequestAuth = {
      type: 'jwt-bearer',
      algorithm: 'RS256',
      secretOrKey: '',
      payload: '',
      jwtHeaders: '',
      token: 'abc.def.ghi',
    };
    const { headers } = await applyAuth(baseTarget, auth);
    expect(headers.Authorization).toBe('Bearer abc.def.ghi');
  });

  it('OAuth2 auto-refreshes when expiresAt is past + a refreshToken is on file', async () => {
    // Mock fetch that returns a fresh token from the IdP's refresh endpoint.
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      new Response(
        JSON.stringify({
          access_token: 'new-access',
          token_type: 'Bearer',
          refresh_token: 'rt-rotated',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      ),
    );
    const persistCalls: Array<unknown> = [];
    const result = await applyAuth(
      baseTarget,
      {
        type: 'oauth2-client-credentials',
        tokenUrl: 'https://idp/token',
        clientId: 'c',
        clientSecret: 's',
        scope: '',
        accessToken: 'old-access',
        tokenType: 'Bearer',
        refreshToken: 'rt-original',
        expiresAt: Date.now() - 1000, // expired 1s ago
        obtainedScope: '',
        clientAuthMethod: 'header',
      },
      {
        fetchImpl,
        onTokenRefreshed: (_auth, next) => {
          persistCalls.push(next);
        },
      },
    );
    expect(result.headers.Authorization).toBe('Bearer new-access');
    expect(persistCalls).toHaveLength(1);
    expect(persistCalls[0]).toMatchObject({
      accessToken: 'new-access',
      refreshToken: 'rt-rotated',
    });
  });

  it('OAuth2 surfaces a "oauth2-refresh-failed" warning when the IdP rejects the refresh', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValue(
        new Response(
          JSON.stringify({ error: 'invalid_grant', error_description: 'refresh expired' }),
          { status: 400, headers: { 'content-type': 'application/json' } },
        ),
      );
    const result = await applyAuth(
      baseTarget,
      {
        type: 'oauth2-client-credentials',
        tokenUrl: 'https://idp/token',
        clientId: 'c',
        clientSecret: 's',
        scope: '',
        accessToken: 'stale-access',
        tokenType: 'Bearer',
        refreshToken: 'rt-bad',
        expiresAt: Date.now() - 1000,
        obtainedScope: '',
        clientAuthMethod: 'header',
      },
      { fetchImpl },
    );
    // Original (stale) token still applies — request will hit the
    // server with an expired bearer.
    expect(result.headers.Authorization).toBe('Bearer stale-access');
    // Warning surfaced for the user.
    expect(result.warnings).toBeDefined();
    expect(result.warnings![0]?.code).toBe('oauth2-refresh-failed');
    expect(result.warnings![0]?.message).toMatch(/invalid_grant.*refresh expired/);
  });

  it('OAuth2 coalesces concurrent refresh attempts via the in-flight mutex', async () => {
    let calls = 0;
    const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
      calls++;
      // 50ms latency so both applyAuth calls overlap and the second
      // hits the in-flight Promise rather than firing a new fetch.
      await new Promise((r) => setTimeout(r, 50));
      return new Response(
        JSON.stringify({
          access_token: 'tk-new',
          token_type: 'Bearer',
          expires_in: 3600,
        }),
        { status: 200, headers: { 'content-type': 'application/json' } },
      );
    });
    const expiredAuth = {
      type: 'oauth2-client-credentials' as const,
      tokenUrl: 'https://idp/token-mutex',
      clientId: 'mutex-client',
      clientSecret: 's',
      scope: '',
      accessToken: 'old',
      tokenType: 'Bearer',
      refreshToken: 'rt-shared',
      expiresAt: Date.now() - 1000,
      obtainedScope: '',
      clientAuthMethod: 'header' as const,
    };
    const [a, b] = await Promise.all([
      applyAuth(baseTarget, expiredAuth, { fetchImpl }),
      applyAuth(baseTarget, expiredAuth, { fetchImpl }),
    ]);
    expect(a.headers.Authorization).toBe('Bearer tk-new');
    expect(b.headers.Authorization).toBe('Bearer tk-new');
    // The mutex should have coalesced — exactly one fetch to /token.
    expect(calls).toBe(1);
  });

  it('OAuth2 skips auto-refresh when expiresAt is comfortably in the future', async () => {
    const fetchImpl = vi.fn<typeof fetch>();
    const result = await applyAuth(
      baseTarget,
      {
        type: 'oauth2-client-credentials',
        tokenUrl: 'https://idp/token',
        clientId: 'c',
        clientSecret: 's',
        scope: '',
        accessToken: 'fresh-access',
        tokenType: 'Bearer',
        refreshToken: 'rt',
        expiresAt: Date.now() + 3600 * 1000, // 1h in the future
        obtainedScope: '',
        clientAuthMethod: 'header',
      },
      { fetchImpl, refreshLeewayMs: 60_000 },
    );
    expect(result.headers.Authorization).toBe('Bearer fresh-access');
    expect(fetchImpl).not.toHaveBeenCalled();
  });

  it('Hawk produces an Authorization header with id, ts, nonce, mac', async () => {
    const auth: RequestAuth = {
      type: 'hawk',
      hawkId: 'dh37fgj492je',
      hawkKey: 'werxhqb98rpaxn39848xrunpaw3489ruxnpa98w4rxn',
      algorithm: 'sha256',
      ext: 'some-ext',
    };
    const { headers } = await applyAuth(baseTarget, auth);
    expect(headers.Authorization).toMatch(
      /^Hawk id="dh37fgj492je", ts="\d+", nonce="[^"]+", ext="some-ext", mac="[^"]+"$/,
    );
  });

  it('AWS SigV4 attaches an Authorization header with the right components', async () => {
    const auth: RequestAuth = {
      type: 'aws-sigv4',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      sessionToken: '',
      region: 'us-east-1',
      service: 'execute-api',
      addTo: 'header',
    };
    const { headers } = await applyAuth(
      { ...baseTarget, url: 'https://example.amazonaws.com/' },
      auth,
    );
    expect(headers.Authorization).toMatch(/^AWS4-HMAC-SHA256 Credential=AKIDEXAMPLE\//);
    expect(headers['x-amz-date']).toMatch(/^\d{8}T\d{6}Z$/);
  });

  it('AWS SigV4 with addTo=query writes presigned-URL parameters', async () => {
    const auth: RequestAuth = {
      type: 'aws-sigv4',
      accessKeyId: 'AKIDEXAMPLE',
      secretAccessKey: 'wJalrXUtnFEMI/K7MDENG+bPxRfiCYEXAMPLEKEY',
      sessionToken: '',
      region: 'us-east-1',
      service: 's3',
      addTo: 'query',
    };
    const { url, headers } = await applyAuth(
      { ...baseTarget, url: 'https://bucket.s3.amazonaws.com/key' },
      auth,
    );
    expect(url).toContain('X-Amz-Algorithm=AWS4-HMAC-SHA256');
    expect(url).toContain('X-Amz-Credential=AKIDEXAMPLE%2F');
    expect(url).toContain('X-Amz-Signature=');
    // Authorization header is NOT set in query mode
    expect(headers.Authorization).toBeUndefined();
  });
});
