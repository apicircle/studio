// Importer for the `apicircle.folder/v1` JSON envelope produced by
// `collectFolderExport` in `../export/folderExport.ts`.
//
// Pure parser — no IndexedDB / store dependencies. Validates the
// envelope, allocates fresh ids for every folder/request/dependency so
// the destination workspace stays collision-free, and remaps every
// cross-entity reference (request.bodySchemaId, request.graphqlSchemaId,
// body.attachment.globalFileAssetId, form-row globalFileAssetId,
// folder.parentId / request.folderId) onto the new ids.
//
// The caller (`importApicircleFolder` in the workspace store) walks the
// resulting `ParsedApicircleFolderExport` and grafts it into the active
// `WorkspaceSynced`, applying name-based dedupe for global assets to
// avoid silently shadowing the destination's existing library entries.

import type {
  Folder,
  GlobalFileAsset,
  GlobalGraphQL,
  GlobalSchema,
  Request as ApiRequest,
} from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import {
  APICIRCLE_FOLDER_EXPORT_FORMAT,
  type ApicircleFolderExportV1,
} from '../export/folderExport';

export interface ParsedApicircleFolderExport {
  /** The exported root folder, already assigned a fresh id. */
  rootFolder: {
    id: string;
    name: string;
    auth?: Folder['auth'];
  };
  /** Descendant folders with fresh ids + remapped parentIds. */
  subfolders: Folder[];
  /** Requests with fresh ids + remapped folderIds + remapped asset refs. */
  requests: ApiRequest[];
  /** Dependencies, ids freshly minted. */
  dependencies: {
    schemas: GlobalSchema[];
    graphql: GlobalGraphQL[];
    files: GlobalFileAsset[];
  };
  /** Source envelope's `source.folderName` — used for display copy. */
  sourceFolderName: string;
  /**
   * Notes the parser surfaced about the import — e.g. a stale dependency
   * reference that no longer existed in the source envelope. Importers
   * forward these to the UI as soft warnings.
   */
  warnings: string[];
}

/** Lightweight discriminator — `true` when `doc.format === 'apicircle.folder/v1'`. */
export function isApicircleFolderExport(doc: unknown): doc is ApicircleFolderExportV1 {
  if (!doc || typeof doc !== 'object') return false;
  const d = doc as { format?: unknown };
  return d.format === APICIRCLE_FOLDER_EXPORT_FORMAT;
}

/**
 * Parse + validate a raw JSON string. Throws with a single, user-readable
 * message when the input is malformed; otherwise returns a parsed shape
 * ready for the store to graft in.
 *
 * `idGenerator` is overridable for deterministic tests; defaults to
 * `generateId()` from `@apicircle/shared`.
 */
export function parseApicircleFolderExport(
  input: string,
  options: { idGenerator?: () => string } = {},
): ParsedApicircleFolderExport {
  let doc: unknown;
  try {
    doc = JSON.parse(input);
  } catch (err) {
    throw new Error(`Couldn't parse JSON: ${err instanceof Error ? err.message : String(err)}`);
  }
  return parseApicircleFolderExportDoc(doc, options);
}

/**
 * Same as `parseApicircleFolderExport` but skips the JSON.parse step —
 * used by callers that already deserialized the document. Splitting the
 * entry points keeps the validation logic identical.
 */
