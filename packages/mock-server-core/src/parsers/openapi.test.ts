import { describe, expect, it } from 'vitest';
import type { MockEndpoint } from '@apicircle/shared';
import { parseOpenApiToEndpoints } from './openapi';

// Helper accessors — every endpoint stores its parsed response on
// `defaultResponse`; these wrap that detail so the tests below stay
// readable.
const status = (e: MockEndpoint) => e.defaultResponse.status;
const headers = (e: MockEndpoint) => e.defaultResponse.headers;
const bodyContent = (e: MockEndpoint) =>
  e.defaultResponse.body.type === 'json' ||
  e.defaultResponse.body.type === 'text' ||
  e.defaultResponse.body.type === 'xml' ||
  e.defaultResponse.body.type === 'urlencoded'
    ? e.defaultResponse.body.content
    : '';

const PETSTORE_JSON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        operationId: 'listPets',
        responses: {
          '200': {
            content: {
              'application/json': {
                example: [{ id: 1, name: 'Fido' }],
              },
            },
          },
        },
      },
      post: {
        operationId: 'createPet',
        responses: {
          '201': {
            content: {
              'application/json': {
                schema: {
                  type: 'object',
                  required: ['id', 'name'],
                  properties: {
                    id: { type: 'integer' },
                    name: { type: 'string' },
                  },
                },
              },
            },
          },
        },
      },
    },
    '/pets/{id}': {
      get: {
        operationId: 'getPet',
        responses: {
          '200': {
            content: {
              'application/json': {
                examples: {
                  fido: { value: { id: 1, name: 'Fido' } },
                },
              },
            },
          },
        },
      },
    },
  },
});

const PETSTORE_YAML = `openapi: 3.0.0
info:
  title: Petstore
  version: 1.0.0
paths:
  /pets:
    get:
      responses:
        '200':
          content:
            application/json:
              example:
                - id: 1
                  name: Fido
`;

