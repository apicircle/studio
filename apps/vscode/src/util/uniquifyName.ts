import type { WorkspaceSynced, Request as ApiRequest, Folder } from '@apicircle/shared';

/**
 * Returns true when `name` is unused for that kind within `parentFolderId`
 * (case-insensitive, whitespace-trimmed). Mirrors the web/desktop logic in
 * `packages/ui-components/src/store/editorActions.ts`.
 */
function isNameAvailable(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  kind: 'folder' | 'request',
  name: string,
): boolean {
  const trimmed = name.trim().toLowerCase();
  if (!trimmed) return false;
  const collection: Record<string, Folder | ApiRequest> =
    kind === 'folder' ? synced.collections.folders : synced.collections.requests;
  for (const node of Object.values(collection)) {
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
 * existing item in the same parent folder. n starts at 2.
 */
export function uniquifyName(
  synced: WorkspaceSynced,
  parentFolderId: string | null,
  kind: 'folder' | 'request',
  base: string,
): string {
  if (isNameAvailable(synced, parentFolderId, kind, base)) return base;
  let n = 2;
  while (!isNameAvailable(synced, parentFolderId, kind, `${base} (${n})`)) {
    n += 1;
    if (n > 999) return `${base} (${n})`;
  }
  return `${base} (${n})`;
}
