import { describe, expect, it } from 'vitest';
import type { MockEndpoint } from '@apicircle/shared';
import { dereferenceInternal } from './refDeref';
import { parseOpenApiToEndpoints } from './openapi';
import { parseOpenApiToEndpointsNode } from './openapiNode';

// Expansion is COMPLETE: every use of a `$ref` resolves to its target, and no
// operation is ever dropped. A legitimate spec whose components are shared by
// hundreds of operations keeps every endpoint whole — an earlier attempt to cap
// the walk document-wide truncated an 800-operation document down to 434
// endpoints, so nothing here is counted across a document, and these tests pin
// that.
//
// And expansion is BOUNDED. Each `$ref` target (and each node a YAML alias
// shares) is resolved once and shared by every use, so the dereferenced document
// is a DAG no larger than its input; the examples built from it spend a budget
// that belongs to ONE operation (`faker/schemaToExample.ts`). A few KB of `$ref`
// or alias fan-out — trillions of nodes if expanded as a tree — now parses in
// milliseconds into an endpoint whose example is cut short, with a warning that
// names the operation, on the browser path and the Node path alike.

type Parse = (
  source: string,
  format?: 'json' | 'yaml',
) => Promise<{
  endpoints: MockEndpoint[];
  warnings: string[];
}>;

/** Both OpenAPI surfaces: the browser build's in-document resolver, and the
 *  Node build's swagger-parser (Desktop main, VS Code host, Lens CLI / MCP). */
const SURFACES: Array<[string, Parse]> = [
  ['browser', parseOpenApiToEndpoints],
  ['node', parseOpenApiToEndpointsNode],
];

const bodyOf = (endpoint: MockEndpoint): string =>
  endpoint.defaultResponse.body.type === 'json' ? endpoint.defaultResponse.body.content : '';

/** `levels` schemas, each with `fanout` properties referencing the next one:
 *  fanout ** levels output nodes when expanded in full. `paths` is declared
 *  before `components` (the order real specs use), so the expansion reached
 *  through an operation's response schema is the one under test. */
function refFanOutSpec(levels: number, fanout: number) {
  const schemas: Record<string, unknown> = {};
  for (let level = 0; level < levels; level += 1) {
    const properties: Record<string, unknown> = {};
    for (let p = 0; p < fanout; p += 1) {
      properties[`p${p}`] =
        level === levels - 1 ? { type: 'string' } : { $ref: `#/components/schemas/S${level + 1}` };
    }
    schemas[`S${level}`] = { type: 'object', properties };
  }
  return {
    openapi: '3.0.0',
    info: { title: 'Fan-out', version: '1.0.0' },
    paths: {
      '/x': {
        get: {
          responses: {
            '200': {
              description: 'ok',
              content: { 'application/json': { schema: { $ref: '#/components/schemas/S0' } } },
            },
          },
        },
      },
    },
    components: { schemas },
  };
}

/** The same fan-out written with YAML anchors and aliases instead of `$ref`s —
 *  js-yaml hands back ONE object per anchor, so no resolver is involved. */
function aliasFanOutYaml(levels: number, fanout: number): string {
  const lines = [
    'openapi: 3.0.0',
    'info: { title: Alias fan-out, version: 1.0.0 }',
    'components:',
    '  schemas:',
    '    A0: &a0 { type: string }',
  ];
  for (let level = 1; level <= levels; level += 1) {
    const props = Array.from({ length: fanout }, (_, p) => `p${p}: *a${level - 1}`).join(', ');
    lines.push(`    A${level}: &a${level} { type: object, properties: { ${props} } }`);
  }
  lines.push(
    'paths:',
    '  /x:',
    '    get:',
    '      responses:',
    "        '200':",
    '          description: ok',
    '          content:',
    '            application/json:',
    `              schema: *a${levels}`,
  );
  return lines.join('\n');
}

/** A "billion laughs" example: `levels` of two-element lists, each holding the
 *  list below twice — 2 ** levels leaves, spelled out in a few hundred bytes. */
function exampleBombYaml(levels: number): string {
  const lines = [
    'openapi: 3.0.0',
    'info: { title: Example bomb, version: 1.0.0 }',
    'x-laughs:',
    '  l0: &l0 [lol, lol]',
  ];
  for (let level = 1; level <= levels; level += 1) {
    lines.push(`  l${level}: &l${level} [*l${level - 1}, *l${level - 1}]`);
  }
  lines.push(
    'paths:',
    '  /x:',
    '    get:',
    '      responses:',
    "        '200':",
    '          description: ok',
    '          content:',
    '            application/json:',
    `              example: *l${levels}`,
  );
  return lines.join('\n');
}

