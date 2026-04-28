import { describe, expect, it } from 'vitest';
import type { MockEndpoint, MockServer, MockServerSource, MockRuntime } from './mock';

describe('MockServerSource discriminator', () => {
  it('narrows on `kind` so each variant carries the right payload', () => {
    const sources: MockServerSource[] = [
      { kind: 'openapi', spec: '{}', format: 'json' },
      { kind: 'openapi', spec: 'paths: {}\n', format: 'yaml' },
      { kind: 'postman', collection: '{"info":{}}' },
      { kind: 'insomnia', export: '{"resources":[]}' },
      {
        kind: 'manual',
        endpoints: [
          {
            id: 'e1',
            method: 'GET',
            pathPattern: '/pets/{id}',
            status: 200,
            headers: [],
            body: '{}',
          },
        ],
      },
    ];
    for (const s of sources) {
      switch (s.kind) {
        case 'openapi':
          expect(s.spec).toBeDefined();
          expect(['json', 'yaml']).toContain(s.format);
          break;
        case 'postman':
          expect(s.collection).toBeDefined();
          break;
        case 'insomnia':
          expect(s.export).toBeDefined();
          break;
        case 'manual':
          expect(Array.isArray(s.endpoints)).toBe(true);
          break;
      }
    }
  });
});

describe('MockServer round-trips through JSON', () => {
  it('preserves all fields when serialized + parsed', () => {
    const endpoint: MockEndpoint = {
      id: 'e-1',
      method: 'POST',
      pathPattern: '/pets',
      status: 201,
      headers: [{ key: 'X-Trace', value: 'on' }],
      body: '{"id":1,"name":"Fido"}',
      delayMs: 50,
      example: 'created-pet',
    };
    const mock: MockServer = {
      id: 'm-1',
      name: 'Petstore',
      source: { kind: 'manual', endpoints: [endpoint] },
      endpoints: [endpoint],
      overrides: {
        'e-1': { status: 503, body: 'Service Unavailable' },
      },
      defaultPort: 4040,
      cors: { enabled: true, origins: ['http://localhost:5174'] },
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    };
    const round = JSON.parse(JSON.stringify(mock)) as MockServer;
    expect(round).toEqual(mock);
  });
});

describe('MockRuntime', () => {
  it('keys runtime entries by mockServerId', () => {
    const rt: MockRuntime = {
      active: {
        'm-1': {
          port: 4040,
          pid: 12345,
          startedAt: '2026-04-27T00:00:00.000Z',
          lastError: null,
          requestCount: 7,
        },
      },
    };
    expect(rt.active['m-1']?.port).toBe(4040);
    expect(rt.active['m-2']).toBeUndefined();
  });
});
