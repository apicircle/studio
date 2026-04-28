import type { Request as ApiRequest } from '@apicircle/shared';
import { describe, expect, it, vi } from 'vitest';
import { buildRequest, composeBody, composeHeaders, composeUrl } from './buildRequest';

describe('composeUrl', () => {
  it('returns the URL unchanged when no params are enabled', () => {
    expect(
      composeUrl('https://api.example.com/v1', [{ key: 'a', value: '1', enabled: false }]),
    ).toBe('https://api.example.com/v1');
  });

  it('appends enabled params as query string on a parseable URL', () => {
    const url = composeUrl('https://api.example.com/v1', [
      { key: 'page', value: '2', enabled: true },
      { key: 'sort', value: 'name', enabled: true },
    ]);
    expect(url).toBe('https://api.example.com/v1?page=2&sort=name');
  });

  it('preserves existing query params', () => {
    const url = composeUrl('https://api.example.com/v1?already=here', [
      { key: 'extra', value: 'yes', enabled: true },
    ]);
    expect(url).toBe('https://api.example.com/v1?already=here&extra=yes');
  });

  it('skips disabled and empty-key entries', () => {
    const url = composeUrl('https://api.example.com/v1', [
      { key: '', value: 'x', enabled: true },
      { key: 'k', value: 'v', enabled: false },
      { key: 'real', value: 'r', enabled: true },
    ]);
    expect(url).toBe('https://api.example.com/v1?real=r');
  });

  it('encodes special characters', () => {
    const url = composeUrl('https://api.example.com', [
      { key: 'q', value: 'hello world', enabled: true },
    ]);
    expect(url).toBe('https://api.example.com/?q=hello+world');
  });

  it('falls back to manual concat when the URL is not parseable (e.g. unresolved templates)', () => {
    const url = composeUrl('{{BASE_URL}}/users', [{ key: 'page', value: '1', enabled: true }]);
    expect(url).toBe('{{BASE_URL}}/users?page=1');
  });

  it('uses & when the unparseable URL already has a query', () => {
    const url = composeUrl('{{BASE_URL}}/users?id=1', [{ key: 'page', value: '2', enabled: true }]);
    expect(url).toBe('{{BASE_URL}}/users?id=1&page=2');
  });
});

describe('composeHeaders', () => {
  it('drops disabled and empty-key rows', () => {
    expect(
      composeHeaders([
        { key: 'X-A', value: 'a', enabled: true },
        { key: 'X-B', value: 'b', enabled: false },
        { key: '   ', value: 'c', enabled: true },
      ]),
    ).toEqual({ 'X-A': 'a' });
  });

  it('later rows with the same name override earlier ones', () => {
    expect(
      composeHeaders([
        { key: 'X-Auth', value: 'first', enabled: true },
        { key: 'X-Auth', value: 'second', enabled: true },
      ]),
    ).toEqual({ 'X-Auth': 'second' });
  });
});

