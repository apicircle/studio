import type {
  Assertion,
  ContextExtraction,
  Folder,
  HttpMethod,
  Request as ApiRequest,
  RequestAuth,
  RequestBody,
  WorkspaceSynced,
} from '@apicircle/shared';
import { generateId } from '@apicircle/shared';

// Pure helpers — no IDB / Zustand dependencies. Each returns a new
// `WorkspaceSynced` snapshot so callers can wrap them in a single store
// transition + persist.

function createRequest(parentFolderId: string | null, name = 'New request'): ApiRequest {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name,
    folderId: parentFolderId,
    method: 'GET',
    url: 'https://httpbin.org/anything',
    headers: [],
    query: [],
    pathParams: {},
    cookies: [],
    body: { type: 'none', content: '' },
    // Default to `inherit` so requests created inside a folder pick up
    // folder auth automatically. Resolver returns `{ type: 'none' }` at
    // the root when no ancestor has auth set, so behavior at the root is
    // unchanged. Users who want a request to bypass folder auth flip to
    // 'none' explicitly — and `<FolderAuthBypassCue>` warns them when they
    // do that inside a folder that DOES have auth.
    auth: { type: 'inherit' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: now,
    updatedAt: now,
  };
}

function createFolder(parentFolderId: string | null, name = 'New folder'): Folder {
  return { id: generateId(), name, parentId: parentFolderId };
}

/**
 * Returns true when `name` is unused for that kind within `parentFolderId`
 * (case-insensitive, whitespace-trimmed). `ignoreId` lets callers exclude
 * the current node from the check (useful during rename).
 */
export function isNameAvailableInFolder(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  kind: 'folder' | 'request',
  name: string,
  ignoreId?: string,
): boolean {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return false;
  const collection: Record<string, Folder | ApiRequest> =
    kind === 'folder' ? synced.collections.folders : synced.collections.requests;
  for (const node of Object.values(collection)) {
    if (node.id === ignoreId) continue;
    const matchesParent =
      kind === 'folder'
        ? (node as Folder).parentId === parentFolderId
        : (node as ApiRequest).folderId === parentFolderId;
    if (!matchesParent) continue;
    if (node.name.trim().toLowerCase() === trimmed) return false;
  }
  return true;
}

/**
 * Append " (n)" to `base` until the resulting name doesn't collide with an
 * existing folder/request in the same parent. n starts at 2.
 */
function uniquifyName(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  kind: 'folder' | 'request',
  base: string,
): string {
  if (isNameAvailableInFolder(synced, parentFolderId, kind, base)) return base;
  let n = 2;
  while (!isNameAvailableInFolder(synced, parentFolderId, kind, `${base} (${n})`)) {
    n += 1;
    if (n > 999) return `${base} (${n})`; // pragmatic upper bound
  }
  return `${base} (${n})`;
}

export function addRequest(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  name?: string,
): { synced: WorkspaceSynced; request: ApiRequest } {
  const desired = (name ?? 'New request').trim() || 'New request';
  const finalName = uniquifyName(synced, parentFolderId, 'request', desired);
  const request = createRequest(parentFolderId, finalName);
  const next = pushChild(synced, parentFolderId, { kind: 'request', id: request.id });
  return {
    synced: {
      ...next,
      collections: {
        ...next.collections,
        requests: { ...next.collections.requests, [request.id]: request },
      },
      meta: { ...next.meta, updatedAt: request.updatedAt },
    },
    request,
  };
}

export function addFolder(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  name?: string,
): { synced: WorkspaceSynced; folder: Folder } {
  const desired = (name ?? 'New folder').trim() || 'New folder';
  const finalName = uniquifyName(synced, parentFolderId, 'folder', desired);
  const folder = createFolder(parentFolderId, finalName);
  const next = pushChild(synced, parentFolderId, { kind: 'folder', id: folder.id });
  return {
    synced: {
      ...next,
      collections: {
        ...next.collections,
        folders: { ...next.collections.folders, [folder.id]: folder },
      },
      meta: { ...next.meta, updatedAt: new Date().toISOString() },
    },
    folder,
  };
}

export function removeRequest(synced: WorkspaceSynced, id: string): WorkspaceSynced {
  if (!synced.collections.requests[id]) return synced;
  const requests = { ...synced.collections.requests };
  delete requests[id];
  return {
    ...synced,
    collections: {
      ...synced.collections,
      requests,
      tree: removeChildFromTree(synced.collections.tree, { kind: 'request', id }),
    },
    meta: { ...synced.meta, updatedAt: new Date().toISOString() },
  };
}

/**
 * Cascade-remove a folder and everything inside it (nested folders +
 * requests). Returns the new synced doc plus the list of request IDs that
 * were deleted, so the store can free their attachment slots.
 */
