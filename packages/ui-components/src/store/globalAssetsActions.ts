// Pure helpers for the workspace-wide Global Assets library: JSON Schemas
// and GraphQL definitions. Same shape as editorActions — return a fresh
// `WorkspaceSynced` so callers wrap them in commitSynced.

import type { GlobalGraphQL, GlobalSchema, WorkspaceSynced } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';

function withGlobalAssets(synced: WorkspaceSynced): WorkspaceSynced['globalAssets'] {
  return synced.globalAssets ?? { schemas: {}, graphql: {} };
}

export function createGlobalSchema(args: {
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

export function createGlobalGraphQL(args: {
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
