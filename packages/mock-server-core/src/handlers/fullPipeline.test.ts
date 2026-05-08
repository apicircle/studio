// End-to-end integration test for the full mock pipeline:
//   request → validation → response rules → multipliers → respond
//
// Boots the Hono app in-process (no real port) so we can curl-style
// hit endpoints and inspect the resulting Response. Confirms every
// stage from validation through multipliers actually fires together
// and produces the configured payload.

import { describe, expect, it } from 'vitest';
import type { MockEndpoint, MockResponseConfig, MockServer } from '@apicircle/shared';
import { buildRouter } from './buildRouter';

const baseServer = (endpoints: MockEndpoint[]): MockServer => ({
  id: 'm1',
  name: 'Test',
  source: { kind: 'manual', endpoints },
  endpoints,
  defaultPort: null,
  cors: { enabled: false, origins: [] },
  createdAt: 't',
  updatedAt: 't',
});

const jsonResponse = (status: number, payload: unknown): MockResponseConfig => ({
  status,
  headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
  body: { type: 'json', content: JSON.stringify(payload) },
});

describe('full pipeline — validation + response rules + multipliers', () => {
  it('returns the validation fail response when a required header is missing', async () => {
    const endpoint: MockEndpoint = {
      id: 'e1',
      name: 'GET /secure',
      method: 'GET',
      pathPattern: '/secure',
      requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
      requestValidation: [
        {
          id: 'v1',
          kind: 'header-required',
          target: 'authorization',
          enabled: true,
          failResponse: jsonResponse(401, { error: 'unauthorized' }),
        },
      ],
      responseRules: [],
      defaultResponse: jsonResponse(200, { ok: true }),
    };
    const app = buildRouter(baseServer([endpoint]));
    const denied = await app.request('/secure');
    expect(denied.status).toBe(401);
    expect(await denied.json()).toEqual({ error: 'unauthorized' });
  });

  it('skips validation rules that are disabled', async () => {
    const endpoint: MockEndpoint = {
      id: 'e1',
      name: 'GET /secure',
      method: 'GET',
      pathPattern: '/secure',
      requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
      requestValidation: [
        {
          id: 'v1',
          kind: 'header-required',
          target: 'authorization',
          enabled: false,
          failResponse: jsonResponse(401, { error: 'unauthorized' }),
        },
      ],
      responseRules: [],
      defaultResponse: jsonResponse(200, { ok: true }),
    };
    const app = buildRouter(baseServer([endpoint]));
    const allowed = await app.request('/secure');
    expect(allowed.status).toBe(200);
    expect(await allowed.json()).toEqual({ ok: true });
  });

  it('matches the first response rule whose clauses all hit', async () => {
    const endpoint: MockEndpoint = {
      id: 'e1',
      name: 'GET /pets',
      method: 'GET',
      pathPattern: '/pets',
      requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
      requestValidation: [],
      responseRules: [
        {
          id: 'r1',
          name: 'admins see admin payload',
          enabled: true,
          when: [{ id: 'c1', scope: 'header', target: 'X-Role', op: 'equals', value: 'admin' }],
          response: jsonResponse(200, { admin: true }),
        },
      ],
      defaultResponse: jsonResponse(200, { admin: false }),
    };
    const app = buildRouter(baseServer([endpoint]));
    const asAdmin = await app.request('/pets', { headers: { 'x-role': 'admin' } });
    expect(await asAdmin.json()).toEqual({ admin: true });
    const asUser = await app.request('/pets', { headers: { 'x-role': 'user' } });
    expect(await asUser.json()).toEqual({ admin: false });
  });

  it('expands the multiplier-targeted array to the requested page size', async () => {
    const endpoint: MockEndpoint = {
      id: 'e1',
      name: 'GET /items',
      method: 'GET',
      pathPattern: '/items',
      requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
      requestValidation: [],
      responseRules: [],
      defaultResponse: {
        ...jsonResponse(200, { items: [{ id: 1, name: 'X' }] }),
        multipliers: [
          {
            id: 'm1',
            source: { kind: 'query', key: 'pageSize' },
            targetJsonPath: '$.items',
            defaultCount: 2,
            min: 1,
            max: 10,
          },
        ],
      },
    };
    const app = buildRouter(baseServer([endpoint]));
    const five = await app.request('/items?pageSize=5');
    const fiveBody = (await five.json()) as { items: unknown[] };
    expect(fiveBody.items).toHaveLength(5);
    expect(fiveBody.items[0]).toEqual({ id: 1, name: 'X' });

    const fallback = await app.request('/items');
    const fallbackBody = (await fallback.json()) as { items: unknown[] };
    expect(fallbackBody.items).toHaveLength(2);

    const clamped = await app.request('/items?pageSize=999');
    const clampedBody = (await clamped.json()) as { items: unknown[] };
    expect(clampedBody.items).toHaveLength(10);
  });

  it('runs validation → response rules → multipliers in order on a single request', async () => {
    const endpoint: MockEndpoint = {
      id: 'e1',
      name: 'GET /pets',
      method: 'GET',
      pathPattern: '/pets',
      requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
      requestValidation: [
        {
          id: 'v1',
          kind: 'header-required',
          target: 'authorization',
          enabled: true,
          failResponse: jsonResponse(401, { error: 'unauthorized' }),
        },
      ],
      responseRules: [
        {
          id: 'r1',
          name: 'admin big page',
          enabled: true,
          when: [{ id: 'c1', scope: 'header', target: 'X-Role', op: 'equals', value: 'admin' }],
          response: {
            ...jsonResponse(200, { items: [{ id: 1 }] }),
            multipliers: [
              {
                id: 'm1',
                source: { kind: 'query', key: 'size' },
                targetJsonPath: '$.items',
                defaultCount: 3,
              },
            ],
          },
        },
      ],
      defaultResponse: jsonResponse(200, { items: [] }),
    };
    const app = buildRouter(baseServer([endpoint]));

    const noAuth = await app.request('/pets?size=5', { headers: { 'x-role': 'admin' } });
    expect(noAuth.status).toBe(401);

    const authedNoMatch = await app.request('/pets?size=5', {
      headers: { authorization: 'Bearer x', 'x-role': 'user' },
    });
    expect(await authedNoMatch.json()).toEqual({ items: [] });

    const authedMatched = await app.request('/pets?size=4', {
      headers: { authorization: 'Bearer x', 'x-role': 'admin' },
    });
    const matchedBody = (await authedMatched.json()) as { items: unknown[] };
    expect(matchedBody.items).toHaveLength(4);
  });
});
