import { describe, expect, it } from 'vitest';
import {
  EXAMPLE_MAX_DEPTH,
  ExampleBudget,
  exampleFromData,
  exampleFromSchema,
  schemaToExample,
  type JsonSchemaLike,
} from './schemaToExample';

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

  it('samples an array with no `items` schema as one null item', () => {
    expect(schemaToExample({ type: 'array' })).toEqual([null]);
  });

  it('picks the first branch for allOf / oneOf / anyOf', () => {
    expect(schemaToExample({ allOf: [{ const: 'A' }, { const: 'B' }] })).toBe('A');
    expect(schemaToExample({ oneOf: [{ type: 'string' }, { type: 'integer' }] })).toBe('string');
    expect(schemaToExample({ anyOf: [{ type: 'integer' }, { type: 'string' }] })).toBe(0);
  });

  it('prefers non-null when type is an array', () => {
    expect(schemaToExample({ type: ['null', 'string'] })).toBe('string');
    // …and falls back to the first entry when null is all there is.
    expect(schemaToExample({ type: ['null'] })).toBeNull();
  });

  it('returns null when schema is undefined', () => {
    expect(schemaToExample(undefined)).toBeNull();
  });

  it('tolerates malformed schema fields instead of throwing', () => {
    // `required: true` is a common Swagger-2-ism inside an OpenAPI 3 schema.
    const notAList = { type: 'object', properties: { a: { type: 'integer' } }, required: true };
    expect(schemaToExample(notAList as unknown as JsonSchemaLike)).toEqual({ a: 0 });
    // A `type` that is neither a string nor a list of strings reads as no type.
    expect(schemaToExample({ type: 5 } as unknown as JsonSchemaLike)).toEqual({});
    expect(schemaToExample({ type: [5] } as unknown as JsonSchemaLike)).toEqual({});
    // A format named after an Object.prototype member is just an unknown format.
    expect(schemaToExample({ type: 'string', format: 'constructor' })).toBe('string');
    // A JSON Schema boolean (`true` = "anything") in a property position.
    const anyValue = { type: 'object', properties: { any: true } };
    expect(schemaToExample(anyValue as unknown as JsonSchemaLike)).toEqual({ any: {} });
  });
});

// A dereferenced document is not always a tree: swagger-parser (the Node
// surfaces) leaves an in-document cycle as a real object cycle, and both
// resolvers share one object between every use of a `$ref`.
describe('schemaToExample — recursive schemas', () => {
  it('builds a self-referencing schema without overflowing the stack', () => {
    // Category { name, children: Category[] }, no `required` — the shape that
    // threw "Maximum call stack size exceeded" on Desktop / CLI / MCP.
    const category: JsonSchemaLike = { type: 'object', properties: { name: { type: 'string' } } };
    category.properties!.children = { type: 'array', items: category };
    expect(schemaToExample(category)).toEqual({ name: 'string', children: [{}] });
  });

  it('answers a revisited array schema with an empty array', () => {
    const tree: JsonSchemaLike = { type: 'array' };
    tree.items = tree;
    expect(schemaToExample(tree)).toEqual([[]]);
  });

  it('cuts a cycle that runs through a compositor', () => {
    const node: JsonSchemaLike = { type: 'object' };
    node.allOf = [node];
    expect(schemaToExample(node)).toEqual({});
  });

  it('expands a schema shared by sibling properties in full each time — sharing is not a cycle', () => {
    const address: JsonSchemaLike = { type: 'object', properties: { city: { type: 'string' } } };
    const order: JsonSchemaLike = {
      type: 'object',
      properties: { billing: address, shipping: address },
    };
    expect(schemaToExample(order)).toEqual({
      billing: { city: 'string' },
      shipping: { city: 'string' },
    });
  });
});