describe('parseOpenApiToEndpoints', () => {
  it('parses JSON spec and extracts endpoints', async () => {
    const { endpoints, warnings } = await parseOpenApiToEndpoints(PETSTORE_JSON, 'json');
    expect(warnings).toEqual([]);
    expect(endpoints).toHaveLength(3);
    const listPets = endpoints.find((e) => e.method === 'GET' && e.pathPattern === '/pets');
    expect(listPets).toBeDefined();
    expect(status(listPets!)).toBe(200);
    expect(bodyContent(listPets!)).toContain('"name": "Fido"');
  });

  it('populates requestSchema from operation + path-item parameters', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'P', version: '1' },
      paths: {
        '/pets/{petId}': {
          parameters: [
            {
              name: 'petId',
              in: 'path',
              required: true,
              schema: { type: 'string' },
              description: 'Pet id',
            },
          ],
          get: {
            operationId: 'getPet',
            parameters: [
              { name: 'expand', in: 'query', schema: { type: 'string' }, example: 'owner' },
              { name: 'X-Api-Key', in: 'header', required: true, schema: { type: 'string' } },
            ],
            responses: { '200': { content: { 'application/json': { example: { id: 1 } } } } },
          },
        },
      },
    });
    const { endpoints } = await parseOpenApiToEndpoints(spec, 'json');
    const ep = endpoints.find((e) => e.pathPattern === '/pets/{petId}')!;
    expect(ep.requestSchema.pathParams.map((p) => p.name)).toEqual(['petId']);
    expect(ep.requestSchema.pathParams[0].required).toBe(true);
    expect(ep.requestSchema.pathParams[0].typeHint).toBe('string');
    expect(ep.requestSchema.pathParams[0].description).toBe('Pet id');
    expect(ep.requestSchema.queryParams.map((p) => p.name)).toEqual(['expand']);
    expect(ep.requestSchema.queryParams[0].example).toBe('owner');
    expect(ep.requestSchema.headers.map((p) => p.name)).toEqual(['X-Api-Key']);
    // Every param carries a generated id (so the editors can reorder rows).
    expect(ep.requestSchema.pathParams[0].id).toBeTruthy();
  });

  it('parses YAML spec', async () => {
    const { endpoints, warnings } = await parseOpenApiToEndpoints(PETSTORE_YAML, 'yaml');
    expect(warnings).toEqual([]);
    expect(endpoints).toHaveLength(1);
    expect(endpoints[0].pathPattern).toBe('/pets');
  });

  it('synthesizes a body from schema when no example is present', async () => {
    const { endpoints } = await parseOpenApiToEndpoints(PETSTORE_JSON, 'json');
    const post = endpoints.find((e) => e.method === 'POST');
    expect(post).toBeDefined();
    expect(status(post!)).toBe(201);
    const body = JSON.parse(bodyContent(post!));
    expect(body).toEqual({ id: 0, name: 'string' });
  });

  it('uses the first named example when `examples` map is present', async () => {
    const { endpoints } = await parseOpenApiToEndpoints(PETSTORE_JSON, 'json');
    const getPet = endpoints.find((e) => e.method === 'GET' && e.pathPattern === '/pets/{id}');
    expect(getPet).toBeDefined();
    expect(getPet!.example).toBe('fido');
    expect(bodyContent(getPet!)).toContain('"name": "Fido"');
  });

  it('returns warnings for invalid JSON without throwing', async () => {
    const { endpoints, warnings } = await parseOpenApiToEndpoints('{not json', 'json');
    expect(endpoints).toEqual([]);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('skips operations with no 2xx response', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0.0' },
      paths: {
        '/x': {
          get: { responses: { '500': { description: 'oops' } } },
        },
      },
    });
    const { endpoints, warnings } = await parseOpenApiToEndpoints(spec, 'json');
    expect(endpoints).toEqual([]);
    expect(warnings.some((w) => w.includes('No 2xx'))).toBe(true);
  });

  it('attaches a Content-Type header by default', async () => {
    const { endpoints } = await parseOpenApiToEndpoints(PETSTORE_JSON, 'json');
    for (const e of endpoints) {
      expect(headers(e).find((h) => h.key.toLowerCase() === 'content-type')).toBeDefined();
    }
  });

  it('honors the preferStatus option when multiple 2xx responses exist', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': { content: { 'application/json': { example: { from: '200' } } } },
              '201': { content: { 'application/json': { example: { from: '201' } } } },
            },
          },
        },
      },
    });
    const lowest = await parseOpenApiToEndpoints(spec, 'json');
    expect(JSON.parse(bodyContent(lowest.endpoints[0]))).toEqual({ from: '200' });

    const preferred = await parseOpenApiToEndpoints(spec, 'json', { preferStatus: 201 });
    expect(JSON.parse(bodyContent(preferred.endpoints[0]))).toEqual({ from: '201' });
  });

  it('passes through response headers from the OpenAPI spec', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                headers: {
                  'X-Trace-Id': { example: 'trace-123' },
                  'X-Schema-Header': { schema: { type: 'string', format: 'uuid' } },
                },
                content: { 'application/json': { example: { ok: true } } },
              },
            },
          },
        },
      },
    });
    const { endpoints } = await parseOpenApiToEndpoints(spec, 'json');
    const trace = headers(endpoints[0]).find((h) => h.key === 'X-Trace-Id');
    expect(trace?.value).toBe('trace-123');
    const schemaHeader = headers(endpoints[0]).find((h) => h.key === 'X-Schema-Header');
    expect(schemaHeader?.value).toMatch(/^[0-9a-f-]+$/);
  });

  it('returns warnings + empty result for raw non-object input', async () => {
    const { endpoints, warnings } = await parseOpenApiToEndpoints('"just a string"', 'json');
    expect(endpoints).toEqual([]);
    expect(warnings).toContain('Could not parse OpenAPI source');
  });

  it('skips when 2xx responses are entirely missing', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0.0' },
      paths: {
        '/x': {
          get: { responses: {} },
        },
      },
    });
    const { endpoints, warnings } = await parseOpenApiToEndpoints(spec, 'json');
    expect(endpoints).toEqual([]);
    expect(warnings.some((w) => w.includes('No 2xx'))).toBe(true);
  });

  it('uses Swagger 2.0 response.examples when no schema is set', async () => {
    const swagger2 = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Swagger 2', version: '1.0.0' },
      paths: {
        '/legacy': {
          get: {
            responses: {
              '200': {
                examples: {
                  'application/xml': '<root/>',
                },
              },
            },
          },
        },
      },
    });
    const { endpoints } = await parseOpenApiToEndpoints(swagger2, 'json');
    expect(endpoints).toHaveLength(1);
    expect(bodyContent(endpoints[0])).toBe('<root/>');
  });

  it('serializes non-JSON object payloads without extra whitespace', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': {
                content: {
                  'application/xml': { example: { wrapped: { value: 1 } } },
                },
              },
            },
          },
        },
      },
    });
    const { endpoints } = await parseOpenApiToEndpoints(spec, 'json');
    // For non-JSON content types we fall through to compact JSON serialisation.
    expect(bodyContent(endpoints[0])).toBe('{"wrapped":{"value":1}}');
  });

  it('falls back to safeJsonParse when YAML parser throws', async () => {
    // Single-quote YAML with mismatched bracket: js-yaml accepts a lot of
    // weird stuff so we force a clean failure with `[}`.
    const result = await parseOpenApiToEndpoints('[invalid: yaml: at: all }', 'yaml');
    expect(result.endpoints).toEqual([]);
    expect(result.warnings.length).toBeGreaterThan(0);
  });

  it('handles Swagger 2.0 fallback shape', async () => {
    const swagger2 = JSON.stringify({
      swagger: '2.0',
      info: { title: 'Swagger 2', version: '1.0.0' },
      paths: {
        '/legacy': {
          get: {
            produces: ['application/json'],
            responses: {
              '200': {
                schema: {
                  type: 'object',
                  required: ['ok'],
                  properties: { ok: { type: 'boolean' } },
                },
              },
            },
          },
        },
      },
    });
    const { endpoints } = await parseOpenApiToEndpoints(swagger2, 'json');
    expect(endpoints).toHaveLength(1);
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ ok: false });
  });

  it('resolves an in-document $ref in a response schema (default browser parser)', async () => {
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
    const { endpoints, warnings } = await parseOpenApiToEndpoints(spec, 'json');
    expect(warnings).toEqual([]);
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ id: 0, name: 'string' });
  });

  it('warns (but still parses) when a response schema uses an external $ref', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Ext', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              '200': {
                content: { 'application/json': { schema: { $ref: './pet.yaml#/Pet' } } },
              },
            },
          },
        },
      },
    });
    const { endpoints, warnings } = await parseOpenApiToEndpoints(spec, 'json');
    expect(endpoints).toHaveLength(1);
    expect(warnings.some((w) => w.includes('External $ref not resolved in the web app'))).toBe(
      true,
    );
  });

  it('uses an injected dereferencer when provided', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Inj', version: '1.0.0' },
      paths: {
        '/x': { get: { responses: { '200': { content: { 'application/json': {} } } } } },
      },
    });
    let called = false;
    const { warnings } = await parseOpenApiToEndpoints(
      spec,
      'json',
      {},
      {
        dereference: (root) => {
          called = true;
          return { doc: root, warnings: ['custom-deref-warning'] };
        },
      },
    );
    expect(called).toBe(true);
    expect(warnings).toContain('custom-deref-warning');
  });

  it('falls back to the lowest 2xx when preferStatus is not among the responses', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': { content: { 'application/json': { example: { from: '200' } } } },
              '201': { content: { 'application/json': { example: { from: '201' } } } },
            },
          },
        },
      },
    });
    // preferStatus 404 isn't a 2xx candidate → lowest 2xx (200) wins.
    const { endpoints } = await parseOpenApiToEndpoints(spec, 'json', { preferStatus: 404 });
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ from: '200' });
  });

  it('defaults the content type when the response content map is empty', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0.0' },
      paths: { '/x': { get: { responses: { '200': { content: {} } } } } },
    });
    const { endpoints } = await parseOpenApiToEndpoints(spec, 'json');
    expect(endpoints).toHaveLength(1);
    const ct = headers(endpoints[0]).find((h) => h.key === 'Content-Type');
    expect(ct?.value).toBe('application/json');
  });

  it('uses the first media type when none is JSON', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'X', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            responses: { '200': { content: { 'application/xml': { example: '<ok/>' } } } },
          },
        },
      },
    });
    const { endpoints } = await parseOpenApiToEndpoints(spec, 'json');
    const ct = headers(endpoints[0]).find((h) => h.key === 'Content-Type');
    expect(ct?.value).toBe('application/xml');
  });

  it('reads a Swagger 2.0 `examples` map keyed by content type', async () => {
    const spec = JSON.stringify({
      swagger: '2.0',
      info: { title: 'S2', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            responses: {
              '200': { description: 'ok', examples: { 'application/json': { hello: 'world' } } },
            },
          },
        },
      },
    });
    const { endpoints } = await parseOpenApiToEndpoints(spec, 'json');
    expect(endpoints).toHaveLength(1);
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ hello: 'world' });
  });

  it('falls back to the raw spec when the dereferencer returns a non-object doc', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'Raw', version: '1.0.0' },
      paths: {
        '/x': {
          get: {
            responses: { '200': { content: { 'application/json': { example: { ok: 1 } } } } },
          },
        },
      },
    });
    // A dereferencer that discards the doc (returns null) forces the
    // `doc && typeof doc === 'object' ? doc : raw` fallback branch — the
    // parser must still walk the original parsed spec.
    const { endpoints } = await parseOpenApiToEndpoints(
      spec,
      'json',
      {},
      { dereference: () => ({ doc: null, warnings: [] }) },
    );
    expect(endpoints).toHaveLength(1);
    expect(JSON.parse(bodyContent(endpoints[0]))).toEqual({ ok: 1 });
  });
});
