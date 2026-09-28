import { describe, expect, it } from 'vitest';
import type { RequestAuth, WorkspaceSynced, Request as ApiRequest } from '@apicircle/shared';
import { assertNoPlaintextCredentials, redactForGit } from './redactWorkspace';

function reqWithAuth(id: string, auth: RequestAuth): ApiRequest {
  return {
    id,
    name: id,
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth,
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-04-27T00:00:00.000Z',
    updatedAt: '2026-04-27T00:00:00.000Z',
  };
}

function syncedWith(requests: Record<string, ApiRequest>): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      requests,
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
  } as unknown as WorkspaceSynced;
}

describe('redactForGit - credential field blanking', () => {
  it('blanks basic.password', () => {
    const synced = syncedWith({
      r: reqWithAuth('r', { type: 'basic', username: 'alice', password: 'hunter2' }),
    });
    const redacted = redactForGit(synced);
    const auth = redacted.collections.requests.r.auth;
    expect(auth.type).toBe('basic');
    if (auth.type === 'basic') {
      expect(auth.username).toBe('alice');
      expect(auth.password).toBe('');
    }
  });

  it('blanks bearer.token', () => {
    const synced = syncedWith({
      r: reqWithAuth('r', { type: 'bearer', token: 'eyJhbGciOiJIUzI1NiJ9.foo.bar' }),
    });
    const auth = redactForGit(synced).collections.requests.r.auth;
    if (auth.type === 'bearer') expect(auth.token).toBe('');
  });

  it('blanks api-key.value while keeping the name', () => {
    const synced = syncedWith({
      r: reqWithAuth('r', { type: 'api-key', key: 'X-API-Key', value: 'sk-123', addTo: 'header' }),
    });
    const auth = redactForGit(synced).collections.requests.r.auth;
    if (auth.type === 'api-key') {
      expect(auth.key).toBe('X-API-Key');
      expect(auth.value).toBe('');
    }
  });

  it('blanks digest.password / ntlm.password', () => {
    const digest = syncedWith({
      r: reqWithAuth('r', { type: 'digest', username: 'u', password: 'p' }),
    });
    const ntlm = syncedWith({
      r: reqWithAuth('r', {
        type: 'ntlm',
        username: 'u',
        password: 'p',
        domain: 'CORP',
        workstation: 'WS1',
      }),
    });
    const dAuth = redactForGit(digest).collections.requests.r.auth;
    const nAuth = redactForGit(ntlm).collections.requests.r.auth;
    if (dAuth.type === 'digest') expect(dAuth.password).toBe('');
    if (nAuth.type === 'ntlm') expect(nAuth.password).toBe('');
  });

  it('blanks aws-sigv4.secretAccessKey + sessionToken (keeps accessKeyId / region)', () => {
    const synced = syncedWith({
      r: reqWithAuth('r', {
        type: 'aws-sigv4',
        accessKeyId: 'AKIA...',
        secretAccessKey: 'wJalrXUtn...',
        sessionToken: 'FQoG...',
        region: 'us-east-1',
        service: 's3',
        addTo: 'header',
      }),
    });
    const auth = redactForGit(synced).collections.requests.r.auth;
    if (auth.type === 'aws-sigv4') {
      expect(auth.accessKeyId).toBe('AKIA...');
      expect(auth.region).toBe('us-east-1');
      expect(auth.secretAccessKey).toBe('');
      expect(auth.sessionToken).toBe('');
    }
  });

  it('blanks oauth2-client-credentials secrets but keeps identifiers', () => {
    const synced = syncedWith({
      r: reqWithAuth('r', {
        type: 'oauth2-client-credentials',
        tokenUrl: 'https://idp/token',
        clientId: 'app-1',
        clientSecret: 'super-secret',
        scope: 'read',
        clientAuthMethod: 'header',
        accessToken: 'live-token',
        tokenType: 'Bearer',
        refreshToken: 'refresh-it',
        expiresAt: null,
        obtainedScope: 'read',
      }),
    });
    const auth = redactForGit(synced).collections.requests.r.auth;
    if (auth.type === 'oauth2-client-credentials') {
      expect(auth.clientId).toBe('app-1');
      expect(auth.clientSecret).toBe('');
      expect(auth.accessToken).toBe('');
      expect(auth.refreshToken).toBe('');
    }
  });

  it('blanks oauth2-password.password as well as secrets and tokens', () => {
    const synced = syncedWith({
      r: reqWithAuth('r', {
        type: 'oauth2-password',
        tokenUrl: 'https://idp/token',
        clientId: 'app-1',
        clientSecret: 's',
        username: 'alice',
        password: 'hunter2',
        scope: 'read',
        accessToken: 'tk',
        tokenType: 'Bearer',
        refreshToken: 'rf',
        expiresAt: null,
        obtainedScope: '',
      }),
    });
    const auth = redactForGit(synced).collections.requests.r.auth;
    if (auth.type === 'oauth2-password') {
      expect(auth.username).toBe('alice');
      expect(auth.password).toBe('');
      expect(auth.clientSecret).toBe('');
      expect(auth.accessToken).toBe('');
      expect(auth.refreshToken).toBe('');
    }
  });

  it('blanks hawk.hawkKey and jwt-bearer.secretOrKey + token', () => {
    const hawk = syncedWith({
      r: reqWithAuth('r', {
        type: 'hawk',
        hawkId: 'h-id',
        hawkKey: 'h-key',
        algorithm: 'sha256',
        ext: '',
      }),
    });
    const jwt = syncedWith({
      r: reqWithAuth('r', {
        type: 'jwt-bearer',
        algorithm: 'HS256',
        secretOrKey: 'pem-data',
        payload: '{}',
        jwtHeaders: '{}',
        token: 'eyJ...',
      }),
    });
    const hAuth = redactForGit(hawk).collections.requests.r.auth;
    const jAuth = redactForGit(jwt).collections.requests.r.auth;
    if (hAuth.type === 'hawk') {
      expect(hAuth.hawkId).toBe('h-id');
      expect(hAuth.hawkKey).toBe('');
    }
    if (jAuth.type === 'jwt-bearer') {
      expect(jAuth.secretOrKey).toBe('');
      expect(jAuth.token).toBe('');
    }
  });

  it('passes through none / inherit unchanged', () => {
    const synced = syncedWith({
      a: reqWithAuth('a', { type: 'none' }),
      b: reqWithAuth('b', { type: 'inherit' }),
    });
    const redacted = redactForGit(synced);
    expect(redacted.collections.requests.a.auth).toEqual({ type: 'none' });
    expect(redacted.collections.requests.b.auth).toEqual({ type: 'inherit' });
  });

  it('blanks a custom auth header value like an api-key value, keeping the header name', () => {
    const synced = syncedWith({
      c: reqWithAuth('c', { type: 'custom-header', key: 'X-Service-Token', value: 's3cr3t' }),
    });
    expect(redactForGit(synced).collections.requests.c.auth).toEqual({
      type: 'custom-header',
      key: 'X-Service-Token',
      value: '',
    });
  });

  it('blanks a folder-level custom auth header value too', () => {
    const synced = syncedWith({});
    synced.collections.folders = {
      f: {
        id: 'f',
        name: 'F',
        parentId: null,
        auth: { type: 'custom-header', key: 'X-Service-Token', value: 's3cr3t' },
      },
      plain: { id: 'plain', name: 'Plain', parentId: null },
    };
    const folders = redactForGit(synced).collections.folders;
    expect(folders.f.auth).toEqual({ type: 'custom-header', key: 'X-Service-Token', value: '' });
    expect(folders.plain).toEqual({ id: 'plain', name: 'Plain', parentId: null });
  });

  it('strips credential user-info from request URLs and nothing else', () => {
    const withUrl = (url: string): ApiRequest => ({ ...reqWithAuth('r', { type: 'none' }), url });
    const redactedUrl = (url: string) =>
      redactForGit(syncedWith({ r: withUrl(url) })).collections.requests.r.url;

    expect(redactedUrl('https://alice:hunter22@api.example.com/v1/{{id}}?q=1')).toBe(
      'https://api.example.com/v1/{{id}}?q=1',
    );
    const token = 'ghp_' + 'A1b2C3d4E5f6G7h8I9j0K1l2M3n4O5p6Q7r8';
    expect(redactedUrl(`https://${token}@github.com/org/repo.git`)).toBe(
      'https://github.com/org/repo.git',
    );
    // Nothing secret in these — they stay exactly as written.
    for (const url of [
      'https://{{user}}:{{pass}}@api.example.com',
      'https://alice@api.example.com',
      '{{BASE_URL}}/v1',
      'https://api.example.com/users/a@b',
    ]) {
      expect(redactedUrl(url)).toBe(url);
    }
  });

  it('passes over a request with no auth at all (a remote document can hold one)', () => {
    const request = { ...reqWithAuth('r', { type: 'none' }) } as Partial<ApiRequest>;
    delete request.auth;
    const redacted = redactForGit(syncedWith({ r: request as ApiRequest }));
    expect(redacted.collections.requests.r.auth).toBeUndefined();
    expect(redacted.collections.requests.r.url).toBe('https://api.example.com');
  });

  it('does not mutate the input', () => {
    const original = syncedWith({
      r: {
        ...reqWithAuth('r', { type: 'basic', username: 'u', password: 'p' }),
        url: 'https://u:p@api.example.com',
      },
    });
    redactForGit(original);
    const auth = original.collections.requests.r.auth;
    if (auth.type === 'basic') expect(auth.password).toBe('p'); // input untouched
    expect(original.collections.requests.r.url).toBe('https://u:p@api.example.com');
  });
});