export function removeFolder(
  synced: WorkspaceSynced,
  folderId: string,
): { synced: WorkspaceSynced; deletedRequestIds: string[] } {
  if (!synced.collections.folders[folderId]) {
    return { synced, deletedRequestIds: [] };
  }
  // Collect every descendant folder + request via parentId/folderId chains.
  const folderIds = new Set<string>([folderId]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of Object.values(synced.collections.folders)) {
      if (f.parentId && folderIds.has(f.parentId) && !folderIds.has(f.id)) {
        folderIds.add(f.id);
        grew = true;
      }
    }
  }
  const requestIds = new Set<string>();
  for (const r of Object.values(synced.collections.requests)) {
    if (r.folderId && folderIds.has(r.folderId)) requestIds.add(r.id);
  }

  const folders = { ...synced.collections.folders };
  for (const id of folderIds) delete folders[id];
  const requests = { ...synced.collections.requests };
  for (const id of requestIds) delete requests[id];

  // Strip any references that survive at the root tree level (legacy data
  // may have child entries that used to live at root).
  let tree = synced.collections.tree;
  for (const id of folderIds) {
    tree = removeChildFromTree(tree, { kind: 'folder', id });
  }
  for (const id of requestIds) {
    tree = removeChildFromTree(tree, { kind: 'request', id });
  }

  return {
    synced: {
      ...synced,
      collections: { ...synced.collections, folders, requests, tree },
      meta: { ...synced.meta, updatedAt: new Date().toISOString() },
    },
    deletedRequestIds: [...requestIds],
  };
}

export function updateRequest(
  synced: WorkspaceSynced,
  id: string,
  patch: Partial<Omit<ApiRequest, 'id' | 'createdAt'>>,
): WorkspaceSynced {
  const existing = synced.collections.requests[id];
  if (!existing) return synced;
  const updated: ApiRequest = {
    ...existing,
    ...patch,
    id: existing.id,
    createdAt: existing.createdAt,
    updatedAt: new Date().toISOString(),
  };
  return {
    ...synced,
    collections: {
      ...synced.collections,
      requests: { ...synced.collections.requests, [id]: updated },
    },
    meta: { ...synced.meta, updatedAt: updated.updatedAt },
  };
}

export function renameRequest(synced: WorkspaceSynced, id: string, name: string): WorkspaceSynced {
  const trimmed = name.trim();
  const request = synced.collections.requests[id];
  if (!request || !trimmed || trimmed === request.name) return synced;
  // Reject duplicates against siblings in the same folder.
  if (!isNameAvailableInFolder(synced, request.folderId, 'request', trimmed, id)) return synced;
  return updateRequest(synced, id, { name: trimmed });
}

export function renameFolder(synced: WorkspaceSynced, id: string, name: string): WorkspaceSynced {
  const trimmed = name.trim();
  const folder = synced.collections.folders[id];
  if (!folder || !trimmed || trimmed === folder.name) return synced;
  if (!isNameAvailableInFolder(synced, folder.parentId, 'folder', trimmed, id)) return synced;
  const next: Folder = { ...folder, name: trimmed };
  return {
    ...synced,
    collections: {
      ...synced.collections,
      folders: { ...synced.collections.folders, [id]: next },
    },
    meta: { ...synced.meta, updatedAt: new Date().toISOString() },
  };
}

export function setRequestMethod(
  synced: WorkspaceSynced,
  id: string,
  method: HttpMethod,
): WorkspaceSynced {
  return updateRequest(synced, id, { method });
}

export function setRequestUrl(synced: WorkspaceSynced, id: string, url: string): WorkspaceSynced {
  return updateRequest(synced, id, { url });
}

export function setRequestBody(
  synced: WorkspaceSynced,
  id: string,
  body: RequestBody,
): WorkspaceSynced {
  return updateRequest(synced, id, { body });
}

export function setRequestAuth(
  synced: WorkspaceSynced,
  id: string,
  auth: RequestAuth,
): WorkspaceSynced {
  return updateRequest(synced, id, { auth });
}

export function setRequestExtractions(
  synced: WorkspaceSynced,
  id: string,
  extractions: ContextExtraction[],
): WorkspaceSynced {
  return updateRequest(synced, id, { extractions });
}

export function setRequestContextVars(
  synced: WorkspaceSynced,
  id: string,
  contextVars: ApiRequest['contextVars'],
): WorkspaceSynced {
  return updateRequest(synced, id, { contextVars });
}

export function setRequestBodySchemaId(
  synced: WorkspaceSynced,
  id: string,
  bodySchemaId: string | null,
): WorkspaceSynced {
  return updateRequest(synced, id, { bodySchemaId });
}

