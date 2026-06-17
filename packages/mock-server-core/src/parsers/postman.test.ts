import { describe, expect, it } from 'vitest';
import type { MockEndpoint } from '@apicircle/shared';
import { parsePostmanToEndpoints } from './postman';

const status = (e: MockEndpoint) => e.defaultResponse.status;
const bodyContent = (e: MockEndpoint) =>
  e.defaultResponse.body.type === 'json' ||
  e.defaultResponse.body.type === 'text' ||
  e.defaultResponse.body.type === 'xml' ||
  e.defaultResponse.body.type === 'urlencoded'
    ? e.defaultResponse.body.content
    : '';

const POSTMAN_COLLECTION = JSON.stringify({
  info: { name: 'Petstore', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/' },
  item: [
    {
      name: 'API',
      item: [
        {
          name: 'List pets',
          request: {
            method: 'GET',
            url: { raw: 'https://api.example.com/pets' },
          },
          response: [
            {
              name: 'Two pets',
              code: 200,
              header: [{ key: 'Content-Type', value: 'application/json' }],
              body: '[{"id":1,"name":"Fido"}]',
            },
          ],
        },
        {
          name: 'Create pet',
          request: {
            method: 'POST',
            url: 'https://api.example.com/pets',
          },
          // No saved response — should synthesize a 200 default.
        },
      ],
    },
  ],
});

describe('parsePostmanToEndpoints', () => {
  it('walks the recursive item tree and extracts requests', () => {
    const { endpoints, warnings } = parsePostmanToEndpoints(POSTMAN_COLLECTION);
    expect(warnings).toEqual([]);
    expect(endpoints).toHaveLength(2);
  });

  it('populates requestSchema from url.variable / url.query / headers', () => {
    const collection = JSON.stringify({
      info: { name: 'C', schema: 'https://schema.getpostman.com/json/collection/v2.1.0/' },
      item: [
        {
          name: 'Get pet',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.example.com/pets/:petId?expand=owner',
              path: ['pets', ':petId'],
              variable: [{ key: 'petId', value: '1', description: 'Pet id' }],
              query: [
                { key: 'expand', value: 'owner' },
                { key: 'debug', value: 'true', disabled: true },
              ],
            },
            header: [{ key: 'X-Api-Key', value: 'abc' }],
          },
        },
      ],
    });
    const { endpoints } = parsePostmanToEndpoints(collection);
    const ep = endpoints[0];
    expect(ep.requestSchema.pathParams.map((p) => p.name)).toEqual(['petId']);
    expect(ep.requestSchema.pathParams[0].example).toBe('1');
    // Disabled query rows are skipped.
    expect(ep.requestSchema.queryParams.map((p) => p.name)).toEqual(['expand']);
    expect(ep.requestSchema.headers.map((p) => p.name)).toEqual(['X-Api-Key']);
  });

  it('uses the first saved response when present', () => {
    const { endpoints } = parsePostmanToEndpoints(POSTMAN_COLLECTION);
    const list = endpoints.find((e) => e.method === 'GET');
    expect(list).toBeDefined();
    expect(status(list!)).toBe(200);
    expect(bodyContent(list!)).toBe('[{"id":1,"name":"Fido"}]');
    expect(list!.example).toBe('Two pets');
  });

  it('synthesizes a 200 default when no saved response is present', () => {
    const { endpoints } = parsePostmanToEndpoints(POSTMAN_COLLECTION);
    const create = endpoints.find((e) => e.method === 'POST');
    expect(create).toBeDefined();
    expect(status(create!)).toBe(200);
    expect(bodyContent(create!)).toBe('{}');
  });

  it('extracts the path from absolute URLs', () => {
    const { endpoints } = parsePostmanToEndpoints(POSTMAN_COLLECTION);
    expect(endpoints.every((e) => e.pathPattern.startsWith('/'))).toBe(true);
  });

  it('returns warnings on malformed JSON without throwing', () => {
    const { endpoints, warnings } = parsePostmanToEndpoints('{not json');
    expect(endpoints).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('handles `url.path` array form', () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [
        {
          name: 'A',
          request: {
            method: 'GET',
            url: { path: ['users', '42'] },
          },
        },
      ],
    });
    const { endpoints } = parsePostmanToEndpoints(collection);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].pathPattern).toBe('/users/42');
  });

  it('skips items with unsupported methods', () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [{ name: 'a', request: { method: 'TRACE', url: 'https://x/a' } }],
    });
    const { endpoints, warnings } = parsePostmanToEndpoints(collection);
    expect(endpoints).toEqual([]);
    expect(warnings.some((w) => w.includes('TRACE'))).toBe(true);
  });

  it('skips requests with no extractable path', () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [{ name: 'noUrl', request: { method: 'GET' } }],
    });
    const { endpoints, warnings } = parsePostmanToEndpoints(collection);
    expect(endpoints).toEqual([]);
    expect(warnings.some((w) => w.includes('no extractable path'))).toBe(true);
  });

  it('extracts path from a template URL like {{baseUrl}}/users', () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [{ name: 'a', request: { method: 'GET', url: { raw: '{{baseUrl}}/users' } } }],
    });
    const { endpoints } = parsePostmanToEndpoints(collection);
    expect(endpoints[0].pathPattern).toBe('/users');
  });

  it('falls back to root path for malformed URL with no slash', () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [{ name: 'a', request: { method: 'GET', url: { raw: 'no-slash-anywhere' } } }],
    });
    const { endpoints } = parsePostmanToEndpoints(collection);
    expect(endpoints[0].pathPattern).toBe('/');
  });

  it('handles a single-string url.path', () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [{ name: 'a', request: { method: 'GET', url: { path: 'users' } } }],
    });
    const { endpoints } = parsePostmanToEndpoints(collection);
    expect(endpoints[0].pathPattern).toBe('/users');
  });

  it('returns 200 + JSON default when response[] is empty array', () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [
        {
          name: 'a',
          request: { method: 'GET', url: 'https://x/y' },
          response: [],
        },
      ],
    });
    const { endpoints } = parsePostmanToEndpoints(collection);
    expect(status(endpoints[0])).toBe(200);
    expect(bodyContent(endpoints[0])).toBe('{}');
  });

  it('reads code from `status` string when `code` is missing', () => {
    const collection = JSON.stringify({
      info: { name: 'X' },
      item: [
        {
          name: 'a',
          request: { method: 'GET', url: 'https://x/y' },
          response: [{ name: 'r', status: '503', body: 'down' }],
        },
      ],
    });
    const { endpoints } = parsePostmanToEndpoints(collection);
    expect(status(endpoints[0])).toBe(503);
  });
});
