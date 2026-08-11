import { z } from 'zod';
import type {
  Assertion,
  Environment,
  ExecutionPlan,
  Folder,
  MockEndpoint,
  MockResponseConfig,
  MockServer,
  Request as ApiRequest,
  RequestAuth,
  RequestBody,
} from '@apicircle/shared';
import {
  generateId,
  makeDefaultMockResponse,
  makeDefaultRequestSchema,
  MAX_RESPONSE_MULTIPLIERS,
} from '@apicircle/shared';
import type { AnyToolDef } from './types';
import { ENV_PRIORITY_REF_INPUT, normalizeEnvPriorityOrder } from './crud';

// =============================================================================
// Prompt-driven authoring tools. The AI client converts the user's natural-
// language request into JSON matching the schemas below; the server validates
// + persists. The actual NL → JSON conversion happens client-side in the AI's
// own model, not here.
// =============================================================================

export const promptCreateEnvironmentTool: AnyToolDef = {
  name: 'prompt.create_environment',
  description:
    'Create a new environment from an LLM-shaped JSON envelope. The model produces { name, variables: [{ key, value, encrypted }] }; this tool validates and persists it.',
  inputSchema: z.object({
    name: z.string(),
    variables: z.array(
      z.object({
        key: z.string(),
        value: z.string(),
        encrypted: z.boolean().default(false),
      }),
    ),
  }),
  async handler(input, ctx) {
    const env: Environment = { name: input.name, variables: input.variables };
    const out = await ctx.workspace.apply({ kind: 'environment.upsert', environment: env });
    return { name: env.name, changedIds: out.changedIds };
  },
};

export const promptCreateAssertionTool: AnyToolDef = {
  name: 'prompt.create_assertion',
  description:
    'Add an assertion to a request from an LLM-shaped JSON envelope. Useful when the user asks "assert that the response status is 200 and body.id matches".',
  inputSchema: z.object({
    requestId: z.string(),
    assertion: z.object({
      kind: z.enum(['status', 'header', 'json-path', 'duration', 'json-schema']),
      op: z.enum([
        'equals',
        'not-equals',
        'contains',
        'lt',
        'gt',
        'matches',
        'exists',
        'type',
        'matches-schema',
      ]),
      // `json-schema` (op `matches-schema`): `expected` is a JSON Schema string validating the
      // whole body (or `target` path) recursively — array element shapes, nested objects, required.
      target: z.string().optional(),
      expected: z.union([z.string(), z.number()]),
    }),
  }),
  async handler(input, ctx) {
    const assertion: Assertion = {
      ...input.assertion,
      id: generateId(),
    } as Assertion;
    const out = await ctx.workspace.apply({
      kind: 'assertion.upsert',
      requestId: input.requestId,
      assertion,
    });
    return { id: assertion.id, changedIds: out.changedIds };
  },
};

export const promptCreatePlanTool: AnyToolDef = {
  name: 'prompt.create_plan',
  description:
    'Create an execution plan from an LLM-shaped JSON envelope. The model produces { name, stepRequestIds: [...] } and the tool validates that each id exists in the workspace before persisting.',
  inputSchema: z.object({
    name: z.string(),
    stepRequestIds: z.array(z.string()).default([]),
    // Bare strings = local env names; objects target local/linked envs.
    envPriorityOrder: z.array(ENV_PRIORITY_REF_INPUT).default([]),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const missing: string[] = [];
    for (const rid of input.stepRequestIds) {
      if (!state.synced.collections.requests[rid]) missing.push(rid);
    }
    if (missing.length) {
      return {
        ok: false,
        error: `Unknown request ids: ${missing.join(', ')}`,
        missing,
      };
    }
    const id = generateId();
    const now = new Date().toISOString();
    const plan: ExecutionPlan = {
      id,
      name: input.name,
      steps: input.stepRequestIds.map((requestId: string) => ({ requestId })),
      envPriorityOrder: normalizeEnvPriorityOrder(input.envPriorityOrder),
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'plan.upsert', plan });
    return { ok: true, id, changedIds: out.changedIds };
  },
};

// =============================================================================
// Shared schema fragments for the request- and mock-shaped prompt.* tools
// below. Kept inline (vs imported from crud.ts / mocks.ts) so each prompt.*
// tool stays a self-contained NL contract — the canonical CRUD schemas can
// evolve without dragging the prompt surface with them.
// =============================================================================