describe('composeBody', () => {
  it('returns null for body type "none"', async () => {
    expect(await composeBody({ type: 'none', content: '{"x":1}' })).toBeNull();
  });

  it('returns the raw content for json/text/xml', async () => {
    expect(await composeBody({ type: 'json', content: '{"x":1}' })).toBe('{"x":1}');
    expect(await composeBody({ type: 'text', content: 'hello' })).toBe('hello');
    expect(await composeBody({ type: 'xml', content: '<root/>' })).toBe('<root/>');
  });

  it('serializes urlencoded body from key=value lines', async () => {
    const body = await composeBody({ type: 'urlencoded', content: 'a=1\nb=hello world\nc=' });
    expect(body).toBe('a=1&b=hello+world&c=');
  });

  it('skips lines without "="', async () => {
    const body = await composeBody({ type: 'urlencoded', content: 'a=1\njust a line\nb=2' });
    expect(body).toBe('a=1&b=2');
  });

  it('skips lines with empty key', async () => {
    const body = await composeBody({ type: 'urlencoded', content: '=ignored\na=1' });
    expect(body).toBe('a=1');
  });

  describe('form-data', () => {
    it('builds a FormData with text rows', async () => {
      const result = await composeBody({
        type: 'form-data',
        content: '',
        formRows: [
          { kind: 'text', key: 'name', value: 'alice', enabled: true },
          { kind: 'text', key: 'role', value: 'admin', enabled: true },
        ],
      });
      expect(result).toBeInstanceOf(FormData);
      const fd = result as FormData;
      expect(fd.get('name')).toBe('alice');
      expect(fd.get('role')).toBe('admin');
    });

    it('skips disabled rows and rows with empty keys', async () => {
      const result = await composeBody({
        type: 'form-data',
        content: '',
        formRows: [
          { kind: 'text', key: '', value: 'x', enabled: true },
          { kind: 'text', key: 'k', value: 'v', enabled: false },
          { kind: 'text', key: 'real', value: 'r', enabled: true },
        ],
      });
      const fd = result as FormData;
      expect(fd.has('')).toBe(false);
      expect(fd.has('k')).toBe(false);
      expect(fd.get('real')).toBe('r');
    });

    it('appends a file via the attachment resolver with filename', async () => {
      const blob = new Blob([new Uint8Array([1, 2, 3])], { type: 'application/octet-stream' });
      const resolver = vi.fn(async (slotId: string) =>
        slotId === 'slot-A' ? { blob, filename: 'avatar.png' } : null,
      );
      const result = await composeBody(
        {
          type: 'form-data',
          content: '',
          formRows: [
            { kind: 'text', key: 'name', value: 'alice', enabled: true },
            { kind: 'file', key: 'avatar', slotId: 'slot-A', enabled: true },
          ],
        },
        resolver,
      );
      const fd = result as FormData;
      const file = fd.get('avatar');
      expect(file).toBeInstanceOf(File);
      expect((file as File).name).toBe('avatar.png');
      expect(resolver).toHaveBeenCalledWith('slot-A');
    });

    it('skips file rows when the resolver returns null', async () => {
      const resolver = vi.fn(async () => null);
      const result = await composeBody(
        {
          type: 'form-data',
          content: '',
          formRows: [{ kind: 'file', key: 'avatar', slotId: 'missing', enabled: true }],
        },
        resolver,
      );
      const fd = result as FormData;
      expect(fd.has('avatar')).toBe(false);
    });

    it('skips file rows when no resolver is provided', async () => {
      const result = await composeBody({
        type: 'form-data',
        content: '',
        formRows: [{ kind: 'file', key: 'avatar', slotId: 'slot-A', enabled: true }],
      });
      const fd = result as FormData;
      expect(fd.has('avatar')).toBe(false);
    });
  });

  describe('binary', () => {
    it('returns the resolved blob as the body', async () => {
      const blob = new Blob([new Uint8Array([9, 8, 7])], { type: 'application/pdf' });
      const result = await composeBody(
        { type: 'binary', content: '', attachment: { slotId: 'bin-1' } },
        async (id) => (id === 'bin-1' ? { blob, filename: 'doc.pdf' } : null),
      );
      expect(result).toBe(blob);
    });

    it('returns null when no attachment is set', async () => {
      const result = await composeBody({ type: 'binary', content: '' });
      expect(result).toBeNull();
    });

    it('returns null when the attachment resolver returns null', async () => {
      const result = await composeBody(
        { type: 'binary', content: '', attachment: { slotId: 'missing' } },
        async () => null,
      );
      expect(result).toBeNull();
    });
  });

  describe('graphql', () => {
    it('wraps the query into a JSON envelope when no variables are set', async () => {
      const result = await composeBody({ type: 'graphql', content: 'query { hello }' });
      expect(typeof result).toBe('string');
      expect(JSON.parse(result as string)).toEqual({ query: 'query { hello }' });
    });

    it('parses the variables JSON and includes it in the envelope', async () => {
      const result = await composeBody({
        type: 'graphql',
        content: 'query Q($id: ID!) { user(id: $id) { name } }',
        variables: '{"id":"42"}',
      });
      expect(JSON.parse(result as string)).toEqual({
        query: 'query Q($id: ID!) { user(id: $id) { name } }',
        variables: { id: '42' },
      });
    });

    it('falls back to variables=null on malformed JSON', async () => {
      const result = await composeBody({
        type: 'graphql',
        content: '{ x }',
        variables: '{ broken',
      });
      expect(JSON.parse(result as string)).toEqual({ query: '{ x }', variables: null });
    });
  });
});

describe('buildRequest', () => {
  const baseReq = (overrides: Partial<ApiRequest> = {}): ApiRequest => ({
    id: 'r1',
    name: 'Get user',
    folderId: null,
    method: 'POST',
    url: 'https://api.example.com/users',
    headers: [{ key: 'X-Auth', value: 't', enabled: true }],
    query: [{ key: 'verbose', value: 'true', enabled: true }],
    body: { type: 'json', content: '{"x":1}' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-04-27T00:00:00.000Z',
    updatedAt: '2026-04-27T00:00:00.000Z',
    ...overrides,
  });

  it('composes all four pieces from a Request', async () => {
    const built = await buildRequest(baseReq());
    expect(built).toEqual({
      url: 'https://api.example.com/users?verbose=true',
      method: 'POST',
      headers: { 'X-Auth': 't' },
      body: '{"x":1}',
    });
  });

  it('strips Content-Type for form-data so fetch can set the multipart boundary', async () => {
    const built = await buildRequest(
      baseReq({
        headers: [
          { key: 'Content-Type', value: 'multipart/form-data', enabled: true },
          { key: 'X-Auth', value: 't', enabled: true },
        ],
        body: { type: 'form-data', content: '', formRows: [] },
      }),
    );
    expect(built.headers).not.toHaveProperty('Content-Type');
    expect(built.headers['X-Auth']).toBe('t');
    expect(built.body).toBeInstanceOf(FormData);
  });

  it('strips Content-Type for binary so the blob type wins', async () => {
    const blob = new Blob([new Uint8Array([1, 2])], { type: 'image/png' });
    const built = await buildRequest(
      baseReq({
        headers: [{ key: 'Content-Type', value: 'application/octet-stream', enabled: true }],
        body: { type: 'binary', content: '', attachment: { slotId: 'b1' } },
      }),
      async () => ({ blob, filename: 'pic.png' }),
    );
    expect(built.headers).not.toHaveProperty('Content-Type');
    expect(built.body).toBe(blob);
  });
});
