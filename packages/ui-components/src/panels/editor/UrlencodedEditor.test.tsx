import { describe, expect, it } from 'vitest';
import { parseUrlencoded, serializeUrlencoded } from './UrlencodedEditor';

// `body.content` for urlencoded is the raw, newline-delimited `key=value`
// format that `buildRequest.composeBody` consumes — values are stored
// verbatim and percent-encoded only at send time.

describe('parseUrlencoded', () => {
  it('returns one empty enabled row for empty input', () => {
    expect(parseUrlencoded('')).toEqual([{ key: '', value: '', enabled: true }]);
    expect(parseUrlencoded('   ')).toEqual([{ key: '', value: '', enabled: true }]);
  });

  it('parses newline-delimited a=1 / b=2', () => {
    expect(parseUrlencoded('a=1\nb=2')).toEqual([
      { key: 'a', value: '1', enabled: true },
      { key: 'b', value: '2', enabled: true },
    ]);
  });

  it('keeps keys + values verbatim — no percent-decoding', () => {
    expect(parseUrlencoded('first name=Ada Lovelace')).toEqual([
      { key: 'first name', value: 'Ada Lovelace', enabled: true },
    ]);
  });

  it('keeps reserved characters in the value as a single row', () => {
    expect(parseUrlencoded('q=a b&c=d')).toEqual([{ key: 'q', value: 'a b&c=d', enabled: true }]);
  });

  it('splits each line on the first = so values may contain =', () => {
    expect(parseUrlencoded('token=a=b=c')).toEqual([
      { key: 'token', value: 'a=b=c', enabled: true },
    ]);
  });

  it('handles a line with no value', () => {
    expect(parseUrlencoded('flag\nq=x')).toEqual([
      { key: 'flag', value: '', enabled: true },
      { key: 'q', value: 'x', enabled: true },
    ]);
  });

  it('preserves {{variable}} references for send-time resolution', () => {
    expect(parseUrlencoded('auth={{TOKEN}}')).toEqual([
      { key: 'auth', value: '{{TOKEN}}', enabled: true },
    ]);
  });
});

describe('serializeUrlencoded', () => {
  it('round-trips simple rows as newline-delimited lines', () => {
    expect(
      serializeUrlencoded([
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: true },
      ]),
    ).toBe('a=1\nb=2');
  });

  it('skips disabled rows', () => {
    expect(
      serializeUrlencoded([
        { key: 'a', value: '1', enabled: true },
        { key: 'b', value: '2', enabled: false },
        { key: 'c', value: '3', enabled: true },
      ]),
    ).toBe('a=1\nc=3');
  });

  it('skips rows with empty key', () => {
    expect(
      serializeUrlencoded([
        { key: '', value: 'x', enabled: true },
        { key: 'a', value: '1', enabled: true },
      ]),
    ).toBe('a=1');
  });

  it('stores values verbatim — encoding happens at send time', () => {
    expect(serializeUrlencoded([{ key: 'first name', value: 'Ada Lovelace', enabled: true }])).toBe(
      'first name=Ada Lovelace',
    );
    expect(serializeUrlencoded([{ key: 'q', value: 'a&b=c', enabled: true }])).toBe('q=a&b=c');
  });

  it('preserves {{variable}} references verbatim', () => {
    expect(serializeUrlencoded([{ key: 'auth', value: '{{TOKEN}}', enabled: true }])).toBe(
      'auth={{TOKEN}}',
    );
  });

  it('parse + serialize round-trips', () => {
    const content = 'first name=Ada Lovelace\nage=42';
    expect(serializeUrlencoded(parseUrlencoded(content))).toBe(content);
  });
});
