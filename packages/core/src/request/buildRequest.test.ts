import type { Request as ApiRequest } from '@apicircle/shared';
import { describe, expect, it, vi } from 'vitest';
import {
  buildRequest,
  composeBody,
  composeCookieHeader,
  composeHeaders,
  composeUrl,
} from './buildRequest';

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

  // RFC 7230 token-grammar enforcement (Phase 6). A {{var}} resolved to
  // something with `:` / CR / LF / NUL / space in the NAME would smuggle
  // a second header line on a future native HTTP layer. Drop the row.
  it('drops header names that violate the RFC 7230 token grammar', () => {
    expect(
      composeHeaders([
        { key: 'Bad: Name', value: 'v', enabled: true },
        { key: 'Bad\r\nName', value: 'v', enabled: true },
        { key: 'Bad Name', value: 'v', enabled: true },
        { key: 'Bad\x00Name', value: 'v', enabled: true },
        { key: 'X-Good', value: 'v', enabled: true },
      ]),
    ).toEqual({ 'X-Good': 'v' });
  });

  // CRLF / NUL / DEL in a header VALUE is rejected by browser fetch but
  // would also become header injection on a future native stack. Strip
  // those characters; keep everything else.
  it('strips control characters from header values', () => {
    expect(
      composeHeaders([
        { key: 'X-Sneaky', value: 'real\r\nEvil: smuggled', enabled: true },
        { key: 'X-Nul', value: 'before\x00after', enabled: true },
        { key: 'X-OK', value: 'normal value', enabled: true },
      ]),
    ).toEqual({
      'X-Sneaky': 'realEvil: smuggled',
      'X-Nul': 'beforeafter',
      'X-OK': 'normal value',
    });
  });
});

