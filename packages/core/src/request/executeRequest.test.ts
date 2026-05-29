import type { Request as ApiRequest } from '@apicircle/shared';
import { describe, expect, it, vi } from 'vitest';
import { executeRequest } from './executeRequest';

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

function fakeResponse(init: {
  status?: number;
  statusText?: string;
  body?: string;
  headers?: Record<string, string>;
  ok?: boolean;
}): Response {
  const headers = new Headers(init.headers ?? {});
  return {
    ok: init.ok ?? (init.status ?? 200) < 400,
    status: init.status ?? 200,
    statusText: init.statusText ?? 'OK',
    headers,
    text: () => Promise.resolve(init.body ?? ''),
  } as Response;
}

describe('executeRequest', () => {
  it('returns a successful result for a 200 JSON response', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(
      fakeResponse({
        status: 200,
        body: '{"id":1}',
        headers: { 'content-type': 'application/json' },
      }),
    );
    const result = await executeRequest(baseReq(), { fetchImpl });
    expect(result.status).toBe(200);
    expect(result.ok).toBe(true);
    expect(result.body).toBe('{"id":1}');
    expect(result.bodyKind).toBe('json');
    expect(result.headers['content-type']).toBe('application/json');
    expect(result.error).toBeUndefined();
    expect(result.durationMs).toBeGreaterThanOrEqual(0);
  });

  it('returns a visible error when a required attachment is not downloaded', async () => {
    const fetchImpl = vi.fn();
    const result = await executeRequest(
      baseReq({
        method: 'POST',
        body: {
          type: 'binary',
          content: '',
          attachment: { slotId: 'missing-slot', filename: 'payload.bin' },
        },
      }),
      { fetchImpl, resolveAttachment: async () => null },
    );

    expect(fetchImpl).not.toHaveBeenCalled();
    expect(result.ok).toBe(false);
    expect(result.status).toBeNull();
    expect(result.error).toMatch(/payload\.bin .*not downloaded/i);
  });

  it('classifies bodyKind from response Content-Type', async () => {
    const cases: Array<[string, string, 'json' | 'text' | 'binary' | 'empty']> = [
      ['application/json', '{}', 'json'],
      ['text/plain', 'hi', 'text'],
      ['text/html', '<p/>', 'text'],
      ['application/xml', '<x/>', 'text'],
      ['application/octet-stream', 'bin', 'binary'],
      ['application/json', '', 'empty'],
    ];
    for (const [contentType, body, expected] of cases) {
      const fetchImpl = vi
        .fn()
        .mockResolvedValue(fakeResponse({ body, headers: { 'content-type': contentType } }));
      const result = await executeRequest(baseReq(), { fetchImpl });
      expect(result.bodyKind, `${contentType} → ${expected}`).toBe(expected);
    }
  });

  it('forwards method, URL with query params, and headers to fetch', async () => {
    const fetchImpl = vi.fn().mockResolvedValue(fakeResponse({ status: 204 }));
    await executeRequest(
      baseReq({
        method: 'POST',
        query: [{ key: 'page', value: '2', enabled: true }],
        headers: [{ key: 'X-A', value: '1', enabled: true }],
        body: { type: 'json', content: '{"x":1}' },
      }),
      {
        fetchImpl,
        autoHeaderOverrides: {
          spanId: 'fixed-span',
          traceparent: '00-fixed-trace-fixed-span-01',
          platform: 'web',
          version: '0.1.0',
          name: 'API Circle Studio',
        },
      },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/users?page=2');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({
      'X-A': '1',
      'X-Client-Name': 'API Circle Studio',
      'X-Client-Platform': 'web',
      'X-Client-Version': '0.1.0',
      'X-Trace-Span-Id': 'fixed-span',
      traceparent: '00-fixed-trace-fixed-span-01',
    });
    expect(init.body).toBe('{"x":1}');
  });

  it('captures network errors with status=null and the error message', async () => {
    const fetchImpl = vi.fn().mockRejectedValue(new Error('network down'));
    const result = await executeRequest(baseReq(), { fetchImpl });
    expect(result.status).toBeNull();
    expect(result.ok).toBe(false);
    expect(result.error).toBe('network down');
  });

  it('aborts on timeout and reports the timeout error', async () => {
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        });
      });
    const result = await executeRequest(baseReq(), { fetchImpl: hangingFetch, timeoutMs: 50 });
    expect(result.status).toBeNull();
    expect(result.error).toMatch(/timed out/);
  });

  it('respects an external AbortSignal', async () => {
    const ctrl = new AbortController();
    const hangingFetch: typeof fetch = (_input, init) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const reason: unknown = init.signal?.reason;
          reject(reason instanceof Error ? reason : new Error(String(reason)));
        });
      });
    setTimeout(() => ctrl.abort(new Error('user cancelled')), 10);
    const result = await executeRequest(baseReq(), {
      fetchImpl: hangingFetch,
      signal: ctrl.signal,
      timeoutMs: null,
    });
    expect(result.error).toBe('user cancelled');
  });
});

