// Resolve a request's auth by walking up the folder chain when the request
// itself sets `inherit`. Returns the first explicit (non-`inherit`,
// non-`none`) auth found on an ancestor folder. Falls back to `{ type: 'none' }`
// when the chain has nothing to inherit from.
//
// Pure function — same input always yields the same output. Used by the
// workspace executor *before* calling `buildRequest`, so the request reaches
// the wire with a concrete auth.

import type { Folder, RequestAuth } from '@apicircle/shared';

const NONE: RequestAuth = { type: 'none' };

export interface ResolveInheritedAuthArgs {
  /** The request's stated auth (may be `{ type: 'inherit' }`). */
  requestAuth: RequestAuth;
  /** The folderId the request lives in (null if at the root). */
  folderId: string | null;
  /** All known folders, keyed by id. */
  folders: Record<string, Folder>;
}

/**
 * If `requestAuth` is anything other than `inherit`, returns it unchanged.
 * Otherwise walks up the folder chain looking for the first folder whose
 * own `auth` is set and is not itself `inherit` or `none`. Folders with
 * `inherit` or `none` auth are transparent (skipped, walk continues).
 */
export function resolveInheritedAuth({
  requestAuth,
  folderId,
  folders,
}: ResolveInheritedAuthArgs): RequestAuth {
  if (requestAuth.type !== 'inherit') return requestAuth;

  // Walk up from folderId. Bail at root (parentId === null) or first concrete auth.
  let cursor = folderId;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (visited.has(cursor)) {
      // Defensive: cycle in folder.parentId would otherwise loop forever.
      // The data model says this shouldn't happen, but cheap to guard.
      break;
    }
    visited.add(cursor);
    const folder = folders[cursor];
    if (!folder) break;
    const auth = folder.auth;
    if (auth && auth.type !== 'inherit' && auth.type !== 'none') return auth;
    cursor = folder.parentId;
  }
  return NONE;
}
