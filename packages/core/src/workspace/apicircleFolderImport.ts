// Pure workspace-graft logic for the `apicircle.folder/v1` envelope —
// the bridge between `parseApicircleFolderExport` (which produces a
// `ParsedApicircleFolderExport` with fresh ids + warnings) and the
// destination `WorkspaceSynced` it lands in.
//
// Three things it does that the parser can't:
//
//   1. Uniquify the imported root folder name against the destination
//      parent (mirrors how `importPostmanCollection` wraps the imported
//      tree).
//   2. Merge dependencies into `globalAssets`. Schemas + GraphQL
//      definitions reuse an existing entry when the name + content match
//      verbatim, so re-importing the same file does not pile up
//      duplicates; otherwise they're added with the parser-minted id.
//   3. Rewrite cross-entity references (request.bodySchemaId,
//      request.graphqlSchemaId, body.attachment.globalFileAssetId,
//      form-row globalFileAssetId) onto the post-merge ids so the
//      workspace stays internally consistent.
//
// Pure — does not depend on IndexedDB, the React store, or any UI
// helper. The MCP tool, CLI subcommand, and Zustand store all funnel
// through this same function.

import type {
  Folder,
  GlobalFileAsset,
  GlobalGraphQL,
  GlobalSchema,
  Request as ApiRequest,
  WorkspaceSynced,
} from '@apicircle/shared';
import type { ParsedApicircleFolderExport } from '../import/apicircleFolder';

export interface ImportApicircleFolderResult {
  synced: WorkspaceSynced;
  /** Id of the newly-created root folder in the destination workspace. */
  rootFolderId: string;
  /** Final display name (uniquified) of the imported root folder. */
  rootFolderName: string;
  counts: {
    folders: number; // includes the root
    requests: number;
    schemasAdded: number;
    schemasReused: number;
    graphqlAdded: number;
    graphqlReused: number;
    filesAdded: number;
    filesReused: number;
  };
  /**
   * File-asset ids whose metadata landed in `globalAssets.files`
   * without a backing slot (because the export envelope carries
   * metadata only — bytes stay in their Git LFS sidecar). UIs use this
   * to surface a "re-attach these files" cue after import.
   */
  filesRequiringReattachment: string[];
}

/**
 * Graft a parsed API Circle folder export into `synced` under
 * `parentFolderId` (root when `null`). Returns the patched workspace +
 * counts the UI / CLI / MCP can surface.
 */
export function importApicircleFolderInto(
  synced: WorkspaceSynced,
  parsed: ParsedApicircleFolderExport,
  parentFolderId: string | null,
): ImportApicircleFolderResult {
  let cur = synced;

  // 1) Merge dependencies — build remap maps from parser-minted id to
  //    final destination id. When a content match is found we reuse the
  //    existing asset; otherwise we add a fresh entry with the parser's
  //    id (which is already collision-free thanks to generateId()).
  const schemaRemap = new Map<string, string>();
  const graphqlRemap = new Map<string, string>();
  const fileRemap = new Map<string, string>();
  let schemasAdded = 0;
  let schemasReused = 0;
  let graphqlAdded = 0;
  let graphqlReused = 0;
  let filesAdded = 0;
  let filesReused = 0;
  const filesRequiringReattachment: string[] = [];

  const now = new Date().toISOString();

  for (const incoming of parsed.dependencies.schemas) {
    const existing = findMatchingSchema(cur, incoming);
    if (existing) {
      schemaRemap.set(incoming.id, existing.id);
      schemasReused += 1;
      continue;
    }
    cur = mergeGlobalSchema(cur, incoming, now);
    schemaRemap.set(incoming.id, incoming.id);
    schemasAdded += 1;
  }
  for (const incoming of parsed.dependencies.graphql) {
    const existing = findMatchingGraphQL(cur, incoming);
    if (existing) {
      graphqlRemap.set(incoming.id, existing.id);
      graphqlReused += 1;
      continue;
    }
    cur = mergeGlobalGraphQL(cur, incoming, now);
    graphqlRemap.set(incoming.id, incoming.id);
    graphqlAdded += 1;
  }
  for (const incoming of parsed.dependencies.files) {
    const existing = findMatchingFile(cur, incoming);
    if (existing) {
      fileRemap.set(incoming.id, existing.id);
      filesReused += 1;
      continue;
    }
    cur = mergeGlobalFile(cur, incoming, now);
    fileRemap.set(incoming.id, incoming.id);
    filesAdded += 1;
    filesRequiringReattachment.push(incoming.id);
  }

  // 2) Insert the root folder (with a uniquified name + the import's auth).
  const rootName = uniquifyFolderName(cur, parentFolderId, parsed.rootFolder.name);
  const root: Folder = {
    id: parsed.rootFolder.id,
    name: rootName,
    parentId: parentFolderId,
    auth: parsed.rootFolder.auth ? { ...parsed.rootFolder.auth } : undefined,
  };
  cur = insertFolder(cur, root, /* attachToTree */ parentFolderId === null);

  // 3) Insert subfolders. The parser pinned every parentId on a
  //    destination id from the same export, so a single pass suffices.
  for (const f of parsed.subfolders) {
    cur = insertFolder(cur, f, /* attachToTree */ false);
  }

  // 4) Insert requests with dependency references rewritten through the
  //    merge maps. Schema/GraphQL/file refs were already parser-mapped to
  //    the "incoming.id"; this pass swaps in the reused-id where a
  //    duplicate was detected.
  for (const r of parsed.requests) {
    const rewritten: ApiRequest = {
      ...r,
      bodySchemaId: rewriteRef(r.bodySchemaId, schemaRemap),
      graphqlSchemaId: rewriteRef(r.graphqlSchemaId, graphqlRemap),
      body: rewriteBodyFileRefs(r.body, fileRemap),
    };
    cur = insertRequest(cur, rewritten);
  }

  return {
    synced: { ...cur, meta: { ...cur.meta, updatedAt: now } },
    rootFolderId: root.id,
    rootFolderName: rootName,
    counts: {
      folders: parsed.subfolders.length + 1,
      requests: parsed.requests.length,
      schemasAdded,
      schemasReused,
      graphqlAdded,
      graphqlReused,
      filesAdded,
      filesReused,
    },
    filesRequiringReattachment,
  };
}