describe('schemaToExample — bounded by the operation budget', () => {
  /** `levels` of objects whose `width` properties all share the level below:
   *  a few dozen objects that expand to width ** levels leaves. */
  function fanOut(levels: number, width: number): JsonSchemaLike {
    let node: JsonSchemaLike = { type: 'string' };
    for (let level = 0; level < levels; level += 1) {
      const properties: Record<string, JsonSchemaLike> = {};
      for (let p = 0; p < width; p += 1) properties[`p${p}`] = node;
      node = { type: 'object', properties };
    }
    return node;
  }

  it('cuts a fan-out that would expand to 10^10 nodes, keeping the first branch whole', () => {
    const budget = new ExampleBudget();
    const out = exampleFromSchema(fanOut(10, 10), budget);
    expect(budget.truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(1_000_000);
    let first: unknown = out;
    for (let level = 0; level < 10; level += 1) first = (first as Record<string, unknown>).p0;
    expect(first).toBe('string');
  });

  it('leaves objects past the budget empty and keeps primitives, across every call on it', () => {
    const budget = new ExampleBudget(1);
    const schema: JsonSchemaLike = {
      type: 'object',
      properties: {
        nested: { type: 'object', properties: { a: { type: 'string' } } },
        n: { type: 'integer' },
      },
    };
    expect(exampleFromSchema(schema, budget)).toEqual({ nested: {}, n: 0 });
    expect(budget.truncated).toBe(true);
    // The same budget carries into the next example of the same operation.
    expect(exampleFromSchema({ type: 'array', items: { type: 'string' } }, budget)).toEqual([]);
  });

  it('stops nesting at EXAMPLE_MAX_DEPTH and reports the cut', () => {
    let deep: JsonSchemaLike = { type: 'string' };
    for (let i = 0; i < 100; i += 1) deep = { type: 'object', properties: { next: deep } };
    const budget = new ExampleBudget();
    let cur = exampleFromSchema(deep, budget) as Record<string, unknown>;
    let levels = 0;
    while ('next' in cur) {
      levels += 1;
      cur = cur.next as Record<string, unknown>;
    }
    expect(levels).toBe(EXAMPLE_MAX_DEPTH);
    expect(cur).toEqual({});
    expect(budget.truncated).toBe(true);
  });

  it('does not report a cycle cut as a truncation', () => {
    const category: JsonSchemaLike = { type: 'object', properties: {} };
    category.properties!.parent = category;
    const budget = new ExampleBudget();
    expect(exampleFromSchema(category, budget)).toEqual({ parent: {} });
    expect(budget.truncated).toBe(false);
  });
});

describe('exampleFromData — explicit example data', () => {
  it('cuts a value that contains itself where it closes', () => {
    const data: Record<string, unknown> = { id: 1 };
    data.self = data;
    expect(schemaToExample({ example: data })).toEqual({ id: 1, self: {} });
  });

  it('bounds a YAML-alias style bomb by the budget', () => {
    let bomb: unknown = 'lol';
    for (let i = 0; i < 40; i += 1) bomb = [bomb, bomb];
    const budget = new ExampleBudget();
    const out = exampleFromSchema({ example: bomb }, budget);
    expect(budget.truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(1_000_000);
  });

  it('never cuts literal data, however large — only repeats cost budget', () => {
    const rows = Array.from({ length: 20_000 }, (_, id) => ({ id, name: 'x'.repeat(200) }));
    const budget = new ExampleBudget();
    expect(exampleFromData(rows, budget)).toEqual(rows);
    expect(budget.truncated).toBe(false);
  });

  it('charges repeated text by its length, so an aliased long string cannot multiply', () => {
    const row = ['x'.repeat(10_000), 7, true];
    const rows = Array.from({ length: 1_000 }, () => row); // 10 MB of text if serialised whole
    const budget = new ExampleBudget();
    const out = exampleFromData(rows, budget) as unknown[][];
    expect(budget.truncated).toBe(true);
    expect(JSON.stringify(out).length).toBeLessThan(1_000_000);
    // The first sighting is whole; a repeat past the budget keeps its shape, not its text.
    expect(out[0]).toEqual(row);
    expect(out[999]).toEqual([]);
  });

  it("charges a schema's own long example text on every visit", () => {
    const long: JsonSchemaLike = { type: 'string', example: 'y'.repeat(6_500) };
    const properties: Record<string, JsonSchemaLike> = {};
    for (let i = 0; i < 500; i += 1) properties[`f${i}`] = long;
    const budget = new ExampleBudget();
    const out = exampleFromSchema({ type: 'object', properties }, budget) as Record<string, string>;
    expect(budget.truncated).toBe(true);
    expect(out.f0).toHaveLength(6_500);
    // The visit that could still pay for itself but not for its text answers
    // with empty text; past the budget a string schema answers generically.
    expect(Object.values(out)).toContain('');
    expect(out.f499).toBe('string');
    expect(JSON.stringify(out).length).toBeLessThan(1_000_000);
  });

  it('stops nesting at EXAMPLE_MAX_DEPTH', () => {
    let nested: unknown = 'leaf';
    for (let i = 0; i < 100; i += 1) nested = { next: nested };
    const budget = new ExampleBudget();
    let cur = exampleFromData(nested, budget) as Record<string, unknown>;
    let levels = 0;
    while ('next' in cur) {
      levels += 1;
      cur = cur.next as Record<string, unknown>;
    }
    expect(levels).toBe(EXAMPLE_MAX_DEPTH);
    expect(budget.truncated).toBe(true);
  });

  it('serialises exactly as the original does', () => {
    const budget = new ExampleBudget();
    const parsed: unknown = JSON.parse('{"__proto__":{"x":1},"a":[1,{"b":null}],"2":"two"}');
    expect(JSON.stringify(exampleFromData(parsed, budget))).toBe(JSON.stringify(parsed));
    const bare = Object.create(null) as Record<string, unknown>;
    bare.k = 'v';
    expect(JSON.stringify(exampleFromData(bare, budget))).toBe('{"k":"v"}');
  });

  it('passes values that are not plain containers through untouched', () => {
    const when = new Date(0);
    const budget = new ExampleBudget();
    expect(exampleFromData(when, budget)).toBe(when);
    expect(exampleFromData('text', budget)).toBe('text');
    expect(exampleFromData(null, budget)).toBeNull();
    expect(schemaToExample({ default: when })).toBe(when);
  });
});
