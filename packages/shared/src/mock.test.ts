import { describe, expect, it } from 'vitest';
import { coerceMockResponseBodyTypeForStatus, getAllowedMockResponseBodyTypes } from './mock';
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
            name: 'GET /pets/{id}',
            method: 'GET',
            pathPattern: '/pets/{id}',
            requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
            requestValidation: [],
            responseRules: [],
            defaultResponse: {
              status: 200,
              headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
              body: { type: 'json', content: '{}' },
            },
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
      name: 'Create pet',
      method: 'POST',
      pathPattern: '/pets',
      requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
      requestValidation: [],
      responseRules: [],
      defaultResponse: {
        status: 201,
        headers: [{ key: 'X-Trace', value: 'on', enabled: true }],
        body: { type: 'json', content: '{"id":1,"name":"Fido"}' },
        delayMs: 50,
      },
      example: 'created-pet',
    };
    const mock: MockServer = {
      id: 'm-1',
      name: 'Petstore',
      source: { kind: 'manual', endpoints: [endpoint] },
      endpoints: [endpoint],
      defaultPort: 4040,
      cors: { enabled: true, origins: ['http://localhost:5174'] },
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    };
    const round = JSON.parse(JSON.stringify(mock)) as MockServer;
    expect(round).toEqual(mock);
  });
});

describe('getAllowedMockResponseBodyTypes (Phase 2)', () => {
  it('200 supports every body type including binary (file responses)', () => {
    const allowed = getAllowedMockResponseBodyTypes(200);
    expect(allowed).toEqual(['none', 'json', 'text', 'xml', 'urlencoded', 'form-data', 'binary']);
  });

  it('201 / 202 / 206 (other 2xx) drop binary', () => {
    for (const status of [201, 202, 206]) {
      const allowed = getAllowedMockResponseBodyTypes(status);
      expect(allowed).toContain('json');
      expect(allowed).not.toContain('binary');
    }
  });

  it('204 / 205 / 304 forbid any body (RFC 7230 §3.3)', () => {
    for (const status of [204, 205, 304]) {
      expect(getAllowedMockResponseBodyTypes(status)).toEqual(['none']);
    }
  });

  it('1xx informational statuses also forbid bodies', () => {
    for (const status of [100, 101, 102, 103]) {
      expect(getAllowedMockResponseBodyTypes(status)).toEqual(['none']);
    }
  });

  it('4xx + 5xx allow text-y types but never binary', () => {
    for (const status of [400, 401, 403, 404, 500, 503]) {
      const allowed = getAllowedMockResponseBodyTypes(status);
      expect(allowed).toContain('json');
      expect(allowed).toContain('text');
      expect(allowed).not.toContain('binary');
    }
  });
});

describe('coerceMockResponseBodyTypeForStatus (Phase 2)', () => {
  it('returns null when the body type is already allowed', () => {
    expect(coerceMockResponseBodyTypeForStatus('json', 200)).toBeNull();
    expect(coerceMockResponseBodyTypeForStatus('binary', 200)).toBeNull();
    expect(coerceMockResponseBodyTypeForStatus('text', 404)).toBeNull();
    expect(coerceMockResponseBodyTypeForStatus('none', 204)).toBeNull();
  });

  it('coerces binary → json when moving away from 200', () => {
    expect(coerceMockResponseBodyTypeForStatus('binary', 404)).toBe('json');
    expect(coerceMockResponseBodyTypeForStatus('binary', 500)).toBe('json');
  });

  it('coerces any non-none body to none for no-body statuses', () => {
    for (const bodyType of ['json', 'text', 'xml', 'urlencoded', 'form-data', 'binary'] as const) {
      expect(coerceMockResponseBodyTypeForStatus(bodyType, 204)).toBe('none');
      expect(coerceMockResponseBodyTypeForStatus(bodyType, 304)).toBe('none');
    }
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
