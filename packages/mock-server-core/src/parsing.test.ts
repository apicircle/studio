import { describe, expect, it } from 'vitest';
import { parseSourceToEndpoints } from './parsing';

// The browser-safe source dispatch. OpenAPI goes through the in-document
// resolver (no swagger-parser); postman / insomnia / manual are shared with
// the Node entry.

describe('parseSourceToEndpoints (browser dispatch)', () => {
  it('parses an OpenAPI source with in-document $ref resolution', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'P', version: '1.0.0' },
      components: { schemas: { Pet: { type: 'object', properties: { id: { type: 'integer' } } } } },
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
    const { endpoints, warnings } = await parseSourceToEndpoints({
      kind: 'openapi',
      spec,
      format: 'json',
    });
    expect(endpoints).toHaveLength(1);
    expect(warnings).toEqual([]);
  });

  it('warns on an external $ref instead of resolving it', async () => {
    const spec = JSON.stringify({
      openapi: '3.0.0',
      info: { title: 'P', version: '1.0.0' },
      paths: {
        '/pets': {
          get: {
            responses: {
              '200': { content: { 'application/json': { schema: { $ref: './ext.yaml#/Pet' } } } },
            },
          },
        },
      },
    });
    const { warnings } = await parseSourceToEndpoints({ kind: 'openapi', spec, format: 'json' });
    expect(warnings.some((w) => w.includes('External $ref not resolved in the web app'))).toBe(
      true,
    );
  });

  it('dispatches to the Postman parser', async () => {
    const collection = JSON.stringify({
      info: {
        name: 'C',
        schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
      },
      item: [{ name: 'Get', request: { method: 'GET', url: 'https://api.example.com/x' } }],
    });
    const { endpoints } = await parseSourceToEndpoints({ kind: 'postman', collection });
    expect(endpoints).toHaveLength(1);
  });

  it('dispatches to the Insomnia parser', async () => {
    const exportJson = JSON.stringify({
      _type: 'export',
      __export_format: 4,
      resources: [
        {
          _type: 'request',
          _id: 'r1',
          name: 'Get',
          method: 'GET',
          url: 'https://api.example.com/x',
        },
      ],
    });
    const { endpoints } = await parseSourceToEndpoints({ kind: 'insomnia', export: exportJson });
    expect(endpoints).toHaveLength(1);
  });

  it('returns manual endpoints verbatim', async () => {
    const endpoint = {
      id: 'e1',
      name: 'GET /x',
      method: 'GET' as const,
      pathPattern: '/x',
      requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
      requestValidation: [],
      responseRules: [],
      defaultResponse: { status: 200, headers: [], body: { type: 'json' as const, content: '{}' } },
    };
    const { endpoints, warnings } = await parseSourceToEndpoints({
      kind: 'manual',
      endpoints: [endpoint],
    });
    expect(endpoints).toEqual([endpoint]);
    expect(warnings).toEqual([]);
  });
});
