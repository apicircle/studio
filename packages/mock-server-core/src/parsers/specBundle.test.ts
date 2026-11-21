import { describe, expect, it } from 'vitest';
import yaml from 'js-yaml';
import { BUNDLED_DOCUMENTS_KEY, bundleSpec, bundleSpecAsync, parseSpecText } from './specBundle';
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

describe('bundleSpec — text documents are not schema references', () => {
  /** A Redocly-style spec: a Markdown description and code samples beside a schema ref. */
  const redocly = (extra: Record<string, unknown> = {}) => ({
    openapi: '3.0.3',
    info: { title: 'T', version: '1', description: { $ref: './description.md' } },
    paths: {
      '/keys': {
        get: {
          summary: { $ref: 'docs/get-summary' },
          'x-codeSamples': [
            { lang: 'JavaScript', source: { $ref: 'code_samples/get.js' } },
            { lang: 'Shell', label: 'cURL', source: { $ref: 'code_samples/get.sh' } },
          ],
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: 'schemas/key.yaml' } } },
            },
          },
        },
      },
    },
    ...extra,
  });

  it('lists a text document apart from the schema files, and leaves it as written when it is not supplied', () => {
    const text = json(redocly());
    const out = bundleSpec({ text, filename: 'openapi.json' }, new Map());
    // Only the schema file is a file to ask for.
    expect(out.references).toEqual([{ target: 'schemas/key.yaml', supplied: false }]);
    expect(out.textReferences).toEqual([
      { target: 'description.md', supplied: false },
      { target: 'docs/get-summary', supplied: false },
      { target: 'code_samples/get.js', supplied: false },
      { target: 'code_samples/get.sh', supplied: false },
    ]);
    expect(out.warnings).toEqual([]);
    // Nothing was rewritten, so the spec comes back byte for byte.
    expect(out.text).toBe(text);
  });

  it('inlines a supplied text document as a string, where it is referenced', () => {
    const out = bundleSpec(
      { text: json(redocly()), filename: 'openapi.json' },
      docs({
        'description.md': '# Keys\n\nManage API keys.\n',
        'docs/get-summary': 'List keys',
        'code_samples/get.js': 'await sdk.keys.list()\n',
        'code_samples/get.sh': 'curl /keys\n',
        'schemas/key.yaml': { type: 'object' },
      }),
    );
    const doc = bundled(out.text) as Record<string, any>;
    expect(doc.info.description).toBe('# Keys\n\nManage API keys.\n');
    expect(doc.paths['/keys'].get.summary).toBe('List keys');
    expect(doc.paths['/keys'].get['x-codeSamples']).toEqual([
      { lang: 'JavaScript', source: 'await sdk.keys.list()\n' },
      { lang: 'Shell', label: 'cURL', source: 'curl /keys\n' },
    ]);
    expect(out.references).toEqual([{ target: 'schemas/key.yaml', supplied: true }]);
    expect(out.textReferences?.every((r) => r.supplied)).toBe(true);
    // A text document is never parsed, so it never warns.
    expect(out.warnings).toEqual([]);
  });

  it("reads a text document's place, not just its name: no extension is text only where OpenAPI holds text", () => {
    const out = bundleSpec(
      {
        text: json({
          paths: { '/a': { $ref: 'paths/a' } }, // no extension, a path item: a document
          // A JSON/YAML extension stays a document, even where text belongs.
          info: { description: { $ref: 'intro.yaml' } },
          // `source` is text only inside a code sample.
          tool: { source: { $ref: 'tool/source' } },
          'x-code-samples': [{ source: { $ref: 'samples/list' } }],
          // A malformed code-sample list (not an array) holds no samples.
          more: { 'x-codeSamples': { source: { $ref: 'samples/odd' } } },
        }),
        filename: 'openapi.json',
      },
      new Map(),
    );
    expect(out.references.map((r) => r.target)).toEqual([
      'paths/a',
      'intro.yaml',
      'tool/source',
      'samples/odd',
    ]);
    expect(out.textReferences).toEqual([{ target: 'samples/list', supplied: false }]);
  });

  it('inlines text inside a supplied file against its folder, once per text, also through a YAML alias', () => {
    const read: string[] = [];
    /** The documents, noting each one asked for. */
    class Asked extends Map<string, string> {
      override get(target: string): string | undefined {
        read.push(target);
        return super.get(target);
      }
    }
    const out = bundleSpec(
      { text: json(spec('paths/keys.yaml#/Key')), filename: 'openapi.json' },
      new Asked([
        [
          'paths/keys.yaml',
          [
            'Key:',
            '  type: object',
            '  description: &d { $ref: "../docs/key.md" }',
            '  properties:',
            '    id: { type: string, description: *d }',
            '    name: { type: string, description: { $ref: "../docs/key.md" } }',
          ].join('\n'),
        ],
        ['docs/key.md', 'An API key.'],
      ]),
    );
    const key = (bundled(out.text)[BUNDLED_DOCUMENTS_KEY] as Record<string, any>)['paths/keys.yaml']
      .Key;
    expect(key.description).toBe('An API key.');
    expect(key.properties.id.description).toBe('An API key.');
    expect(key.properties.name.description).toBe('An API key.');
    expect(out.textReferences).toEqual([{ target: 'docs/key.md', supplied: true }]);
    // Each document is asked for once.
    expect(read).toEqual(['paths/keys.yaml', 'docs/key.md']);
  });

  it('leaves a text reference with a fragment, or one with no holder, as written', () => {
    const withFragment = bundleSpec(
      { text: json({ info: { description: { $ref: 'intro.md#/section' } } }), filename: 'o.json' },
      docs({ 'intro.md': 'Intro' }),
    );
    expect(bundled(withFragment.text).info).toEqual({ description: { $ref: 'intro.md#/section' } });
    expect(withFragment.textReferences).toEqual([{ target: 'intro.md', supplied: true }]);

    // A document that IS a reference to a text has nowhere to put it.
    const whole = bundleSpec(
      { text: json(spec('wrapper.json')), filename: 'openapi.json' },
      docs({ 'wrapper.json': { $ref: 'notes.md' }, 'notes.md': 'notes' }),
    );
    expect(
      (bundled(whole.text)[BUNDLED_DOCUMENTS_KEY] as Record<string, unknown>)['wrapper.json'],
    ).toEqual({ $ref: 'notes.md' });
    expect(whole.textReferences).toEqual([{ target: 'notes.md', supplied: true }]);
  });

  it('keeps the plain-name fragment warning, and a ref back to the root, for a text position', () => {
    const out = bundleSpec(
      {
        text: json({
          info: { description: { $ref: 'intro.md#Intro' }, summary: { $ref: 'openapi.json#/x' } },
          x: 'Root text',
        }),
        filename: 'openapi.json',
      },
      new Map(),
    );
    expect(out.warnings).toEqual([
      '$ref "intro.md#Intro" uses a plain-name fragment, which is not resolved.',
    ]);
    expect(bundled(out.text).info).toEqual({
      description: { $ref: 'intro.md#Intro' },
      summary: { $ref: '#/x' },
    });
    expect(out.textReferences).toBeUndefined();
  });

  it('lists a target that is also met as a document only among the references', () => {
    const out = bundleSpec(
      {
        text: json({
          info: { description: { $ref: 'shared/notes' } },
          components: { schemas: { Notes: { $ref: 'shared/notes' } } },
        }),
        filename: 'openapi.json',
      },
      new Map(),
    );
    expect(out.references).toEqual([{ target: 'shared/notes', supplied: false }]);
    expect(out.textReferences).toBeUndefined();
  });
});

