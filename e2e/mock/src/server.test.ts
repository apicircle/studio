// In-process tests for the mock server. Each `app.fetch(request)` call
// goes through the exact route stack the e2e harness uses, so we cover
// route assembly + introspection + every auth challenge here.

import { describe, expect, it, beforeAll, afterAll } from 'vitest';
import { buildE2eMockServer, type E2eMockServer } from './server';
import { BASIC_VALID } from './routes/auth/basic';
import { VALID_BEARER } from './routes/auth/bearer';
import { VALID_API_KEY } from './routes/auth/apiKey';
import { COOKIE_AUTH } from './routes/auth/cookie';
import { DIGEST_VALID } from './routes/auth/digest';
import { HAWK_VALID } from './routes/auth/hawk';
import { SIGV4_VALID } from './routes/auth/awsSigV4';
import { HS256_SECRET } from './routes/auth/jwtBearer';
import { createHash, createHmac } from 'node:crypto';
import { FIXED_TREE } from './routes/jsonPath';
import { BINARY_PAYLOAD } from './routes/binary';

let mock: E2eMockServer;
beforeAll(async () => {
  mock = await buildE2eMockServer();
});
afterAll(async () => {
  await mock.close();
});

const fetchMock = (path: string, init?: RequestInit) =>
  mock.app.fetch(new Request(`http://localhost${path}`, init));

describe('health + introspection', () => {
  it('GET /__health returns ok', async () => {
    const res = await fetchMock('/__health');
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  it('introspection captures requests + clears on DELETE', async () => {
    await fetchMock('/__inspect', { method: 'DELETE' });
    await fetchMock('/anything?k=v', { headers: { 'X-Probe': '1' } });
    const res = await fetchMock('/__inspect/last?n=1');
    const body = (await res.json()) as {
      entries: Array<{ url: string; query: Record<string, string> }>;
    };
    expect(body.entries).toHaveLength(1);
    expect(body.entries[0].url).toContain('/anything?k=v');
    expect(body.entries[0].query.k).toBe('v');
    await fetchMock('/__inspect', { method: 'DELETE' });
    const cleared = await fetchMock('/__inspect/last?n=10');
    const clearedBody = (await cleared.json()) as { entries: unknown[] };
    expect(clearedBody.entries).toHaveLength(0);
  });
});

describe('echo routes', () => {
  it('GET /anything echoes method, query, headers', async () => {
    const res = await fetchMock('/anything?a=1&b=2', { headers: { 'X-Test': 'yes' } });
    const body = (await res.json()) as {
      method: string;
      query: Record<string, string>;
      headers: Record<string, string>;
    };
    expect(body.method).toBe('GET');
    expect(body.query).toEqual({ a: '1', b: '2' });
    expect(body.headers['x-test']).toBe('yes');
  });

  it('POST /anything with JSON echoes body.json', async () => {
    const res = await fetchMock('/anything', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'alice', n: 42 }),
    });
    const body = (await res.json()) as { body: { kind: string; json: unknown } };
    expect(body.body.kind).toBe('json');
    expect(body.body.json).toEqual({ name: 'alice', n: 42 });
  });

  it('GET /method/get is OK; POST /method/get returns 405', async () => {
    expect((await fetchMock('/method/get')).status).toBe(200);
    const wrong = await fetchMock('/method/get', { method: 'POST' });
    expect(wrong.status).toBe(405);
    expect(wrong.headers.get('allow')).toBe('GET');
  });

  it('GET /status/418 returns 418', async () => {
    const res = await fetchMock('/status/418');
    expect(res.status).toBe(418);
  });

  it('GET /status/204 returns 204 with empty body', async () => {
    const res = await fetchMock('/status/204');
    expect(res.status).toBe(204);
  });

  it('GET /delay/50 takes at least 50ms', async () => {
    const t0 = Date.now();
    await fetchMock('/delay/50');
    expect(Date.now() - t0).toBeGreaterThanOrEqual(45); // small slack for timer drift
  });

  it('GET /json returns the fixed tree', async () => {
    const res = await fetchMock('/json');
    const body = await res.json();
    expect(body).toEqual(FIXED_TREE);
  });

  it('GET /binary returns octet-stream with the known byte length', async () => {
    const res = await fetchMock('/binary');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/octet-stream');
    const buf = new Uint8Array(await res.arrayBuffer());
    expect(buf.length).toBe(BINARY_PAYLOAD.byteLength);
    for (let i = 0; i < buf.length; i++) expect(buf[i]).toBe(BINARY_PAYLOAD[i]);
  });
});

