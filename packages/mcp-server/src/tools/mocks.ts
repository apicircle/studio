import { z } from 'zod';
import type {
  MockEndpoint,
  MockResponseConfig,
  MockServer,
  MockServerSource,
} from '@apicircle/shared';
import { generateId, makeDefaultMockResponse, makeDefaultRequestSchema } from '@apicircle/shared';
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

// =============================================================================
// Manual mock construction & endpoint-level CRUD
// -----------------------------------------------------------------------------
// `mock.create_manual` mirrors the web UI's "New mock server" → manual mode.
// The endpoint tools below let an MCP client author endpoints + their default
// responses without needing to round-trip through `workspace.write` with a
// hand-built blob.
// =============================================================================

const HTTP_METHOD = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

export const mockCreateManualTool: AnyToolDef = {
  name: 'mock.create_manual',
  description:
    "Create an empty manual-mode mock server. Use `mock.add_endpoint` afterward to populate it. CORS defaults to enabled with origin '*' so MCP clients can hit the running mock from any host.",
  inputSchema: z.object({
    name: z.string().min(1),
    defaultPort: z.number().int().positive().nullable().optional(),
  }),
  async handler(input, ctx) {
    const now = new Date().toISOString();
    const mock: MockServer = {
      id: generateId(),
      name: input.name,
      source: { kind: 'manual', endpoints: [] },
      endpoints: [],
      defaultPort: input.defaultPort ?? null,
      cors: { enabled: true, origins: ['*'] },
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock });
    return { id: mock.id, changedIds: out.changedIds };
  },
};

export const mockListEndpointsTool: AnyToolDef = {
  name: 'mock.list_endpoints',
  description: 'List endpoints for a mock server (id, method, path, name).',
  inputSchema: z.object({ mockId: z.string() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false, error: 'mock not found' as const };
    return {
      ok: true as const,
      count: mock.endpoints.length,
      endpoints: mock.endpoints.map((e) => ({
        id: e.id,
        method: e.method,
        pathPattern: e.pathPattern,
        name: e.name,
        validationCount: e.requestValidation.length,
        responseRuleCount: e.responseRules.length,
      })),
    };
  },
};

const ENDPOINT_RESPONSE = z.object({
  status: z.number().int().min(100).max(599).default(200),
  jsonBody: z.string().default('{}'),
  contentType: z.string().default('application/json'),
});

function buildDefaultEndpoint(args: {
  method: z.infer<typeof HTTP_METHOD>;
  pathPattern: string;
  name?: string;
  description?: string;
  response?: z.infer<typeof ENDPOINT_RESPONSE>;
}): MockEndpoint {
  const response = args.response ?? {
    status: 200,
    jsonBody: '{}',
    contentType: 'application/json',
  };
  const headers = [{ key: 'Content-Type', value: response.contentType, enabled: true as const }];
  return {
    id: generateId(),
    name: args.name ?? `${args.method} ${args.pathPattern}`,
    method: args.method,
    pathPattern: args.pathPattern,
    description: args.description,
    requestSchema: makeDefaultRequestSchema(),
    requestValidation: [],
    responseRules: [],
    defaultResponse: {
      ...makeDefaultMockResponse(),
      status: response.status,
      headers,
      body: { type: 'json', content: response.jsonBody },
    },
  };
}

export const mockAddEndpointTool: AnyToolDef = {
  name: 'mock.add_endpoint',
  description:
    'Append a new endpoint to a mock server. Defaults to a 200 JSON response of `{}`. Returns the new endpoint id.',
  inputSchema: z.object({
    mockId: z.string(),
    method: HTTP_METHOD,
    pathPattern: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    response: ENDPOINT_RESPONSE.optional(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false, error: 'mock not found' as const };
    const endpoint = buildDefaultEndpoint(input);
    const nextEndpoints = [...mock.endpoints, endpoint];
    // Manual-mode mocks mirror endpoints back into source so the runtime
    // sees the same array regardless of which field it reads.
    const source =
      mock.source.kind === 'manual'
        ? { kind: 'manual' as const, endpoints: nextEndpoints }
        : mock.source;
    const next: MockServer = {
      ...mock,
      source,
      endpoints: nextEndpoints,
      updatedAt: new Date().toISOString(),
    };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, endpointId: endpoint.id, changedIds: out.changedIds };
  },
};

