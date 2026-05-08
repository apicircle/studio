import type {
  MockEndpoint,
  MockResponseConfig,
  MockResponseRule,
  MockServer,
  MockValidationRule,
  WorkspaceSynced,
} from '@apicircle/shared';
import { generateId } from '@apicircle/shared';

// Pure reducers for cloning a MockServer or a single MockEndpoint within a
// server. Mirrors the editorActions pattern: take a synced doc, return a
// new snapshot with `meta.updatedAt` bumped.
//
// Cloning a server: every nested entity (endpoints, validation rules,
// response rules, response-rule clauses, multipliers) gets a fresh id so
// the duplicate is a self-contained subtree.
//
// Cloning an endpoint: stays inside the same server; gets a new id +
// "(copy)" label suffix; all nested rules + multipliers are re-id'd.

function bumpUpdatedAt(synced: WorkspaceSynced): WorkspaceSynced {
  return { ...synced, meta: { ...synced.meta, updatedAt: new Date().toISOString() } };
}

function uniquifyServerName(synced: WorkspaceSynced, base: string): string {
  const taken = new Set(Object.values(synced.mockServers).map((s) => s.name.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) {
    n += 1;
    if (n > 999) return `${base} (${n})`;
  }
  return `${base} (${n})`;
}

function uniquifyEndpointName(server: MockServer, base: string): string {
  const taken = new Set(server.endpoints.map((e) => e.name.trim().toLowerCase()));
  if (!taken.has(base.trim().toLowerCase())) return base;
  let n = 2;
  while (taken.has(`${base} (${n})`.toLowerCase())) {
    n += 1;
    if (n > 999) return `${base} (${n})`;
  }
  return `${base} (${n})`;
}

function cloneResponseConfig(response: MockResponseConfig): MockResponseConfig {
  return {
    ...response,
    headers: response.headers.map((h) => ({ ...h })),
    body: cloneBody(response.body),
    multipliers: response.multipliers?.map((m) => ({
      ...m,
      id: generateId(),
      source: { ...m.source },
    })),
  };
}

function cloneBody(body: MockResponseConfig['body']): MockResponseConfig['body'] {
  if (body.type === 'form-data') {
    return { ...body, formRows: body.formRows.map((row) => ({ ...row })) };
  }
  if (body.type === 'binary') {
    return { ...body, attachment: body.attachment ? { ...body.attachment } : undefined };
  }
  return { ...body };
}

function cloneValidationRule(rule: MockValidationRule): MockValidationRule {
  return {
    ...rule,
    id: generateId(),
    failResponse: cloneResponseConfig(rule.failResponse),
  };
}

function cloneResponseRule(rule: MockResponseRule): MockResponseRule {
  return {
    ...rule,
    id: generateId(),
    when: rule.when.map((c) => ({ ...c, id: generateId() })),
    response: cloneResponseConfig(rule.response),
  };
}

/**
 * Deep-clone an endpoint with fresh ids on every nested rule / clause /
 * multiplier. Used both by `duplicateMockEndpoint` and as a helper inside
 * `duplicateMockServer`.
 */
export function cloneEndpoint(endpoint: MockEndpoint): MockEndpoint {
  return {
    ...endpoint,
    id: generateId(),
    requestSchema: {
      pathParams: endpoint.requestSchema.pathParams.map((p) => ({ ...p, id: generateId() })),
      queryParams: endpoint.requestSchema.queryParams.map((p) => ({ ...p, id: generateId() })),
      headers: endpoint.requestSchema.headers.map((p) => ({ ...p, id: generateId() })),
      cookies: endpoint.requestSchema.cookies.map((p) => ({ ...p, id: generateId() })),
      body: endpoint.requestSchema.body ? { ...endpoint.requestSchema.body } : undefined,
    },
    requestValidation: endpoint.requestValidation.map(cloneValidationRule),
    responseRules: endpoint.responseRules.map(cloneResponseRule),
    defaultResponse: cloneResponseConfig(endpoint.defaultResponse),
  };
}

export function duplicateMockServer(
  synced: WorkspaceSynced,
  serverId: string,
): { synced: WorkspaceSynced; server: MockServer | null } {
  const src = synced.mockServers[serverId];
  if (!src) return { synced, server: null };

  const newId = generateId();
  const newName = uniquifyServerName(synced, `${src.name} (copy)`);
  const now = new Date().toISOString();

  const clonedEndpoints = src.endpoints.map(cloneEndpoint);
  const newSource =
    src.source.kind === 'manual'
      ? { kind: 'manual' as const, endpoints: clonedEndpoints }
      : src.source.kind === 'openapi'
        ? { ...src.source }
        : src.source.kind === 'postman'
          ? { ...src.source }
          : { ...src.source };

  const dup: MockServer = {
    ...src,
    id: newId,
    name: newName,
    source: newSource,
    endpoints: clonedEndpoints,
    cors: { enabled: src.cors.enabled, origins: [...src.cors.origins] },
    createdAt: now,
    updatedAt: now,
  };

  return {
    synced: bumpUpdatedAt({
      ...synced,
      mockServers: { ...synced.mockServers, [newId]: dup },
    }),
    server: dup,
  };
}

export function duplicateMockEndpoint(
  synced: WorkspaceSynced,
  serverId: string,
  endpointId: string,
): { synced: WorkspaceSynced; endpoint: MockEndpoint | null } {
  const server = synced.mockServers[serverId];
  if (!server) return { synced, endpoint: null };
  const src = server.endpoints.find((e) => e.id === endpointId);
  if (!src) return { synced, endpoint: null };

  const cloned = cloneEndpoint(src);
  cloned.name = uniquifyEndpointName(server, `${src.name} (copy)`);
  const nextEndpoints = [...server.endpoints, cloned];
  const source =
    server.source.kind === 'manual'
      ? { kind: 'manual' as const, endpoints: nextEndpoints }
      : server.source;
  const now = new Date().toISOString();

  return {
    synced: bumpUpdatedAt({
      ...synced,
      mockServers: {
        ...synced.mockServers,
        [serverId]: { ...server, source, endpoints: nextEndpoints, updatedAt: now },
      },
    }),
    endpoint: cloned,
  };
}
