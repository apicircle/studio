// Surfaces a yellow notice in the request's Auth tab when the request
// has `auth.type === 'none'` BUT one of its ancestor folders has explicit
// auth set. Without this cue the user has no signal that they're silently
// bypassing folder auth — exactly the bug that prompted the dual fix.
//
// Action button flips the request to `auth.type === 'inherit'`, which
// engages the resolver and picks up the nearest explicit folder auth.

import { ShieldAlert } from 'lucide-react';
import type { Folder, RequestAuth } from '@apicircle/shared';
import { resolveInheritedAuth } from '@apicircle/core';

const AUTH_TYPE_LABELS: Record<string, string> = {
  bearer: 'Bearer token',
  basic: 'Basic',
  'api-key': 'API key',
  'custom-header': 'custom header',
  digest: 'Digest',
  ntlm: 'NTLM',
  hawk: 'Hawk',
  'aws-sigv4': 'AWS SigV4',
  'jwt-bearer': 'JWT Bearer',
  'oauth2-client-credentials': 'OAuth2 (Client Credentials)',
  'oauth2-auth-code': 'OAuth2 (Authorization Code)',
  'oauth2-pkce': 'OAuth2 (PKCE)',
  'oauth2-password': 'OAuth2 (Password)',
  'oauth2-implicit': 'OAuth2 (Implicit)',
  'oauth2-device': 'OAuth2 (Device Code)',
};

function findAncestorWithAuth(
  folderId: string | null,
  folders: Record<string, Folder>,
): { folder: Folder; auth: RequestAuth } | null {
  let cursor = folderId;
  const visited = new Set<string>();
  while (cursor !== null) {
    if (visited.has(cursor)) break;
    visited.add(cursor);
    const folder = folders[cursor];
    if (!folder) break;
    if (folder.auth && folder.auth.type !== 'inherit' && folder.auth.type !== 'none') {
      return { folder, auth: folder.auth };
    }
    cursor = folder.parentId;
  }
  return null;
}

export interface FolderAuthBypassCueProps {
  /** Current request's own auth — only renders when this is `none`. */
  requestAuth: RequestAuth;
  /** Folder the request lives in (null at root). */
  folderId: string | null;
  /** All folders, keyed by id — same shape as the resolver expects. */
  folders: Record<string, Folder>;
  /** Called with `{ type: 'inherit' }` when the user clicks "Use folder auth". */
  onUseFolderAuth: () => void;
}

export function FolderAuthBypassCue({
  requestAuth,
  folderId,
  folders,
  onUseFolderAuth,
}: FolderAuthBypassCueProps) {
  if (requestAuth.type !== 'none') return null;
  const ancestor = findAncestorWithAuth(folderId, folders);
  if (!ancestor) return null;

  // Cross-check via the public resolver — guards against any divergence
  // between this component's walk and the wire-time resolver.
  const wouldResolveTo = resolveInheritedAuth({
    requestAuth: { type: 'inherit' },
    folderId,
    folders,
  });
  if (wouldResolveTo.type === 'none') return null;

  const label = AUTH_TYPE_LABELS[wouldResolveTo.type] ?? wouldResolveTo.type;

  return (
    <div
      role="status"
      aria-label="Folder auth bypass cue"
      className="mb-3 flex items-start gap-2 rounded-sm border border-warning/40 bg-warning/5 px-3 py-2 text-xs text-text-primary"
    >
      <ShieldAlert size={14} className="mt-0.5 shrink-0 text-warning" />
      <div className="flex flex-1 flex-col gap-1.5">
        <p>
          Folder <span className="font-medium">{ancestor.folder.name}</span> has{' '}
          <span className="font-medium">{label}</span> auth set. This request is bypassing it
          because its own auth is <span className="font-medium">No Auth</span>.
        </p>
        <button
          type="button"
          onClick={onUseFolderAuth}
          className="inline-flex h-6 w-fit items-center gap-1 rounded-sm border border-warning/40 bg-warning/10 px-2 text-[0.6875rem] text-warning hover:bg-warning/20"
        >
          Use folder auth
        </button>
      </div>
    </div>
  );
}
