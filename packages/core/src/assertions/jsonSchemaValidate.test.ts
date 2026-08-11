import { describe, expect, it } from 'vitest';
import { validateJsonSchema, type JsonSchema } from './jsonSchemaValidate';

describe('validateJsonSchema', () => {
  it('accepts any value for an empty schema (an unresolved field)', () => {
    expect(validateJsonSchema({}, 42)).toBeNull();
    expect(validateJsonSchema({}, { a: 1 })).toBeNull();
    expect(validateJsonSchema({}, null)).toBeNull();
  });

  it('checks scalar types, including integer vs number', () => {
    expect(validateJsonSchema({ type: 'string' }, 'x')).toBeNull();
    expect(validateJsonSchema({ type: 'boolean' }, true)).toBeNull();
    expect(validateJsonSchema({ type: 'number' }, 1.5)).toBeNull();
    expect(validateJsonSchema({ type: 'integer' }, 3)).toBeNull();
    expect(validateJsonSchema({ type: 'integer' }, 3.5)).toBe(
      '$: expected type integer, got number',
    );
    expect(validateJsonSchema({ type: 'string' }, 5)).toBe('$: expected type string, got number');
    expect(validateJsonSchema({ type: 'null' }, null)).toBeNull();
  });

  it('supports a nullable field as a type array', () => {
    const s: JsonSchema = { type: ['string', 'null'] };
    expect(validateJsonSchema(s, 'x')).toBeNull();
    expect(validateJsonSchema(s, null)).toBeNull();
    expect(validateJsonSchema(s, 7)).toBe('$: expected type string|null, got number');
  });

  it('validates enums (and reports the allowed set)', () => {
    expect(validateJsonSchema({ enum: ['a', 'b'] }, 'b')).toBeNull();
    expect(validateJsonSchema({ enum: ['a', 'b'] }, 'c')).toBe(
      '$: expected one of ["a","b"], got "c"',
    );
    expect(validateJsonSchema({ enum: [1, 2] }, { x: 1 })).toBe(
      '$: expected one of [1,2], got object',
    );
  });

  it('validates object required + property types with a rooted path', () => {
    const s: JsonSchema = {
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
      required: ['id', 'name'],
      additionalProperties: false,
    };
    expect(validateJsonSchema(s, { id: 1, name: 'a' })).toBeNull();
    expect(validateJsonSchema(s, { id: 1 })).toBe('$.name: required property missing');
    expect(validateJsonSchema(s, { id: 'x', name: 'a' })).toBe(
      '$.id: expected type integer, got string',
    );
  });

  it('rejects unexpected properties when additionalProperties is false, and quotes odd keys', () => {
    const s: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'number' } },
      required: ['a'],
      additionalProperties: false,
    };
    expect(validateJsonSchema(s, { a: 1, extra: 2 })).toBe('$.extra: unexpected property');
    const odd: JsonSchema = { type: 'object', properties: {}, additionalProperties: false };
    expect(validateJsonSchema(odd, { 'a b': 1 })).toBe('$["a b"]: unexpected property');
  });

  it('allows extra properties when additionalProperties is not false', () => {
    const s: JsonSchema = { type: 'object', properties: { a: { type: 'number' } } };
    expect(validateJsonSchema(s, { a: 1, extra: 'ok' })).toBeNull();
  });

  it('validates array element shapes and passes on an empty array', () => {
    const s: JsonSchema = {
      type: 'array',
      items: {
        type: 'object',
        properties: { title: { type: 'string' } },
        required: ['title'],
        additionalProperties: false,
      },
    };
    expect(validateJsonSchema(s, [])).toBeNull(); // empty array is valid — no false-fail
    expect(validateJsonSchema(s, [{ title: 'a' }, { title: 'b' }])).toBeNull();
    expect(validateJsonSchema(s, [{ title: 'a' }, { title: 2 }])).toBe(
      '$[1].title: expected type string, got number',
    );
  });

  it('recurses deeply (array of objects with a nested object)', () => {
    const s: JsonSchema = {
      type: 'object',
      properties: {
        articles: {
          type: 'array',
          items: {
            type: 'object',
            properties: {
              author: {
                type: 'object',
                properties: { username: { type: 'string' } },
                required: ['username'],
                additionalProperties: false,
              },
            },
            required: ['author'],
            additionalProperties: false,
          },
        },
      },
      required: ['articles'],
      additionalProperties: false,
    };
    expect(validateJsonSchema(s, { articles: [{ author: { username: 'jane' } }] })).toBeNull();
    expect(validateJsonSchema(s, { articles: [{ author: { username: 9 } }] })).toBe(
      '$.articles[0].author.username: expected type string, got number',
    );
  });

  it('validates a string pattern (format), passing non-strings through', () => {
    const s: JsonSchema = { type: 'string', pattern: '^[0-9a-f]{4}$' };
    expect(validateJsonSchema(s, 'ab12')).toBeNull();
    expect(validateJsonSchema(s, 'zzzz')).toBe('$: "zzzz" does not match /^[0-9a-f]{4}$/');
    // A pattern with no `type` constraint is skipped for a non-string value.
    expect(validateJsonSchema({ pattern: '^x$' }, 5)).toBeNull();
  });

  it('handles an object schema with required but no properties, and an unparseable pattern', () => {
    // `required` without a `properties` map → the missing-key check still runs; extras allowed.
    const req: JsonSchema = { type: 'object', required: ['x'] };
    expect(validateJsonSchema(req, { x: 1, y: 2 })).toBeNull();
    expect(validateJsonSchema(req, { y: 2 })).toBe('$.x: required property missing');
    // An unparseable regex pattern can't fail the value.
    expect(validateJsonSchema({ type: 'string', pattern: '(' }, 'anything')).toBeNull();
  });

  it('reports the root type mismatch before descending', () => {
    const s: JsonSchema = {
      type: 'object',
      properties: { a: { type: 'string' } },
      required: ['a'],
      additionalProperties: false,
    };
    expect(validateJsonSchema(s, [1, 2])).toBe('$: expected type object, got array');
    expect(validateJsonSchema(s, null)).toBe('$: expected type object, got null');
  });
});
