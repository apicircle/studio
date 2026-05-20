// Lightweight GraphQL schema parser for editor autocomplete. Two inputs
// supported:
//
//   1. SDL (`type Query { ... }`): a forgiving regex-based extractor — we
//      don't ship a full GraphQL grammar; we just want enough information
//      to power "what fields does this type expose?" completions.
//
//   2. Introspection JSON (the result of `query IntrospectionQuery`): we
//      consume the official shape, so completions are accurate.
//
// Output is a flat shape consumable by Monaco's completion provider —
// types, fields per type, root operation type names, and a list of
// scalar / enum names.

export interface GraphQLSchemaInfo {
  /** Object/Interface types and their fields. */
  types: Map<string, { fields: GraphQLField[] }>;
  /** Top-level operations (Query, Mutation, Subscription). */
  rootTypes: { query?: string; mutation?: string; subscription?: string };
  /** Scalar + enum names. */
  scalars: string[];
  enums: string[];
}

export interface GraphQLField {
  name: string;
  type: string;
  description?: string;
}

const EMPTY: GraphQLSchemaInfo = {
  types: new Map(),
  rootTypes: {},
  scalars: [],
  enums: [],
};

export function parseGraphqlSchema(
  source: string,
  kind: 'sdl' | 'introspection',
): GraphQLSchemaInfo {
  if (!source.trim()) return EMPTY;
  if (kind === 'introspection') return parseIntrospection(source);
  return parseSdl(source);
}

// --- SDL parser ---------------------------------------------------------

function parseSdl(source: string): GraphQLSchemaInfo {
  const types = new Map<string, { fields: GraphQLField[] }>();
  const rootTypes: GraphQLSchemaInfo['rootTypes'] = {
    query: 'Query',
    mutation: 'Mutation',
    subscription: 'Subscription',
  };
  const scalars: string[] = [];
  const enums: string[] = [];

  // Strip block + line comments.
  const text = source.replace(/"""[\s\S]*?"""/g, '').replace(/^\s*#.*$/gm, '');

  // schema { query: A, mutation: B, subscription: C }
  const schemaMatch = /schema\s*\{([\s\S]*?)\}/.exec(text);
  if (schemaMatch) {
    const inner = schemaMatch[1] ?? '';
    for (const line of inner.split(/\r?\n/)) {
      const m = /(query|mutation|subscription)\s*:\s*(\w+)/.exec(line);
      if (m) (rootTypes as Record<string, string>)[m[1]] = m[2]!;
    }
  }

  const typeRegex = /\b(type|interface)\s+(\w+)(?:\s+implements\s+[\w\s&]+?)?\s*\{([\s\S]*?)\}/g;
  let match: RegExpExecArray | null;
  while ((match = typeRegex.exec(text))) {
    const typeName = match[2];
    const body = match[3];
    const fields: GraphQLField[] = [];
    for (const line of body.split(/\r?\n/)) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;
      const fm = /^(\w+)(?:\s*\([^)]*\))?\s*:\s*([^\s,]+)/.exec(trimmed);
      if (fm) {
        fields.push({ name: fm[1], type: fm[2] });
      }
    }
    types.set(typeName, { fields });
  }

  for (const m of text.matchAll(/\bscalar\s+(\w+)/g)) scalars.push(m[1]);
  for (const m of text.matchAll(/\benum\s+(\w+)\s*\{[\s\S]*?\}/g)) enums.push(m[1]);

  return { types, rootTypes, scalars, enums };
}

// --- Introspection parser ----------------------------------------------

interface IntrospectionType {
  kind: string;
  name: string;
  description?: string;
  fields?: Array<{
    name: string;
    description?: string;
    type: { name?: string; ofType?: { name?: string } };
  }>;
}

interface IntrospectionRoot {
  __schema?: {
    queryType?: { name: string };
    mutationType?: { name: string } | null;
    subscriptionType?: { name: string } | null;
    types: IntrospectionType[];
  };
  data?: {
    __schema?: IntrospectionRoot['__schema'];
  };
}

function parseIntrospection(source: string): GraphQLSchemaInfo {
  let parsed: IntrospectionRoot;
  try {
    parsed = JSON.parse(source) as IntrospectionRoot;
  } catch {
    return EMPTY;
  }
  const schema = parsed.__schema ?? parsed.data?.__schema;
  if (!schema) return EMPTY;

  const types = new Map<string, { fields: GraphQLField[] }>();
  const scalars: string[] = [];
  const enums: string[] = [];

  for (const t of schema.types) {
    if (!t.name || t.name.startsWith('__')) continue;
    if (t.kind === 'OBJECT' || t.kind === 'INTERFACE') {
      types.set(t.name, {
        fields: (t.fields ?? []).map((f) => ({
          name: f.name,
          type: typeName(f.type) ?? 'Unknown',
          description: f.description,
        })),
      });
    } else if (t.kind === 'SCALAR') {
      scalars.push(t.name);
    } else if (t.kind === 'ENUM') {
      enums.push(t.name);
    }
  }

  return {
    types,
    rootTypes: {
      query: schema.queryType?.name,
      mutation: schema.mutationType?.name,
      subscription: schema.subscriptionType?.name,
    },
    scalars,
    enums,
  };
}

function typeName(
  t: { name?: string; ofType?: { name?: string } } | undefined,
): string | undefined {
  if (!t) return undefined;
  if (t.name) return t.name;
  return typeName(t.ofType);
}
