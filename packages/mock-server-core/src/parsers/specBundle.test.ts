import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { BUNDLED_DOCUMENTS_KEY, bundleSpec, parseSpecText } from './specBundle';
import { dereferenceInternal, UNRESOLVED_KEY } from './refDeref';
import { parseOpenApiToEndpoints } from './openapi';

const json = (value: unknown): string => JSON.stringify(value);
const docs = (entries: Record<string, unknown>): Map<string, string> =>
  new Map(
    Object.entries(entries).map(([k, v]) => [k, typeof v === 'string' ? v : JSON.stringify(v)]),
  );

/** The bundled document, parsed. */
function bundled(text: string): Record<string, unknown> {
  return JSON.parse(text) as Record<string, unknown>;
}

/** Bundle, dereference, and return the resolved document. */
function resolved(rootDoc: unknown, documents: Map<string, string>, filename = 'openapi.json') {
  const out = bundleSpec({ text: json(rootDoc), filename }, documents);
  const { doc, warnings } = dereferenceInternal(parseSpecText(out.text, 'x.json')!.doc);
  return { out, doc: doc as Record<string, any>, derefWarnings: warnings };
}

const spec = (schemaRef: string, extra: Record<string, unknown> = {}) => ({
  openapi: '3.0.3',
  info: { title: 'T', version: '1' },
  paths: {
    '/users': {
      get: {
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: schemaRef } } },
          },
        },
      },
    },
  },
  ...extra,
});

const userSchema = (path: string) => (doc: Record<string, any>) =>
  doc.paths[path].get.responses['200'].content['application/json'].schema;

describe('bundleSpec — a self-contained spec', () => {
  it('returns the text byte for byte, in its own format, with no references', () => {
    const text = '{\n  "openapi": "3.0.0",   "paths": {}\n}';
    const out = bundleSpec({ text, filename: 'openapi.json' }, new Map());
    expect(out).toEqual({ text, format: 'json', references: [], warnings: [] });
  });

  it('leaves the root its own in-document refs and a ref back to its own file name', () => {
    const root = {
      openapi: '3.0.0',
      a: { $ref: '#/components/schemas/Id' },
      b: { $ref: './openapi.json#/components/schemas/Id' },
      components: { schemas: { Id: { type: 'string' } } },
    };
    const out = bundleSpec({ text: json(root), filename: 'specs/openapi.json' }, new Map());
    const doc = bundled(out.text);
    expect(doc.a).toEqual({ $ref: '#/components/schemas/Id' });
    expect(doc.b).toEqual({ $ref: '#/components/schemas/Id' });
    expect(out.references).toEqual([]);
  });

  it('gives back unparseable or non-object text untouched', () => {
    expect(bundleSpec({ text: '{ nope: [', filename: 'a.json' }, new Map())).toEqual({
      text: '{ nope: [',
      format: 'json',
      references: [],
      warnings: [],
    });
    expect(bundleSpec({ text: '"just a string"', filename: 'a.json' }, new Map()).text).toBe(
      '"just a string"',
    );
  });
});

