import { describe, expect, it, vi } from 'vitest';
import type { MockEndpoint, MockResponseConfig, MockServer } from '@apicircle/shared';
import { buildRouter, openApiPathToHono } from './buildRouter';

const baseServer: MockServer = {
  id: 'm-1',
  name: 'Test',
  source: { kind: 'manual', endpoints: [] },
  endpoints: [],
  defaultPort: null,
  cors: { enabled: false, origins: [] },
  createdAt: 't',
  updatedAt: 't',
};

interface ResponseShape {
  status?: number;
  headers?: Array<{ key: string; value: string; enabled?: boolean }>;
  body?: string;
  delayMs?: number;
}

function makeEndpoint(
  id: string,
  method: MockEndpoint['method'],
  pathPattern: string,
  response: ResponseShape = {},
): MockEndpoint {
  return {
    id,
    name: `${method} ${pathPattern}`,
    method,
    pathPattern,
    requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
    requestValidation: [],
    responseRules: [],
    defaultResponse: makeResponse(response),
  };
}

function makeResponse(response: ResponseShape): MockResponseConfig {
  const status = response.status ?? 200;
  const headers = (response.headers ?? []).map((h) => ({
    key: h.key,
    value: h.value,
    enabled: h.enabled ?? true,
  }));
  const body = response.body ?? '';
  return {
    status,
    headers,
    body: { type: 'json', content: body },
    ...(response.delayMs !== undefined ? { delayMs: response.delayMs } : {}),
  };
}

describe('openApiPathToHono', () => {
  it('translates {param} to :param', () => {
    expect(openApiPathToHono('/pets/{id}')).toBe('/pets/:id');
    expect(openApiPathToHono('/users/{userId}/items/{itemId}')).toBe(
      '/users/:userId/items/:itemId',
    );
  });

  it('returns literal paths unchanged', () => {
    expect(openApiPathToHono('/health')).toBe('/health');
  });
});

describe('buildRouter', () => {
  it('matches a literal path and returns the configured body + status + headers', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [
        makeEndpoint('e1', 'GET', '/health', {
          headers: [{ key: 'Content-Type', value: 'application/json' }],
          body: '{"status":"ok"}',
        }),
      ],
    });
    const res = await app.request('/health');
    expect(res.status).toBe(200);
    expect(res.headers.get('content-type')).toBe('application/json');
    expect(await res.text()).toBe('{"status":"ok"}');
  });

  it('matches a path-templated route', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [makeEndpoint('e1', 'GET', '/pets/{id}', { body: '{"id":"echo"}' })],
    });
    const res = await app.request('/pets/42');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"id":"echo"}');
  });

  it('runs response rules ahead of the default response', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [
        {
          ...makeEndpoint('e1', 'GET', '/pets/{id}', { body: '{"id":"original"}' }),
          responseRules: [
            {
              id: 'r1',
              name: 'down for maintenance',
              enabled: true,
              when: [{ id: 'c1', scope: 'query', target: 'mode', op: 'equals', value: 'down' }],
              response: makeResponse({ status: 503, body: '{"error":"down"}' }),
            },
          ],
        },
      ],
    });
    const matched = await app.request('/pets/42?mode=down');
    expect(matched.status).toBe(503);
    expect(await matched.text()).toBe('{"error":"down"}');
    const fallthrough = await app.request('/pets/42');
    expect(fallthrough.status).toBe(200);
    expect(await fallthrough.text()).toBe('{"id":"original"}');
  });

  it('returns the first failing validation rule response', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [
        {
          ...makeEndpoint('e1', 'GET', '/secure', { body: 'ok' }),
          requestValidation: [
            {
              id: 'v1',
              kind: 'header-required',
              target: 'authorization',
              enabled: true,
              failResponse: makeResponse({ status: 401, body: '{"error":"unauthorized"}' }),
            },
          ],
        },
      ],
    });
    const denied = await app.request('/secure');
    expect(denied.status).toBe(401);
    const allowed = await app.request('/secure', {
      headers: { authorization: 'Bearer x' },
    });
    expect(allowed.status).toBe(200);
  });

  it('skips disabled validation rules', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [
        {
          ...makeEndpoint('e1', 'GET', '/secure', { body: 'ok' }),
          requestValidation: [
            {
              id: 'v1',
              kind: 'header-required',
              target: 'authorization',
              enabled: false,
              failResponse: makeResponse({ status: 401, body: '{"error":"u"}' }),
            },
          ],
        },
      ],
    });
    const res = await app.request('/secure');
    expect(res.status).toBe(200);
  });

  it('prefers literal routes over parameterised ones', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [
        makeEndpoint('param', 'GET', '/pets/{id}', { body: 'param' }),
        makeEndpoint('literal', 'GET', '/pets/special', { body: 'literal' }),
      ],
    });
    const literal = await app.request('/pets/special');
    expect(await literal.text()).toBe('literal');
    const param = await app.request('/pets/abc');
    expect(await param.text()).toBe('param');
  });

  it('returns 404 JSON for unknown paths', async () => {
    const app = buildRouter(baseServer);
    const res = await app.request('/missing');
    expect(res.status).toBe(404);
    const body = (await res.json()) as { error: string; method: string; path: string };
    expect(body.error).toMatch(/no mock endpoint matches/i);
    expect(body.method).toBe('GET');
    expect(body.path).toBe('/missing');
  });

  it('honors per-endpoint delay (smoke test, not timing-dependent)', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [makeEndpoint('e1', 'GET', '/slow', { body: 'ok', delayMs: 1 })],
    });
    const res = await app.request('/slow');
    expect(res.status).toBe(200);
  });

  it('calls onRequest with endpoint metadata', async () => {
    const onRequest = vi.fn();
    const app = buildRouter(
      { ...baseServer, endpoints: [makeEndpoint('e1', 'GET', '/x', { body: '' })] },
      { onRequest },
    );
    await app.request('/x');
    expect(onRequest).toHaveBeenCalledWith({
      endpointId: 'e1',
      method: 'GET',
      path: '/x',
    });
  });

  it('handles all supported HTTP methods', async () => {
    const methods = ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'] as const;
    for (const method of methods) {
      const app = buildRouter({
        ...baseServer,
        endpoints: [makeEndpoint(`e-${method}`, method, '/ping', { body: method })],
      });
      const res = await app.request('/ping', { method });
      expect(await res.text()).toBe(method);
    }
  });
});
