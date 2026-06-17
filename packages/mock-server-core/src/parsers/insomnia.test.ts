import { describe, expect, it } from 'vitest';
import { parseInsomniaToEndpoints } from './insomnia';

const INSOMNIA_EXPORT = JSON.stringify({
  _type: 'export',
  resources: [
    {
      _id: 'wrk_1',
      _type: 'workspace',
      name: 'Petstore',
    },
    {
      _id: 'env_1',
      _type: 'environment',
      parentId: 'wrk_1',
      data: { baseUrl: 'https://api.example.com' },
    },
    {
      _id: 'req_1',
      _type: 'request',
      parentId: 'wrk_1',
      name: 'List pets',
      method: 'GET',
      url: 'https://api.example.com/pets',
    },
    {
      _id: 'req_2',
      _type: 'request',
      parentId: 'wrk_1',
      name: 'Create pet',
      method: 'POST',
      url: 'https://api.example.com/pets',
    },
  ],
});

describe('parseInsomniaToEndpoints', () => {
  it('extracts only request resources', () => {
    const { endpoints, warnings } = parseInsomniaToEndpoints(INSOMNIA_EXPORT);
    expect(warnings).toEqual([]);
    expect(endpoints).toHaveLength(2);
    expect(endpoints.map((e) => e.method).sort()).toEqual(['GET', 'POST']);
  });

  it('populates requestSchema from url path slots / parameters / headers', () => {
    const exp = JSON.stringify({
      resources: [
        {
          _id: 'req_1',
          _type: 'request',
          name: 'Get pet',
          method: 'GET',
          url: 'https://api.example.com/pets/:petId',
          parameters: [
            { name: 'expand', value: 'owner' },
            { name: 'debug', value: 'true', disabled: true },
          ],
          headers: [{ name: 'X-Api-Key', value: 'abc' }],
        },
      ],
    });
    const { endpoints } = parseInsomniaToEndpoints(exp);
    const ep = endpoints[0];
    expect(ep.requestSchema.pathParams.map((p) => p.name)).toEqual(['petId']);
    expect(ep.requestSchema.queryParams.map((p) => p.name)).toEqual(['expand']); // disabled skipped
    expect(ep.requestSchema.headers.map((p) => p.name)).toEqual(['X-Api-Key']);
  });

  it('synthesizes a 200 + JSON Content-Type for every request', () => {
    const { endpoints } = parseInsomniaToEndpoints(INSOMNIA_EXPORT);
    for (const e of endpoints) {
      expect(e.defaultResponse.status).toBe(200);
      expect(e.defaultResponse.headers.find((h) => h.key === 'Content-Type')?.value).toBe(
        'application/json',
      );
    }
  });

  it('returns warnings on malformed JSON without throwing', () => {
    const { endpoints, warnings } = parseInsomniaToEndpoints('{not json');
    expect(endpoints).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('skips unsupported methods', () => {
    const exp = JSON.stringify({
      resources: [{ _id: 'r', _type: 'request', name: 'x', method: 'CONNECT', url: 'https://x/y' }],
    });
    const { endpoints, warnings } = parseInsomniaToEndpoints(exp);
    expect(endpoints).toEqual([]);
    expect(warnings.some((w) => w.includes('CONNECT'))).toBe(true);
  });

  it('extracts path from absolute URL', () => {
    const { endpoints } = parseInsomniaToEndpoints(INSOMNIA_EXPORT);
    expect(endpoints.every((e) => e.pathPattern === '/pets')).toBe(true);
  });

  it('skips requests with no URL', () => {
    const exp = JSON.stringify({
      resources: [{ _type: 'request', name: 'a', method: 'GET' }],
    });
    const { endpoints, warnings } = parseInsomniaToEndpoints(exp);
    expect(endpoints).toEqual([]);
    expect(warnings.some((w) => w.includes('no path'))).toBe(true);
  });

  it('extracts path from a relative URL', () => {
    const exp = JSON.stringify({
      resources: [{ _type: 'request', name: 'a', method: 'GET', url: '/users/42' }],
    });
    const { endpoints } = parseInsomniaToEndpoints(exp);
    expect(endpoints[0].pathPattern).toBe('/users/42');
  });

  it('falls back to root for a non-URL string', () => {
    const exp = JSON.stringify({
      resources: [{ _type: 'request', name: 'a', method: 'GET', url: 'noslash' }],
    });
    const { endpoints } = parseInsomniaToEndpoints(exp);
    expect(endpoints[0].pathPattern).toBe('/');
  });

  it('returns empty when resources is undefined', () => {
    const { endpoints } = parseInsomniaToEndpoints('{}');
    expect(endpoints).toEqual([]);
  });
});