describe('bundleSpec — documents a spec points at', () => {
  it('embeds a supplied file and rewrites a fragment ref into it', () => {
    const { out, doc, derefWarnings } = resolved(
      spec('schemas/user.json#/User'),
      docs({
        'schemas/user.json': { User: { type: 'object', properties: { id: { type: 'string' } } } },
      }),
    );
    expect(out.references).toEqual([{ target: 'schemas/user.json', supplied: true }]);
    expect(out.format).toBe('json');
    const raw = bundled(out.text);
    expect(Object.keys(raw).pop()).toBe(BUNDLED_DOCUMENTS_KEY);
    expect(userSchema('/users')(raw as Record<string, any>)).toEqual({
      $ref: '#/x-apicircle-documents/schemas~1user.json/User',
    });
    expect(derefWarnings).toEqual([]);
    expect(userSchema('/users')(doc)).toEqual({
      type: 'object',
      properties: { id: { type: 'string' } },
    });
  });

  it('rewrites a whole-file ref, a backslash path and a percent-encoded name', () => {
    const root = spec('./pet.json', {
      components: {
        schemas: {
          A: { $ref: 'schemas\\a.json' },
          B: { $ref: 'my%20pet.json#/B' },
        },
      },
    });
    const { out, doc } = resolved(
      root,
      docs({
        'pet.json': { type: 'string' },
        'schemas/a.json': { type: 'integer' },
        'my pet.json': { B: { type: 'boolean' } },
      }),
    );
    // In document order: `paths` comes before `components`.
    expect(out.references.map((r) => r.target)).toEqual([
      'pet.json',
      'schemas/a.json',
      'my pet.json',
    ]);
    expect(userSchema('/users')(doc)).toEqual({ type: 'string' });
    expect(doc.components.schemas.A).toEqual({ type: 'integer' });
    expect(doc.components.schemas.B).toEqual({ type: 'boolean' });
    expect(bundled(out.text).components).toMatchObject({
      schemas: { B: { $ref: '#/x-apicircle-documents/my%20pet.json/B' } },
    });
  });

  it("resolves a supplied file's refs against its own folder, its in-file refs, and refs back to the root", () => {
    const { out, doc } = resolved(
      spec('schemas/user.json#/User', {
        components: { schemas: { Id: { type: 'string', format: 'uuid' } } },
      }),
      docs({
        'schemas/user.json': {
          User: {
            type: 'object',
            properties: {
              id: { $ref: '../openapi.json#/components/schemas/Id' },
              address: { $ref: '../common/address.json#/Address' },
              tags: { $ref: '#/Tags' },
            },
          },
          Tags: { type: 'array', items: { type: 'string' } },
        },
        'common/address.json': {
          Address: { type: 'object', properties: { zip: { type: 'string' } } },
        },
      }),
    );
    expect(out.references).toEqual([
      { target: 'schemas/user.json', supplied: true },
      { target: 'common/address.json', supplied: true },
    ]);
    expect(userSchema('/users')(doc).properties).toEqual({
      id: { type: 'string', format: 'uuid' },
      address: { type: 'object', properties: { zip: { type: 'string' } } },
      tags: { type: 'array', items: { type: 'string' } },
    });
  });

  it('keeps a `..` above the root, and an absolute path, as their own targets', () => {
    const out = bundleSpec(
      {
        text: json({
          a: { $ref: '../shared/errors.json#/E' },
          b: { $ref: '/abs/../x.json' },
          c: { $ref: './../../up.json' },
        }),
        filename: 'openapi.json',
      },
      new Map(),
    );
    expect(out.references.map((r) => r.target).sort()).toEqual([
      '../../up.json',
      '../shared/errors.json',
      '/x.json',
    ]);
    expect(out.references.every((r) => !r.supplied)).toBe(true);
  });

  it('reads a stray % in a file name literally', () => {
    const out = bundleSpec(
      { text: json({ a: { $ref: '50%off.json' } }), filename: 'o.json' },
      new Map(),
    );
    expect(out.references).toEqual([{ target: '50%off.json', supplied: false }]);
  });

  it('turns a cycle across files into an in-document cycle the resolver cuts', () => {
    const { doc, derefWarnings } = resolved(
      spec('a.json#/A'),
      docs({
        'a.json': { A: { type: 'object', properties: { b: { $ref: 'b.json#/B' } } } },
        'b.json': { B: { type: 'object', properties: { a: { $ref: 'a.json#/A' } } } },
      }),
    );
    expect(derefWarnings).toEqual([]);
    expect(userSchema('/users')(doc).properties.b.properties.a).toEqual({
      [UNRESOLVED_KEY]: 'cycle',
    });
  });

  it('names a URL target without fetching it, and resolves refs inside a supplied URL document against it', () => {
    const url = 'https://example.com/specs/common.json';
    const unsupplied = bundleSpec(
      { text: json(spec(`${url}#/User`)), filename: 'openapi.json' },
      new Map(),
    );
    expect(unsupplied.references).toEqual([{ target: url, supplied: false }]);
    expect(unsupplied.text).toBe(json(spec(`${url}#/User`)));

    const { out, doc } = resolved(
      spec(`${url}#/User`),
      docs({
        [url]: { User: { type: 'object', properties: { org: { $ref: 'org.json#/Org' } } } },
        'https://example.com/specs/org.json': { Org: { type: 'string' } },
      }),
    );
    expect(out.references.map((r) => r.target)).toEqual([
      url,
      'https://example.com/specs/org.json',
    ]);
    expect(userSchema('/users')(doc).properties.org).toEqual({ type: 'string' });
  });

  it('leaves a relative ref it cannot resolve against a non-hierarchical URL as written', () => {
    const out = bundleSpec(
      { text: json(spec('urn:specs:user#/User')), filename: 'openapi.json' },
      docs({ 'urn:specs:user': { User: { $ref: './other.json' } } }),
    );
    expect(out.references.map((r) => r.target)).toEqual(['urn:specs:user', './other.json']);
  });

  it('reports the files a supplied file reaches, supplied or not', () => {
    const out = bundleSpec(
      { text: json(spec('schemas/user.json#/User')), filename: 'openapi.json' },
      docs({ 'schemas/user.json': { User: { $ref: './address.json#/A' } } }),
    );
    expect(out.references).toEqual([
      { target: 'schemas/user.json', supplied: true },
      { target: 'schemas/address.json', supplied: false },
    ]);
    // The missing file's ref is left exactly as written inside the embedded copy.
    const embedded = (bundled(out.text)[BUNDLED_DOCUMENTS_KEY] as Record<string, any>)[
      'schemas/user.json'
    ];
    expect(embedded.User).toEqual({ $ref: './address.json#/A' });
  });

  it('treats a supplied file it cannot read as missing, and says so once', () => {
    const out = bundleSpec(
      {
        text: json({ a: { $ref: 'bad.json#/X' }, b: { $ref: 'bad.json#/Y' } }),
        filename: 'openapi.json',
      },
      docs({ 'bad.json': '{ nope: [' }),
    );
    expect(out.references).toEqual([{ target: 'bad.json', supplied: false }]);
    expect(out.warnings).toEqual(['Referenced file "bad.json" could not be read as JSON or YAML.']);
    expect(bundled(out.text).a).toEqual({ $ref: 'bad.json#/X' });

    const scalar = bundleSpec(
      { text: json({ a: { $ref: 'n.json' } }), filename: 'openapi.json' },
      docs({ 'n.json': '42' }),
    );
    expect(scalar.references).toEqual([{ target: 'n.json', supplied: false }]);
  });

  it('rewrites a ref met through a YAML alias once', () => {
    const shared = ['Shared: &s { $ref: "./inner.yaml#/I" }', 'A: *s', 'B: [*s, *s]'].join('\n');
    const { out, doc } = resolved(
      { a: { $ref: 'shared.yaml#/A' }, b: { $ref: 'shared.yaml#/B' } },
      new Map([
        ['shared.yaml', shared],
        ['inner.yaml', 'I: { type: string }'],
      ]),
    );
    expect(out.references.map((r) => r.target)).toEqual(['shared.yaml', 'inner.yaml']);
    expect(doc.a).toEqual({ type: 'string' });
    expect(doc.b).toEqual([{ type: 'string' }, { type: 'string' }]);
  });

  it('walks the siblings of a $ref, which OpenAPI 3.1 allows', () => {
    const out = bundleSpec(
      {
        text: json({ s: { $ref: 'a.json', allOf: [{ $ref: 'b.json' }] } }),
        filename: 'openapi.json',
      },
      new Map(),
    );
    expect(out.references.map((r) => r.target)).toEqual(['a.json', 'b.json']);
  });

  it('warns about, and leaves, a plain-name fragment', () => {
    const out = bundleSpec(
      { text: json({ a: { $ref: 'a.json#Pet' }, b: { $ref: 'a.json#Pet' } }), filename: 'o.json' },
      docs({ 'a.json': {} }),
    );
    expect(out.warnings).toEqual([
      '$ref "a.json#Pet" uses a plain-name fragment, which is not resolved.',
    ]);
    expect(out.references).toEqual([]);
  });
});

