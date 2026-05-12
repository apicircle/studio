import { describe, expect, it } from 'vitest';
import { parseUrlencoded, serializeUrlencoded } from './UrlencodedEditor';

describe('parseUrlencoded', () => {
  it('returns one empty enabled row for empty input', () => {
    expect(parseUrlencoded('')).toEqual([{ key: '', value: '', enabled: true }]);
    expect(parseUrlencoded('   ')).toEqual([{ key: '', value: '', enabled: true }]);
  });

  it('parses simple a=1&b=2', () => {
    expect(parseUrlencoded('a=1&b=2')).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true },
    ]);
  });

  it('decodes percent-encoded keys + values', () => {
    expect(parseUrlencoded('first%20name=Ada%20Lovelace')).toEqual([
      { key: 'first name', value: 'Ada Lovelace', enabled: true },
    ]);
  });

  it('decodes + as space (form encoding)', () => {
    expect(parseUrlencoded('q=hello+world')).toEqual([
      { key: 'q', value: 'hello world', enabled: true },
    ]);
  });

  it('handles missing value', () => {
    expect(parseUrlencoded('flag&q=x')).toEqual([
      { key: 'flag', value: '', enabled: true },
      { key: 'q', value: 'x', enabled: true },
    ]);
  });

  it('survives malformed percent escapes', () => {
    expect(parseUrlencoded('a=%E')).toEqual([{ key: 'a', value: '%E', enabled: true }]);
  });
});

describe('serializeUrlencoded', () => {
  it('round-trips simple rows', () => {
    expect(
      serializeUrlencoded([
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: true },
      ]),
    ).toBe('a=1&b=2');
  });

  it('skips disabled rows', () => {
    expect(
      serializeUrlencoded([
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: false },
        { key: 'c', value: '3', enabled: true },
      ]),
    ).toBe('a=1&c=3');
  });

  it('skips rows with empty key', () => {
    expect(
      serializeUrlencoded([
        { key: '', value: 'x', enabled: true },
        { key: 'a', value: '1', enabled: true },
      ]),
    ).toBe('a=1');
  });

  it('percent-encodes spaces + reserved chars', () => {
    expect(serializeUrlencoded([{ key: 'first name', value: 'Ada Lovelace', enabled: true }])).toBe(
      'first%20name=Ada%20Lovelace',
    );
    expect(serializeUrlencoded([{ key: 'q', value: 'a&b=c', enabled: true }])).toBe('q=a%26b%3Dc');
  });

  it('parse + serialize round-trips', () => {
    const wire = 'first%20name=Ada%20Lovelace&age=42';
    expect(serializeUrlencoded(parseUrlencoded(wire))).toBe(wire);
  });
});
