import { describe, it, expect } from 'vitest';
import { walkJsonPaths } from './extractionPicker';

describe('walkJsonPaths', () => {
  it('walks a flat object', () => {
    const leaves = walkJsonPaths({ a: 1, b: 'x' });
    expect(leaves).toEqual([
      { path: '$.a', value: '1' },
      { path: '$.b', value: '"x"' },
    ]);
  });

  it('walks nested objects with dot paths', () => {
    const leaves = walkJsonPaths({ user: { id: '123', email: 'a@b.com' } });
    expect(leaves).toEqual([
      { path: '$.user.id', value: '"123"' },
      { path: '$.user.email', value: '"a@b.com"' },
    ]);
  });

  it('walks arrays with bracket indices', () => {
    const leaves = walkJsonPaths({ items: [{ id: 'a' }, { id: 'b' }] });
    expect(leaves.map((l) => l.path)).toEqual(['$.items[0].id', '$.items[1].id']);
  });

  it('quotes non-identifier keys with bracket+single-quote', () => {
    const leaves = walkJsonPaths({ 'kebab-key': 1, 'space key': 2 });
    expect(leaves.map((l) => l.path).sort()).toEqual(["$['kebab-key']", "$['space key']"]);
  });

  it('represents empty arrays + empty objects as leaf values', () => {
    const leaves = walkJsonPaths({ a: [], b: {} });
    expect(leaves).toEqual([
      { path: '$.a', value: '[]' },
      { path: '$.b', value: '{}' },
    ]);
  });

  it('represents null as a leaf', () => {
    const leaves = walkJsonPaths({ a: null });
    expect(leaves).toEqual([{ path: '$.a', value: 'null' }]);
  });

  it('truncates long string values to 60 chars with ellipsis', () => {
    const longStr = 'x'.repeat(200);
    const leaves = walkJsonPaths({ a: longStr });
    expect(leaves[0].value.length).toBeLessThan(70);
    expect(leaves[0].value).toContain('…');
  });

  it('caps total leaf count at 500', () => {
    const huge = Object.fromEntries(Array.from({ length: 1000 }, (_, i) => [`k${i}`, i]));
    const leaves = walkJsonPaths(huge);
    expect(leaves.length).toBe(500);
  });

  it('handles top-level primitives', () => {
    const leaves = walkJsonPaths('hello');
    expect(leaves).toEqual([{ path: '$', value: '"hello"' }]);
  });

  it('handles top-level arrays', () => {
    const leaves = walkJsonPaths([{ id: 'a' }, { id: 'b' }]);
    expect(leaves.map((l) => l.path)).toEqual(['$[0].id', '$[1].id']);
  });

  it('handles deeply nested arrays + objects', () => {
    const leaves = walkJsonPaths({ a: [{ b: { c: 'deep' } }] });
    expect(leaves).toEqual([{ path: '$.a[0].b.c', value: '"deep"' }]);
  });
});