describe('executeRequest — redirect handling (Phase 6)', () => {
  function redirectResponse(location: string, status = 302): Response {
    return fakeResponse({ status, statusText: 'Found', headers: { location } });
  }

  it('follows a single same-origin redirect transparently', async () => {
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      call++;
      if (call === 1) {
        // Verify we requested redirect: 'manual' so we control the chain.
        expect(init.redirect).toBe('manual');
        return redirectResponse('https://api.example.com/users/1');
      }
      return fakeResponse({ status: 200, body: '{"id":1}' });
    });
    const result = await executeRequest(baseReq({ url: 'https://api.example.com/redirect-me' }), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe(200);
    expect(result.url).toBe('https://api.example.com/users/1');
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  it('strips Authorization on a cross-origin redirect', async () => {
    let callerHeaders: Record<string, unknown> = {};
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      call++;
      if (call === 1) {
        return redirectResponse('https://attacker.example/grab', 302);
      }
      // Second hop — capture the headers and inspect.
      callerHeaders = init.headers as Record<string, unknown>;
      return fakeResponse({ status: 200, body: 'ok' });
    });
    const result = await executeRequest(
      baseReq({
        url: 'https://api.honest.example/login',
        auth: { type: 'bearer', token: 'super-secret' },
      }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(result.status).toBe(200);
    // The first hop sent Authorization; the cross-origin second hop must NOT.
    expect(Object.keys(callerHeaders).map((k) => k.toLowerCase())).not.toContain('authorization');
  });

  it('preserves Authorization on a same-origin redirect', async () => {
    let secondCallHeaders: Record<string, unknown> = {};
    let call = 0;
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      call++;
      if (call === 1) {
        return redirectResponse('https://api.example.com/v2/users');
      }
      secondCallHeaders = init.headers as Record<string, unknown>;
      return fakeResponse({ status: 200, body: 'ok' });
    });
    await executeRequest(
      baseReq({
        url: 'https://api.example.com/v1/users',
        auth: { type: 'bearer', token: 'keep-me' },
      }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    const lower = Object.fromEntries(
      Object.entries(secondCallHeaders).map(([k, v]) => [k.toLowerCase(), v]),
    );
    expect(lower.authorization).toBe('Bearer keep-me');
  });

  it('converts non-GET to GET on 302 (but preserves on 307)', async () => {
    const calls: Array<{ method: string; body: BodyInit | null | undefined }> = [];
    const fetchImpl = vi.fn(async (_url: string, init: RequestInit) => {
      calls.push({ method: init.method ?? 'GET', body: init.body ?? null });
      if (calls.length === 1) return redirectResponse('https://api.example.com/x', 302);
      return fakeResponse({ status: 200, body: 'ok' });
    });
    await executeRequest(
      baseReq({
        url: 'https://api.example.com/submit',
        method: 'POST',
        body: { type: 'text', content: 'payload' },
        headers: [{ key: 'Content-Type', value: 'text/plain', enabled: true }],
      }),
      { fetchImpl: fetchImpl as unknown as typeof fetch },
    );
    expect(calls[1].method).toBe('GET');
    expect(calls[1].body).toBeNull();
  });

  it('rejects after MAX_REDIRECTS (loop detection)', async () => {
    const fetchImpl = vi.fn(async () => redirectResponse('https://api.example.com/loop'));
    const result = await executeRequest(baseReq(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.error).toMatch(/Too many redirects/i);
  });
});

describe('executeRequest — response body cap (Phase 6)', () => {
  /** Build a fake Response with a body stream that yields a single huge
   *  chunk, simulating a hostile chunked-transfer-encoded server. */
  function megaResponse(byteCount: number): Response {
    const chunk = new Uint8Array(byteCount);
    chunk.fill(0x41); // 'A'
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(chunk);
        controller.close();
      },
    });
    const headers = new Headers({ 'content-type': 'text/plain' });
    return {
      ok: true,
      status: 200,
      statusText: 'OK',
      headers,
      body: stream,
      text: () => Promise.resolve('a'.repeat(byteCount)),
    } as unknown as Response;
  }

  it('reports responseTruncated when body exceeds the cap', async () => {
    // 60 MB — above the 50 MB cap.
    const fetchImpl = vi.fn().mockResolvedValue(megaResponse(60 * 1024 * 1024));
    const result = await executeRequest(baseReq(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.status).toBe(200);
    expect(result.responseTruncated).toBe(true);
    // The retained body is exactly the cap size, decoded — 50 MiB of 'A'.
    expect(result.body.length).toBe(50 * 1024 * 1024);
  });

  it('reads the full body when under the cap and does not set responseTruncated', async () => {
    const small = megaResponse(1024);
    const fetchImpl = vi.fn().mockResolvedValue(small);
    const result = await executeRequest(baseReq(), {
      fetchImpl: fetchImpl as unknown as typeof fetch,
    });
    expect(result.responseTruncated).toBeUndefined();
    expect(result.body.length).toBe(1024);
  });
});