export function setRequestGraphqlSchemaId(
  synced: WorkspaceSynced,
  id: string,
  graphqlSchemaId: string | null,
): WorkspaceSynced {
  return updateRequest(synced, id, { graphqlSchemaId });
}

/**
 * Walk a request and collect every attachment slotId it owns. Used on
 * delete to free the corresponding blobs in the local attachments store.
 */
export function collectRequestSlotIds(req: ApiRequest): string[] {
  const ids: string[] = [];
  if (req.body.type === 'form-data' && req.body.formRows) {
    for (const row of req.body.formRows) {
      if (row.kind === 'file' && row.slotId) ids.push(row.slotId);
    }
  }
  if (req.body.type === 'binary' && req.body.attachment?.slotId) {
    ids.push(req.body.attachment.slotId);
  }
  return ids;
}

export function setRequestHeaders(
  synced: WorkspaceSynced,
  id: string,
  headers: ApiRequest['headers'],
): WorkspaceSynced {
  return updateRequest(synced, id, { headers });
}

export function setRequestQuery(
  synced: WorkspaceSynced,
  id: string,
  query: ApiRequest['query'],
): WorkspaceSynced {
  return updateRequest(synced, id, { query });
}

export function setRequestPathParams(
  synced: WorkspaceSynced,
  id: string,
  pathParams: Record<string, string>,
): WorkspaceSynced {
  return updateRequest(synced, id, { pathParams });
}

export function setRequestCookies(
  synced: WorkspaceSynced,
  id: string,
  cookies: NonNullable<ApiRequest['cookies']>,
): WorkspaceSynced {
  return updateRequest(synced, id, { cookies });
}

/**
 * Set folder-level auth. Pass `undefined` (or omit) to clear the field — that
 * lets the resolver continue walking up the chain on `inherit`.
 */
export function setFolderAuth(
  synced: WorkspaceSynced,
  folderId: string,
  auth: RequestAuth | undefined,
): WorkspaceSynced {
  const folder = synced.collections.folders[folderId];
  if (!folder) return synced;
  const next: Folder = { ...folder, auth };
  return {
    ...synced,
    collections: {
      ...synced.collections,
      folders: { ...synced.collections.folders, [folderId]: next },
    },
    meta: { ...synced.meta, updatedAt: new Date().toISOString() },
  };
}

export function setRequestAssertions(
  synced: WorkspaceSynced,
  id: string,
  assertions: Assertion[],
): WorkspaceSynced {
  return updateRequest(synced, id, { assertions });
}

/**
 * Clone a request inside the same folder as the original. The duplicate
 * gets a fresh id + timestamps and a uniquified `"<name> (copy)"` /
 * `"<name> (copy 2)"` style name. All editable fields (headers, body,
 * params, auth, assertions, extractions, contextVars, schema bindings)
 * are deep-copied so future edits to the original don't bleed through.
 *
 * Returns the new synced doc + the cloned request, or `{ synced, request:
 * null }` when the source id doesn't exist.
 */
export function duplicateRequest(
  synced: WorkspaceSynced,
  requestId: string,
): { synced: WorkspaceSynced; request: ApiRequest | null } {
  const src = synced.collections.requests[requestId];
  if (!src) return { synced, request: null };
  const finalName = uniquifyName(synced, src.folderId, 'request', `${src.name} (copy)`);
  const now = new Date().toISOString();
  const dup: ApiRequest = {
    ...src,
    id: generateId(),
    name: finalName,
    // Deep-clone every nested mutable structure so callers can edit one
    // without aliasing the other.
    headers: src.headers.map((h) => ({ ...h })),
    query: src.query.map((q) => ({ ...q })),
    pathParams: { ...src.pathParams },
    cookies: src.cookies?.map((c) => ({ ...c })),
    body: cloneRequestBody(src.body),
    auth: cloneRequestAuth(src.auth),
    contextVars: src.contextVars.map((v) => ({ ...v })),
    extractions: src.extractions.map((e) => ({ ...e })),
    assertions: src.assertions.map((a) => ({ ...a })),
    createdAt: now,
    updatedAt: now,
  };
  // Folder children are derived from `folderId` for nested entries; the
  // root tree only carries top-level entries, so reuse `pushChild` to
  // mirror addRequest's behavior at root vs. inside a folder.
  const next = pushChild(synced, src.folderId, { kind: 'request', id: dup.id });
  return {
    synced: {
      ...next,
      collections: {
        ...next.collections,
        requests: { ...next.collections.requests, [dup.id]: dup },
      },
      meta: { ...next.meta, updatedAt: now },
    },
    request: dup,
  };
}

/**
 * Clone a folder along with every descendant folder + request, generating
 * fresh ids for all of them and rewiring `parentId` / `folderId` so the
 * duplicate is a self-contained subtree alongside the original.
 *
 * The new top-level folder gets a `"<name> (copy)"` style label inside
 * the same parent. Descendant names are preserved verbatim — the editor
 * only enforces uniqueness within each parent folder, so siblings of the
 * original keep their natural names inside the cloned subtree.
 */