export function parseApicircleFolderExportDoc(
  doc: unknown,
  options: { idGenerator?: () => string } = {},
): ParsedApicircleFolderExport {
  const id = options.idGenerator ?? generateId;

  if (!isApicircleFolderExport(doc)) {
    throw new Error(
      `Unsupported format. Expected an API Circle folder export ("format": "${APICIRCLE_FOLDER_EXPORT_FORMAT}").`,
    );
  }

  const envelope = doc;
  validateEnvelopeShape(envelope);

  const warnings: string[] = [];

  // --- Allocate fresh ids -----------------------------------------------
  const folderIdMap = new Map<string, string>();
  folderIdMap.set(envelope.source.folderId, id());
  for (const f of envelope.folder.subfolders) folderIdMap.set(f.id, id());

  const requestIdMap = new Map<string, string>();
  for (const r of envelope.folder.requests) requestIdMap.set(r.id, id());

  const schemaIdMap = new Map<string, string>();
  for (const s of envelope.dependencies.schemas) schemaIdMap.set(s.id, id());
  const graphqlIdMap = new Map<string, string>();
  for (const g of envelope.dependencies.graphql) graphqlIdMap.set(g.id, id());
  const fileIdMap = new Map<string, string>();
  for (const f of envelope.dependencies.files) fileIdMap.set(f.id, id());

  // --- Remap subfolders --------------------------------------------------
  const rootFolderId = folderIdMap.get(envelope.source.folderId)!;
  const subfolders: Folder[] = envelope.folder.subfolders.map((f) => {
    const newId = folderIdMap.get(f.id)!;
    // parentId === source.folderId  →  remap to the new root.
    // parentId === some other source folder id  →  remap to its new id.
    // parentId === null (legacy export at root)  →  attach under new root.
    let newParentId: string | null;
    if (f.parentId === null) {
      newParentId = rootFolderId;
    } else {
      const mapped = folderIdMap.get(f.parentId);
      if (!mapped) {
        warnings.push(
          `Subfolder "${f.name}" referenced parentId "${f.parentId}" that wasn't present in the export — reattached under "${envelope.folder.name}".`,
        );
        newParentId = rootFolderId;
      } else {
        newParentId = mapped;
      }
    }
    return {
      ...f,
      id: newId,
      parentId: newParentId,
      auth: f.auth ? { ...f.auth } : undefined,
    };
  });

  // --- Remap dependencies -----------------------------------------------
  const schemas: GlobalSchema[] = envelope.dependencies.schemas.map((s) => ({
    ...s,
    id: schemaIdMap.get(s.id)!,
  }));
  const graphql: GlobalGraphQL[] = envelope.dependencies.graphql.map((g) => ({
    ...g,
    id: graphqlIdMap.get(g.id)!,
  }));
  const files: GlobalFileAsset[] = envelope.dependencies.files.map((f) => ({
    ...f,
    id: fileIdMap.get(f.id)!,
  }));

  // --- Remap requests ----------------------------------------------------
  const requests: ApiRequest[] = envelope.folder.requests.map((r) => {
    const newId = requestIdMap.get(r.id)!;
    // folderId may be null (legacy export at root) — attach to new root.
    let newFolderId: string | null;
    if (r.folderId === null) {
      newFolderId = rootFolderId;
    } else {
      const mapped = folderIdMap.get(r.folderId);
      if (!mapped) {
        warnings.push(
          `Request "${r.name}" referenced folderId "${r.folderId}" that wasn't present in the export — reattached under "${envelope.folder.name}".`,
        );
        newFolderId = rootFolderId;
      } else {
        newFolderId = mapped;
      }
    }

    const bodySchemaId = remapDependencyRef(
      r.bodySchemaId,
      schemaIdMap,
      `Request "${r.name}".bodySchemaId`,
      warnings,
    );
    const graphqlSchemaId = remapDependencyRef(
      r.graphqlSchemaId,
      graphqlIdMap,
      `Request "${r.name}".graphqlSchemaId`,
      warnings,
    );

    return {
      ...r,
      id: newId,
      folderId: newFolderId,
      bodySchemaId,
      graphqlSchemaId,
      headers: r.headers.map((h) => ({ ...h })),
      query: r.query.map((q) => ({ ...q })),
      pathParams: r.pathParams ? { ...r.pathParams } : undefined,
      cookies: r.cookies ? r.cookies.map((c) => ({ ...c })) : undefined,
      body: remapBodyFileRefs(r.body, fileIdMap, r.name, warnings),
      auth: { ...r.auth },
      contextVars: r.contextVars.map((v) => ({ ...v })),
      extractions: r.extractions.map((e) => ({ ...e })),
      assertions: r.assertions.map((a) => ({ ...a })),
    };
  });

  return {
    rootFolder: {
      id: rootFolderId,
      name: envelope.folder.name,
      auth: envelope.folder.auth ? { ...envelope.folder.auth } : undefined,
    },
    subfolders,
    requests,
    dependencies: { schemas, graphql, files },
    sourceFolderName: envelope.source.folderName,
    warnings,
  };
}

