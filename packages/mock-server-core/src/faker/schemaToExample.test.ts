import { describe, expect, it } from 'vitest';
import { schemaToExample } from './schemaToExample';

describe('schemaToExample', () => {
  it('honors `example` first', () => {
    expect(schemaToExample({ type: 'string', example: 'alice' })).toBe('alice');
  });

  it('honors `default` when no example', () => {
    expect(schemaToExample({ type: 'integer', default: 42 })).toBe(42);
  });

  it('honors `const`', () => {
    expect(schemaToExample({ const: 'PINNED' })).toBe('PINNED');
  });

  it('returns the first enum value', () => {
    expect(schemaToExample({ enum: ['admin', 'user'] })).toBe('admin');
  });

  it('builds primitives by type', () => {
    expect(schemaToExample({ type: 'string' })).toBe('string');
    expect(schemaToExample({ type: 'integer' })).toBe(0);
    expect(schemaToExample({ type: 'number' })).toBe(0);
    expect(schemaToExample({ type: 'boolean' })).toBe(false);
    expect(schemaToExample({ type: 'null' })).toBeNull();
  });

  it('uses format defaults for known string formats', () => {
    expect(schemaToExample({ type: 'string', format: 'email' })).toBe('user@example.com');
    expect(schemaToExample({ type: 'string', format: 'uuid' })).toMatch(/^[0-9a-f-]{36}$/);
    expect(schemaToExample({ type: 'string', format: 'date-time' })).toMatch(
      /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/,
    );
  });

  it('builds objects from required props', () => {
    const out = schemaToExample({
      type: 'object',
      properties: {
        id: { type: 'integer' },
        name: { type: 'string' },
        email: { type: 'string', format: 'email' },
      },
      required: ['id', 'name'],
    });
    expect(out).toEqual({ id: 0, name: 'string' });
  });

  it('builds objects from all props when required is missing', () => {
    const out = schemaToExample({
      type: 'object',
      properties: { id: { type: 'integer' }, flag: { type: 'boolean' } },
    });
    expect(out).toEqual({ id: 0, flag: false });
  });

  it('builds arrays with one sample item', () => {
    expect(schemaToExample({ type: 'array', items: { type: 'string' } })).toEqual(['string']);
  });

  it('picks the first branch for allOf / oneOf / anyOf', () => {
    expect(schemaToExample({ allOf: [{ const: 'A' }, { const: 'B' }] })).toBe('A');
    expect(schemaToExample({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('string');
    expect(schemaToExample({ anyOf: [{ type: 'integer' }, { type: 'string' }] })).toBe(0);
  });

  it('prefers non-null when type is an array', () => {
    expect(schemaToExample({ type: ['null', 'string'] })).toBe('string');
  });

  it('returns null when schema is undefined', () => {
    expect(schemaToExample(undefined)).toBeNull();
  });
});
