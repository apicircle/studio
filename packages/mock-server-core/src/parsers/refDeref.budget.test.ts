import { describe, expect, it } from 'vitest';
import { dereferenceInternal } from './refDeref';
import { parseOpenApiToEndpoints } from './openapi';

// Expansion is COMPLETE: every use of a `$ref` gets its own expanded copy, and
// nothing is dropped or capped. A shared component referenced from hundreds of
// operations therefore costs its size times its uses, which is what keeps a
// large real-world spec whole — an earlier attempt to cap the walk truncated a
// legitimate 800-operation document down to 434 endpoints, so the cap was
// reverted and these tests pin the uncapped contract.
//
// The flip side is a known, still-open limitation: a document of a few KB can
// describe an astronomically large expansion (levels of `$ref` fan-out, or a
// YAML alias graph, since js-yaml hands back one shared object per anchor), and
// nothing here stops it. Bounding that safely means making a legitimate spec
// linear (memoising resolved targets) AND bounding the downstream walk in
// `faker/schemaToExample.ts`, which is where the Node parser's shared
// swagger-parser output explodes too. Deliberately not asserted here: the
// pathological case exhausts the heap rather than failing an assertion.

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

describe('dereferenceInternal — expansion is complete, never truncated', () => {
  it('expands a reference reused across many branches once per use', () => {
    // 4 levels of 10-way fan-out: 10k leaves, all present, no warning.
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
  });

  it('keeps every operation in a spec whose components are shared widely', async () => {
    // 60 paths all referencing one component: the shared schema is expanded per
    // use, and each path still yields its endpoint.
    const paths: Record<string, unknown> = {};
    for (let i = 0; i < 60; i += 1) {
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
    const properties: Record<string, unknown> = {};
    for (let p = 0; p < 20; p += 1) properties[`f${p}`] = { type: 'string' };
    const spec = {
      openapi: '3.0.0',
      info: { title: 'Wide', version: '1.0.0' },
      paths,
      components: { schemas: { Shared: { type: 'object', properties } } },
    };

    const { endpoints, warnings } = await parseOpenApiToEndpoints(JSON.stringify(spec), 'json');
    expect(warnings).toEqual([]);
    expect(endpoints).toHaveLength(60);
    const body = endpoints[0].defaultResponse.body;
    const synthesized = body.type === 'json' ? (JSON.parse(body.content) as object) : {};
    expect(Object.keys(synthesized)).toHaveLength(20);
  });
});
