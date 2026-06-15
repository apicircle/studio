// Folder → JSON export (API Circle exchange format `apicircle.folder/v1`).
//
// Produces a self-describing envelope a teammate can import back into any
// other API Circle workspace via `ImportModal` / the headless
// `parseApicircleFolderExport` parser. The envelope is intentionally
// additive on top of the existing `'apicircle'` source-format slot in
// `ImportModal` — round-tripping an export through a fresh workspace must
// not silently drop fields.
//
// Embedded vs. referenced dependencies:
//   - JSON Schemas + GraphQL definitions are pure text. We embed the full
//     entity so the importer can recreate them in the destination
//     workspace without any extra user action.
//   - Global file assets carry BYTES outside `workspace.json` (Git
//     LFS sidecar under `.apicircle/workspace-<id>/attachments/<slotId>`). The envelope
//     therefore captures only metadata (name, filename, size, mimeType,
//     sha256) so the importer can show the user a clear "re-attach these
//     files" cue. Bytes never travel through the JSON.
//
// All envelope `id` fields refer to the SOURCE workspace's ids. The
// importer is expected to remint them on its side to avoid collisions
// (`apicircleFolder.ts` does this).

import type {
  Folder,
  GlobalFileAsset,
  GlobalGraphQL,
  GlobalSchema,
  Request as ApiRequest,
  WorkspaceSynced,
} from '@apicircle/shared';
import {
  collectFolderExportCredentials,
  type FolderExportCredential,
} from './folderExportCredentials';

/** Envelope discriminator. Bump the version suffix on a breaking shape change. */
export const APICIRCLE_FOLDER_EXPORT_FORMAT = 'apicircle.folder/v1';

export interface ApicircleFolderExportV1 {
  format: typeof APICIRCLE_FOLDER_EXPORT_FORMAT;
  /** ISO timestamp of when the export was generated. */
  exportedAt: string;
  /** App version that produced the export (free-form string). */
  appVersion: string;
  /** Loose breadcrumb back to the source — never required by importers. */
  source: {
    workspaceId: string;
    folderId: string;
    folderName: string;
  };
  folder: {
    /** Display name of the exported root folder. */
    name: string;
    /** Folder-level auth, if any was set on the source root folder. */
    auth?: Folder['auth'];
    /**
     * Descendant folders (NOT including the root). `parentId` is the
     * source workspace's id of the parent — when it equals `source.folderId`
     * the folder lives directly under the exported root.
     */
    subfolders: Folder[];
    /**
     * All requests inside the exported subtree. `folderId` is the source
     * id of the immediate parent folder; the importer remaps it onto the
     * destination workspace's freshly-minted ids.
     */
    requests: ApiRequest[];
  };
  /**
   * Captured global-asset dependencies referenced by the exported
   * requests. Schemas/GraphQL travel embedded; files travel
   * metadata-only.
   */
  dependencies: ApicircleFolderExportDependencies;
}

export interface ApicircleFolderExportDependencies {
  schemas: GlobalSchema[];
  graphql: GlobalGraphQL[];
  /**
   * File-asset METADATA only. The `slotId` is preserved so the importer
   * can correlate against an existing slot on the destination side if
   * one happens to match; otherwise the user is prompted to re-attach.
   */
  files: GlobalFileAsset[];
}

/**
 * Plain-language summary of what the export contains, surfaced inside the
 * Export Folder modal so the user knows exactly what's leaving the
 * workspace before they click Download.
 */