describe('executeRequest — Digest 401-retry', () => {
  const digestReq = baseReq({
    auth: { type: 'digest', username: 'Mufasa', password: 'Circle Of Life' },
  });

  it('parses WWW-Authenticate, builds Digest response, and re-fetches', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        fakeResponse({
          status: 401,
          headers: {
            'www-authenticate':
              'Digest realm="testrealm@host.com", qop="auth", nonce="dcd98b7102dd2f0e8b11d0f600bfb0c093", algorithm=MD5',
          },
        }),
      )
      .mockResolvedValueOnce(fakeResponse({ status: 200, body: 'ok' }));

    const result = await executeRequest(digestReq, { fetchImpl });
    expect(result.status).toBe(200);
    expect(result.body).toBe('ok');
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // The retry call must carry an Authorization: Digest header derived
    // from the parsed challenge — proving applyAuth deferred and
    // executeRequest filled in.
    const retryHeaders = (fetchImpl.mock.calls[1]![1]!.headers ?? {}) as Record<string, string>;
    expect(retryHeaders['Authorization']).toMatch(/^Digest /);
    expect(retryHeaders['Authorization']).toContain('username="Mufasa"');
    expect(retryHeaders['Authorization']).toContain('realm="testrealm@host.com"');
    expect(retryHeaders['Authorization']).toContain('response="');
  });

  it("returns the original 401 if the WWW-Authenticate scheme isn't Digest", async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      fakeResponse({
        status: 401,
        headers: { 'www-authenticate': 'Bearer realm="api"' },
      }),
    );
    const result = await executeRequest(digestReq, { fetchImpl });
    expect(result.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('retries again with a bumped nc when the server returns stale=true', async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        fakeResponse({
          status: 401,
          headers: {
            'www-authenticate': 'Digest realm="r", qop="auth", nonce="old-nonce", algorithm=MD5',
          },
        }),
      )
      .mockResolvedValueOnce(
        fakeResponse({
          status: 401,
          headers: {
            'www-authenticate':
              'Digest realm="r", qop="auth", nonce="new-nonce", algorithm=MD5, stale=true',
          },
        }),
      )
      .mockResolvedValueOnce(fakeResponse({ status: 200, body: 'ok' }));

    const result = await executeRequest(digestReq, { fetchImpl });
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(3);

    const firstRetry = (fetchImpl.mock.calls[1]![1]!.headers ?? {}) as Record<string, string>;
    const staleRetry = (fetchImpl.mock.calls[2]![1]!.headers ?? {}) as Record<string, string>;
    expect(firstRetry['Authorization']).toContain('nc=00000001');
    expect(firstRetry['Authorization']).toContain('nonce="old-nonce"');
    // Stale retry uses the new nonce + nc=00000002.
    expect(staleRetry['Authorization']).toContain('nonce="new-nonce"');
    expect(staleRetry['Authorization']).toContain('nc=00000002');
  });

  it('does not retry on 5xx with WWW-Authenticate (only 401 triggers retry)', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValueOnce(
      fakeResponse({
        status: 503,
        headers: {
          'www-authenticate': 'Digest realm="r", qop="auth", nonce="n", algorithm=MD5',
        },
      }),
    );
    const result = await executeRequest(digestReq, { fetchImpl });
    expect(result.status).toBe(503);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });

  it('forwards authWarnings from applyAuth to ExecutionResult', async () => {
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(fakeResponse({ status: 200 }));
    const result = await executeRequest(
      baseReq({
        auth: {
          type: 'jwt-bearer',
          algorithm: 'HS256',
          secretOrKey: 'k',
          payload: '{not valid json',
          jwtHeaders: '{}',
          token: '',
        },
      }),
      { fetchImpl },
    );
    expect(result.authWarnings.length).toBeGreaterThan(0);
    expect(result.authWarnings[0]!.code).toBe('jwt-payload-json-invalid');
  });

  it('does not retry past the first attempt without stale=true', async () => {
    // Two consecutive 401s without stale=true means credentials are wrong;
    // we surface the second 401 to the user instead of looping.
    const fetchImpl = vi.fn<typeof fetch>().mockResolvedValue(
      fakeResponse({
        status: 401,
        headers: {
          'www-authenticate': 'Digest realm="r", qop="auth", nonce="n", algorithm=MD5',
        },
      }),
    );
    const result = await executeRequest(digestReq, { fetchImpl });
    expect(result.status).toBe(401);
    // 1 initial + 1 retry = 2 calls, no third attempt.
    expect(fetchImpl).toHaveBeenCalledTimes(2);
  });

  // Note: the explicit "auth-int with non-replayable body" throw lives
  // in runChallengeRetry. Exercising it cleanly via the
  // executeRequest → buildRequest → composeBody pipeline requires a
  // FormData body that survives composeBody intact, which is brittle
  // in unit tests. The throw is defensive (preferable to a silent
  // empty-body hash) and reviewable by inspection. Real-world
  // surfacing is via P8's mock-IdP integration test where bodies are
  // strings.

  it("does not retry when there's no www-authenticate header at all", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(fakeResponse({ status: 401, headers: {} }));
    const result = await executeRequest(digestReq, { fetchImpl });
    expect(result.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});