describe('bundleSpecAsync', () => {
  const root = {
    openapi: '3.0.3',
    info: { title: 'T', version: '1', description: { $ref: 'intro.md' } },
    paths: { '/pets': { $ref: 'paths/pets.yaml' }, '/gone': { $ref: 'paths/gone.yaml' } },
  };
  const files: Record<string, string> = {
    'paths/pets.yaml': [
      'get:',
      '  responses:',
      "    '200':",
      '      description: ok',
      '      content:',
      '        application/json:',
      "          schema: { $ref: '../schemas/pet.yaml#/Pet' }",
    ].join('\n'),
    'schemas/pet.yaml':
      'Pet: { type: object, properties: { name: { type: string }, kind: { $ref: "#/Kind" } } }\nKind: { type: string }',
    'intro.md': 'Pets.',
  };

  it('reads each document the spec reaches once, when the walk needs it, and gives what bundleSpec gives', async () => {
    const asked: string[] = [];
    const out = await bundleSpecAsync({ text: json(root), filename: 'openapi.json' }, async (t) => {
      asked.push(t);
      return files[t] ?? null;
    });
    expect(asked).toEqual(['intro.md', 'paths/pets.yaml', 'paths/gone.yaml', 'schemas/pet.yaml']);
    expect(out).toEqual(
      bundleSpec({ text: json(root), filename: 'openapi.json' }, new Map(Object.entries(files))),
    );
    expect(out.references).toEqual([
      { target: 'paths/pets.yaml', supplied: true },
      { target: 'paths/gone.yaml', supplied: false },
      { target: 'schemas/pet.yaml', supplied: true },
    ]);
    expect(out.textReferences).toEqual([{ target: 'intro.md', supplied: true }]);
    const { endpoints } = await parseOpenApiToEndpoints(out.text, out.format);
    expect(endpoints.map((e) => `${e.method} ${e.pathPattern}`)).toEqual(['GET /pets']);
  });

  it('reads nothing for a self-contained spec, and takes undefined as not available', async () => {
    const text = json({ openapi: '3.0.0', paths: {} });
    let calls = 0;
    const self = await bundleSpecAsync({ text, filename: 'a.json' }, async () => {
      calls += 1;
      return 'never';
    });
    expect(calls).toBe(0);
    expect(self).toEqual({ text, format: 'json', references: [], warnings: [] });

    const none = await bundleSpecAsync(
      { text: json(root), filename: 'openapi.json' },
      async () => undefined,
      { output: 'yaml' },
    );
    expect(none.format).toBe('yaml');
    expect(none.references.every((r) => !r.supplied)).toBe(true);
    expect(none.textReferences).toEqual([{ target: 'intro.md', supplied: false }]);
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
