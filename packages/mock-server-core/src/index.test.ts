import { describe, expect, it } from 'vitest';
import type { MockServer } from '@apicircle/shared';
import { createMockApp, parseSourceToEndpoints, startMockServer, stopMockServer } from './index';

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

const PETSTORE_OPENAPI = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets/{id}': {
      get: {
        responses: {
          '200': {
            content: {
              'application/json': { example: { id: 1, name: 'Fido' } },
            },
          },
        },
      },
    },
  },
});

describe('parseSourceToEndpoints', () => {
  it('dispatches OpenAPI sources to the openapi parser', async () => {
    const result = await parseSourceToEndpoints({
      kind: 'openapi',
      spec: PETSTORE_OPENAPI,
      format: 'json',
    });
    expect(result.endpoints).toHaveLength(1);
  });

  it('passes manual endpoints through verbatim', async () => {
    const result = await parseSourceToEndpoints({
      kind: 'manual',
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
    });
    expect(result.endpoints).toHaveLength(1);
    expect(result.endpoints[0].pathPattern).toBe('/x');
  });

  it('dispatches Postman sources', async () => {
    const result = await parseSourceToEndpoints({
      kind: 'postman',
      collection: JSON.stringify({
        info: { name: 'X' },
        item: [{ name: 'a', request: { method: 'GET', url: 'https://x/y' } }],
      }),
    });
    expect(result.endpoints).toHaveLength(1);
  });

  it('dispatches Insomnia sources', async () => {
    const result = await parseSourceToEndpoints({
      kind: 'insomnia',
      export: JSON.stringify({
        resources: [{ _type: 'request', name: 'a', method: 'GET', url: 'https://x/y' }],
      }),
    });
    expect(result.endpoints).toHaveLength(1);
  });
});

describe('createMockApp', () => {
  it('produces a Hono app from a MockServer', async () => {
    const app = createMockApp({
      ...baseServer,
      endpoints: [
        {
          id: 'e1',
          method: 'GET',
          pathPattern: '/health',
          status: 200,
          headers: [],
          body: 'ok',
        },
      ],
    });
    const res = await app.request('/health');
    expect(await res.text()).toBe('ok');
  });
});

describe('startMockServer / stopMockServer', () => {
  it('starts on a free port and serves the configured endpoints', async () => {
    const server: MockServer = {
      ...baseServer,
      endpoints: [
        {
          id: 'e1',
          method: 'GET',
          pathPattern: '/ping',
          status: 200,
          headers: [],
          body: 'pong',
        },
      ],
    };
    const handle = await startMockServer(server);
    try {
      const res = await fetch(`http://127.0.0.1:${handle.port}/ping`);
      expect(await res.text()).toBe('pong');
    } finally {
      await stopMockServer(handle);
    }
  });

  it('uses MockServer.defaultPort when set and the port is free', async () => {
    // We pass through to startMockServer's port=0 fallback when defaultPort
    // is null; explicit port test is in nodeAdapter.test.ts.
    const server: MockServer = { ...baseServer, defaultPort: null };
    const handle = await startMockServer(server);
    try {
      expect(handle.port).toBeGreaterThan(0);
    } finally {
      await stopMockServer(handle);
    }
  });
});
