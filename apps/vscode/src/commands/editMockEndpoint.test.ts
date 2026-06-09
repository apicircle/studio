import { describe, it, expect } from 'vitest';
import { applyFormStateToMock } from './editMockEndpoint';
import type { MockServer } from '@apicircle/shared';

function makeMock(): MockServer {
  return {
    id: 'm-1',
    name: 'Test Mock',
    source: { kind: 'manual', endpoints: [] },
    endpoints: [
      {
        id: 'ep-1',
        name: 'Original',
        method: 'GET',
        pathPattern: '/users',
        requestSchema: {
          contentType: 'application/json',
          query: [],
          headers: [],
          pathParams: [],
        },
        requestValidation: [],
        responseRules: [
          {
            id: 'rule-1',
            name: 'odd-user',
            when: [{ kind: 'pathParam', key: 'id', op: 'matches', value: '^[13579]$' }],
            response: { status: 418, headers: [], body: { type: 'text', content: 'odd' } },
          },
        ],
        defaultResponse: {
          status: 200,
          headers: [{ key: 'X-Original', value: 'preserved', enabled: true }],
          body: { type: 'json', content: '{"original":true}' },
          delayMs: 50,
        },
      },
    ],
    runtime: 'desktop-bridge',
    port: null,
    spec: null,
    overrides: { perEndpointResponses: {} },
    createdAt: '',
    updatedAt: '',
  } as unknown as MockServer;
}

describe('applyFormStateToMock', () => {
  it('returns error when endpointId no longer exists', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ghost',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'none',
      bodyContent: '',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('ghost');
    }
  });

  it('preserves response rules, headers, delayMs when editor saves', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'POST',
      pathPattern: '/users/{id}',
      status: 201,
      bodyType: 'json',
      bodyContent: '{"created":true}',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      const ep = result.next.endpoints[0];
      expect(ep.method).toBe('POST');
      expect(ep.pathPattern).toBe('/users/{id}');
      expect(ep.defaultResponse.status).toBe(201);
      expect(ep.defaultResponse.body).toEqual({ type: 'json', content: '{"created":true}' });
      // Preserved fields:
      expect(ep.defaultResponse.headers).toEqual([
        { key: 'X-Original', value: 'preserved', enabled: true },
      ]);
      expect(ep.defaultResponse.delayMs).toBe(50);
      expect(ep.responseRules).toHaveLength(1);
      expect(ep.responseRules[0].id).toBe('rule-1');
    }
  });

  it('rejects malformed JSON in the body when bodyType is json', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'json',
      bodyContent: '{not json',
    });
    expect(result.ok).toBe(false);
    if (!result.ok) {
      expect(result.error).toContain('does not parse');
    }
  });

  it('accepts an empty body when bodyType is json (caller may clear)', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'json',
      bodyContent: '',
    });
    expect(result.ok).toBe(true);
  });

  it('switches bodyType from json to none cleanly', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'none',
      bodyContent: '',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.endpoints[0].defaultResponse.body).toEqual({
        type: 'none',
        content: '',
      });
    }
  });

  it('switches bodyType to xml', () => {
    const result = applyFormStateToMock(makeMock(), {
      endpointId: 'ep-1',
      method: 'GET',
      pathPattern: '/x',
      status: 200,
      bodyType: 'xml',
      bodyContent: '<ok/>',
    });
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.next.endpoints[0].defaultResponse.body).toEqual({
        type: 'xml',
        content: '<ok/>',
      });
    }
  });
});