export function duplicateFolder(
  synced: WorkspaceSynced,
  folderId: string,
): { synced: WorkspaceSynced; folder: Folder | null } {
  const src = synced.collections.folders[folderId];
  if (!src) return { synced, folder: null };

  // Walk the subtree, allocating new ids for every node we touch.
  const folderIdMap = new Map<string, string>([[src.id, generateId()]]);
  let grew = true;
  while (grew) {
    grew = false;
    for (const f of Object.values(synced.collections.folders)) {
      if (folderIdMap.has(f.id)) continue;
      if (f.parentId && folderIdMap.has(f.parentId)) {
        folderIdMap.set(f.id, generateId());
        grew = true;
      }
    }
  }
  const requestIdMap = new Map<string, string>();
  for (const r of Object.values(synced.collections.requests)) {
    if (r.folderId && folderIdMap.has(r.folderId)) {
      requestIdMap.set(r.id, generateId());
    }
  }

  const now = new Date().toISOString();

  // Root folder of the clone gets the "(copy)" label; nested folders
  // keep their original names because they're scoped under a different
  // parent now.
  const newRootId = folderIdMap.get(src.id)!;
  const newRootName = uniquifyName(synced, src.parentId, 'folder', `${src.name} (copy)`);

  const folders = { ...synced.collections.folders };
  for (const [oldId, newId] of folderIdMap.entries()) {
    const original = synced.collections.folders[oldId];
    if (!original) continue;
    const parentId =
      oldId === src.id ? src.parentId : (folderIdMap.get(original.parentId ?? '') ?? null);
    folders[newId] = {
      ...original,
      id: newId,
      parentId,
      name: oldId === src.id ? newRootName : original.name,
      auth: original.auth ? cloneRequestAuth(original.auth) : undefined,
    };
  }

  const requests = { ...synced.collections.requests };
  for (const [oldId, newId] of requestIdMap.entries()) {
    const original = synced.collections.requests[oldId];
    if (!original) continue;
    const newFolderId = folderIdMap.get(original.folderId ?? '') ?? null;
    requests[newId] = {
      ...original,
      id: newId,
      folderId: newFolderId,
      headers: original.headers.map((h) => ({ ...h })),
      query: original.query.map((q) => ({ ...q })),
      pathParams: { ...original.pathParams },
      cookies: original.cookies?.map((c) => ({ ...c })),
      body: cloneRequestBody(original.body),
      auth: cloneRequestAuth(original.auth),
      contextVars: original.contextVars.map((v) => ({ ...v })),
      extractions: original.extractions.map((e) => ({ ...e })),
      assertions: original.assertions.map((a) => ({ ...a })),
      createdAt: now,
      updatedAt: now,
    };
  }

  // Mirror addFolder's tree behavior — only the new top-level folder
  // needs a tree entry when `parentId === null`.
  let next: WorkspaceSynced = synced;
  next = pushChild(next, src.parentId, { kind: 'folder', id: newRootId });

  return {
    synced: {
      ...next,
      collections: { ...next.collections, folders, requests },
      meta: { ...next.meta, updatedAt: now },
    },
    folder: folders[newRootId] ?? null,
  };
}

function cloneRequestBody(body: ApiRequest['body']): ApiRequest['body'] {
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

function cloneRequestAuth(auth: RequestAuth): RequestAuth {
  // Every RequestAuth variant in `@apicircle/shared` is a flat record of
  // string / number / null primitives — no nested objects, arrays, Maps,
  // Dates, or binary. A single-level spread preserves the discriminant
  // and copies every field by value. The `as RequestAuth` cast is safe
  // because TS narrows the spread of a union back to the same union.
  return { ...auth };
}

// --- internal helpers --------------------------------------------------------

function pushChild(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  child: { kind: 'folder' | 'request'; id: string },
): WorkspaceSynced {
  // Only the root list is materialized in the tree node. Nested children are
  // derived from request.folderId / folder.parentId at render time, so we
  // skip the tree push when the entry belongs inside a folder.
  if (parentFolderId !== null) return synced;
  return {
    ...synced,
    collections: {
      ...synced.collections,
      tree: { ...synced.collections.tree, children: [...synced.collections.tree.children, child] },
    },
  };
}

function removeChildFromTree(
  tree: WorkspaceSynced['collections']['tree'],
  child: { kind: 'folder' | 'request'; id: string },
): WorkspaceSynced['collections']['tree'] {
  return {
    ...tree,
    children: tree.children.filter((c) => !(c.kind === child.kind && c.id === child.id)),
  };
}
