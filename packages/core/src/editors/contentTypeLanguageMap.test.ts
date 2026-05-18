import { describe, expect, it } from 'vitest';
import {
  getLanguageFromBodyType,
  getLanguageFromContentType,
  normalizeContentType,
} from './contentTypeLanguageMap';

describe('normalizeContentType', () => {
  it('lower-cases + strips parameters', () => {
    expect(normalizeContentType('Application/JSON; charset=utf-8')).toBe('application/json');
  });
  it('returns empty string when input is falsy', () => {
    expect(normalizeContentType()).toBe('');
    expect(normalizeContentType('')).toBe('');
  });
});

describe('getLanguageFromContentType', () => {
  it('maps the canonical types', () => {
    expect(getLanguageFromContentType('application/json')).toBe('json');
    expect(getLanguageFromContentType('text/xml')).toBe('xml');
    expect(getLanguageFromContentType('text/html')).toBe('html');
    expect(getLanguageFromContentType('application/graphql')).toBe('graphql');
    expect(getLanguageFromContentType('application/javascript')).toBe('javascript');
    expect(getLanguageFromContentType('text/plain')).toBe('plaintext');
  });

  it('honors +json / +xml suffixes', () => {
    expect(getLanguageFromContentType('application/vnd.api+json')).toBe('json');
    expect(getLanguageFromContentType('application/vnd.atom+xml')).toBe('xml');
  });

  it('falls back to plaintext for unknown types', () => {
    expect(getLanguageFromContentType('application/octet-stream')).toBe('plaintext');
    expect(getLanguageFromContentType()).toBe('plaintext');
  });

  it('strips charset parameters before mapping', () => {
    expect(getLanguageFromContentType('application/json; charset=utf-8')).toBe('json');
  });
});

describe('getLanguageFromBodyType', () => {
  it('maps each body type to the right Monaco language', () => {
    expect(getLanguageFromBodyType('json')).toBe('json');
    expect(getLanguageFromBodyType('xml')).toBe('xml');
    expect(getLanguageFromBodyType('graphql')).toBe('graphql');
    expect(getLanguageFromBodyType('text')).toBe('plaintext');
    expect(getLanguageFromBodyType('urlencoded')).toBe('plaintext');
    expect(getLanguageFromBodyType('form-data')).toBe('plaintext');
    expect(getLanguageFromBodyType('binary')).toBe('plaintext');
    expect(getLanguageFromBodyType('none')).toBe('plaintext');
  });
});
