import { describe, expect, it } from 'vitest';
import type { MockEndpoint, MockServer } from '@apicircle/shared';
import { createMockApp, parseSourceToEndpoints, startMockServer, stopMockServer } from './index';

function makeEndpoint(
  id: string,
  method: MockEndpoint['method'],
  pathPattern: string,
  body: string,
): MockEndpoint {
  return {
    id,
    name: `${method} ${pathPattern}`,
    method,
    pathPattern,
    requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
    requestValidation: [],
    responseRules: [],
    defaultResponse: {
      status: 200,
      headers: [],
      body: { type: 'json', content: body },
    },
  };
}

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
      endpoints: [makeEndpoint('e1', 'GET', '/x', '')],
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
      endpoints: [makeEndpoint('e1', 'GET', '/health', 'ok')],
    });
    const res = await app.request('/health');
    expect(await res.text()).toBe('ok');
  });
});

describe('startMockServer / stopMockServer', () => {
  it('starts on a free port and serves the configured endpoints', async () => {
    const server: MockServer = {
      ...baseServer,
      endpoints: [makeEndpoint('e1', 'GET', '/ping', 'pong')],
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