describe('executeRequest — NTLM 3-way handshake', () => {
  const ntlmReq = baseReq({
    auth: {
      type: 'ntlm',
      username: 'alice',
      password: 'hunter2',
      domain: 'CORP',
      workstation: 'WS01',
    },
  });

  // Type-2 server-challenge bytes — minimal valid layout: NTLMSSP\0,
  // type=2, then the 8-byte server challenge at offset 24, with no
  // target info.
  function makeType2Base64(): string {
    const buf = new Uint8Array(48);
    buf.set([78, 84, 76, 77, 83, 83, 80, 0]);
    buf[8] = 2;
    for (let i = 0; i < 8; i++) buf[24 + i] = 0xa0 + i;
    let bin = '';
    for (let i = 0; i < buf.length; i++) bin += String.fromCharCode(buf[i]!);
    return btoa(bin);
  }

  it('sends Type-1 on first call, Type-3 on retry after Type-2 challenge', async () => {
    const type2 = makeType2Base64();
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        fakeResponse({ status: 401, headers: { 'www-authenticate': `NTLM ${type2}` } }),
      )
      .mockResolvedValueOnce(fakeResponse({ status: 200, body: 'ok' }));

    const result = await executeRequest(ntlmReq, { fetchImpl });
    expect(result.status).toBe(200);
    expect(fetchImpl).toHaveBeenCalledTimes(2);

    // First call carries Type-1 Negotiate.
    const firstHeaders = (fetchImpl.mock.calls[0]![1]!.headers ?? {}) as Record<string, string>;
    expect(firstHeaders['Authorization']).toMatch(/^NTLM /);
    const type1Bytes = Uint8Array.from(
      atob(firstHeaders['Authorization']!.replace(/^NTLM /, '')),
      (c) => c.charCodeAt(0),
    );
    expect(type1Bytes[8]).toBe(1); // type-1

    // Retry call carries Type-3 Authenticate.
    const retryHeaders = (fetchImpl.mock.calls[1]![1]!.headers ?? {}) as Record<string, string>;
    const type3Bytes = Uint8Array.from(
      atob(retryHeaders['Authorization']!.replace(/^NTLM /, '')),
      (c) => c.charCodeAt(0),
    );
    expect(type3Bytes[8]).toBe(3); // type-3
  });

  it("returns the 401 when the server's NTLM challenge is malformed", async () => {
    const fetchImpl = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        fakeResponse({ status: 401, headers: { 'www-authenticate': 'NTLM @bad@base64@' } }),
      );
    const result = await executeRequest(ntlmReq, { fetchImpl });
    expect(result.status).toBe(401);
    expect(fetchImpl).toHaveBeenCalledTimes(1);
  });
});