describe('bundleSpec — data positions are not references', () => {
  it('neither reports nor rewrites a $ref inside example, default, enum, const, examples or an Example value', () => {
    const root = {
      components: {
        schemas: {
          Pet: {
            type: 'object',
            example: { $ref: './ex1.json' },
            default: { $ref: './ex2.json' },
            enum: [{ $ref: './ex3.json' }],
            const: { $ref: './ex4.json' },
            examples: [{ $ref: './ex5.json' }],
            // A PROPERTY called `example` is a schema, and its refs are references.
            properties: { example: { $ref: './real.json' } },
          },
        },
        examples: { E: { value: { $ref: './ex6.json' }, externalValue: 'ex7.json' } },
      },
      paths: {
        '/p': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': {
                    examples: { shared: { $ref: './examples.json#/Shared' } },
                  },
                },
              },
            },
          },
        },
      },
    };
    const out = bundleSpec({ text: json(root), filename: 'openapi.json' }, new Map());
    expect(out.references.map((r) => r.target).sort()).toEqual(['examples.json', 'real.json']);
  });
});

describe('bundleSpec — output', () => {
  const root = spec('user.yaml#/User');
  const userYaml = 'User: { type: object, properties: { id: { type: string } } }';

  it('writes YAML without anchors when asked, keeping root key order', () => {
    const out = bundleSpec(
      { text: yaml.dump(root), filename: 'openapi.yaml' },
      new Map([['user.yaml', userYaml]]),
      { output: 'yaml' },
    );
    expect(out.format).toBe('yaml');
    expect(out.text).not.toMatch(/[&*]\w/);
    const doc = yaml.load(out.text) as Record<string, unknown>;
    expect(Object.keys(doc)).toEqual(['openapi', 'info', 'paths', BUNDLED_DOCUMENTS_KEY]);
  });

  it('writes JSON for the parsers by default once anything changed', () => {
    const out = bundleSpec(
      { text: yaml.dump(root), filename: 'openapi.yaml' },
      new Map([['user.yaml', userYaml]]),
    );
    expect(out.format).toBe('json');
    expect(out.text.startsWith('{\n  "openapi"')).toBe(true);
  });

  it('converts an unchanged spec when another format is asked for', () => {
    const out = bundleSpec({ text: json({ openapi: '3.0.0' }), filename: 'a.json' }, new Map(), {
      output: 'yaml',
    });
    expect(out).toMatchObject({ text: 'openapi: 3.0.0\n', format: 'yaml' });
  });

  it('leaves a bundle unchanged when bundled again, and merges files supplied later into it', () => {
    const first = bundleSpec(
      { text: json(spec('user.yaml#/User')), filename: 'openapi.json' },
      new Map([['user.yaml', 'User: { $ref: "./more.yaml#/M" }']]),
    );
    const again = bundleSpec({ text: first.text, filename: 'openapi.bundled.json' }, new Map());
    expect(again.text).toBe(first.text);

    const merged = bundleSpec(
      { text: json({ ...bundled(first.text), extra: { $ref: 'late.json' } }), filename: 'o.json' },
      docs({ 'late.json': { type: 'string' } }),
    );
    expect(Object.keys(bundled(merged.text)[BUNDLED_DOCUMENTS_KEY] as object)).toEqual([
      'user.yaml',
      'late.json',
    ]);
  });

  it('falls back to the uploaded text, with a warning, when the result cannot be written', () => {
    const out = bundleSpec(
      { text: json({ a: { $ref: 'loop.yaml#/X' } }), filename: 'openapi.json' },
      new Map([['loop.yaml', 'X: &x\n  self: *x\n']]),
    );
    expect(out.text).toBe(json({ a: { $ref: 'loop.yaml#/X' } }));
    expect(out.format).toBe('json');
    expect(out.warnings[0]).toMatch(/^The bundled spec could not be written as JSON \(/);

    const asYaml = bundleSpec(
      { text: json({ a: { $ref: 'loop.yaml#/X' } }), filename: 'openapi.json' },
      new Map([['loop.yaml', 'X: &x\n  self: *x\n']]),
      { output: 'yaml' },
    );
    expect(asYaml.warnings[0]).toMatch(/^The bundled spec could not be written as YAML \(/);
  });
});

describe('bundleSpec — a split spec through the parser', () => {
  it('reads operations held in other files and their full schemas', async () => {
    const root = {
      openapi: '3.0.3',
      info: { title: 'Split', version: '1' },
      paths: { '/pets': { $ref: 'paths/pets.yaml' } },
    };
    const pets = [
      'get:',
      '  responses:',
      "    '200':",
      '      description: ok',
      '      content:',
      '        application/json:',
      "          schema: { $ref: '../schemas/pet.yaml#/Pet' }",
    ].join('\n');
    const pet = 'Pet: { type: object, required: [name], properties: { name: { type: string } } }';
    const out = bundleSpec(
      { text: json(root), filename: 'openapi.json' },
      new Map([
        ['paths/pets.yaml', pets],
        ['schemas/pet.yaml', pet],
      ]),
    );
    const { endpoints, warnings } = await parseOpenApiToEndpoints(out.text, out.format);
    expect(warnings).toEqual([]);
    expect(endpoints).toHaveLength(1);
    expect(JSON.parse(endpoints[0].defaultResponse.body.content)).toEqual({ name: 'string' });
  });
});

describe('parseSpecText', () => {
  it('reads by extension, then by content, then the other format', () => {
    expect(parseSpecText('{"a":1}', 'x.json')).toEqual({ doc: { a: 1 }, format: 'json' });
    expect(parseSpecText('a: 1', 'x.yml')).toEqual({ doc: { a: 1 }, format: 'yaml' });
    expect(parseSpecText('a: 1', 'x.yaml')).toEqual({ doc: { a: 1 }, format: 'yaml' });
    expect(parseSpecText('{"a":1}')).toEqual({ doc: { a: 1 }, format: 'json' });
    expect(parseSpecText('a: 1')).toEqual({ doc: { a: 1 }, format: 'yaml' });
    // Mislabelled: YAML in a .json file still reads, as YAML.
    expect(parseSpecText('a: 1', 'x.json')).toEqual({ doc: { a: 1 }, format: 'yaml' });
    expect(parseSpecText('{ nope: [', 'x.json')).toBeNull();
  });
});