const HTTP_METHOD = z.enum(['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS']);

const HEADER_OR_QUERY = z.object({
  key: z.string(),
  value: z.string(),
  enabled: z.boolean().default(true),
});

const REQUEST_BODY = z.object({
  type: z.enum(['none', 'json', 'text', 'xml', 'graphql', 'urlencoded']).default('none'),
  content: z.string().default(''),
  variables: z.string().optional(),
});

// LLM-friendly auth surface — covers the authoring flows a model can plausibly
// produce from natural language. OAuth2 / AWS / Hawk / NTLM / JWT are token-
// state heavy and best authored via the dedicated UI, then patched via
// `request.update`. Callers needing them should use that path.
export const PROMPT_AUTH = z.discriminatedUnion('type', [
  z.object({ type: z.literal('none') }),
  z.object({ type: z.literal('inherit') }),
  z.object({ type: z.literal('bearer'), token: z.string().default('') }),
  z.object({
    type: z.literal('basic'),
    username: z.string().default(''),
    password: z.string().default(''),
  }),
  z.object({
    type: z.literal('api-key'),
    key: z.string().default(''),
    value: z.string().default(''),
    addTo: z.enum(['header', 'query', 'cookie']).default('header'),
  }),
  z.object({
    type: z.literal('custom-header'),
    key: z.string().default(''),
    value: z.string().default(''),
  }),
]);

const PROMPT_ASSERTION = z.object({
  kind: z.enum(['status', 'header', 'json-path', 'duration', 'json-schema']),
  op: z.enum([
    'equals',
    'not-equals',
    'contains',
    'lt',
    'gt',
    'matches',
    'exists',
    'type',
    'matches-schema',
  ]),
  target: z.string().optional(),
  expected: z.union([z.string(), z.number()]),
});

const ENDPOINT_RESPONSE = z.object({
  status: z.number().int().min(100).max(599).default(200),
  jsonBody: z.string().default('{}'),
  contentType: z.string().default('application/json'),
});