/** `operations` paths, each answering with one shared component. */
function wideSpec(operations: number) {
  const paths: Record<string, unknown> = {};
  for (let i = 0; i < operations; i += 1) {
    paths[`/r${i}`] = {
      get: {
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: '#/components/schemas/Shared' } } },
          },
        },
      },
    };
  }
  const properties: Record<string, unknown> = {
    owner: { $ref: '#/components/schemas/User' },
  };
  for (let p = 0; p < 20; p += 1) properties[`f${p}`] = { type: 'string' };
  const userProps: Record<string, unknown> = {};
  for (let p = 0; p < 5; p += 1) userProps[`u${p}`] = { type: 'integer' };
  return {
    openapi: '3.0.0',
    info: { title: 'Wide', version: '1.0.0' },
    paths,
    components: {
      schemas: {
        Shared: { type: 'object', properties },
        User: { type: 'object', properties: userProps },
      },
    },
  };
}

describe('dereferenceInternal — complete, and no larger than its input', () => {
  it('resolves a reference reused across many branches to one shared object', () => {
    // 4 levels of 10-way fan-out: 10k leaves, all reachable, no warning.
    const { doc, warnings } = dereferenceInternal(refFanOutSpec(4, 10));
    expect(warnings).toEqual([]);
    const s0 = (doc as { components: { schemas: { S0: unknown } } }).components.schemas.S0;
    const leaf = (path: string[]): unknown =>
      path.reduce<unknown>(
        (node, key) => (node as Record<string, Record<string, unknown>>).properties[key],
        s0,
      );
    // Four hops from S0 reach the leaf level, whichever branch is taken.
    expect(leaf(['p0', 'p9', 'p0', 'p5'])).toEqual({ type: 'string' });
    expect(leaf(['p9', 'p0', 'p9', 'p0'])).toEqual({ type: 'string' });
    // …because every branch is the same resolved S1.
    expect(leaf(['p0'])).toBe(leaf(['p9']));
  });

  it('dereferences a fan-out of 12 ** 12 nodes without expanding it', () => {
    const { doc, warnings } = dereferenceInternal(refFanOutSpec(12, 12));
    expect(warnings).toEqual([]);
    const s0 = (doc as { components: { schemas: { S0: { properties: Record<string, unknown> } } } })
      .components.schemas.S0;
    expect(s0.properties.p0).toBe(s0.properties.p11);
  });
});

describe.each(SURFACES)(
  '%s OpenAPI parser — every operation kept, every example bounded',
  (_surface, parse) => {
    it('keeps all 800 operations of a spec whose components they all share, examples whole', async () => {
      const { endpoints, warnings } = await parse(JSON.stringify(wideSpec(800)), 'json');
      expect(warnings).toEqual([]);
      expect(endpoints).toHaveLength(800);
      for (const endpoint of [endpoints[0], endpoints[399], endpoints[799]]) {
        const body = JSON.parse(bodyOf(endpoint)) as Record<string, unknown>;
        expect(Object.keys(body)).toHaveLength(21);
        expect(body.owner).toEqual({ u0: 0, u1: 0, u2: 0, u3: 0, u4: 0 });
      }
    });

    it('bounds the example of a $ref fan-out of 12 ** 12 nodes, and says so', async () => {
      const { endpoints, warnings } = await parse(JSON.stringify(refFanOutSpec(12, 12)), 'json');
      expect(endpoints).toHaveLength(1);
      expect(bodyOf(endpoints[0]).length).toBeLessThan(2_000_000);
      expect(warnings).toEqual([expect.stringContaining('The example for GET /x was cut short')]);
    });

    it('bounds the example of a YAML alias fan-out the same way', async () => {
      const { endpoints, warnings } = await parse(aliasFanOutYaml(12, 12), 'yaml');
      expect(endpoints).toHaveLength(1);
      expect(bodyOf(endpoints[0]).length).toBeLessThan(2_000_000);
      expect(warnings).toEqual([expect.stringContaining('The example for GET /x was cut short')]);
    });

    it('bounds an explicit example built from YAML aliases (2 ** 40 leaves)', async () => {
      const { endpoints, warnings } = await parse(exampleBombYaml(40), 'yaml');
      expect(endpoints).toHaveLength(1);
      expect(bodyOf(endpoints[0]).length).toBeLessThan(2_000_000);
      expect(warnings).toEqual([expect.stringContaining('The example for GET /x was cut short')]);
    });

    it('spends the budget per operation: a bomb cuts its own example and no other', async () => {
      const spec = wideSpec(50) as {
        paths: Record<string, unknown>;
        components: { schemas: Record<string, unknown> };
      };
      const bomb = refFanOutSpec(12, 12);
      spec.paths['/bomb'] = bomb.paths['/x'];
      Object.assign(spec.components.schemas, bomb.components.schemas);

      const { endpoints, warnings } = await parse(JSON.stringify(spec), 'json');
      expect(endpoints).toHaveLength(51);
      expect(warnings).toEqual([
        expect.stringContaining('The example for GET /bomb was cut short'),
      ]);
      for (const endpoint of endpoints.filter((e) => e.pathPattern !== '/bomb')) {
        expect(Object.keys(JSON.parse(bodyOf(endpoint)) as object)).toHaveLength(21);
      }
    });
  },
);
