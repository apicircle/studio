import { describe, expect, it } from 'vitest';
import type { MockEndpoint } from '@apicircle/shared';
import { parseOpenApiToEndpointsNode, parseOpenApiRequestBodiesNode } from './openapiNode';

const bodyContent = (e: MockEndpoint) =>
  e.defaultResponse.body.type === 'json' ? e.defaultResponse.body.content : '';

describe('parseOpenApiToEndpointsNode (swagger-parser)', () => {
  it('resolves an in-document $ref via swagger-parser', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Ref', version: '1.0.0' },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['id', 'name'],
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          },
        },
      },
      paths: {
        '/pets': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
              },
            },
          },
        },
      },
    });
    const { endpoints, warnings } = await parseOpenApiToEndpointsNode(spec, 'json');
    expect(warnings).toEqual([]);
    expect(endpoints).toHaveLength(1);
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ id: 0, name: 'string' });
  });

  it('falls back to in-document resolution when swagger-parser rejects the doc', async () => {
    // Not a valid OpenAPI/Swagger document (no version key) — swagger-parser
    // throws, and we fall back to the internal resolver, still parsing paths.
    const spec = JSON.stringify({
      paths: {
        '/x': {
          get: {
            responses: { '200': { content: { 'application/json': { example: { ok: 1 } } } } },
          },
        },
      },
    });
    const { endpoints, warnings } = await parseOpenApiToEndpointsNode(spec, 'json');
    expect(endpoints).toHaveLength(1);
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ ok: 1 });
    expect(warnings.some((w) => w.includes('falling back to in-document'))).toBe(true);
  });

  // swagger-parser resolves an in-document cycle into a REAL object cycle
  // (`Category.properties.children.items === Category`). Building the example
  // used to recurse through it until "Maximum call stack size exceeded", which
  // failed mock creation on Desktop and the Lens CLI / MCP import and mock tools.
  it('builds a mock for a self-referencing schema instead of overflowing the stack', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Tree', version: '1.0.0' },
      paths: {
        '/categories': {
          get: {
            responses: {
              '200': {
                description: 'ok',
                content: {
                  'application/json': { schema: { $ref: '#/components/schemas/Category' } },
                },
              },
            },
          },
        },
      },
      components: {
        schemas: {
          Category: {
            type: 'object',
            properties: {
              name: { type: 'string' },
              children: { type: 'array', items: { $ref: '#/components/schemas/Category' } },
            },
          },
        },
      },
    });
    const { endpoints, warnings } = await parseOpenApiToEndpointsNode(spec, 'json');
    expect(warnings).toEqual([]);
    expect(endpoints).toHaveLength(1);
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ name: 'string', children: [{}] });
  });

  it('builds mutually recursive schemas, each cut where it comes back to itself', async () => {
    const op = (schema: string) => ({
      get: {
        responses: {
          '200': {
            description: 'ok',
            content: { 'application/json': { schema: { $ref: `#/components/schemas/${schema}` } } },
          },
        },
      },
    });
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Mutual', version: '1.0.0' },
      paths: { '/a': op('A'), '/b': op('B') },
      components: {
        schemas: {
          A: { type: 'object', properties: { b: { $ref: '#/components/schemas/B' } } },
          B: { type: 'object', properties: { a: { $ref: '#/components/schemas/A' } } },
        },
      },
    });
    const { endpoints, warnings } = await parseOpenApiToEndpointsNode(spec, 'json');
    expect(warnings).toEqual([]);
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ b: { a: {} } });
    expect(JSON.parse(bodyContent(endpoints[1]))).toEqual({ a: { b: {} } });
  });
});

describe('parseOpenApiRequestBodiesNode (swagger-parser)', () => {
  it('resolves a request body $ref via swagger-parser', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Ref', version: '1.0.0' },
      components: {
        schemas: {
          Pet: {
            type: 'object',
            required: ['id', 'name'],
            properties: { id: { type: 'integer' }, name: { type: 'string' } },
          },
        },
      },
      paths: {
        '/pets': {
          post: {
            requestBody: {
              required: true,
              content: { 'application/json': { schema: { $ref: '#/components/schemas/Pet' } } },
            },
            responses: { '201': { description: 'created' } },
          },
        },
      },
    });
    const { requestBodies, warnings } = await parseOpenApiRequestBodiesNode(spec, 'json');
    expect(warnings).toEqual([]);
    expect(requestBodies).toHaveLength(1);
    expect(requestBodies[0]).toMatchObject({
      method: 'POST',
      path: '/pets',
      contentType: 'application/json',
      required: true,
    });
    expect(requestBodies[0].schema).toMatchObject({
      type: 'object',
      properties: { id: { type: 'integer' }, name: { type: 'string' } },
    });
  });
});
