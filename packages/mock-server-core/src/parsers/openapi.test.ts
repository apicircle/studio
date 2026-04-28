import { describe, expect, it } from 'vitest';
import { parseOpenApiToEndpoints } from './openapi';

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
    expect(listPets!.status).toBe(200);
    expect(listPets!.body).toContain('"name": "Fido"');
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
    expect(post!.status).toBe(201);
    const body = JSON.parse(post!.body);
    expect(body).toEqual({ id: 0, name: 'string' });
  });

  it('uses the first named example when `examples` map is present', async () => {
    const { endpoints } = await parseOpenApiToEndpoints(PETSTORE_JSON, 'json');
    const getPet = endpoints.find((e) => e.method === 'GET' && e.pathPattern === '/pets/{id}');
    expect(getPet).toBeDefined();
    expect(getPet!.example).toBe('fido');
    expect(getPet!.body).toContain('"name": "Fido"');
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
      expect(e.headers.find((h) => h.key.toLowerCase() === 'content-type')).toBeDefined();
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
    expect(JSON.parse(lowest.endpoints[0].body)).toEqual({ from: '200' });

    const preferred = await parseOpenApiToEndpoints(spec, 'json', { preferStatus: 201 });
    expect(JSON.parse(preferred.endpoints[0].body)).toEqual({ from: '201' });
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
    const trace = endpoints[0].headers.find((h) => h.key === 'X-Trace-Id');
    expect(trace?.value).toBe('trace-123');
    const schemaHeader = endpoints[0].headers.find((h) => h.key === 'X-Schema-Header');
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
    expect(endpoints[0].body).toBe('<root/>');
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
    expect(endpoints[0].body).toBe('{"wrapped":{"value":1}}');
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
    expect(JSON.parse(endpoints[0].body)).toEqual({ ok: false });
  });
});
