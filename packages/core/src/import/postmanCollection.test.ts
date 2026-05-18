import { describe, expect, it } from 'vitest';
import { isPostmanV2Collection, parsePostmanCollection } from './postmanCollection';

const minimalSchema = 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json';

describe('isPostmanV2Collection', () => {
  it('accepts a v2.1 schema', () => {
    expect(isPostmanV2Collection({ info: { schema: minimalSchema } })).toBe(true);
  });
  it('rejects when info.schema is absent', () => {
    expect(isPostmanV2Collection({ info: {} })).toBe(false);
    expect(isPostmanV2Collection(null)).toBe(false);
    expect(isPostmanV2Collection({})).toBe(false);
  });
  it('rejects unrelated schemas', () => {
    expect(isPostmanV2Collection({ info: { schema: 'http://swagger.io/v2.0' } })).toBe(false);
  });
});

describe('parsePostmanCollection', () => {
  it('imports a flat list of requests', () => {
    const doc = JSON.stringify({
      info: { name: 'My API', schema: minimalSchema },
      item: [
        {
          name: 'List users',
          request: {
            method: 'GET',
            url: {
              raw: 'https://api.example.com/users?limit=10',
              query: [{ key: 'limit', value: '10' }],
            },
            header: [{ key: 'Accept', value: 'application/json' }],
          },
        },
        {
          name: 'Create user',
          request: {
            method: 'POST',
            url: 'https://api.example.com/users',
            body: { mode: 'raw', raw: '{"name":"x"}', options: { raw: { language: 'json' } } },
            auth: { type: 'bearer', bearer: [{ key: 'token', value: 'tok' }] },
          },
        },
      ],
    });
    const parsed = parsePostmanCollection(doc);
    expect(parsed.collectionName).toBe('My API');
    expect(parsed.folders).toHaveLength(0);
    expect(parsed.requests).toHaveLength(2);

    const [list, create] = parsed.requests;
    expect(list.method).toBe('GET');
    expect(list.url).toBe('https://api.example.com/users');
    expect(list.query).toEqual([{ key: 'limit', value: '10', enabled: true }]);
    expect(list.headers).toEqual([{ key: 'Accept', value: 'application/json', enabled: true }]);

    expect(create.method).toBe('POST');
    expect(create.body.type).toBe('json');
    expect(create.body.content).toBe('{"name":"x"}');
    expect(create.auth).toEqual({ type: 'bearer', token: 'tok' });
  });

  it('preserves the folder hierarchy via parentPathIds', () => {
    const doc = JSON.stringify({
      info: { name: 'Org', schema: minimalSchema },
      item: [
        {
          name: 'Auth',
          item: [
            {
              name: 'Login',
              request: { method: 'POST', url: 'https://x/login' },
            },
          ],
        },
        {
          name: 'Users',
          item: [
            {
              name: 'Profile',
              item: [{ name: 'Get me', request: { method: 'GET', url: 'https://x/me' } }],
            },
          ],
        },
      ],
    });
    const parsed = parsePostmanCollection(doc);
    expect(parsed.folders.map((f) => f.name)).toEqual(['Auth', 'Users', 'Profile']);
    expect(parsed.folders.map((f) => f.parentPathIds)).toEqual([null, null, [1]]);
    expect(parsed.requests.map((r) => r.name)).toEqual(['Login', 'Get me']);
    expect(parsed.requests[0].folderPathIds).toEqual([0]);
    expect(parsed.requests[1].folderPathIds).toEqual([1, 0]);
  });

  it('throws on non-Postman input', () => {
    expect(() => parsePostmanCollection('{}')).toThrow(/Unsupported format/i);
    expect(() => parsePostmanCollection('not-json')).toThrow(/Couldn't parse JSON/i);
  });

  it('warns + skips file rows in form-data, keeps text rows', () => {
    const doc = JSON.stringify({
      info: { name: 'F', schema: minimalSchema },
      item: [
        {
          name: 'Upload',
          request: {
            method: 'POST',
            url: 'https://x',
            body: {
              mode: 'formdata',
              formdata: [
                { key: 'name', value: 'a', type: 'text' },
                { key: 'avatar', type: 'file' },
              ],
            },
          },
        },
      ],
    });
    const parsed = parsePostmanCollection(doc);
    expect(parsed.warnings.some((w) => w.includes('avatar'))).toBe(true);
    const body = parsed.requests[0].body;
    expect(body.type).toBe('form-data');
    if (body.type === 'form-data') {
      expect(body.formRows).toEqual([{ kind: 'text', key: 'name', value: 'a', enabled: true }]);
    }
  });
});
