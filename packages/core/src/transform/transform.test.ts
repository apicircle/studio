import { describe, expect, it } from 'vitest';
import { toToon } from './toon';
import { toYaml } from './yaml';
import { toCsv } from './csv';
import { computeTransformSavings } from './computeSavings';

describe('toToon', () => {
  it('drops quotes and braces around flat objects', () => {
    expect(toToon({ id: 1, name: 'alice' })).toBe('id: 1\nname: alice');
  });

  it('emits tabular form for arrays of homogeneous flat objects', () => {
    const out = toToon([
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ]);
    expect(out).toBe('[2]{id,name}:\n  1,alice\n  2,bob');
  });

  it('falls back to indented form for arrays whose objects diverge', () => {
    const out = toToon([
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob', extra: 'x' },
    ]);
    expect(out).toContain('- id: 1');
    expect(out).toContain('extra: x');
  });

  it('quotes strings that contain delimiters or look like reserved words', () => {
    expect(toToon({ a: 'hello, world' })).toBe('a: "hello, world"');
    expect(toToon({ a: 'true' })).toBe('a: "true"');
    expect(toToon({ a: '' })).toBe('a: ""');
  });

  it('handles empty containers', () => {
    expect(toToon([])).toBe('[]');
    expect(toToon({})).toBe('{}');
  });
});

describe('toCsv', () => {
  it('emits a header row plus one row per object', () => {
    expect(
      toCsv([
        { id: 1, name: 'alice' },
        { id: 2, name: 'bob' },
      ]),
    ).toBe('id,name\n1,alice\n2,bob');
  });

  it('quotes cells containing commas, quotes, or newlines', () => {
    expect(toCsv([{ a: 'one, two', b: 'has "quote"' }])).toBe('a,b\n"one, two","has ""quote"""');
  });

  it('returns null for non-arrays, empty arrays, or non-homogeneous rows', () => {
    expect(toCsv({ a: 1 })).toBeNull();
    expect(toCsv([])).toBeNull();
    expect(toCsv([{ a: 1 }, { b: 2 }])).toBeNull();
    expect(toCsv([{ a: { nested: true } }])).toBeNull();
  });
});

describe('toYaml', () => {
  it('emits flat block-style for objects', () => {
    expect(toYaml({ id: 1, name: 'alice' })).toBe('id: 1\nname: alice');
  });

  it('uses one list item per row for arrays (no TOON-style tabular shorthand)', () => {
    const out = toYaml([
      { id: 1, name: 'alice' },
      { id: 2, name: 'bob' },
    ]);
    expect(out).toBe('- id: 1\n  name: alice\n- id: 2\n  name: bob');
  });

  it('quotes scalars that would otherwise deserialize as YAML booleans/numbers', () => {
    expect(toYaml({ a: 'true' })).toBe('a: "true"');
    expect(toYaml({ a: 'no' })).toBe('a: "no"');
    expect(toYaml({ a: '42' })).toBe('a: "42"');
  });
});

describe('computeTransformSavings', () => {
  const tabularJson = JSON.stringify(
    [
      { id: 1, name: 'alice', active: true },
      { id: 2, name: 'bob', active: false },
      { id: 3, name: 'carol', active: true },
    ],
    null,
    2,
  );

  it('returns no candidates for non-JSON content', () => {
    const out = computeTransformSavings('hello world', 'text/plain');
    expect(out.candidates).toHaveLength(0);
    expect(out.originalBytes).toBeGreaterThan(0);
    expect(out.minifiedBytes).toBe(out.originalBytes);
  });

  it('returns no candidates for malformed JSON', () => {
    const out = computeTransformSavings('{not json', 'application/json');
    expect(out.candidates).toHaveLength(0);
  });

  it('reports minifiedBytes < originalBytes when the body is pretty-printed', () => {
    const out = computeTransformSavings(tabularJson, 'application/json');
    expect(out.minifiedBytes).toBeLessThan(out.originalBytes);
  });

  it('reports minifiedBytes === originalBytes when the body is already compact', () => {
    const compact = JSON.stringify({ id: 1, name: 'alice' });
    const out = computeTransformSavings(compact, 'application/json');
    expect(out.minifiedBytes).toBe(out.originalBytes);
  });

  it('produces toon + yaml + csv candidates for tabular array data — NOT minified-json', () => {
    const out = computeTransformSavings(tabularJson, 'application/json');
    const formats = out.candidates.map((c) => c.format);
    // Minification is treated as a baseline, not a "transformation".
    expect(formats).not.toContain('minified-json');
    expect(formats).toContain('toon');
    expect(formats).toContain('csv');
  });

  it('measures percentSaved against the minified baseline, not the pretty body', () => {
    const out = computeTransformSavings(tabularJson, 'application/json');
    const toon = out.candidates.find((c) => c.format === 'toon');
    expect(toon).toBeDefined();
    if (toon) {
      const expected = Math.round((1 - toon.bytes / out.minifiedBytes) * 1000) / 10;
      expect(toon.percentSaved).toBe(expected);
    }
  });

  it('sorts candidates by percentSaved descending', () => {
    const out = computeTransformSavings(tabularJson, 'application/json');
    for (let i = 1; i < out.candidates.length; i++) {
      expect(out.candidates[i - 1].percentSaved).toBeGreaterThanOrEqual(
        out.candidates[i].percentSaved,
      );
    }
  });

  it('drops candidates that do not beat the minified baseline', () => {
    // Primitive root: minified === JSON.stringify(42); TOON also "42".
    // Nothing should be smaller, so candidates must be empty.
    const out = computeTransformSavings(JSON.stringify(42), 'application/json');
    expect(out.candidates).toHaveLength(0);
  });

  it('sniffs JSON content even without a content-type header', () => {
    const out = computeTransformSavings(tabularJson);
    expect(out.candidates.length).toBeGreaterThan(0);
  });
});