// -- internals --------------------------------------------------------------

function validateEnvelopeShape(envelope: ApicircleFolderExportV1): void {
  if (!envelope.folder || typeof envelope.folder !== 'object') {
    throw new Error('API Circle folder export is missing the "folder" section.');
  }
  if (typeof envelope.folder.name !== 'string' || envelope.folder.name.length === 0) {
    throw new Error('API Circle folder export must have a non-empty "folder.name".');
  }
  if (!Array.isArray(envelope.folder.subfolders)) {
    throw new Error('API Circle folder export must have a "folder.subfolders" array.');
  }
  if (!Array.isArray(envelope.folder.requests)) {
    throw new Error('API Circle folder export must have a "folder.requests" array.');
  }
  if (!envelope.dependencies || typeof envelope.dependencies !== 'object') {
    throw new Error('API Circle folder export is missing the "dependencies" section.');
  }
  if (
    !Array.isArray(envelope.dependencies.schemas) ||
    !Array.isArray(envelope.dependencies.graphql) ||
    !Array.isArray(envelope.dependencies.files)
  ) {
    throw new Error(
      'API Circle folder export "dependencies" must have schemas / graphql / files arrays.',
    );
  }
  if (!envelope.source || typeof envelope.source !== 'object') {
    throw new Error('API Circle folder export is missing the "source" section.');
  }
  if (
    typeof envelope.source.folderId !== 'string' ||
    typeof envelope.source.folderName !== 'string'
  ) {
    throw new Error('API Circle folder export "source" must include "folderId" and "folderName".');
  }
}

function remapDependencyRef(
  value: string | null | undefined,
  map: Map<string, string>,
  label: string,
  warnings: string[],
): string | null | undefined {
  if (value === null || value === undefined) return value;
  const mapped = map.get(value);
  if (mapped) return mapped;
  warnings.push(
    `${label} referenced a dependency ("${value}") that wasn't embedded in the export — reference dropped on import.`,
  );
  return null;
}

function remapBodyFileRefs(
  body: ApiRequest['body'],
  fileIdMap: Map<string, string>,
  requestName: string,
  warnings: string[],
): ApiRequest['body'] {
  if (body.type === 'binary') {
    if (!body.attachment) return { ...body };
    const oldId = body.attachment.globalFileAssetId;
    let nextGlobalFileAssetId: string | null | undefined = oldId;
    if (oldId) {
      const mapped = fileIdMap.get(oldId);
      if (mapped) {
        nextGlobalFileAssetId = mapped;
      } else {
        warnings.push(
          `Request "${requestName}".body.attachment referenced file asset "${oldId}" that wasn't embedded in the export — re-attach the file after import.`,
        );
        nextGlobalFileAssetId = null;
      }
    }
    return {
      ...body,
      attachment: {
        ...body.attachment,
        // Reset slotId — the destination workspace owns its own slots.
        slotId: null,
        globalFileAssetId: nextGlobalFileAssetId,
      },
    };
  }
  if (body.type === 'form-data') {
    const formRows = body.formRows?.map((row) => {
      if (row.kind !== 'file') return { ...row };
      const oldId = row.globalFileAssetId;
      let nextGlobalFileAssetId: string | null | undefined = oldId;
      if (oldId) {
        const mapped = fileIdMap.get(oldId);
        if (mapped) {
          nextGlobalFileAssetId = mapped;
        } else {
          warnings.push(
            `Request "${requestName}" form-data row "${row.key}" referenced file asset "${oldId}" that wasn't embedded in the export — re-attach the file after import.`,
          );
          nextGlobalFileAssetId = null;
        }
      }
      return {
        ...row,
        slotId: null,
        globalFileAssetId: nextGlobalFileAssetId,
      };
    });
    return { ...body, formRows };
  }
  return { ...body };
}
