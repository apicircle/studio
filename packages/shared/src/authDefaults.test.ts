import { describe, expect, it } from 'vitest';
import { defaultAuthFor, normalizeAuth, REQUEST_AUTH_TYPES } from './authDefaults';

describe('defaultAuthFor', () => {
  it('returns an object whose type matches the requested type', () => {
    for (const t of REQUEST_AUTH_TYPES) {
      expect(defaultAuthFor(t).type).toBe(t);
    }
  });

  it('returns blank token state for OAuth2 grants', () => {
    const a = defaultAuthFor('oauth2-client-credentials');
    expect(a.accessToken).toBe('');
    expect(a.tokenType).toBe('Bearer');
    expect(a.expiresAt).toBeNull();
  });

  it('seeds AWS SigV4 with us-east-1', () => {
    const a = defaultAuthFor('aws-sigv4');
    expect(a.region).toBe('us-east-1');
    expect(a.addTo).toBe('header');
  });

  it('seeds JWT defaults with HS256 + sample payload', () => {
    const a = defaultAuthFor('jwt-bearer');
    expect(a.algorithm).toBe('HS256');
    expect(JSON.parse(a.payload)).toMatchObject({ sub: 'user-id' });
  });
});

describe('normalizeAuth', () => {
  it('passes through a valid RequestAuth shape', () => {
    expect(normalizeAuth({ type: 'bearer', token: 'x' })).toEqual({ type: 'bearer', token: 'x' });
  });

  it('returns { type: "none" } for null / undefined / non-objects', () => {
    expect(normalizeAuth(null)).toEqual({ type: 'none' });
    expect(normalizeAuth(undefined)).toEqual({ type: 'none' });
    expect(normalizeAuth('hello')).toEqual({ type: 'none' });
  });

  it('returns { type: "none" } when the type field is unknown', () => {
    expect(normalizeAuth({ type: 'mystery' })).toEqual({ type: 'none' });
  });
});

describe('REQUEST_AUTH_TYPES', () => {
  it('includes all 17 supported types', () => {
    expect(REQUEST_AUTH_TYPES).toHaveLength(17);
    for (const expected of [
      'none',
      'inherit',
      'bearer',
      'basic',
      'api-key',
      'custom-header',
      'oauth2-client-credentials',
      'oauth2-auth-code',
      'oauth2-pkce',
      'oauth2-password',
      'oauth2-implicit',
      'oauth2-device',
      'aws-sigv4',
      'digest',
      'ntlm',
      'hawk',
      'jwt-bearer',
    ]) {
      expect(REQUEST_AUTH_TYPES).toContain(expected as never);
    }
  });
});
