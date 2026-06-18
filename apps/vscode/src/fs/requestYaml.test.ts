import { describe, it, expect } from 'vitest';
import type { Request } from '@apicircle/shared';
import {
  serializeRequestToYaml,
  parseRequestFromYaml,
  projectRequestYaml,
  RequestYamlParseError,
} from './requestYaml';

function makeRequest(over: Partial<Request> = {}): Request {
  return {
    id: 'req_test',
    name: 'Get user',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/users/123',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: '2026-01-01T00:00:00Z',
    updatedAt: '2026-01-01T00:00:00Z',
    ...over,
  };
}

describe('serializeRequestToYaml', () => {
  it('emits only required fields when everything else is empty', () => {
    const yaml = serializeRequestToYaml(makeRequest());
    expect(yaml).toContain('name: Get user');
    expect(yaml).toContain('method: GET');
    expect(yaml).toContain('url: https://api.example.com/users/123');
    expect(yaml).not.toContain('headers:');
    expect(yaml).not.toContain('body:');
    expect(yaml).not.toContain('auth:');
  });

  it('includes the read-only header comment', () => {
    const yaml = serializeRequestToYaml(makeRequest());
    expect(yaml).toMatch(/API Circle Request/);
    expect(yaml).toMatch(/Read-only system fields/);
  });

  it('emits headers / query / body / auth when populated', () => {
    const yaml = serializeRequestToYaml(
      makeRequest({
        method: 'POST',
        headers: [{ key: 'X-Trace', value: 'abc', enabled: true }],
        query: [{ key: 'page', value: '1', enabled: true }],
        body: { type: 'json', content: '{"a":1}' },
        auth: { type: 'bearer', token: 'xyz' },
      }),
    );
    expect(yaml).toContain('X-Trace');
    expect(yaml).toContain('page');
    expect(yaml).toContain('bearer');
    expect(yaml).toContain('xyz');
  });

  it('does NOT emit read-only fields (id, createdAt, updatedAt, folderId)', () => {
    const yaml = serializeRequestToYaml(makeRequest());
    expect(yaml).not.toContain('req_test');
    expect(yaml).not.toContain('createdAt');
    expect(yaml).not.toContain('folderId');
  });
});