const VALIDATION_RULE_NL = z.object({
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

const CONDITION_CLAUSE_NL = z.object({
  scope: z.enum(['query', 'pathParam', 'header', 'cookie', 'body-json-path']),
  target: z.string(),
  op: z.enum(['equals', 'not-equals', 'matches', 'gt', 'lt', 'gte', 'lte', 'present', 'absent']),
  value: z.string().optional(),
});

const RESPONSE_RULE_NL = z.object({
  name: z.string(),
  enabled: z.boolean().default(true),
  // At least one clause — a no-condition rule is dead (the runtime engine skips
  // clause-less rules), so it never fires (mirrors the VS Code parser's reject).
  when: z.array(CONDITION_CLAUSE_NL).min(1),
  response: z
    .object({
      status: z.number().int().min(100).max(599).default(200),
      jsonBody: z.string().default('{}'),
    })
    .default({}),
});

const MULTIPLIER_NL = z.object({
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

const ENDPOINT_INPUT = z.object({
  method: HTTP_METHOD,
  pathPattern: z.string().min(1),
  name: z.string().optional(),
  description: z.string().optional(),
  response: ENDPOINT_RESPONSE.optional(),
  validationRules: z.array(VALIDATION_RULE_NL).default([]),
  responseRules: z.array(RESPONSE_RULE_NL).default([]),
  multipliers: z.array(MULTIPLIER_NL).default([]),
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function buildRequestBody(input?: z.infer<typeof REQUEST_BODY>): RequestBody {
  if (!input) return { type: 'none', content: '' };
  const body: RequestBody = { type: input.type, content: input.content };
  if (input.variables !== undefined && input.type === 'graphql') {
    body.variables = input.variables;
  }
  return body;
}

function buildEndpoint(input: z.infer<typeof ENDPOINT_INPUT>): MockEndpoint {
  const response = input.response ?? {
    status: 200,
    jsonBody: '{}',
    contentType: 'application/json',
  };
  const headers = [{ key: 'Content-Type', value: response.contentType, enabled: true as const }];
  const defaultResponse: MockResponseConfig = {
    ...makeDefaultMockResponse(),
    status: response.status,
    headers,
    body: { type: 'json', content: response.jsonBody },
  };
  // Inputs from raw JSON (callers bypassing zod parse) may have these arrays
  // omitted. Treat undefined as empty so the build path never NPEs.
  const validationRules = input.validationRules ?? [];
  const responseRules = input.responseRules ?? [];
  const multipliers = (input.multipliers ?? []).slice(0, MAX_RESPONSE_MULTIPLIERS);
  if (multipliers.length > 0) {
    defaultResponse.multipliers = multipliers.map((m) => ({
      id: generateId(),
      name: m.name,
      source: { kind: m.source.kind, key: m.source.key },
      targetJsonPath: m.targetJsonPath,
      defaultCount: m.defaultCount,
      min: m.min,
      max: m.max,
    }));
  }
  return {
    id: generateId(),
    name: input.name ?? `${input.method} ${input.pathPattern}`,
    method: input.method,
    pathPattern: input.pathPattern,
    description: input.description,
    requestSchema: makeDefaultRequestSchema(),
    requestValidation: validationRules.map((r) => ({
      id: generateId(),
      kind: r.kind,
      target: r.target,
      expected: r.expected,
      message: r.message,
      enabled: r.enabled,
      failResponse: {
        status: r.failResponse.status,
        headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
        body: { type: 'json', content: r.failResponse.jsonBody },
      },
    })),
    responseRules: responseRules.map((r) => ({
      id: generateId(),
      name: r.name,
      enabled: r.enabled,
      when: (r.when ?? []).map((c) => ({
        id: generateId(),
        scope: c.scope,
        target: c.target,
        op: c.op,
        value: c.value,
      })),
      response: {
        status: r.response.status,
        headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
        body: { type: 'json', content: r.response.jsonBody },
      },
    })),
    defaultResponse,
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

// ---------------------------------------------------------------------------
// Requests
// ---------------------------------------------------------------------------

export const promptCreateRequestTool: AnyToolDef = {
  name: 'prompt.create_request',
  description:
    'Create a fully-shaped request from an LLM-shaped JSON envelope: method, url, headers, query params, body, auth, and inline assertions. The model produces a flat object; this tool generates the request id, normalizes auth (defaults to `inherit` so folder auth wins), and persists.',
  inputSchema: z.object({
    name: z.string().default('New request'),
    method: HTTP_METHOD.default('GET'),
    url: z.string().default(''),
    folderId: z.string().nullable().optional(),
    headers: z.array(HEADER_OR_QUERY).default([]),
    queryParams: z.array(HEADER_OR_QUERY).default([]),
    pathParams: z.record(z.string(), z.string()).optional(),
    body: REQUEST_BODY.optional(),
    auth: PROMPT_AUTH.optional(),
    assertions: z.array(PROMPT_ASSERTION).default([]),
  }),
  async handler(input, ctx) {
    const now = new Date().toISOString();
    const auth: RequestAuth = (input.auth ?? { type: 'inherit' }) as RequestAuth;
    const assertions: Array<z.infer<typeof PROMPT_ASSERTION>> = input.assertions ?? [];
    const request: ApiRequest = {
      id: generateId(),
      name: input.name ?? 'New request',
      folderId: input.folderId ?? null,
      method: input.method ?? 'GET',
      url: input.url ?? '',
      headers: input.headers ?? [],
      query: input.queryParams ?? [],
      pathParams: input.pathParams,
      body: buildRequestBody(input.body),
      auth,
      contextVars: [],
      extractions: [],
      assertions: assertions.map((a) => ({ ...a, id: generateId() })),
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'request.create', request });
    return { id: request.id, changedIds: out.changedIds };
  },
};

export const promptUpdateRequestTool: AnyToolDef = {
  name: 'prompt.update_request',
  description:
    'Patch an existing request from an LLM-shaped JSON envelope. Provided fields replace the existing values; omitted fields are left untouched. Arrays (headers, queryParams, assertions) are full replacements when supplied. Returns `{ ok: false, error }` when the id does not resolve.',
  inputSchema: z.object({
    id: z.string(),
    patch: z
      .object({
        name: z.string().optional(),
        method: HTTP_METHOD.optional(),
        url: z.string().optional(),
        folderId: z.string().nullable().optional(),
        headers: z.array(HEADER_OR_QUERY).optional(),
        queryParams: z.array(HEADER_OR_QUERY).optional(),
        pathParams: z.record(z.string(), z.string()).optional(),
        body: REQUEST_BODY.optional(),
        auth: PROMPT_AUTH.optional(),
        assertions: z.array(PROMPT_ASSERTION).optional(),
      })
      .strict(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    if (!state.synced.collections.requests[input.id]) {
      return { ok: false as const, error: 'request not found' as const };
    }
    const patch: Partial<Omit<ApiRequest, 'id' | 'createdAt'>> = {};
    if (input.patch.name !== undefined) patch.name = input.patch.name;
    if (input.patch.method !== undefined) patch.method = input.patch.method;
    if (input.patch.url !== undefined) patch.url = input.patch.url;
    if (input.patch.folderId !== undefined) patch.folderId = input.patch.folderId ?? null;
    if (input.patch.headers !== undefined) patch.headers = input.patch.headers;
    if (input.patch.queryParams !== undefined) patch.query = input.patch.queryParams;
    if (input.patch.pathParams !== undefined) patch.pathParams = input.patch.pathParams;
    if (input.patch.body !== undefined) patch.body = buildRequestBody(input.patch.body);
    if (input.patch.auth !== undefined) patch.auth = input.patch.auth as RequestAuth;
    if (input.patch.assertions !== undefined) {
      patch.assertions = input.patch.assertions.map((a: z.infer<typeof PROMPT_ASSERTION>) => ({
        ...a,
        id: generateId(),
      }));
    }
    const out = await ctx.workspace.apply({ kind: 'request.update', id: input.id, patch });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

// ---------------------------------------------------------------------------
// Folders
// ---------------------------------------------------------------------------

interface FolderTreeNode {
  name: string;
  children?: FolderTreeNode[];
}

const FOLDER_TREE_NODE: z.ZodType<FolderTreeNode> = z.lazy(() =>
  z.object({
    name: z.string(),
    children: z.array(FOLDER_TREE_NODE).optional(),
  }),
);

export const promptCreateFolderTreeTool: AnyToolDef = {
  name: 'prompt.create_folder_tree',
  description:
    'Create a recursive folder hierarchy from an LLM-shaped JSON envelope. The model produces `{ parentId?, tree: { name, children?: [...] } }` and this tool walks the tree, generating ids and persisting one folder per node. Returns the list of created ids in pre-order.',
  inputSchema: z.object({
    parentId: z.string().nullable().optional(),
    tree: FOLDER_TREE_NODE,
  }),
  async handler(input, ctx) {
    const createdIds: string[] = [];
    const allChangedIds: string[] = [];
    const walk = async (node: FolderTreeNode, parentId: string | null): Promise<void> => {
      const folder: Folder = {
        id: generateId(),
        name: node.name,
        parentId,
      };
      const out = await ctx.workspace.apply({ kind: 'folder.create', folder });
      createdIds.push(folder.id);
      allChangedIds.push(...out.changedIds);
      for (const child of node.children ?? []) {
        await walk(child, folder.id);
      }
    };
    await walk(input.tree, input.parentId ?? null);
    return { createdIds, changedIds: allChangedIds };
  },
};

// ---------------------------------------------------------------------------
// Plans
// ---------------------------------------------------------------------------

export const promptAddPlanStepsTool: AnyToolDef = {
  name: 'prompt.add_plan_steps',
  description:
    'Append one or more steps to an existing execution plan from an LLM-shaped JSON envelope. The model produces `{ planId, requestIds: [...] }`; each id is validated against the workspace before any step is appended. Order in the input list is preserved.',
  inputSchema: z.object({
    planId: z.string(),
    requestIds: z.array(z.string()).min(1),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const plan = (state.synced.executionPlans ?? {})[input.planId];
    if (!plan) return { ok: false as const, error: 'plan not found' as const };
    const requestIds: string[] = input.requestIds;
    const missing = requestIds.filter((rid) => !state.synced.collections.requests[rid]);
    if (missing.length) {
      return {
        ok: false as const,
        error: `Unknown request ids: ${missing.join(', ')}`,
        missing,
      };
    }
    const newSteps = requestIds.map((requestId) => ({ requestId }));
    const out = await ctx.workspace.apply({
      kind: 'plan.upsert',
      plan: {
        ...plan,
        steps: [...plan.steps, ...newSteps],
        updatedAt: new Date().toISOString(),
      },
    });
    return { ok: true as const, addedCount: newSteps.length, changedIds: out.changedIds };
  },
};

export const promptSetPlanVariablesTool: AnyToolDef = {
  name: 'prompt.set_plan_variables',
  description:
    'Replace the plan-scoped variables on an execution plan from an LLM-shaped JSON envelope. The model produces `{ planId, variables: [{ key, value }] }`. Empty array clears all plan variables.',
  inputSchema: z.object({
    planId: z.string(),
    variables: z.array(z.object({ key: z.string(), value: z.string() })),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const plan = (state.synced.executionPlans ?? {})[input.planId];
    if (!plan) return { ok: false as const, error: 'plan not found' as const };
    const out = await ctx.workspace.apply({
      kind: 'plan.upsert',
      plan: { ...plan, variables: input.variables, updatedAt: new Date().toISOString() },
    });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

// ---------------------------------------------------------------------------
// Mocks
// ---------------------------------------------------------------------------

export const promptCreateMockServerTool: AnyToolDef = {
  name: 'prompt.create_mock_server',
  description:
    'Create a manual-mode mock server with optional inline endpoints from an LLM-shaped JSON envelope. The model produces `{ name, defaultPort?, endpoints: [{ method, pathPattern, name?, response?, validationRules?, responseRules?, multiplier? }] }`; this tool generates ids for the server and every endpoint / rule, then persists in one shot.',
  inputSchema: z.object({
    name: z.string().min(1),
    // Mirrors mock.create_manual / mock.start / mock.set_default_port:
    // reject out-of-range ports at the tool boundary so a prompt that
    // returns a stray port (1, 80, 999999) never leaks into the synced doc.
    defaultPort: z.number().int().min(1024).max(65535).nullable().optional(),
    endpoints: z.array(ENDPOINT_INPUT).default([]),
  }),
  async handler(input, ctx) {
    const now = new Date().toISOString();
    const endpointInputs: Array<z.infer<typeof ENDPOINT_INPUT>> = input.endpoints ?? [];
    const endpoints = endpointInputs.map((e) => buildEndpoint(e));
    const mock: MockServer = {
      id: generateId(),
      name: input.name,
      source: { kind: 'manual', endpoints },
      endpoints,
      defaultPort: input.defaultPort ?? null,
      cors: { enabled: true, origins: ['*'] },
      createdAt: now,
      updatedAt: now,
    };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock });
    return {
      id: mock.id,
      endpointIds: endpoints.map((e: MockEndpoint) => e.id),
      changedIds: out.changedIds,
    };
  },
};

export const promptAddMockEndpointTool: AnyToolDef = {
  name: 'prompt.add_mock_endpoint',
  description:
    'Append a new endpoint (with optional inline validation rules, response rules, and a single response multiplier) to an existing mock server from an LLM-shaped JSON envelope. All ids are auto-generated; the existing endpoints stay in place.',
  inputSchema: z.object({
    mockId: z.string(),
    method: HTTP_METHOD,
    pathPattern: z.string().min(1),
    name: z.string().optional(),
    description: z.string().optional(),
    response: ENDPOINT_RESPONSE.optional(),
    validationRules: z.array(VALIDATION_RULE_NL).default([]),
    responseRules: z.array(RESPONSE_RULE_NL).default([]),
    multipliers: z.array(MULTIPLIER_NL).default([]),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false as const, error: 'mock not found' as const };
    const endpoint = buildEndpoint(input);
    const nextEndpoints = [...mock.endpoints, endpoint];
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

export const promptSetEndpointValidationRulesTool: AnyToolDef = {
  name: 'prompt.set_endpoint_validation_rules',
  description:
    "Replace an endpoint's validation rules with an LLM-shaped list. Every rule gets a fresh id; the existing rules are dropped. Empty array clears all validation rules.",
  inputSchema: z.object({
    mockId: z.string(),
    endpointId: z.string(),
    rules: z.array(VALIDATION_RULE_NL),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false as const, error: 'mock not found' as const };
    const rules: Array<z.infer<typeof VALIDATION_RULE_NL>> = input.rules;
    const next = patchEndpoint(mock, input.endpointId, (e) => ({
      ...e,
      requestValidation: rules.map((r) => ({
        id: generateId(),
        kind: r.kind,
        target: r.target,
        expected: r.expected,
        message: r.message,
        enabled: r.enabled,
        failResponse: {
          status: r.failResponse.status,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: { type: 'json', content: r.failResponse.jsonBody },
        },
      })),
    }));
    if (!next) return { ok: false as const, error: 'endpoint not found' as const };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

export const promptSetEndpointResponseRulesTool: AnyToolDef = {
  name: 'prompt.set_endpoint_response_rules',
  description:
    "Replace an endpoint's conditional response rules with an LLM-shaped list. Rules fire in order, first match wins. Every rule + clause gets a fresh id. Empty array falls back to defaultResponse.",
  inputSchema: z.object({
    mockId: z.string(),
    endpointId: z.string(),
    rules: z.array(RESPONSE_RULE_NL),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false as const, error: 'mock not found' as const };
    const rules: Array<z.infer<typeof RESPONSE_RULE_NL>> = input.rules;
    const next = patchEndpoint(mock, input.endpointId, (e) => ({
      ...e,
      responseRules: rules.map((r) => ({
        id: generateId(),
        name: r.name,
        enabled: r.enabled,
        when: r.when.map((c: z.infer<typeof CONDITION_CLAUSE_NL>) => ({
          id: generateId(),
          scope: c.scope,
          target: c.target,
          op: c.op,
          value: c.value,
        })),
        response: {
          status: r.response.status,
          headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
          body: { type: 'json', content: r.response.jsonBody },
        },
      })),
    }));
    if (!next) return { ok: false as const, error: 'endpoint not found' as const };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, changedIds: out.changedIds };
  },
};

export const promptSetEndpointMultipliersTool: AnyToolDef = {
  name: 'prompt.set_endpoint_multipliers',
  description:
    "Replace the response multipliers on an endpoint's defaultResponse with an LLM-shaped list. Multipliers expand an array at `targetJsonPath` to a count derived from a request value. Every multiplier gets a fresh id. Empty array clears all. Capped at MAX_RESPONSE_MULTIPLIERS (1) — extra entries are rejected.",
  inputSchema: z.object({
    mockId: z.string(),
    endpointId: z.string(),
    multipliers: z.array(MULTIPLIER_NL),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false as const, error: 'mock not found' as const };
    const multipliers: Array<z.infer<typeof MULTIPLIER_NL>> = input.multipliers;
    if (multipliers.length > MAX_RESPONSE_MULTIPLIERS) {
      return { ok: false as const, error: 'too many multipliers' as const };
    }
    const next = patchEndpoint(mock, input.endpointId, (e) => ({
      ...e,
      defaultResponse: {
        ...e.defaultResponse,
        multipliers:
          multipliers.length === 0
            ? undefined
            : multipliers.map((m) => ({
                id: generateId(),
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

const PARAM_NL = z.object({
  name: z.string(),
  typeHint: z.string().optional(),
  required: z.boolean().optional(),
  description: z.string().optional(),
  example: z.string().optional(),
});

export const promptSetEndpointRequestSchemaTool: AnyToolDef = {
  name: 'prompt.set_endpoint_request_schema',
  description:
    "Declare an endpoint's expected inputs with an LLM-shaped list: path / query / header / cookie params (name + optional typeHint / required / description / example) plus an optional body-shape doc. Every param gets a fresh id; omitted lists are cleared. Documentation-only — it drives the editor UI + OpenAPI export, not runtime gating (use validation rules for that).",
  inputSchema: z.object({
    mockId: z.string(),
    endpointId: z.string(),
    pathParams: z.array(PARAM_NL).default([]),
    queryParams: z.array(PARAM_NL).default([]),
    headers: z.array(PARAM_NL).default([]),
    cookies: z.array(PARAM_NL).default([]),
    body: z
      .object({ description: z.string().optional(), example: z.string().optional() })
      .optional(),
  }),
  async handler(input, ctx) {
    const state = await ctx.workspace.read();
    const mock = state.synced.mockServers[input.mockId];
    if (!mock) return { ok: false as const, error: 'mock not found' as const };
    const toParams = (list: Array<z.infer<typeof PARAM_NL>>) =>
      list.map((p) => ({
        id: generateId(),
        name: p.name,
        typeHint: p.typeHint,
        required: p.required,
        description: p.description,
        example: p.example,
      }));
    const body =
      input.body && (input.body.description || input.body.example) ? input.body : undefined;
    const next = patchEndpoint(mock, input.endpointId, (e) => ({
      ...e,
      requestSchema: {
        pathParams: toParams(input.pathParams),
        queryParams: toParams(input.queryParams),
        headers: toParams(input.headers),
        cookies: toParams(input.cookies),
        body,
      },
    }));
    if (!next) return { ok: false as const, error: 'endpoint not found' as const };
    const out = await ctx.workspace.apply({ kind: 'mock.upsert', mock: next });
    return { ok: true as const, changedIds: out.changedIds };
  },
};
