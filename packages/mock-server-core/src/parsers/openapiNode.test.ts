import { describe, expect, it } from 'vitest';
import type { MockEndpoint } from '@apicircle/shared';
import { parseOpenApiToEndpointsNode } from './openapiNode';

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
});
