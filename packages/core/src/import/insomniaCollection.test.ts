import { describe, expect, it } from 'vitest';
import { isInsomniaExport, parseInsomniaCollection } from './insomniaCollection';

const SIMPLE_EXPORT = JSON.stringify({
  _type: 'export',
  __export_format: 4,
  resources: [
    { _type: 'workspace', _id: 'wrk_1', name: 'My App' },
    {
      _type: 'request_group',
      _id: 'fld_1',
      name: 'Auth',
      parentId: 'wrk_1',
    },
    {
      _type: 'request',
      _id: 'req_1',
      name: 'Login',
      method: 'POST',
      url: 'https://api.example.com/login',
      parentId: 'fld_1',
      headers: [{ name: 'Accept', value: 'application/json' }],
      body: {
        mimeType: 'application/json',
        text: '{"u":"a"}',
      },
      authentication: { type: 'bearer', token: 'tok' },
    },
    {
      _type: 'request',
      _id: 'req_2',
      name: 'Health',
      method: 'GET',
      url: 'https://api.example.com/health',
      parentId: 'wrk_1',
    },
  ],
});

describe('isInsomniaExport', () => {
  it('accepts the canonical _type marker', () => {
    expect(isInsomniaExport({ _type: 'export', resources: [] })).toBe(true);
  });
  it('rejects non-Insomnia shapes', () => {
    expect(isInsomniaExport({ info: { schema: 'collection/v2.1' } })).toBe(false);
    expect(isInsomniaExport(null)).toBe(false);
    expect(isInsomniaExport({ _type: 'export' })).toBe(false); // resources missing
  });
});

describe('parseInsomniaCollection', () => {
  it('imports requests + folders + auth', () => {
    const parsed = parseInsomniaCollection(SIMPLE_EXPORT);
    expect(parsed.collectionName).toBe('My App');
    expect(parsed.folders).toHaveLength(1);
    expect(parsed.folders[0].name).toBe('Auth');
    expect(parsed.requests.map((r) => r.name)).toEqual(['Login', 'Health']);

    const login = parsed.requests[0];
    expect(login.method).toBe('POST');
    expect(login.url).toBe('https://api.example.com/login');
    expect(login.body.type).toBe('json');
    expect(login.body.content).toBe('{"u":"a"}');
    expect(login.auth).toEqual({ type: 'bearer', token: 'tok' });
    expect(login.folderPathIds).toEqual([0]);

    // Health is at the workspace root → folderPathIds = []
    expect(parsed.requests[1].folderPathIds).toEqual([]);
  });

  it('parses GraphQL bodies wrapping query + variables', () => {
    const doc = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _type: 'request',
          _id: 'req_1',
          name: 'q',
          method: 'POST',
          url: 'https://x',
          body: {
            mimeType: 'application/graphql',
            text: JSON.stringify({ query: 'query { me { id } }', variables: { x: 1 } }),
          },
        },
      ],
    });
    const parsed = parseInsomniaCollection(doc);
    const r = parsed.requests[0];
    expect(r.body.type).toBe('graphql');
    expect(r.body.content).toBe('query { me { id } }');
    if (r.body.type === 'graphql') {
      expect(r.body.variables).toContain('"x": 1');
    }
  });

  it('throws on non-Insomnia input', () => {
    expect(() => parseInsomniaCollection('{}')).toThrow(/Unsupported format/i);
  });
});