describe('cookie routes', () => {
  it('GET /cookies echoes Cookie header', async () => {
    const res = await fetchMock('/cookies', { headers: { Cookie: 'a=1; b=2' } });
    const body = (await res.json()) as { cookies: Record<string, string> };
    expect(body.cookies).toEqual({ a: '1', b: '2' });
  });

  it('GET /cookies/set/foo/bar issues Set-Cookie', async () => {
    const res = await fetchMock('/cookies/set/foo/bar');
    expect(res.headers.get('set-cookie')).toContain('foo=bar');
  });
});

describe('auth — basic', () => {
  it('401 with WWW-Authenticate when no credentials', async () => {
    const res = await fetchMock('/auth/basic');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Basic /);
  });

  it('200 with correct credentials', async () => {
    const creds = Buffer.from(`${BASIC_VALID.user}:${BASIC_VALID.pass}`).toString('base64');
    const res = await fetchMock('/auth/basic', { headers: { Authorization: `Basic ${creds}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { authenticated: boolean };
    expect(body.authenticated).toBe(true);
  });

  it('401 with wrong credentials', async () => {
    const creds = Buffer.from(`wrong:wrong`).toString('base64');
    const res = await fetchMock('/auth/basic', { headers: { Authorization: `Basic ${creds}` } });
    expect(res.status).toBe(401);
  });
});

describe('auth — bearer', () => {
  it('401 without token', async () => {
    expect((await fetchMock('/auth/bearer')).status).toBe(401);
  });
  it('200 with VALID_BEARER', async () => {
    const res = await fetchMock('/auth/bearer', {
      headers: { Authorization: `Bearer ${VALID_BEARER}` },
    });
    expect(res.status).toBe(200);
  });
  it('401 with wrong token', async () => {
    const res = await fetchMock('/auth/bearer', { headers: { Authorization: 'Bearer nope' } });
    expect(res.status).toBe(401);
  });
});

describe('auth — api-key', () => {
  it('header location accepts the key in default header', async () => {
    const res = await fetchMock('/auth/api-key/header', {
      headers: { 'X-API-Key': VALID_API_KEY },
    });
    expect(res.status).toBe(200);
  });
  it('header location respects ?keyName override', async () => {
    const res = await fetchMock('/auth/api-key/header?keyName=x-custom', {
      headers: { 'x-custom': VALID_API_KEY },
    });
    expect(res.status).toBe(200);
  });
  it('query location accepts the key as ?api_key=', async () => {
    const res = await fetchMock(`/auth/api-key/query?api_key=${VALID_API_KEY}`);
    expect(res.status).toBe(200);
  });
  it('cookie location accepts the key in Cookie', async () => {
    const res = await fetchMock('/auth/api-key/cookie', {
      headers: { Cookie: `apikey=${VALID_API_KEY}` },
    });
    expect(res.status).toBe(200);
  });
});

describe('auth — cookie session', () => {
  it('login then protected with the issued session', async () => {
    const login = await fetchMock('/auth/cookie/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: COOKIE_AUTH.validUser, password: COOKIE_AUTH.validPass }),
    });
    expect(login.status).toBe(200);
    const setCookie = login.headers.get('set-cookie') ?? '';
    const sessionMatch = /session=([^;]+)/.exec(setCookie);
    expect(sessionMatch).toBeTruthy();
    const session = sessionMatch![1];
    const protectedRes = await fetchMock('/auth/cookie/protected', {
      headers: { Cookie: `session=${session}` },
    });
    expect(protectedRes.status).toBe(200);
  });
  it('static session id always works (no login needed)', async () => {
    const res = await fetchMock('/auth/cookie/protected', {
      headers: { Cookie: `session=${COOKIE_AUTH.staticSessionId}` },
    });
    expect(res.status).toBe(200);
  });
  it('protected without session = 401', async () => {
    expect((await fetchMock('/auth/cookie/protected')).status).toBe(401);
  });
});

describe('auth — digest', () => {
  it('first hit issues WWW-Authenticate Digest', async () => {
    const res = await fetchMock('/auth/digest');
    expect(res.status).toBe(401);
    expect(res.headers.get('www-authenticate')).toMatch(/^Digest /);
  });

  it('correct response yields 200', async () => {
    // Recompute the same response a real Digest client would send.
    const challenge = await fetchMock('/auth/digest');
    const wwwAuth = challenge.headers.get('www-authenticate') ?? '';
    const realmMatch = /realm="([^"]+)"/.exec(wwwAuth);
    const nonceMatch = /nonce="([^"]+)"/.exec(wwwAuth);
    const realm = realmMatch![1];
    const nonce = nonceMatch![1];
    const uri = '/auth/digest';
    const method = 'GET';
    const ha1 = createHash('md5')
      .update(`${DIGEST_VALID.user}:${realm}:${DIGEST_VALID.pass}`)
      .digest('hex');
    const ha2 = createHash('md5').update(`${method}:${uri}`).digest('hex');
    const nc = '00000001';
    const cnonce = 'abc';
    const response = createHash('md5')
      .update(`${ha1}:${nonce}:${nc}:${cnonce}:auth:${ha2}`)
      .digest('hex');
    const authHeader = `Digest username="${DIGEST_VALID.user}", realm="${realm}", nonce="${nonce}", uri="${uri}", qop="auth", nc=${nc}, cnonce="${cnonce}", response="${response}"`;
    const res = await fetchMock(uri, { headers: { Authorization: authHeader } });
    expect(res.status).toBe(200);
  });
});

describe('auth — ntlm', () => {
  it('Type-1 negotiate gets a Type-2 challenge', async () => {
    // Minimal Type-1 message: signature + type + flags
    const buf = Buffer.alloc(40);
    buf.write('NTLMSSP\0', 0, 'utf8');
    buf.writeUInt32LE(1, 8); // Type 1
    const auth = `NTLM ${buf.toString('base64')}`;
    const res = await fetchMock('/auth/ntlm', { headers: { Authorization: auth } });
    expect(res.status).toBe(401);
    const challenge = res.headers.get('www-authenticate') ?? '';
    expect(challenge).toMatch(/^NTLM /);
  });

  it('Type-3 authenticate yields 200', async () => {
    const buf = Buffer.alloc(40);
    buf.write('NTLMSSP\0', 0, 'utf8');
    buf.writeUInt32LE(3, 8); // Type 3
    const auth = `NTLM ${buf.toString('base64')}`;
    const res = await fetchMock('/auth/ntlm', { headers: { Authorization: auth } });
    expect(res.status).toBe(200);
  });
});

describe('auth — hawk', () => {
  it('rejects when no Authorization header', async () => {
    expect((await fetchMock('/auth/hawk')).status).toBe(401);
  });
  it('accepts a correctly-signed Hawk request', async () => {
    const ts = '1700000000';
    const nonce = 'abc';
    const method = 'GET';
    const path = '/auth/hawk';
    const host = 'localhost';
    const port = '80'; // Hono's request URL is http://localhost (default port 80)
    const normalized = ['hawk.1.header', ts, nonce, method, path, host, port, '', '', ''].join(
      '\n',
    );
    const mac = createHmac('sha256', HAWK_VALID.key).update(normalized).digest('base64');
    const auth = `Hawk id="${HAWK_VALID.id}", ts="${ts}", nonce="${nonce}", mac="${mac}"`;
    const res = await fetchMock('/auth/hawk', { headers: { Authorization: auth } });
    expect(res.status).toBe(200);
  });
  it('rejects when MAC is wrong', async () => {
    const auth = `Hawk id="${HAWK_VALID.id}", ts="1", nonce="x", mac="bogus"`;
    expect((await fetchMock('/auth/hawk', { headers: { Authorization: auth } })).status).toBe(401);
  });
});

describe('auth — aws-sigv4', () => {
  it('rejects when no Authorization header', async () => {
    expect((await fetchMock('/auth/aws')).status).toBe(401);
  });
  it('accepts a correctly-signed SigV4 request', async () => {
    const dateStamp = '20260503';
    const amzDate = `${dateStamp}T120000Z`;
    const path = '/auth/aws';
    const method = 'GET';
    const headers: Record<string, string> = {
      host: 'localhost',
      'x-amz-date': amzDate,
    };
    const signedHeaders = Object.keys(headers).sort();
    const canonicalHeaders = signedHeaders.map((h) => `${h}:${headers[h]}`).join('\n');
    const bodyHash = createHash('sha256').update(new Uint8Array(0)).digest('hex');
    const canonicalRequest = [
      method,
      path,
      '',
      `${canonicalHeaders}\n`,
      signedHeaders.join(';'),
      bodyHash,
    ].join('\n');
    const credentialScope = `${dateStamp}/${SIGV4_VALID.region}/${SIGV4_VALID.service}/aws4_request`;
    const stringToSign = [
      'AWS4-HMAC-SHA256',
      amzDate,
      credentialScope,
      createHash('sha256').update(canonicalRequest).digest('hex'),
    ].join('\n');
    const kDate = createHmac('sha256', `AWS4${SIGV4_VALID.secret}`).update(dateStamp).digest();
    const kRegion = createHmac('sha256', kDate).update(SIGV4_VALID.region).digest();
    const kService = createHmac('sha256', kRegion).update(SIGV4_VALID.service).digest();
    const kSigning = createHmac('sha256', kService).update('aws4_request').digest();
    const signature = createHmac('sha256', kSigning).update(stringToSign).digest('hex');
    const authHeader = `AWS4-HMAC-SHA256 Credential=${SIGV4_VALID.accessKey}/${credentialScope}, SignedHeaders=${signedHeaders.join(';')}, Signature=${signature}`;
    const res = await fetchMock(path, { headers: { ...headers, Authorization: authHeader } });
    expect(res.status).toBe(200);
  });
});

describe('auth — jwt-bearer (HS256)', () => {
  function signHs256(payload: object): string {
    const header = { alg: 'HS256', typ: 'JWT' };
    const b64 = (o: object) =>
      Buffer.from(JSON.stringify(o))
        .toString('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');
    const hb = b64(header);
    const pb = b64(payload);
    const sig = createHmac('sha256', HS256_SECRET)
      .update(`${hb}.${pb}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    return `${hb}.${pb}.${sig}`;
  }

  it('accepts a valid HS256 token', async () => {
    const token = signHs256({ sub: 'user-1', iat: 1700000000 });
    const res = await fetchMock('/auth/jwt', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(200);
    const body = (await res.json()) as { alg: string; payload: { sub: string } };
    expect(body.alg).toBe('HS256');
    expect(body.payload.sub).toBe('user-1');
  });

  it('rejects an HS256 token signed with a different secret', async () => {
    const header = Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const payload = Buffer.from(JSON.stringify({ sub: 'x' }))
      .toString('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const sig = createHmac('sha256', 'wrong-secret')
      .update(`${header}.${payload}`)
      .digest('base64')
      .replace(/=/g, '')
      .replace(/\+/g, '-')
      .replace(/\//g, '_');
    const token = `${header}.${payload}.${sig}`;
    const res = await fetchMock('/auth/jwt', { headers: { Authorization: `Bearer ${token}` } });
    expect(res.status).toBe(401);
  });
});
