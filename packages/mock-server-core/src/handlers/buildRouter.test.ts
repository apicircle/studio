import { describe, expect, it, vi } from 'vitest';
import type { MockServer } from '@apicircle/shared';
import { buildRouter, openApiPathToHono } from './buildRouter';

const baseServer: MockServer = {
  id: 'm-1',
  name: 'Test',
  source: { kind: 'manual', endpoints: [] },
  endpoints: [],
  overrides: {},
  defaultPort: null,
  cors: { enabled: false, origins: [] },
  createdAt: 't',
  updatedAt: 't',
};

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
        {
          id: 'e1',
          method: 'GET',
          pathPattern: '/health',
          status: 200,
          headers: [{ key: 'Content-Type', value: 'application/json' }],
          body: '{"status":"ok"}',
        },
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
      endpoints: [
        {
          id: 'e1',
          method: 'GET',
          pathPattern: '/pets/{id}',
          status: 200,
          headers: [],
          body: '{"id":"echo"}',
        },
      ],
    });
    const res = await app.request('/pets/42');
    expect(res.status).toBe(200);
    expect(await res.text()).toBe('{"id":"echo"}');
  });

  it('serves overrides on top of source endpoints', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [
        {
          id: 'e1',
          method: 'GET',
          pathPattern: '/pets/{id}',
          status: 200,
          headers: [],
          body: '{"id":"original"}',
        },
      ],
      overrides: {
        e1: { status: 503, body: '{"error":"down"}' },
      },
    });
    const res = await app.request('/pets/42');
    expect(res.status).toBe(503);
    expect(await res.text()).toBe('{"error":"down"}');
  });

  it('prefers literal routes over parameterised ones', async () => {
    const app = buildRouter({
      ...baseServer,
      endpoints: [
        {
          id: 'param',
          method: 'GET',
          pathPattern: '/pets/{id}',
          status: 200,
          headers: [],
          body: 'param',
        },
        {
          id: 'literal',
          method: 'GET',
          pathPattern: '/pets/special',
          status: 200,
          headers: [],
          body: 'literal',
        },
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
      endpoints: [
        {
          id: 'e1',
          method: 'GET',
          pathPattern: '/slow',
          status: 200,
          headers: [],
          body: 'ok',
          delayMs: 1,
        },
      ],
    });
    const res = await app.request('/slow');
    expect(res.status).toBe(200);
  });

  it('calls onRequest with endpoint metadata', async () => {
    const onRequest = vi.fn();
    const app = buildRouter(
      {
        ...baseServer,
        endpoints: [
          {
            id: 'e1',
            method: 'GET',
            pathPattern: '/x',
            status: 200,
            headers: [],
            body: '',
          },
        ],
      },
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
        endpoints: [
          {
            id: `e-${method}`,
            method,
            pathPattern: '/ping',
            status: 200,
            headers: [],
            body: method,
          },
        ],
      });
      const res = await app.request('/ping', { method });
      expect(await res.text()).toBe(method);
    }
  });
});