describe('assertNoPlaintextCredentials - fail-closed lint pass', () => {
  it('passes a redacted workspace', () => {
    const synced = syncedWith({
      r: reqWithAuth('r', { type: 'basic', username: 'u', password: 'hunter2' }),
    });
    const redacted = redactForGit(synced);
    const serialised = JSON.stringify(redacted);
    expect(() => assertNoPlaintextCredentials(serialised)).not.toThrow();
  });

  it('rejects a non-empty password field anywhere in the doc', () => {
    const serialised = JSON.stringify({ auth: { type: 'basic', password: 'hunter2' } });
    expect(() => assertNoPlaintextCredentials(serialised)).toThrow(/credential field "password"/);
  });

  it('rejects a non-empty clientSecret / refreshToken / accessToken', () => {
    expect(() => assertNoPlaintextCredentials('{"x":{"clientSecret":"abc"}}')).toThrow(
      /clientSecret/,
    );
    expect(() => assertNoPlaintextCredentials('{"x":{"refreshToken":"abc"}}')).toThrow(
      /refreshToken/,
    );
    expect(() => assertNoPlaintextCredentials('{"x":{"accessToken":"abc"}}')).toThrow(
      /accessToken/,
    );
  });

  it('rejects a non-empty secretAccessKey / sessionToken / hawkKey / secretOrKey', () => {
    expect(() => assertNoPlaintextCredentials('{"secretAccessKey":"AWS..."}')).toThrow(
      /secretAccessKey/,
    );
    expect(() => assertNoPlaintextCredentials('{"sessionToken":"FQoG..."}')).toThrow(
      /sessionToken/,
    );
    expect(() => assertNoPlaintextCredentials('{"hawkKey":"k"}')).toThrow(/hawkKey/);
    expect(() => assertNoPlaintextCredentials('{"secretOrKey":"-----BEGIN..."}')).toThrow(
      /secretOrKey/,
    );
  });

  it('does NOT flag empty-string credential fields (those are what redactor produces)', () => {
    const empty = '{"password":"","clientSecret":"","refreshToken":""}';
    expect(() => assertNoPlaintextCredentials(empty)).not.toThrow();
  });

  it('does NOT flag generic field names like `value` / `key` / `token`', () => {
    // The narrow allowlist means common fields used in non-credential
    // contexts (header rows, secret-vault metadata, JWT payloads) are not
    // false-positives. The redactor handles those structurally.
    const safe = '{"headers":[{"key":"X-Trace","value":"request-id"}]}';
    expect(() => assertNoPlaintextCredentials(safe)).not.toThrow();
  });
});