describe('parseRequestFromYaml', () => {
  it('round-trips a minimal request', () => {
    const original = makeRequest();
    const yaml = serializeRequestToYaml(original);
    const { patch } = parseRequestFromYaml(yaml);
    expect(patch.name).toBe('Get user');
    expect(patch.method).toBe('GET');
    expect(patch.url).toBe('https://api.example.com/users/123');
  });

  it('round-trips a richer request', () => {
    const original = makeRequest({
      method: 'POST',
      headers: [{ key: 'Authorization', value: 'Bearer x', enabled: true }],
      query: [{ key: 'q', value: 'apple', enabled: true }],
      body: { type: 'json', content: '{"a":1}' },
    });
    const { patch } = parseRequestFromYaml(serializeRequestToYaml(original));
    expect(patch.headers).toEqual([{ key: 'Authorization', value: 'Bearer x', enabled: true }]);
    expect(patch.query).toEqual([{ key: 'q', value: 'apple', enabled: true }]);
    expect(patch.body?.type).toBe('json');
  });

  it('uppercases method', () => {
    const { patch } = parseRequestFromYaml('name: x\nmethod: post\nurl: https://x.com');
    expect(patch.method).toBe('POST');
  });

  it('throws RequestYamlParseError on invalid YAML', () => {
    expect(() => parseRequestFromYaml('::: not yaml ::')).toThrow(RequestYamlParseError);
  });

  it('throws when required fields are missing', () => {
    expect(() => parseRequestFromYaml('name: x\nmethod: GET')).toThrow(/url/);
    expect(() => parseRequestFromYaml('method: GET\nurl: https://x.com')).toThrow(/name/);
  });

  it('throws on unsupported method', () => {
    expect(() => parseRequestFromYaml('name: x\nmethod: SUBMIT\nurl: https://x.com')).toThrow(
      /Invalid method/,
    );
  });

  it('throws when root is not an object', () => {
    expect(() => parseRequestFromYaml('- a\n- b\n- c')).toThrow(/Document root/);
  });

  it('defaults auth to {type: none} when missing', () => {
    const { patch } = parseRequestFromYaml('name: x\nmethod: GET\nurl: https://x.com');
    expect(patch.auth).toEqual({ type: 'none' });
  });

  it('defaults body to {type: none} when missing', () => {
    const { patch } = parseRequestFromYaml('name: x\nmethod: GET\nurl: https://x.com');
    expect(patch.body).toEqual({ type: 'none', content: '' });
  });

  it('rejects an unknown top-level key', () => {
    expect(() =>
      parseRequestFromYaml('name: x\nmethod: GET\nurl: https://x.com\nheaderz: []'),
    ).toThrow(/Unknown field/);
  });

  it('rejects an unknown key inside a header / query / cookie row', () => {
    expect(() =>
      parseRequestFromYaml(
        'name: x\nmethod: GET\nurl: https://x.com\nheaders:\n  - keyy: Accept\n    value: application/json\n    enabled: true',
      ),
    ).toThrow(/unknown field/i);
  });

  it('rejects a known section with the wrong type', () => {
    expect(() =>
      parseRequestFromYaml('name: x\nmethod: GET\nurl: https://x.com\nheaders: nope'),
    ).toThrow(/headers.*must be a list/);
    expect(() =>
      parseRequestFromYaml('name: x\nmethod: GET\nurl: https://x.com\nauth: nope'),
    ).toThrow(/auth.*must be a mapping/);
  });

  it('warns but does not throw when query/headers row is malformed', () => {
    const { patch, warnings } = parseRequestFromYaml(
      'name: x\nmethod: GET\nurl: https://x.com\nheaders:\n  - junk\n  - {key: A, value: B, enabled: true}',
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(patch.headers).toHaveLength(2);
  });
});

describe('parseRequestFromYaml — URL ↔ query / pathParams sync', () => {
  it("splits ?key=val typed into url: into the query: block and strips '?' from url", () => {
    const { patch } = parseRequestFromYaml(
      'name: x\nmethod: GET\nurl: https://x.com/api?page=2&limit=10',
    );
    expect(patch.url).toBe('https://x.com/api');
    expect(patch.query).toEqual([
      { key: 'page', value: '2', enabled: true },
      { key: 'limit', value: '10', enabled: true },
    ]);
  });

  it('merges URL-typed query params with existing query rows by key (URL wins on enabled rows)', () => {
    const yaml = [
      'name: x',
      'method: GET',
      'url: https://x.com/api?page=99&fresh=yes',
      'query:',
      '  - key: page',
      "    value: '1'",
      '    enabled: true',
      '  - key: filter',
      '    value: active',
      '    enabled: true',
    ].join('\n');
    const { patch } = parseRequestFromYaml(yaml);
    expect(patch.url).toBe('https://x.com/api');
    expect(patch.query).toEqual([
      { key: 'page', value: '99', enabled: true }, // overwritten by URL
      { key: 'filter', value: 'active', enabled: true }, // kept
      { key: 'fresh', value: 'yes', enabled: true }, // appended
    ]);
  });

  it('preserves disabled query rows even when the URL bar carries the same key', () => {
    const yaml = [
      'name: x',
      'method: GET',
      'url: https://x.com/api?page=2',
      'query:',
      '  - key: page',
      "    value: '1'",
      '    enabled: false',
    ].join('\n');
    const { patch } = parseRequestFromYaml(yaml);
    // Disabled row passes through untouched; the URL-typed value lands as a
    // separate enabled row so the user doesn't lose the disabled-row's value.
    expect(patch.query).toEqual([
      { key: 'page', value: '1', enabled: false },
      { key: 'page', value: '2', enabled: true },
    ]);
  });

  it('drops a trailing #fragment from a typed URL when splitting query rows', () => {
    const { patch } = parseRequestFromYaml(
      'name: x\nmethod: GET\nurl: https://x.com/api?page=2#anchor',
    );
    expect(patch.url).toBe('https://x.com/api');
    expect(patch.query).toEqual([{ key: 'page', value: '2', enabled: true }]);
  });

  it('does not touch the URL or query rows when no ? is present', () => {
    const yaml = [
      'name: x',
      'method: GET',
      'url: https://x.com/users',
      'query:',
      '  - key: page',
      "    value: '1'",
      '    enabled: true',
    ].join('\n');
    const { patch } = parseRequestFromYaml(yaml);
    expect(patch.url).toBe('https://x.com/users');
    expect(patch.query).toEqual([{ key: 'page', value: '1', enabled: true }]);
  });

  it('adds a pathParams entry for each new {name} / :name placeholder in the URL', () => {
    const { patch } = parseRequestFromYaml(
      'name: x\nmethod: GET\nurl: https://x.com/users/{userId}/posts/:postId',
    );
    expect(patch.pathParams).toEqual({ userId: '', postId: '' });
  });

  it('preserves existing pathParams values and only fills in missing placeholders', () => {
    const yaml = [
      'name: x',
      'method: GET',
      'url: https://x.com/users/{userId}/posts/:postId',
      'pathParams:',
      "  userId: '42'",
    ].join('\n');
    const { patch } = parseRequestFromYaml(yaml);
    expect(patch.pathParams).toEqual({ userId: '42', postId: '' });
  });

  it('keeps stale pathParams keys that no longer match a placeholder (user prunes manually)', () => {
    const yaml = [
      'name: x',
      'method: GET',
      'url: https://x.com/users/{userId}',
      'pathParams:',
      "  userId: '42'",
      "  legacy: 'old'",
    ].join('\n');
    const { patch } = parseRequestFromYaml(yaml);
    expect(patch.pathParams).toEqual({ userId: '42', legacy: 'old' });
  });

  it('does NOT treat {{var}} template references in the URL path as path placeholders', () => {
    const { patch } = parseRequestFromYaml(
      'name: x\nmethod: GET\nurl: https://x.com/{{TENANT}}/users/{id}',
    );
    expect(patch.pathParams).toEqual({ id: '' });
  });

  it('does NOT extract path placeholders from inside the query string', () => {
    const { patch } = parseRequestFromYaml(
      'name: x\nmethod: GET\nurl: https://x.com/api?ref=:notPath&other={alsoNot}',
    );
    expect(patch.pathParams).toBeUndefined();
    expect(patch.query).toEqual([
      { key: 'ref', value: ':notPath', enabled: true },
      { key: 'other', value: '{alsoNot}', enabled: true },
    ]);
  });
});

describe('projectRequestYaml — canonical projection for on-will-save', () => {
  it('returns null when the buffer is already canonical (no URL embedded query)', () => {
    const yaml = serializeRequestToYaml({
      id: 'req',
      folderId: null,
      name: 'x',
      method: 'GET',
      url: 'https://x.com/api',
      headers: [],
      query: [{ key: 'page', value: '1', enabled: true }],
      body: { type: 'none', content: '' },
      auth: { type: 'none' },
      contextVars: [],
      extractions: [],
      assertions: [],
      createdAt: '2026-01-01T00:00:00Z',
      updatedAt: '2026-01-01T00:00:00Z',
    });
    expect(projectRequestYaml(yaml)).toBeNull();
  });

  it('rewrites a URL with ?key=val into url=base + query: row appended', () => {
    const buffer = [
      'name: x',
      'method: GET',
      'url: https://x.com/api?page2=15',
      'query:',
      '  - key: page',
      "    value: '1'",
      '    enabled: true',
    ].join('\n');
    const projected = projectRequestYaml(buffer);
    expect(projected).not.toBeNull();
    expect(projected).toContain('url: https://x.com/api');
    expect(projected).not.toContain('?page2=15');
    expect(projected).toContain('key: page2');
    expect(projected).toContain('value: "15"');
    // The pre-existing page=1 row survives.
    expect(projected).toContain('key: page');
    expect(projected).toContain('value: "1"');
  });

  it('rewrites a URL with a {name} placeholder into a pathParams entry', () => {
    const buffer = ['name: x', 'method: GET', 'url: https://x.com/users/{userId}'].join('\n');
    const projected = projectRequestYaml(buffer);
    expect(projected).not.toBeNull();
    expect(projected).toContain('pathParams:');
    expect(projected).toContain('userId:');
  });

  it('returns null when the YAML fails to parse (no rewrite — let writeFile surface the error)', () => {
    expect(projectRequestYaml('::: not yaml :::')).toBeNull();
    expect(projectRequestYaml('name: x\nmethod: NOPE\nurl: https://x.com')).toBeNull();
  });
});
