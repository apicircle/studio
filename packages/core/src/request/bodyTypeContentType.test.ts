import { describe, expect, it } from 'vitest';
import {
  applyContentTypeForBodyType,
  getBodyTypeForContentType,
  getContentTypeForBodyType,
  type HeaderEntry,
} from './bodyTypeContentType';

describe('getContentTypeForBodyType', () => {
  it('maps every body type', () => {
    expect(getContentTypeForBodyType('none')).toBeNull();
    expect(getContentTypeForBodyType('json')).toBe('application/json');
    expect(getContentTypeForBodyType('text')).toBe('text/plain');
    expect(getContentTypeForBodyType('xml')).toBe('application/xml');
    expect(getContentTypeForBodyType('graphql')).toBe('application/graphql');
    expect(getContentTypeForBodyType('form-data')).toBe('multipart/form-data');
    expect(getContentTypeForBodyType('urlencoded')).toBe('application/x-www-form-urlencoded');
    expect(getContentTypeForBodyType('binary')).toBe('application/octet-stream');
  });
});

describe('getBodyTypeForContentType', () => {
  it.each([
    ['application/json', 'json'],
    ['application/json; charset=utf-8', 'json'],
    ['APPLICATION/JSON', 'json'],
    ['text/plain', 'text'],
    ['application/xml', 'xml'],
    ['text/xml', 'xml'],
    ['application/graphql', 'graphql'],
    ['multipart/form-data; boundary=---abc', 'form-data'],
    ['application/x-www-form-urlencoded', 'urlencoded'],
    ['application/octet-stream', 'binary'],
  ])('reverse-maps %s → %s', (ct, expected) => {
    expect(getBodyTypeForContentType(ct)).toBe(expected);
  });

  it('returns null for unknown types', () => {
    expect(getBodyTypeForContentType('image/png')).toBeNull();
    expect(getBodyTypeForContentType('weird/thing')).toBeNull();
  });

  it('returns null for empty input', () => {
    expect(getBodyTypeForContentType('')).toBeNull();
    expect(getBodyTypeForContentType(';charset=utf-8')).toBeNull();
  });
});

describe('applyContentTypeForBodyType', () => {
  const enabled = (k: string, v: string): HeaderEntry => ({ key: k, value: v, enabled: true });

  it('appends Content-Type when none exists', () => {
    const result = applyContentTypeForBodyType([], 'json');
    expect(result).toEqual([{ key: 'Content-Type', value: 'application/json', enabled: true }]);
  });

  it('updates an existing Content-Type entry in place (preserves order)', () => {
    const headers = [enabled('Accept', 'application/json'), enabled('Content-Type', 'text/plain')];
    const result = applyContentTypeForBodyType(headers, 'json');
    expect(result).toEqual([
      enabled('Accept', 'application/json'),
      enabled('Content-Type', 'application/json'),
    ]);
  });

  it('matches Content-Type case-insensitively', () => {
    const headers = [enabled('content-type', 'text/plain')];
    const result = applyContentTypeForBodyType(headers, 'xml');
    expect(result).toEqual([enabled('content-type', 'application/xml')]);
  });

  it('strips Content-Type when body type is none', () => {
    const headers = [enabled('Accept', '*/*'), enabled('Content-Type', 'application/json')];
    const result = applyContentTypeForBodyType(headers, 'none');
    expect(result).toEqual([enabled('Accept', '*/*')]);
  });

  it('is a no-op when removing a missing Content-Type', () => {
    const headers = [enabled('Accept', '*/*')];
    expect(applyContentTypeForBodyType(headers, 'none')).toBe(headers);
  });
});
