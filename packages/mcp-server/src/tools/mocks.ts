import { z } from 'zod';
import type { MockServer, MockServerSource } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import { parseSourceToEndpoints } from '@apicircle/mock-server-core';
import type { AnyToolDef } from './types';

// =============================================================================
// Mock-server tools. Definitions live in `synced.mockServers` (push to git);
// `mock.start` / `mock.stop` go through the MockController so the MCP host's
// environment (Electron main, CLI, hosted) controls the actual lifecycle.
// =============================================================================

async function ingestSource(source: MockServerSource, name: string): Promise<MockServer> {
  const { endpoints } = await parseSourceToEndpoints(source);
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    source,
    endpoints,
    overrides: {},
    defaultPort: null,
    cors: { enabled: true, origins: ['*'] },
    createdAt: now,
    updatedAt: now,
  };
}

export const mockCreateFromOpenApiTool: AnyToolDef = {
  name: 'mock.create_from_openapi',
  description: 'Create a mock server from an OpenAPI / Swagger spec (YAML or JSON).',
  inputSchema: z.object({
    name: z.string(),
    spec: z.string().min(1),
    format: z.enum(['json', 'yaml']).default('json'),
  }),
  async handler(input, ctx) {
    const mock = await ingestSource(
      { kind: 'openapi', spec: input.spec, format: input.format },
      input.name,
    );
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock });
    return { id: mock.id, endpointCount: mock.endpoints.length, changedIds: out.changedIds };
  },
};

export const mockCreateFromPostmanTool: AnyToolDef = {
  name: 'mock.create_from_postman',
  description: 'Create a mock server from a Postman v2/v2.1 collection.',
  inputSchema: z.object({ name: z.string(), collection: z.string().min(1) }),
  async handler(input, ctx) {
    const mock = await ingestSource({ kind: 'postman', collection: input.collection }, input.name);
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock });
    return { id: mock.id, endpointCount: mock.endpoints.length, changedIds: out.changedIds };
  },
};

export const mockCreateFromInsomniaTool: AnyToolDef = {
  name: 'mock.create_from_insomnia',
  description: 'Create a mock server from an Insomnia v4 export.',
  inputSchema: z.object({ name: z.string(), export: z.string().min(1) }),
  async handler(input, ctx) {
    const mock = await ingestSource({ kind: 'insomnia', export: input.export }, input.name);
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock });
    return { id: mock.id, endpointCount: mock.endpoints.length, changedIds: out.changedIds };
  },
};

// Postman has its own "mock collection" concept — same parser, but we tag
// the source so the UI can label it differently in the mock list.
export const mockImportPostmanMockCollectionTool: AnyToolDef = {
  name: 'mock.import_postman_mock_collection',
  description:
    "Import a Postman Mock Collection (collections previously hosted on Postman's mock service). Same parser as a regular Postman collection but marked as a mock import.",
  inputSchema: z.object({ name: z.string(), collection: z.string().min(1) }),
  async handler(input, ctx) {
    const mock = await ingestSource({ kind: 'postman', collection: input.collection }, input.name);
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock });
    return { id: mock.id, endpointCount: mock.endpoints.length, changedIds: out.changedIds };
  },
};

export const mockListTool: AnyToolDef = {
  name: 'mock.list',
  description:
    'List all mock servers in the workspace plus their runtime status (running / stopped, port).',
  inputSchema: z.object({}),
  async handler(_input, ctx) {
    const state = await ctx.workspace.read();
    const running = await ctx.mock.list();
    const runningById = new Map(running.map((r) => [r.serverId, r.runtime]));
    const items = Object.values(state.synced.mockServers).map((m) => {
      const runtime = runningById.get(m.id);
      return {
        id: m.id,
        name: m.name,
        endpointCount: m.endpoints.length,
        defaultPort: m.defaultPort,
        running: !!runtime,
        port: runtime?.port ?? null,
      };
    });
    return { count: items.length, mocks: items };
  },
};

export const mockStartTool: AnyToolDef = {
  name: 'mock.start',
  description:
    'Start a mock server by id. Returns the bound port. Errors if the mock is already running or the requested port is in use.',
  inputSchema: z.object({
    id: z.string(),
    port: z.number().int().positive().optional(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.id];
    if (!mock) return { ok: false, error: 'mock not found' };
    const result = await ctx.mock.start(mock, { port: input.port });
    return { ok: true, port: result.port, pid: result.pid, startedAt: result.startedAt };
  },
};

export const mockStopTool: AnyToolDef = {
  name: 'mock.stop',
  description: 'Stop a running mock server by id (no-op if not running).',
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    await ctx.mock.stop(input.id);
    return { ok: true };
  },
};

export const mockDeleteTool: AnyToolDef = {
  name: 'mock.delete',
  description: "Delete a mock server definition. Stops it first if it's running.",
  inputSchema: z.object({ id: z.string() }),
  async handler(input, ctx) {
    await ctx.mock.stop(input.id);
    const out = await ctx.workspace.apply({ kind: 'mock.delete', id: input.id });
    return { ok: true, changedIds: out.changedIds };
  },
};
