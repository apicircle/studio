// Pure helpers for the workspace-wide Global Assets library: JSON Schemas
// and GraphQL definitions. Same shape as editorActions — return a fresh
// `WorkspaceSynced` so callers wrap them in commitSynced.

import type {
  AttachmentRef,
  FormDataRow,
  GlobalFileAsset,
  GlobalGraphQL,
  GlobalSchema,
  MockResponseBody,
  MockResponseConfig,
  RequestBody,
  WorkspaceSynced,
} from '@apicircle/shared';
import { generateId } from '@apicircle/shared';

function withGlobalAssets(synced: WorkspaceSynced): WorkspaceSynced['globalAssets'] {
  return synced.globalAssets ?? { schemas: {}, graphql: {}, files: {} };
}

function createGlobalSchema(args: {
  name: string;
  schema: string;
  description?: string;
}): GlobalSchema {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: args.name.trim() || 'Untitled schema',
    description: args.description,
    schema: args.schema,
    createdAt: now,
    updatedAt: now,
  };
}

export function addGlobalSchema(
  synced: WorkspaceSynced,
  init: { name: string; schema?: string; description?: string },
): { synced: WorkspaceSynced; schema: GlobalSchema } {
  const schema = createGlobalSchema({
    name: init.name,
    schema:
      init.schema ??
      '{\n  "$schema": "https://json-schema.org/draft/2020-12/schema",\n  "type": "object"\n}',
    description: init.description,
  });
  const ga = withGlobalAssets(synced);
  return {
    synced: {
      ...synced,
      globalAssets: {
        ...ga,
        schemas: { ...ga.schemas, [schema.id]: schema },
      },
      meta: { ...synced.meta, updatedAt: schema.updatedAt },
    },
    schema,
  };
}

export function updateGlobalSchema(
  synced: WorkspaceSynced,
  id: string,
  patch: Partial<Omit<GlobalSchema, 'id' | 'createdAt'>>,
): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  const existing = ga.schemas[id];
  if (!existing) return synced;
  const updated: GlobalSchema = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...synced,
    globalAssets: {
      ...ga,
      schemas: { ...ga.schemas, [id]: updated },
    },
    meta: { ...synced.meta, updatedAt: updated.updatedAt },
  };
}

export function removeGlobalSchema(synced: WorkspaceSynced, id: string): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  if (!ga.schemas[id]) return synced;
  const { [id]: _drop, ...rest } = ga.schemas;
  void _drop;
  // Also clear any request that referenced this schema so dangling ids
  // don't survive a delete.
  const requests = { ...synced.collections.requests };
  for (const [reqId, req] of Object.entries(requests)) {
    if (req.bodySchemaId === id) {
      requests[reqId] = { ...req, bodySchemaId: null };
    }
  }
  return {
    ...synced,
    collections: { ...synced.collections, requests },
    globalAssets: { ...ga, schemas: rest },
    meta: { ...synced.meta, updatedAt: new Date().toISOString() },
  };
}

function createGlobalGraphQL(args: {
  name: string;
  source: string;
  kind: GlobalGraphQL['kind'];
  description?: string;
}): GlobalGraphQL {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: args.name.trim() || 'Untitled GraphQL schema',
    description: args.description,
    kind: args.kind,
    source: args.source,
    createdAt: now,
    updatedAt: now,
  };
}

export function addGlobalGraphQL(
  synced: WorkspaceSynced,
  init: { name: string; source?: string; kind?: GlobalGraphQL['kind']; description?: string },
): { synced: WorkspaceSynced; graphql: GlobalGraphQL } {
  const graphql = createGlobalGraphQL({
    name: init.name,
    source: init.source ?? 'type Query {\n  hello: String\n}',
    kind: init.kind ?? 'sdl',
    description: init.description,
  });
  const ga = withGlobalAssets(synced);
  return {
    synced: {
      ...synced,
      globalAssets: {
        ...ga,
        graphql: { ...ga.graphql, [graphql.id]: graphql },
      },
      meta: { ...synced.meta, updatedAt: graphql.updatedAt },
    },
    graphql,
  };
}

export function updateGlobalGraphQL(
  synced: WorkspaceSynced,
  id: string,
  patch: Partial<Omit<GlobalGraphQL, 'id' | 'createdAt'>>,
): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  const existing = ga.graphql[id];
  if (!existing) return synced;
  const updated: GlobalGraphQL = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...synced,
    globalAssets: {
      ...ga,
      graphql: { ...ga.graphql, [id]: updated },
    },
    meta: { ...synced.meta, updatedAt: updated.updatedAt },
  };
}

export function removeGlobalGraphQL(synced: WorkspaceSynced, id: string): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  if (!ga.graphql[id]) return synced;
  const { [id]: _drop, ...rest } = ga.graphql;
  void _drop;
  const requests = { ...synced.collections.requests };
  for (const [reqId, req] of Object.entries(requests)) {
    if (req.graphqlSchemaId === id) {
      requests[reqId] = { ...req, graphqlSchemaId: null };
    }
  }
  return {
    ...synced,
    collections: { ...synced.collections, requests },
    globalAssets: { ...ga, graphql: rest },
    meta: { ...synced.meta, updatedAt: new Date().toISOString() },
  };
}

function createGlobalFileAsset(args: {
  name: string;
  description?: string;
  slotId: string;
  filename: string;
  size: number;
  mimeType: string;
  sha256?: string;
}): GlobalFileAsset {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: args.name.trim() || args.filename || 'Untitled file',
    description: args.description,
    slotId: args.slotId,
    filename: args.filename,
    size: args.size,
    mimeType: args.mimeType,
    sha256: args.sha256,
    createdAt: now,
    updatedAt: now,
  };
}

