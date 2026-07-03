import { describe, expect, it } from 'vitest';
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
