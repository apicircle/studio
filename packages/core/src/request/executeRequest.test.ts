import type { Request as ApiRequest } from '@apicircle-v2/shared';
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
  contextVars: [],
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
      { fetchImpl },
    );
    expect(fetchImpl).toHaveBeenCalledOnce();
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe('https://api.example.com/users?page=2');
    expect(init.method).toBe('POST');
    expect(init.headers).toEqual({ 'X-A': '1' });
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
