import { describe, expect, it } from 'vitest';
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
      },
    ];
    for (const auth of cases) {
      const { headers } = await applyAuth(baseTarget, auth);
      expect(headers.Authorization).toMatch(/^(Bearer|DPoP) /);
    }
  });

  it('Digest and NTLM are deferred — credentials present, no header sent', async () => {
    const digestResult = await applyAuth(baseTarget, {
      type: 'digest',
      username: 'u',
      password: 'p',
    });
    expect(digestResult.headers.Authorization).toBeUndefined();
    const ntlmResult = await applyAuth(baseTarget, {
      type: 'ntlm',
      username: 'u',
      password: 'p',
      domain: '',
      workstation: '',
    });
    expect(ntlmResult.headers.Authorization).toBeUndefined();
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
