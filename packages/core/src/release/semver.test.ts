import { describe, expect, it } from 'vitest';
import { compareSemver, isValidSemver, parseSemver, sortVersionsDesc } from './semver';

describe('parseSemver', () => {
  it('parses major.minor.patch', () => {
    expect(parseSemver('1.2.3')).toEqual({
      major: 1,
      minor: 2,
      patch: 3,
      prerelease: null,
      build: null,
    });
  });

  it('parses prerelease + build', () => {
    expect(parseSemver('1.0.0-rc.1+exp.sha.5114f')).toEqual({
      major: 1,
      minor: 0,
      patch: 0,
      prerelease: 'rc.1',
      build: 'exp.sha.5114f',
    });
  });

  it('returns null for non-semver strings', () => {
    expect(parseSemver('1.2')).toBeNull();
    expect(parseSemver('v1.2.3')).toBeNull();
    expect(parseSemver('1.2.3.4')).toBeNull();
    expect(parseSemver('')).toBeNull();
  });

  it('isValidSemver agrees with parse', () => {
    expect(isValidSemver('1.0.0')).toBe(true);
    expect(isValidSemver('not-a-version')).toBe(false);
  });
});

describe('compareSemver', () => {
  it('orders by major then minor then patch', () => {
    expect(Math.sign(compareSemver('2.0.0', '1.99.99'))).toBe(1);
    expect(Math.sign(compareSemver('1.0.1', '1.0.0'))).toBe(1);
    expect(compareSemver('1.0.0', '1.0.0')).toBe(0);
  });

  it('treats a release as greater than its prerelease', () => {
    expect(Math.sign(compareSemver('1.0.0', '1.0.0-rc.1'))).toBe(1);
    expect(Math.sign(compareSemver('1.0.0-rc.1', '1.0.0'))).toBe(-1);
  });

  it('orders prereleases by dot-separated identifiers', () => {
    expect(Math.sign(compareSemver('1.0.0-alpha', '1.0.0-beta'))).toBe(-1);
    expect(Math.sign(compareSemver('1.0.0-rc.1', '1.0.0-rc.2'))).toBe(-1);
    expect(Math.sign(compareSemver('1.0.0-rc.10', '1.0.0-rc.2'))).toBe(1);
  });

  it('numeric prerelease identifiers sort before alpha', () => {
    expect(Math.sign(compareSemver('1.0.0-1', '1.0.0-alpha'))).toBe(-1);
  });
});

describe('sortVersionsDesc', () => {
  it('returns newest first', () => {
    expect(sortVersionsDesc(['1.0.0', '1.2.0', '1.1.0'])).toEqual(['1.2.0', '1.1.0', '1.0.0']);
  });

  it('keeps releases above prereleases of the same triple', () => {
    expect(sortVersionsDesc(['1.0.0-rc.1', '1.0.0', '0.9.0'])).toEqual([
      '1.0.0',
      '1.0.0-rc.1',
      '0.9.0',
    ]);
  });
});
