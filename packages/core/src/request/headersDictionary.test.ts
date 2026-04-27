import { describe, expect, it } from 'vitest';
import {
  HTTP_HEADERS_MAP,
  getHeaderEntry,
  getHeaderValues,
  suggestHeaders,
} from './headersDictionary';

describe('HTTP_HEADERS_MAP', () => {
  it('contains the canonical Content-Type entry', () => {
    const ct = HTTP_HEADERS_MAP.find((h) => h.name === 'Content-Type');
    expect(ct).toBeDefined();
    expect(ct!.values).toContain('application/json');
  });
});

describe('suggestHeaders', () => {
  it('returns all suggestable headers when prefix is empty', () => {
    const result = suggestHeaders('');
    expect(result.length).toBeGreaterThan(5);
    // No 'reserved: app' headers in the dictionary right now, but this is the
    // contract for when they're added.
    expect(result.every((h) => h.reserved !== 'app')).toBe(true);
  });

  it('filters by case-insensitive prefix', () => {
    const result = suggestHeaders('cont');
    expect(result.map((h) => h.name)).toEqual(
      expect.arrayContaining(['Content-Type', 'Content-Length']),
    );
  });

  it('returns sorted alphabetically', () => {
    const names = suggestHeaders('').map((h) => h.name);
    const sorted = [...names].sort();
    expect(names).toEqual(sorted);
  });

  it('respects an optional limit on filtered results', () => {
    const result = suggestHeaders('a', 1);
    expect(result).toHaveLength(1);
  });

  it('respects an optional limit on the full list', () => {
    const result = suggestHeaders('', 3);
    expect(result).toHaveLength(3);
  });
});

describe('getHeaderValues / getHeaderEntry', () => {
  it('returns values for a known header (case-insensitive)', () => {
    expect(getHeaderValues('content-type')).toContain('application/json');
    expect(getHeaderValues('CONTENT-TYPE')).toContain('application/xml');
  });

  it('returns empty array for an unknown header', () => {
    expect(getHeaderValues('X-Made-Up-Header')).toEqual([]);
  });

  it('returns the entry object for a known header', () => {
    const entry = getHeaderEntry('Authorization');
    expect(entry).toBeDefined();
    expect(entry!.description).toMatch(/credentials/i);
  });

  it('returns undefined for an unknown header', () => {
    expect(getHeaderEntry('not-real')).toBeUndefined();
  });
});
