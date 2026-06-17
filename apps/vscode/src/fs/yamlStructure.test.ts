import { describe, it, expect } from 'vitest';
import { unknownTopLevelKeys, isPresentNonArray, isPresentNonMapping } from './yamlStructure';

describe('unknownTopLevelKeys', () => {
  it('returns empty array when every key is in the allowlist', () => {
    const out = unknownTopLevelKeys({ name: 'x', method: 'GET' }, ['name', 'method', 'url']);
    expect(out).toEqual([]);
  });

  it('returns keys not in the allowlist (preserving input order)', () => {
    const out = unknownTopLevelKeys({ name: 'x', defaultRespons: {}, methodd: 'GET' }, [
      'name',
      'method',
    ]);
    expect(out).toEqual(['defaultRespons', 'methodd']);
  });

  it('treats the allowlist as a set (duplicates do not matter)', () => {
    const out = unknownTopLevelKeys({ a: 1, b: 2 }, ['a', 'a', 'a']);
    expect(out).toEqual(['b']);
  });

  it('handles an empty object', () => {
    expect(unknownTopLevelKeys({}, ['a', 'b'])).toEqual([]);
  });
});

describe('isPresentNonArray', () => {
  it('returns false for undefined and null', () => {
    expect(isPresentNonArray(undefined)).toBe(false);
    expect(isPresentNonArray(null)).toBe(false);
  });

  it('returns false for arrays', () => {
    expect(isPresentNonArray([])).toBe(false);
    expect(isPresentNonArray([1, 2])).toBe(false);
  });

  it('returns true for objects, strings, numbers, booleans', () => {
    expect(isPresentNonArray({})).toBe(true);
    expect(isPresentNonArray({ a: 1 })).toBe(true);
    expect(isPresentNonArray('')).toBe(true);
    expect(isPresentNonArray('x')).toBe(true);
    expect(isPresentNonArray(0)).toBe(true);
    expect(isPresentNonArray(false)).toBe(true);
  });
});

describe('isPresentNonMapping', () => {
  it('returns false for undefined and null', () => {
    expect(isPresentNonMapping(undefined)).toBe(false);
    expect(isPresentNonMapping(null)).toBe(false);
  });

  it('returns false for plain objects', () => {
    expect(isPresentNonMapping({})).toBe(false);
    expect(isPresentNonMapping({ a: 1 })).toBe(false);
  });

  it('returns true for arrays (arrays are objects but not mappings)', () => {
    expect(isPresentNonMapping([])).toBe(true);
    expect(isPresentNonMapping([1, 2])).toBe(true);
  });

  it('returns true for non-object scalars', () => {
    expect(isPresentNonMapping('x')).toBe(true);
    expect(isPresentNonMapping(0)).toBe(true);
    expect(isPresentNonMapping(true)).toBe(true);
  });
});
