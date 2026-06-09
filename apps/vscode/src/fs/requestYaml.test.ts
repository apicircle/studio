import { describe, it, expect } from 'vitest';
import type { Request } from '@apicircle/shared';
import { serializeRequestToYaml, parseRequestFromYaml, RequestYamlParseError } from './requestYaml';

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
    expect(yaml).toMatch(/APICircle Request/);
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

  it('warns but does not throw when query/headers row is malformed', () => {
    const { patch, warnings } = parseRequestFromYaml(
      'name: x\nmethod: GET\nurl: https://x.com\nheaders:\n  - junk\n  - {key: A, value: B, enabled: true}',
    );
    expect(warnings.length).toBeGreaterThan(0);
    expect(patch.headers).toHaveLength(2);
  });
});