describe('composeCookieHeader', () => {
  it('joins enabled rows into a Cookie header value', () => {
    expect(
      composeCookieHeader([
        { key: 'session', value: 'abc', enabled: true },
        { key: 'csrf', value: 'tok', enabled: true },
      ]),
    ).toBe('session=abc; csrf=tok');
  });

  it('skips disabled and empty-key rows', () => {
    expect(
      composeCookieHeader([
        { key: 'a', value: '1', enabled: false },
        { key: '', value: '2', enabled: true },
        { key: 'b', value: '3', enabled: true },
      ]),
    ).toBe('b=3');
  });

  // Phase 6: defend against header smuggling via cookie row injection.
  // A {{var}} resolved with CRLF in either key or value would otherwise
  // break the `; key=value; …` row framing.
  it('strips CRLF / NUL from cookie values', () => {
    expect(
      composeCookieHeader([
        { key: 'session', value: 'abc\r\nAuthorization: Bearer evil', enabled: true },
      ]),
    ).toBe('session=abcAuthorization: Bearer evil');
  });

  // A `;` inside a value would close the row early and let an attacker
  // inject a forged cookie pair after the legitimate one. Strip semicolons.
  it('strips semicolons from cookie values', () => {
    expect(composeCookieHeader([{ key: 'session', value: 'abc; admin=1', enabled: true }])).toBe(
      'session=abc admin=1',
    );
  });

  // Cookie names cannot contain `;` `=` whitespace or CTLs per RFC 6265.
  // Drop those characters from the key.
  it('strips disallowed characters from cookie names', () => {
    expect(composeCookieHeader([{ key: 'session; admin', value: 'v', enabled: true }])).toBe(
      'sessionadmin=v',
    );
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

  it('percent-encodes reserved characters in values exactly once', async () => {
    // The `&` and `=` belong to the VALUE — they are encoded rather than
    // treated as separators, and the value is encoded once (not double-
    // encoded the way storing pre-encoded content would cause).
    const body = await composeBody({ type: 'urlencoded', content: 'q=a b&c=d' });
    expect(body).toBe('q=a+b%26c%3Dd');
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

  // Deterministic auto-header overrides so the per-send tracing fields
  // (X-Trace-Span-Id, traceparent) are easy to assert without snapshotting
  // random hex. `platform: 'web'` keeps Origin/Referer suppressed in tests.
  const fixedAuto = {
    autoHeaderOverrides: {
      spanId: 'fixed-span-id',
      traceparent: '00-fixedtrace-fixedspan-01',
      platform: 'web' as const,
      version: '0.1.0',
      name: 'APICircle Studio',
    },
  };

  // Headers every send injects when the user has set none of them.
  const expectedAutoHeaders = {
    'X-Client-Name': 'APICircle Studio',
    'X-Client-Platform': 'web',
    'X-Client-Version': '0.1.0',
    'X-Trace-Span-Id': 'fixed-span-id',
    traceparent: '00-fixedtrace-fixedspan-01',
  };

  it('composes all four pieces from a Request and auto-feeds APICircle headers', async () => {
    const built = await buildRequest(baseReq(), fixedAuto);
    expect(built).toEqual({
      url: 'https://api.example.com/users?verbose=true',
      method: 'POST',
      headers: {
        'X-Auth': 't',
        ...expectedAutoHeaders,
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
      fixedAuto,
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
        ...fixedAuto,
      },
    );
    expect(built.headers).not.toHaveProperty('Content-Type');
    expect(built.body).toBe(blob);
  });

  it('user-set X-Client-Version wins over the auto-fed header (case-insensitive)', async () => {
    const built = await buildRequest(
      baseReq({
        headers: [{ key: 'x-client-version', value: 'user-supplied', enabled: true }],
      }),
      fixedAuto,
    );
    // The user's casing is preserved, the auto-fed copy is suppressed.
    expect(built.headers['x-client-version']).toBe('user-supplied');
    expect(built.headers).not.toHaveProperty('X-Client-Version');
    // Other auto headers are still injected because the user didn't set them.
    expect(built.headers['X-Client-Name']).toBe('APICircle Studio');
    expect(built.headers['X-Trace-Span-Id']).toBe('fixed-span-id');
  });

  it('user-set traceparent wins over the auto-fed traceparent', async () => {
    const built = await buildRequest(
      baseReq({
        headers: [{ key: 'traceparent', value: '00-aaa-bbb-01', enabled: true }],
      }),
      fixedAuto,
    );
    expect(built.headers.traceparent).toBe('00-aaa-bbb-01');
    // X-Trace-Span-Id is always regenerated even if traceparent is overridden.
    expect(built.headers['X-Trace-Span-Id']).toBe('fixed-span-id');
  });

  it('desktop platform also auto-feeds Origin and Referer', async () => {
    const built = await buildRequest(baseReq(), {
      autoHeaderOverrides: {
        ...fixedAuto.autoHeaderOverrides,
        platform: 'desktop',
      },
    });
    expect(built.headers['X-Client-Platform']).toBe('desktop');
    expect(built.headers.Origin).toBe('http://app.studio.apicircle.dev');
    expect(built.headers.Referer).toBe('http://app.studio.apicircle.dev/');
  });

  it('defaults regenerate trace ids per send when no overrides are supplied', async () => {
    const built = await buildRequest(baseReq());
    // X-Trace-Span-Id is 16 hex chars (W3C span format).
    expect(built.headers['X-Trace-Span-Id']).toMatch(/^[0-9a-f]{16}$/);
    // traceparent is `00-<32 hex>-<16 hex>-01`.
    expect(built.headers.traceparent).toMatch(/^00-[0-9a-f]{32}-[0-9a-f]{16}-01$/);
    expect(built.headers['X-Client-Name']).toBe('APICircle Studio');
    expect(built.headers['X-Client-Version']).toBe('0.1.0');
  });

  it('substitutes :name and {name} placeholders from pathParams', async () => {
    const built = await buildRequest(
      baseReq({
        url: 'https://api.example.com/users/:userId/posts/{postId}',
        query: [],
        pathParams: { userId: 'u-42', postId: '99' },
      }),
      fixedAuto,
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
      fixedAuto,
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
      fixedAuto,
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
      fixedAuto,
    );
    expect(built.headers.Cookie).toBe('session=abc; theme=dark');
  });

  it('user-set Cookie header wins over composed cookies (case-insensitive)', async () => {
    const built = await buildRequest(
      baseReq({
        headers: [{ key: 'cookie', value: 'manual=1', enabled: true }],
        cookies: [{ key: 'auto', value: 'should-not-appear', enabled: true }],
      }),
      fixedAuto,
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
