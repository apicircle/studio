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

  // Deterministic runtime so the auto-fed APICircle headers are easy to assert
  // without snapshotting a UUID.
  const fixedRuntime = { runtimeTag: 'test/runtime', traceId: 'fixed-trace-id' };

  it('composes all four pieces from a Request and auto-feeds APICircle headers', async () => {
    const built = await buildRequest(baseReq(), { runtime: fixedRuntime });
    expect(built).toEqual({
      url: 'https://api.example.com/users?verbose=true',
      method: 'POST',
      headers: {
        'X-Auth': 't',
        'X-APICircle-Trace-Id': 'fixed-trace-id',
        'X-APICircle-Runtime': 'test/runtime',
      },
      body: '{"x":1}',
      // Empty when applyAuth had nothing to warn about — populated when
      // e.g. JWT signing fails. See applyAuth.test.ts for the warnings shape.
      authWarnings: [],
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
      { runtime: fixedRuntime },
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
      {
        resolveAttachment: async () => ({ blob, filename: 'pic.png' }),
        runtime: fixedRuntime,
      },
    );
    expect(built.headers).not.toHaveProperty('Content-Type');
    expect(built.body).toBe(blob);
  });

  it('user-set X-APICircle-Trace-Id wins over the auto-fed header (case-insensitive)', async () => {
    const built = await buildRequest(
      baseReq({
        headers: [{ key: 'x-apicircle-trace-id', value: 'user-supplied', enabled: true }],
      }),
      { runtime: fixedRuntime },
    );
    // The user's casing is preserved, the auto-fed copy is suppressed.
    expect(built.headers['x-apicircle-trace-id']).toBe('user-supplied');
    expect(built.headers).not.toHaveProperty('X-APICircle-Trace-Id');
    // Runtime header is still injected because the user didn't set one.
    expect(built.headers['X-APICircle-Runtime']).toBe('test/runtime');
  });

  it('default runtime tag is the web studio when no runtime is supplied', async () => {
    const built = await buildRequest(baseReq());
    expect(built.headers['X-APICircle-Runtime']).toBe('apicircle-studio/web');
    // Trace-id is auto-generated UUID (length is non-zero hex)
    expect(built.headers['X-APICircle-Trace-Id']).toMatch(/.+/);
  });

  it('substitutes :name and {name} placeholders from pathParams', async () => {
    const built = await buildRequest(
      baseReq({
        url: 'https://api.example.com/users/:userId/posts/{postId}',
        query: [],
        pathParams: { userId: 'u-42', postId: '99' },
      }),
      { runtime: fixedRuntime },
    );
    expect(built.url).toBe('https://api.example.com/users/u-42/posts/99');
  });

  it('URL-encodes path param values', async () => {
    const built = await buildRequest(
      baseReq({
        url: 'https://api.example.com/files/{name}',
        query: [],
        pathParams: { name: 'a b/c' },
      }),
      { runtime: fixedRuntime },
    );
    expect(built.url).toBe('https://api.example.com/files/a%20b%2Fc');
  });

  it('missing path param substitutes to empty string (no runtime error)', async () => {
    const built = await buildRequest(
      baseReq({
        url: 'https://api.example.com/users/{userId}/profile',
        query: [],
        pathParams: {},
      }),
      { runtime: fixedRuntime },
    );
    expect(built.url).toBe('https://api.example.com/users//profile');
  });

  it('combines cookies into a Cookie header (skips disabled rows)', async () => {
    const built = await buildRequest(
      baseReq({
        cookies: [
          { key: 'session', value: 'abc', enabled: true },
          { key: 'tracking', value: 'off', enabled: false },
          { key: 'theme', value: 'dark', enabled: true },
        ],
      }),
      { runtime: fixedRuntime },
    );
    expect(built.headers.Cookie).toBe('session=abc; theme=dark');
  });

  it('user-set Cookie header wins over composed cookies (case-insensitive)', async () => {
    const built = await buildRequest(
      baseReq({
        headers: [{ key: 'cookie', value: 'manual=1', enabled: true }],
        cookies: [{ key: 'auto', value: 'should-not-appear', enabled: true }],
      }),
      { runtime: fixedRuntime },
    );
    expect(built.headers.cookie).toBe('manual=1');
    expect(built.headers).not.toHaveProperty('Cookie');
    expect(JSON.stringify(built.headers)).not.toContain('should-not-appear');
  });
});

describe('findPathPlaceholders', () => {
  it('extracts both :name and {name} forms in document order', async () => {
    const { findPathPlaceholders } = await import('./buildRequest');
    expect(findPathPlaceholders('https://x/:a/{b}/:c')).toEqual(['a', 'b', 'c']);
  });

  it('dedupes repeated placeholders', async () => {
    const { findPathPlaceholders } = await import('./buildRequest');
    expect(findPathPlaceholders('https://x/:id/posts/:id')).toEqual(['id']);
  });

  it('ignores anything in the query string', async () => {
    const { findPathPlaceholders } = await import('./buildRequest');
    expect(findPathPlaceholders('https://x/users/{id}?q=:bogus&n={alsoBogus}')).toEqual(['id']);
  });

  it('does NOT match {{NAME}} template-variable syntax', async () => {
    const { findPathPlaceholders } = await import('./buildRequest');
    // The Cookie test case from the bug report: the URL `?greeting={{GREETING}}`
    // used to surface GREETING as a path param. It must not.
    expect(findPathPlaceholders('https://httpbin.org/anything?greeting={{GREETING}}')).toEqual([]);
    // Even without the query-string guard, `{{NAME}}` in the path itself
    // mustn't match.
    expect(findPathPlaceholders('https://x/{{TENANT}}/users/{id}')).toEqual(['id']);
  });

  it('applyPathParams leaves the query string untouched', async () => {
    const { applyPathParams } = await import('./buildRequest');
    const url = 'https://x/users/{id}/posts?q={{var}}&p={alsoNotPath}';
    expect(applyPathParams(url, { id: '42' })).toBe(
      'https://x/users/42/posts?q={{var}}&p={alsoNotPath}',
    );
  });
});