export const mockUpdateEndpointTool: AnyToolDef = {
  name: 'mock.update_endpoint',
  description:
    'Patch fields on a single mock endpoint (method, pathPattern, name, description, defaultResponse status / contentType / json body). Pass only the fields you want to change.',
  inputSchema: z.object({
    mockId: z.string(),
    endpointId: z.string(),
    method: HTTP_METHOD.optional(),
    pathPattern: z.string().optional(),
    name: z.string().optional(),
    description: z.string().optional(),
    response: ENDPOINT_RESPONSE.partial().optional(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false, error: 'mock not found' as const };
    const idx = mock.endpoints.findIndex((e) => e.id === input.endpointId);
    if (idx === -1) return { ok: false, error: 'endpoint not found' as const };
    const existing = mock.endpoints[idx];
    const nextEndpoint: MockEndpoint = {
      ...existing,
      method: input.method ?? existing.method,
      pathPattern: input.pathPattern ?? existing.pathPattern,
      name: input.name ?? existing.name,
      description: input.description ?? existing.description,
      defaultResponse: input.response
        ? {
            ...existing.defaultResponse,
            status: input.response.status ?? existing.defaultResponse.status,
            headers: input.response.contentType
              ? existing.defaultResponse.headers.map((h) =>
                  h.key.toLowerCase() === 'content-type'
                    ? { ...h, value: input.response!.contentType! }
                    : h,
                )
              : existing.defaultResponse.headers,
            body:
              input.response.jsonBody !== undefined
                ? { type: 'json', content: input.response.jsonBody }
                : existing.defaultResponse.body,
          }
        : existing.defaultResponse,
    };
    const nextEndpoints = [...mock.endpoints];
    nextEndpoints[idx] = nextEndpoint;
    const source =
      mock.source.kind === 'manual'
        ? { kind: 'manual' as const, endpoints: nextEndpoints }
        : mock.source;
    const next: MockServer = {
      ...mock,
      source,
      endpoints: nextEndpoints,
      updatedAt: new Date().toISOString(),
    };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

export const mockDeleteEndpointTool: AnyToolDef = {
  name: 'mock.delete_endpoint',
  description: 'Remove an endpoint from a mock server.',
  inputSchema: z.object({ mockId: z.string(), endpointId: z.string() }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false, error: 'mock not found' as const };
    const nextEndpoints = mock.endpoints.filter((e) => e.id !== input.endpointId);
    if (nextEndpoints.length === mock.endpoints.length) {
      return { ok: false, error: 'endpoint not found' as const };
    }
    const source =
      mock.source.kind === 'manual'
        ? { kind: 'manual' as const, endpoints: nextEndpoints }
        : mock.source;
    const next: MockServer = {
      ...mock,
      source,
      endpoints: nextEndpoints,
      updatedAt: new Date().toISOString(),
    };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

// =============================================================================
// Endpoint rule + multiplier editing
// -----------------------------------------------------------------------------
// Validation rules, response rules, and multipliers are all replace-only —
// MCP clients send the full ordered list, the tool writes it. Granular per-
// rule mutations would multiply the surface area without adding capability;
// the MCP client can read, mutate, write back.
// =============================================================================

const VALIDATION_RULE = z.object({
  id: z.string().optional(),
  kind: z.enum([
    'header-required',
    'header-equals',
    'header-matches',
    'query-required',
    'query-equals',
    'query-matches',
    'cookie-required',
    'body-required',
    'content-type-equals',
  ]),
  target: z.string().default(''),
  expected: z.string().optional(),
  message: z.string().optional(),
  enabled: z.boolean().default(true),
  failResponse: z
    .object({
      status: z.number().int().min(100).max(599).default(400),
      jsonBody: z.string().default('{"error":"validation failed"}'),
    })
    .default({}),
});

const CONDITION_CLAUSE = z.object({
  id: z.string().optional(),
  scope: z.enum(['query', 'pathParam', 'header', 'cookie', 'body-json-path']),
  target: z.string(),
  op: z.enum(['equals', 'not-equals', 'matches', 'gt', 'lt', 'gte', 'lte', 'present', 'absent']),
  value: z.string().optional(),
});

const RESPONSE_RULE = z.object({
  id: z.string().optional(),
  name: z.string(),
  enabled: z.boolean().default(true),
  when: z.array(CONDITION_CLAUSE).default([]),
  response: z
    .object({
      status: z.number().int().min(100).max(599).default(200),
      jsonBody: z.string().default('{}'),
    })
    .default({}),
});

const MULTIPLIER = z.object({
  id: z.string().optional(),
  name: z.string().optional(),
  source: z.object({
    kind: z.enum(['query', 'pathParam', 'header', 'body-json-path']),
    key: z.string(),
  }),
  targetJsonPath: z.string(),
  defaultCount: z.number().int().nonnegative().default(0),
  min: z.number().int().nonnegative().optional(),
  max: z.number().int().nonnegative().optional(),
});

function defaultJsonResponseConfig(args: { status: number; jsonBody: string }): MockResponseConfig {
  return {
    status: args.status,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: { type: 'json', content: args.jsonBody },
  };
}

function patchEndpoint(
  mock: MockServer,
  endpointId: string,
  patcher: (e: MockEndpoint) => MockEndpoint,
): MockServer | null {
  const idx = mock.endpoints.findIndex((e) => e.id === endpointId);
  if (idx === -1) return null;
  const nextEndpoints = [...mock.endpoints];
  nextEndpoints[idx] = patcher(mock.endpoints[idx]);
  const source =
    mock.source.kind === 'manual'
      ? { kind: 'manual' as const, endpoints: nextEndpoints }
      : mock.source;
  return {
    ...mock,
    source,
    endpoints: nextEndpoints,
    updatedAt: new Date().toISOString(),
  };
}

export const mockSetValidationRulesTool: AnyToolDef = {
  name: 'mock.set_validation_rules',
  description:
    "Replace an endpoint's validation rules. Rules without an `id` get a fresh one; existing rules can keep theirs to preserve client-side selection state. Empty array clears all rules.",
  inputSchema: z.object({
    mockId: z.string(),
    endpointId: z.string(),
    rules: z.array(VALIDATION_RULE),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false as const, error: 'mock not found' as const };
    const rules: Array<z.infer<typeof VALIDATION_RULE>> = input.rules;
    const next = patchEndpoint(mock, input.endpointId, (e) => ({
      ...e,
      requestValidation: rules.map((r) => ({
        id: r.id ?? generateId(),
        kind: r.kind,
        target: r.target,
        expected: r.expected,
        message: r.message,
        enabled: r.enabled,
        failResponse: defaultJsonResponseConfig(r.failResponse),
      })),
    }));
    if (!next) return { ok: false as const, error: 'endpoint not found' as const };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

export const mockSetResponseRulesTool: AnyToolDef = {
  name: 'mock.set_response_rules',
  description:
    "Replace an endpoint's conditional response rules. Rules fire in order; the first whose every clause matches wins. Disabled rules are skipped. Empty array falls back to defaultResponse.",
  inputSchema: z.object({
    mockId: z.string(),
    endpointId: z.string(),
    rules: z.array(RESPONSE_RULE),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false as const, error: 'mock not found' as const };
    const rules: Array<z.infer<typeof RESPONSE_RULE>> = input.rules;
    const next = patchEndpoint(mock, input.endpointId, (e) => ({
      ...e,
      responseRules: rules.map((r) => ({
        id: r.id ?? generateId(),
        name: r.name,
        enabled: r.enabled,
        when: r.when.map((c: z.infer<typeof CONDITION_CLAUSE>) => ({
          id: c.id ?? generateId(),
          scope: c.scope,
          target: c.target,
          op: c.op,
          value: c.value,
        })),
        response: defaultJsonResponseConfig(r.response),
      })),
    }));
    if (!next) return { ok: false as const, error: 'endpoint not found' as const };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

export const mockSetMultipliersTool: AnyToolDef = {
  name: 'mock.set_multipliers',
  description:
    "Replace the response multipliers on an endpoint's defaultResponse. Multipliers expand an array at `targetJsonPath` to a count derived from a request value. Empty array clears all multipliers.",
  inputSchema: z.object({
    mockId: z.string(),
    endpointId: z.string(),
    multipliers: z.array(MULTIPLIER),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false as const, error: 'mock not found' as const };
    const multipliers: Array<z.infer<typeof MULTIPLIER>> = input.multipliers;
    const next = patchEndpoint(mock, input.endpointId, (e) => ({
      ...e,
      defaultResponse: {
        ...e.defaultResponse,
        multipliers:
          multipliers.length === 0
            ? undefined
            : multipliers.map((m) => ({
                id: m.id ?? generateId(),
                name: m.name,
                source: { kind: m.source.kind, key: m.source.key },
                targetJsonPath: m.targetJsonPath,
                defaultCount: m.defaultCount,
                min: m.min,
                max: m.max,
              })),
      },
    }));
    if (!next) return { ok: false as const, error: 'endpoint not found' as const };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, changedIds: out.changedIds };
  },
};