export interface FolderExportReport {
  folderName: string;
  requestCount: number;
  subfolderCount: number;
  /** Total folder count INCLUDING the exported root. */
  totalFolderCount: number;
  dependencies: {
    schemas: Array<{ id: string; name: string }>;
    graphql: Array<{ id: string; name: string; kind: GlobalGraphQL['kind'] }>;
    files: Array<{
      id: string;
      name: string;
      filename: string;
      size: number;
      mimeType: string;
    }>;
  };
  /** Convenience flag — `true` when any dependency was captured. */
  hasDependencies: boolean;
  /**
   * Every credential-bearing field detected inside the envelope's auth
   * blocks (root folder, subfolders, requests). Surfaced by the export
   * modal so the user can opt-in per-field before the file leaves the
   * workspace. Defaults to "redact everything" — see
   * `redactFolderExportCredentials`.
   */
  credentials: FolderExportCredential[];
  /** Convenience flag — `true` when any credential was detected. */
  hasCredentials: boolean;
}

export interface CollectFolderExportArgs {
  synced: WorkspaceSynced;
  folderId: string;
  /** Defaults to `new Date().toISOString()` — overridable for deterministic tests. */
  now?: string;
  /** Defaults to `'apicircle-studio'` — overridable for deterministic tests. */
  appVersion?: string;
}

export interface CollectFolderExportResult {
  envelope: ApicircleFolderExportV1;
  report: FolderExportReport;
}

/**
 * Walk the subtree rooted at `folderId`, collect its requests + descendant
 * folders, gather every referenced global-asset dependency, and assemble
 * a self-describing export envelope.
 *
 * Returns `null` when `folderId` doesn't exist — UI callers should treat
 * that as a no-op (the source folder was deleted between menu open and
 * click).
 */
export function collectFolderExport(
  args: CollectFolderExportArgs,
): CollectFolderExportResult | null {
  const { synced, folderId } = args;
  const root = synced.collections.folders[folderId];
  if (!root) return null;

  const now = args.now ?? new Date().toISOString();
  const appVersion = args.appVersion ?? 'apicircle-studio';

  // Walk the descendant folder graph by parentId chain — same idiom
  // `removeFolder` / `duplicateFolder` use.
  const folderIds = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of Object.values(synced.collections.folders)) {
      if (folderIds.has(f.id)) continue;
      if (f.parentId && folderIds.has(f.parentId)) {
        folderIds.add(f.id);
        grew = true;
      }
    }
  }

  // Descendants don't include the root itself — the root carries its own
  // `name` / `auth` on `envelope.folder.*`.
  const subfolders: Folder[] = [];
  for (const f of Object.values(synced.collections.folders)) {
    if (f.id !== folderId && folderIds.has(f.id)) subfolders.push(cloneFolder(f));
  }

  const requests: ApiRequest[] = [];
  for (const r of Object.values(synced.collections.requests)) {
    if (r.folderId && folderIds.has(r.folderId)) requests.push(cloneRequest(r));
  }

  const dependencies = collectDependencies(synced, requests);

  const envelope: ApicircleFolderExportV1 = {
    format: APICIRCLE_FOLDER_EXPORT_FORMAT,
    exportedAt: now,
    appVersion,
    source: {
      workspaceId: synced.workspaceId,
      folderId,
      folderName: root.name,
    },
    folder: {
      name: root.name,
      auth: root.auth,
      subfolders,
      requests,
    },
    dependencies,
  };

  const report = buildReport(envelope);
  return { envelope, report };
}

/** JSON-stringify an envelope with stable, human-friendly formatting (2-space indent). */
export function serializeFolderExport(envelope: ApicircleFolderExportV1): string {
  return JSON.stringify(envelope, null, 2);
}

/** Filename the UI uses for the downloaded file. Slugifies the folder name. */
export function suggestFolderExportFilename(envelope: ApicircleFolderExportV1): string {
  const slug = envelope.folder.name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+/, '')
    .replace(/-+$/, '');
  const base = slug || 'folder';
  return `${base}.apicircle.json`;
}

// -- internals --------------------------------------------------------------

function cloneFolder(f: Folder): Folder {
  return {
    ...f,
    auth: f.auth ? { ...f.auth } : undefined,
  };
}

