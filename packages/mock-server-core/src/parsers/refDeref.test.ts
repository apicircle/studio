import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { dereferenceInternal } from './refDeref';

describe('dereferenceInternal', () => {
  it('returns primitives and null untouched', () => {
    expect(dereferenceInternal(null)).toEqual({ doc: null, warnings: [] });
    expect(dereferenceInternal(42)).toEqual({ doc: 42, warnings: [] });
    expect(dereferenceInternal('x')).toEqual({ doc: 'x', warnings: [] });
  });

  it('inlines an in-document $ref (OpenAPI 3 #/components)', () => {
    const root = {
      components: { schemas: { Pet: { type: 'object', properties: { id: { type: 'integer' } } } } },
      paths: { '/pets': { get: { schema: { $ref: '#/components/schemas/Pet' } } } },
    };
    const { doc, warnings } = dereferenceInternal(root);
    expect(warnings).toEqual([]);
    const resolved = (doc as typeof root).paths['/pets'].get.schema;
    expect(resolved).toEqual({ type: 'object', properties: { id: { type: 'integer' } } });
  });

  it('resolves Swagger 2.0 #/definitions pointers', () => {
    const root = {
      definitions: { Tag: { type: 'string' } },
      paths: { '/t': { get: { responses: { '200': { schema: { $ref: '#/definitions/Tag' } } } } } },
    };
    const { doc, warnings } = dereferenceInternal(root);
    expect(warnings).toEqual([]);
    expect((doc as typeof root).paths['/t'].get.responses['200'].schema).toEqual({
      type: 'string',
    });
  });

  it('resolves a $ref nested inside array items', () => {
    const root = {
      components: { schemas: { Pet: { type: 'object' } } },
      data: [{ $ref: '#/components/schemas/Pet' }, { keep: true }],
    };
    const { doc } = dereferenceInternal(root);
    expect((doc as typeof root).data[0]).toEqual({ type: 'object' });
    expect((doc as typeof root).data[1]).toEqual({ keep: true });
  });

  it('decodes escaped pointer segments (~1 → /, ~0 → ~)', () => {
    const root = {
      // property name literally contains both a slash and a tilde: "/a~1b"
      paths: { '/a~1b': { note: 'slashy' } },
      ref: { $ref: '#/paths/~1a~01b' },
    };
    const { doc } = dereferenceInternal(root);
    // '~1a~01b' decodes (~1→'/', ~0→'~') to the key '/a~1b'
    expect((doc as { ref: unknown }).ref).toEqual({ note: 'slashy' });
  });

  it('breaks reference cycles with {} instead of looping', () => {
    const root = {
      components: {
        schemas: {
          Node: {
            type: 'object',
            properties: { next: { $ref: '#/components/schemas/Node' } },
          },
        },
      },
      entry: { $ref: '#/components/schemas/Node' },
    };
    const { doc } = dereferenceInternal(root);
    const entry = (doc as { entry: { properties: { next: unknown } } }).entry;
    expect(entry).toMatchObject({ type: 'object' });
    // The self-reference is broken to {} — no infinite structure.
    expect(entry.properties.next).toEqual({});
  });

  it('warns once for an external $ref and leaves it in place', () => {
    const root = {
      a: { $ref: './other.yaml#/Foo' },
      b: { $ref: './other.yaml#/Foo' },
      c: { $ref: 'https://example.com/spec.json#/Bar' },
    };
    const { doc, warnings } = dereferenceInternal(root);
    expect((doc as typeof root).a).toEqual({ $ref: './other.yaml#/Foo' });
    // De-duplicated: one warning per distinct external ref (2 distinct here).
    expect(warnings).toHaveLength(2);
    expect(warnings[0]).toContain('External $ref not resolved in the web app');
    expect(warnings[0]).toContain('./other.yaml#/Foo');
  });

  it('warns for an unresolved in-document $ref and substitutes {}', () => {
    const root = { ref: { $ref: '#/components/schemas/Missing' } };
    const { doc, warnings } = dereferenceInternal(root);
    expect((doc as { ref: unknown }).ref).toEqual({});
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain('Unresolved internal $ref');
  });

  it('expands a shared (non-cyclic) $ref used in sibling branches', () => {
    const root = {
      components: { schemas: { Id: { type: 'string' } } },
      x: { $ref: '#/components/schemas/Id' },
      y: { $ref: '#/components/schemas/Id' },
    };
    const { doc, warnings } = dereferenceInternal(root);
    expect(warnings).toEqual([]);
    expect((doc as typeof root).x).toEqual({ type: 'string' });
    expect((doc as typeof root).y).toEqual({ type: 'string' });
    // Every use shares ONE resolved object — the copy never grows past the input.
    expect((doc as typeof root).x).toBe((doc as typeof root).y);
    expect((doc as typeof root).x).toBe((doc as typeof root).components.schemas.Id);
  });

  it('keeps a node the input shares (a YAML alias) shared in the copy', () => {
    const root = yaml.load(
      ['components: { schemas: { Id: &id { type: string } } }', 'a: *id', 'b: [*id, *id]'].join(
        '\n',
      ),
    ) as { a: unknown; b: unknown[] };
    const { doc } = dereferenceInternal(root);
    const out = doc as typeof root;
    expect(out.a).toEqual({ type: 'string' });
    expect(out.b[0]).toBe(out.a);
    expect(out.b[1]).toBe(out.a);
    // Still a copy, never the input's own object.
    expect(out.a).not.toBe(root.a);
  });

  it('breaks an object or array that contains itself with {}', () => {
    const node: Record<string, unknown> = { a: 1 };
    node.self = node;
    const list: unknown[] = ['x'];
    list.push(list);
    const { doc, warnings } = dereferenceInternal({ node, list });
    expect(warnings).toEqual([]);
    expect((doc as { node: unknown }).node).toEqual({ a: 1, self: {} });
    expect((doc as { list: unknown }).list).toEqual(['x', {}]);
  });

  it('breaks a chain of $refs that leads back to itself', () => {
    const root = {
      components: {
        schemas: {
          A: { $ref: '#/components/schemas/B' },
          B: { $ref: '#/components/schemas/A' },
        },
      },
      entry: { $ref: '#/components/schemas/A' },
    };
    const { doc, warnings } = dereferenceInternal(root);
    expect(warnings).toEqual([]);
    expect((doc as { entry: unknown }).entry).toEqual({});
  });

  it('resolves mutually recursive schemas once, cutting where the walk comes back', () => {
    const root = {
      paths: { a: { $ref: '#/components/schemas/A' }, b: { $ref: '#/components/schemas/B' } },
      components: {
        schemas: {
          A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
          B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
        },
      },
    };
    const { doc } = dereferenceInternal(root);
    const paths = (doc as { paths: { a: unknown; b: unknown } }).paths;
    // A was reached first, so the walk came back to it from inside B.
    expect(paths.a).toEqual({
      type: 'object',
      properties: { b: { type: 'object', properties: { a: {} } } },
    });
    // B resolved once, inside A, and every later use shares that object.
    expect(paths.b).toBe((paths.a as { properties: { b: unknown } }).properties.b);
  });

  it('does not mutate the input document', () => {
    const root = {
      components: { schemas: { Pet: { type: 'object' } } },
      ref: { $ref: '#/components/schemas/Pet' },
    };
    dereferenceInternal(root);
    expect(root.ref).toEqual({ $ref: '#/components/schemas/Pet' });
  });
});
