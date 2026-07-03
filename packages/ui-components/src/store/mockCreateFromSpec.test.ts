import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

// Regression coverage for the spec-import bug: `createMockServer` must
// MATERIALIZE the endpoint table at create time (the router serves
// `MockServer.endpoints` and never re-parses `source`). Prior to the fix a
// spec-blob mock was persisted with `endpoints: []`, so an imported OpenAPI /
// Postman / Insomnia spec produced a server with zero endpoints.

const OPENAPI_JSON = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Petstore', version: '1.0.0' },
  paths: {
    '/pets': {
      get: { responses: { '200': { content: { 'application/json': { example: [{ id: 1 }] } } } } },
    },
    '/pets/{id}': {
      get: { responses: { '200': { content: { 'application/json': { example: { id: 1 } } } } } },
    },
  },
});

const OPENAPI_YAML = `openapi: 3.0.0
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
`;

const OPENAPI_WITH_EXTERNAL_REF = JSON.stringify({
  openapi: '3.0.0',
  info: { title: 'Ext', version: '1.0.0' },
  paths: {
    '/pets': {
      get: {
        responses: {
          '200': { content: { 'application/json': { schema: { $ref: './pet.yaml#/Pet' } } } },
        },
      },
    },
  },
});

const POSTMAN = JSON.stringify({
  info: {
    name: 'Coll',
    schema: 'https://schema.getpostman.com/json/collection/v2.1.0/collection.json',
  },
  item: [{ name: 'Get pets', request: { method: 'GET', url: 'https://api.example.com/pets' } }],
});

const INSOMNIA = JSON.stringify({
  _type: 'export',
  __export_format: 4,
  resources: [
    {
      _type: 'request',
      _id: 'req_1',
      name: 'Get pets',
      method: 'GET',
      url: 'https://api.example.com/pets',
    },
  ],
});

function endpointCount(id: string): number {
  return useWorkspaceStore.getState().synced?.mockServers[id]?.endpoints.length ?? 0;
}

describe('workspaceStore.createMockServer — spec import materializes endpoints', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    // Ensure no stubbed desktop bridge leaks between tests.
    delete (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop;
    vi.restoreAllMocks();
  });

  it('manual source keeps its inline endpoints and returns no warnings', async () => {
    const { id, warnings } = await useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Manual', source: { kind: 'manual', endpoints: [] } });
    expect(warnings).toEqual([]);
    expect(useWorkspaceStore.getState().synced!.mockServers[id].source.kind).toBe('manual');
    expect(endpointCount(id)).toBe(0);
  });

  it('materializes endpoints from an OpenAPI JSON spec (browser parser)', async () => {
    const { id, warnings } = await useWorkspaceStore.getState().createMockServer({
      name: 'OpenAPI',
      source: { kind: 'openapi', spec: OPENAPI_JSON, format: 'json' },
    });
    expect(warnings).toEqual([]);
    expect(endpointCount(id)).toBe(2);
  });

  it('materializes endpoints from an OpenAPI YAML spec', async () => {
    const { id, warnings } = await useWorkspaceStore.getState().createMockServer({
      name: 'OpenAPI YAML',
      source: { kind: 'openapi', spec: OPENAPI_YAML, format: 'yaml' },
    });
    expect(warnings).toEqual([]);
    expect(endpointCount(id)).toBe(1);
  });

  it('materializes endpoints from a Postman collection', async () => {
    const { id } = await useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Postman', source: { kind: 'postman', collection: POSTMAN } });
    expect(endpointCount(id)).toBe(1);
  });

  it('materializes endpoints from an Insomnia export', async () => {
    const { id } = await useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Insomnia', source: { kind: 'insomnia', export: INSOMNIA } });
    expect(endpointCount(id)).toBe(1);
  });

  it('surfaces a warning for an external $ref (browser cannot resolve it)', async () => {
    const { id, warnings } = await useWorkspaceStore.getState().createMockServer({
      name: 'External',
      source: { kind: 'openapi', spec: OPENAPI_WITH_EXTERNAL_REF, format: 'json' },
    });
    expect(endpointCount(id)).toBe(1);
    expect(warnings.some((w) => w.includes('External $ref not resolved in the web app'))).toBe(
      true,
    );
  });

  it('degrades gracefully (warning + zero endpoints) for an unparseable spec', async () => {
    const { id, warnings } = await useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Bad', source: { kind: 'postman', collection: 'not json' } });
    expect(endpointCount(id)).toBe(0);
    expect(warnings.length).toBeGreaterThan(0);
  });

  it('rejects on a duplicate mock name (throw path)', async () => {
    await useWorkspaceStore
      .getState()
      .createMockServer({ name: 'Dup', source: { kind: 'manual', endpoints: [] } });
    await expect(
      useWorkspaceStore
        .getState()
        .createMockServer({ name: 'Dup', source: { kind: 'manual', endpoints: [] } }),
    ).rejects.toThrow(/already exists/);
  });

  it('uses the Desktop mock bridge (Node/swagger-parser) when present', async () => {
    const parseSpec = vi.fn().mockResolvedValue({
      endpoints: [
        {
          id: 'e1',
          name: 'via bridge',
          method: 'GET',
          pathPattern: '/bridge',
          requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
          requestValidation: [],
          responseRules: [],
          defaultResponse: { status: 200, headers: [], body: { type: 'json', content: '{}' } },
        },
      ],
      warnings: ['bridge-warning'],
    });
    (globalThis as { apicircleDesktop?: unknown }).apicircleDesktop = { mock: { parseSpec } };

    const { id, warnings } = await useWorkspaceStore.getState().createMockServer({
      name: 'Bridged',
      source: { kind: 'openapi', spec: OPENAPI_JSON, format: 'json' },
    });

    expect(parseSpec).toHaveBeenCalledOnce();
    expect(endpointCount(id)).toBe(1);
    expect(useWorkspaceStore.getState().synced!.mockServers[id].endpoints[0].pathPattern).toBe(
      '/bridge',
    );
    expect(warnings).toEqual(['bridge-warning']);
  });
});