function cloneRequest(r: ApiRequest): ApiRequest {
  return {
    ...r,
    headers: r.headers.map((h) => ({ ...h })),
    query: r.query.map((q) => ({ ...q })),
    pathParams: r.pathParams ? { ...r.pathParams } : undefined,
    cookies: r.cookies ? r.cookies.map((c) => ({ ...c })) : undefined,
    body: cloneBody(r.body),
    auth: { ...r.auth },
    contextVars: r.contextVars.map((v) => ({ ...v })),
    extractions: r.extractions.map((e) => ({ ...e })),
    assertions: r.assertions.map((a) => ({ ...a })),
  };
}

function cloneBody(body: ApiRequest['body']): ApiRequest['body'] {
  if (body.type === 'form-data') {
    return {
      ...body,
      formRows: body.formRows?.map((row) => ({ ...row })) ?? body.formRows,
    };
  }
  if (body.type === 'binary') {
    return {
      ...body,
      attachment: body.attachment ? { ...body.attachment } : undefined,
    };
  }
  return { ...body };
}

function collectDependencies(
  synced: WorkspaceSynced,
  requests: ApiRequest[],
): ApicircleFolderExportDependencies {
  const schemaIds = new Set<string>();
  const graphqlIds = new Set<string>();
  const fileIds = new Set<string>();

  for (const r of requests) {
    if (r.bodySchemaId) schemaIds.add(r.bodySchemaId);
    if (r.graphqlSchemaId) graphqlIds.add(r.graphqlSchemaId);
    if (r.body.type === 'binary' && r.body.attachment?.globalFileAssetId) {
      fileIds.add(r.body.attachment.globalFileAssetId);
    }
    if (r.body.type === 'form-data' && r.body.formRows) {
      for (const row of r.body.formRows) {
        if (row.kind === 'file' && row.globalFileAssetId) fileIds.add(row.globalFileAssetId);
      }
    }
  }

  const assets = synced.globalAssets;
  const schemas: GlobalSchema[] = [];
  for (const id of schemaIds) {
    const s = assets.schemas[id];
    if (s) schemas.push({ ...s });
  }
  const graphql: GlobalGraphQL[] = [];
  for (const id of graphqlIds) {
    const g = assets.graphql[id];
    if (g) graphql.push({ ...g });
  }
  const files: GlobalFileAsset[] = [];
  for (const id of fileIds) {
    const f = assets.files?.[id];
    if (f) files.push({ ...f });
  }

  // Stable ordering — name then id — so identical workspaces produce
  // identical JSON regardless of Object.values iteration order.
  schemas.sort(byNameThenId);
  graphql.sort(byNameThenId);
  files.sort(byNameThenId);

  return { schemas, graphql, files };
}

function byNameThenId<T extends { id: string; name: string }>(a: T, b: T): number {
  const c = a.name.localeCompare(b.name, undefined, { sensitivity: 'base' });
  return c !== 0 ? c : a.id.localeCompare(b.id);
}

function buildReport(envelope: ApicircleFolderExportV1): FolderExportReport {
  const subfolderCount = envelope.folder.subfolders.length;
  const requestCount = envelope.folder.requests.length;
  const totalFolderCount = subfolderCount + 1; // include the exported root
  const credentials = collectFolderExportCredentials(envelope);

  return {
    folderName: envelope.folder.name,
    requestCount,
    subfolderCount,
    totalFolderCount,
    dependencies: {
      schemas: envelope.dependencies.schemas.map((s) => ({ id: s.id, name: s.name })),
      graphql: envelope.dependencies.graphql.map((g) => ({
        id: g.id,
        name: g.name,
        kind: g.kind,
      })),
      files: envelope.dependencies.files.map((f) => ({
        id: f.id,
        name: f.name,
        filename: f.filename,
        size: f.size,
        mimeType: f.mimeType,
      })),
    },
    hasDependencies:
      envelope.dependencies.schemas.length > 0 ||
      envelope.dependencies.graphql.length > 0 ||
      envelope.dependencies.files.length > 0,
    credentials,
    hasCredentials: credentials.length > 0,
  };
}