export function addGlobalFileAsset(
  synced: WorkspaceSynced,
  init: {
    name: string;
    description?: string;
    slotId: string;
    filename: string;
    size: number;
    mimeType: string;
    sha256?: string;
  },
): { synced: WorkspaceSynced; file: GlobalFileAsset } {
  const file = createGlobalFileAsset(init);
  const ga = withGlobalAssets(synced);
  return {
    synced: {
      ...synced,
      globalAssets: {
        ...ga,
        files: { ...(ga.files ?? {}), [file.id]: file },
      },
      meta: { ...synced.meta, updatedAt: file.updatedAt },
    },
    file,
  };
}

export function updateGlobalFileAsset(
  synced: WorkspaceSynced,
  id: string,
  patch: Partial<Omit<GlobalFileAsset, 'id' | 'createdAt' | 'slotId' | 'sha256'>>,
): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  const existing = ga.files?.[id];
  if (!existing) return synced;
  const updated: GlobalFileAsset = {
    ...existing,
    ...patch,
    id: existing.id,
    slotId: existing.slotId,
    sha256: existing.sha256,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...synced,
    globalAssets: {
      ...ga,
      files: { ...(ga.files ?? {}), [id]: updated },
    },
    meta: { ...synced.meta, updatedAt: updated.updatedAt },
  };
}

export function removeGlobalFileAsset(synced: WorkspaceSynced, id: string): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  const files = ga.files ?? {};
  if (!files[id]) return synced;
  const { [id]: _drop, ...rest } = files;
  void _drop;

  const requests = { ...synced.collections.requests };
  for (const [reqId, req] of Object.entries(requests)) {
    const body = clearGlobalFileAssetFromBody(req.body, id);
    if (body !== req.body) requests[reqId] = { ...req, body };
  }

  const mockServers = { ...synced.mockServers };
  for (const [serverId, server] of Object.entries(mockServers)) {
    let touchedServer = false;
    const endpoints = server.endpoints.map((endpoint) => {
      let touchedEndpoint = false;
      const defaultResponse = clearGlobalFileAssetFromMockResponse(endpoint.defaultResponse, id);
      if (defaultResponse !== endpoint.defaultResponse) touchedEndpoint = true;
      const requestValidation = endpoint.requestValidation.map((rule) => {
        const failResponse = clearGlobalFileAssetFromMockResponse(rule.failResponse, id);
        if (failResponse === rule.failResponse) return rule;
        touchedEndpoint = true;
        return { ...rule, failResponse };
      });
      const responseRules = endpoint.responseRules.map((rule) => {
        const response = clearGlobalFileAssetFromMockResponse(rule.response, id);
        if (response === rule.response) return rule;
        touchedEndpoint = true;
        return { ...rule, response };
      });
      if (!touchedEndpoint) return endpoint;
      touchedServer = true;
      return { ...endpoint, defaultResponse, requestValidation, responseRules };
    });
    if (touchedServer) {
      const source =
        server.source.kind === 'manual' ? { kind: 'manual' as const, endpoints } : server.source;
      mockServers[serverId] = { ...server, source, endpoints, updatedAt: new Date().toISOString() };
    }
  }

  return {
    ...synced,
    collections: { ...synced.collections, requests },
    mockServers,
    globalAssets: { ...ga, files: rest },
    meta: { ...synced.meta, updatedAt: new Date().toISOString() },
  };
}

function clearGlobalFileAssetFromBody(body: RequestBody, id: string): RequestBody {
  if (body.type === 'binary' && body.attachment?.globalFileAssetId === id) {
    return { type: 'binary', content: '' };
  }
  if (body.type !== 'form-data' || !body.formRows) return body;
  let touched = false;
  const formRows = body.formRows.map((row): FormDataRow => {
    if (row.kind !== 'file' || row.globalFileAssetId !== id) return row;
    touched = true;
    return { kind: 'file', key: row.key, enabled: row.enabled, slotId: null };
  });
  return touched ? { ...body, formRows } : body;
}

function clearGlobalFileAssetFromMockResponse(
  response: MockResponseConfig,
  id: string,
): MockResponseConfig {
  const body = clearGlobalFileAssetFromMockBody(response.body, id);
  return body === response.body ? response : { ...response, body };
}

function clearGlobalFileAssetFromMockBody(body: MockResponseBody, id: string): MockResponseBody {
  if (body.type === 'binary' && body.attachment?.globalFileAssetId === id) {
    return { type: 'binary', content: '' };
  }
  return body;
}

export function attachmentRefFromGlobalFileAsset(file: GlobalFileAsset): AttachmentRef {
  return {
    slotId: file.slotId,
    globalFileAssetId: file.id,
    filename: file.filename,
    size: file.size,
    mimeType: file.mimeType,
    sha256: file.sha256,
  };
}

export function formDataRowFromGlobalFileAsset(
  previous: Extract<FormDataRow, { kind: 'file' }>,
  file: GlobalFileAsset,
): Extract<FormDataRow, { kind: 'file' }> {
  return {
    kind: 'file',
    key: previous.key,
    enabled: previous.enabled,
    slotId: file.slotId,
    globalFileAssetId: file.id,
    filename: file.filename,
    size: file.size,
    mimeType: file.mimeType,
    sha256: file.sha256,
  };
}