// -- internals --------------------------------------------------------------

/**
 * Returns true when `name` is unused for that kind within `parentFolderId`
 * (case-insensitive, whitespace-trimmed). Matches the same check
 * `editorActions.isNameAvailableInFolder` performs — kept inline so this
 * module has no UI dependency.
 */
function isFolderNameAvailable(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  name: string,
): boolean {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return false;
  for (const node of Object.values(synced.collections.folders)) {
    if (node.parentId !== parentFolderId) continue;
    if (node.name.trim().toLowerCase() === trimmed) return false;
  }
  return true;
}

function uniquifyFolderName(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  desired: string,
): string {
  if (isFolderNameAvailable(synced, parentFolderId, desired)) return desired;
  let n = 2;
  while (!isFolderNameAvailable(synced, parentFolderId, `${desired} (${n})`)) {
    n += 1;
    if (n > 999) return `${desired} (${n})`;
  }
  return `${desired} (${n})`;
}

function insertFolder(
  synced: WorkspaceSynced,
  folder: Folder,
  attachToTree: boolean,
): WorkspaceSynced {
  const folders = { ...synced.collections.folders, [folder.id]: folder };
  const tree = attachToTree
    ? {
        ...synced.collections.tree,
        children: [...synced.collections.tree.children, { kind: 'folder' as const, id: folder.id }],
      }
    : synced.collections.tree;
  return {
    ...synced,
    collections: { ...synced.collections, folders, tree },
  };
}

function insertRequest(synced: WorkspaceSynced, request: ApiRequest): WorkspaceSynced {
  return {
    ...synced,
    collections: {
      ...synced.collections,
      requests: { ...synced.collections.requests, [request.id]: request },
    },
  };
}

function withGlobalAssets(synced: WorkspaceSynced): WorkspaceSynced['globalAssets'] {
  return synced.globalAssets ?? { schemas: {}, graphql: {}, files: {} };
}

function findMatchingSchema(synced: WorkspaceSynced, candidate: GlobalSchema): GlobalSchema | null {
  const ga = withGlobalAssets(synced);
  for (const existing of Object.values(ga.schemas)) {
    if (existing.name === candidate.name && existing.schema === candidate.schema) {
      return existing;
    }
  }
  return null;
}

function findMatchingGraphQL(
  synced: WorkspaceSynced,
  candidate: GlobalGraphQL,
): GlobalGraphQL | null {
  const ga = withGlobalAssets(synced);
  for (const existing of Object.values(ga.graphql)) {
    if (
      existing.name === candidate.name &&
      existing.kind === candidate.kind &&
      existing.source === candidate.source
    ) {
      return existing;
    }
  }
  return null;
}

function findMatchingFile(
  synced: WorkspaceSynced,
  candidate: GlobalFileAsset,
): GlobalFileAsset | null {
  const ga = withGlobalAssets(synced);
  const files = ga.files ?? {};
  for (const existing of Object.values(files)) {
    if (
      existing.name === candidate.name &&
      existing.filename === candidate.filename &&
      existing.size === candidate.size
    ) {
      return existing;
    }
  }
  return null;
}

function mergeGlobalSchema(
  synced: WorkspaceSynced,
  schema: GlobalSchema,
  now: string,
): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  return {
    ...synced,
    globalAssets: {
      ...ga,
      schemas: { ...ga.schemas, [schema.id]: { ...schema, updatedAt: now } },
    },
  };
}

function mergeGlobalGraphQL(
  synced: WorkspaceSynced,
  graphql: GlobalGraphQL,
  now: string,
): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  return {
    ...synced,
    globalAssets: {
      ...ga,
      graphql: { ...ga.graphql, [graphql.id]: { ...graphql, updatedAt: now } },
    },
  };
}

function mergeGlobalFile(
  synced: WorkspaceSynced,
  file: GlobalFileAsset,
  now: string,
): WorkspaceSynced {
  const ga = withGlobalAssets(synced);
  const files = ga.files ?? {};
  return {
    ...synced,
    globalAssets: {
      ...ga,
      files: { ...files, [file.id]: { ...file, updatedAt: now } },
    },
  };
}

function rewriteRef(
  value: string | null | undefined,
  remap: Map<string, string>,
): string | null | undefined {
  if (value === null || value === undefined) return value;
  return remap.get(value) ?? value;
}

function rewriteBodyFileRefs(
  body: ApiRequest['body'],
  remap: Map<string, string>,
): ApiRequest['body'] {
  if (body.type === 'binary') {
    if (!body.attachment) return body;
    const rewritten = rewriteRef(body.attachment.globalFileAssetId, remap);
    if (rewritten === body.attachment.globalFileAssetId) return body;
    return {
      ...body,
      attachment: { ...body.attachment, globalFileAssetId: rewritten },
    };
  }
  if (body.type === 'form-data' && body.formRows) {
    let mutated = false;
    const next = body.formRows.map((row) => {
      if (row.kind !== 'file') return row;
      const rewritten = rewriteRef(row.globalFileAssetId, remap);
      if (rewritten === row.globalFileAssetId) return row;
      mutated = true;
      return { ...row, globalFileAssetId: rewritten };
    });
    return mutated ? { ...body, formRows: next } : body;
  }
  return body;
}
