import type { Request as ApiRequest } from '@apicircle-v2/shared';
import { describe, expect, it } from 'vitest';
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
  it('returns null for body type "none"', () => {
    expect(composeBody({ type: 'none', content: '{"x":1}' })).toBeNull();
  });

  it('returns the raw content for json/text/xml/graphql', () => {
    expect(composeBody({ type: 'json', content: '{"x":1}' })).toBe('{"x":1}');
    expect(composeBody({ type: 'text', content: 'hello' })).toBe('hello');
    expect(composeBody({ type: 'xml', content: '<root/>' })).toBe('<root/>');
    expect(composeBody({ type: 'graphql', content: 'query { x }' })).toBe('query { x }');
  });

  it('serializes urlencoded body from key=value lines', () => {
    const body = composeBody({ type: 'urlencoded', content: 'a=1\nb=hello world\nc=' });
    expect(body).toBe('a=1&b=hello+world&c=');
  });

  it('skips lines without "="', () => {
    const body = composeBody({ type: 'urlencoded', content: 'a=1\njust a line\nb=2' });
    expect(body).toBe('a=1&b=2');
  });

  it('skips lines with empty key', () => {
    const body = composeBody({ type: 'urlencoded', content: '=ignored\na=1' });
    expect(body).toBe('a=1');
  });

  it('forwards form-data and binary content as-is for now', () => {
    expect(composeBody({ type: 'form-data', content: 'raw' })).toBe('raw');
    expect(composeBody({ type: 'binary', content: 'raw' })).toBe('raw');
  });
});

describe('buildRequest', () => {
  it('composes all four pieces from a Request', () => {
    const req: ApiRequest = {
      id: 'r1',
      name: 'Get user',
      folderId: null,
      method: 'POST',
      url: 'https://api.example.com/users',
      headers: [{ key: 'X-Auth', value: 't', enabled: true }],
      query: [{ key: 'verbose', value: 'true', enabled: true }],
      body: { type: 'json', content: '{"x":1}' },
      contextVars: [],
      assertions: [],
      createdAt: '2026-04-27T00:00:00.000Z',
      updatedAt: '2026-04-27T00:00:00.000Z',
    };
    expect(buildRequest(req)).toEqual({
      url: 'https://api.example.com/users?verbose=true',
      method: 'POST',
      headers: { 'X-Auth': 't' },
      body: '{"x":1}',
    });
  });
});
