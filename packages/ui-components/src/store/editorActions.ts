import type {
  Assertion,
  Folder,
  HttpMethod,
  Request as ApiRequest,
  RequestBody,
  WorkspaceSynced,
} from '@apicircle-v2/shared';
import { generateId } from '@apicircle-v2/shared';

// Pure helpers — no IDB / Zustand dependencies. Each returns a new
// `WorkspaceSynced` snapshot so callers can wrap them in a single store
// transition + persist.

export function createRequest(parentFolderId: string | null): ApiRequest {
  const now = new Date().toISOString();
  return {
    id: generateId(),
    name: 'New request',
    folderId: parentFolderId,
    method: 'GET',
    url: 'https://httpbin.org/anything',
    headers: [],
    query: [],
    body: { type: 'none', content: '' },
    contextVars: [],
    assertions: [],
    createdAt: now,
    updatedAt: now,
  };
}

export function createFolder(parentFolderId: string | null, name = 'New folder'): Folder {
  return { id: generateId(), name, parentId: parentFolderId };
}

export function addRequest(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
): { synced: WorkspaceSynced; request: ApiRequest } {
  const request = createRequest(parentFolderId);
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
  const folder = createFolder(parentFolderId, name);
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
  return updateRequest(synced, id, { name });
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

export function setRequestAssertions(
  synced: WorkspaceSynced,
  id: string,
  assertions: Assertion[],
): WorkspaceSynced {
  return updateRequest(synced, id, { assertions });
}

// --- internal helpers --------------------------------------------------------

function pushChild(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  child: { kind: 'folder' | 'request'; id: string },
): WorkspaceSynced {
  // For now, every new entry attaches at the root tree node since v2 P2 does
  // not yet implement nested folder placement. Folder hierarchy lands when
  // tree DnD/move actions are added in a follow-up.
  if (parentFolderId !== null) {
    // Tagged for later: parentFolderId is recorded on the entity itself
    // (request.folderId / folder.parentId) — the tree placement just defaults
    // to root for now.
  }
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
