import { describe, it, expect } from 'vitest';
import { flattenJsonToRows, renderContextVarsBlock } from './mapContextVarsFromJson';

describe('flattenJsonToRows', () => {
  it('flattens a flat object into key/value rows', () => {
    expect(flattenJsonToRows({ scope: 'read', id: 42 })).toEqual([
      { key: 'scope', value: 'read' },
      { key: 'id', value: '42' },
    ]);
  });

  it('joins nested object keys with dots', () => {
    expect(flattenJsonToRows({ user: { id: 1, name: 'Ada' } })).toEqual([
      { key: 'user.id', value: '1' },
      { key: 'user.name', value: 'Ada' },
    ]);
  });

  it('uses array indices for array members', () => {
    expect(flattenJsonToRows({ tags: ['a', 'b'] })).toEqual([
      { key: 'tags.0', value: 'a' },
      { key: 'tags.1', value: 'b' },
    ]);
  });

  it('handles deeply nested arrays of objects', () => {
    expect(
      flattenJsonToRows({
        orders: [
          { id: 'o1', total: 10 },
          { id: 'o2', total: 20 },
        ],
      }),
    ).toEqual([
      { key: 'orders.0.id', value: 'o1' },
      { key: 'orders.0.total', value: '10' },
      { key: 'orders.1.id', value: 'o2' },
      { key: 'orders.1.total', value: '20' },
    ]);
  });

  it('stringifies booleans + null literals', () => {
    expect(flattenJsonToRows({ active: true, parent: null })).toEqual([
      { key: 'active', value: 'true' },
      { key: 'parent', value: 'null' },
    ]);
  });

  it('returns [] for an empty object', () => {
    expect(flattenJsonToRows({})).toEqual([]);
  });
});

describe('renderContextVarsBlock', () => {
  it('writes a contextVars: header + key/value rows', () => {
    const text = renderContextVarsBlock([
      { key: 'user.id', value: '1' },
      { key: 'user.name', value: 'Ada' },
    ]);
    expect(text).toBe(
      [
        'contextVars:',
        `  - key: 'user.id'`,
        `    value: '1'`,
        `  - key: 'user.name'`,
        `    value: 'Ada'`,
      ].join('\n') + '\n',
    );
  });

  it('double-quotes values that contain YAML special chars', () => {
    const text = renderContextVarsBlock([{ key: 'note', value: 'hello: world' }]);
    expect(text).toContain('"hello: world"');
  });
});
