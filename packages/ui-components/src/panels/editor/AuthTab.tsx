// Per-request auth editor. Thin wrapper that wires the request's auth +
// store action to the reusable <AuthEditor>. The editor itself (form per
// type, OAuth2, AWS SigV4 etc.) lives in ./AuthEditor.

import { memo } from 'react';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AuthEditor } from './AuthEditor';
import { FolderAuthBypassCue } from './FolderAuthBypassCue';

interface AuthTabProps {
  request: ApiRequest;
}

// memo'd — see ParamsTab for the rationale.
export const AuthTab = memo(function AuthTab({ request }: AuthTabProps) {
  const setRequestAuth = useWorkspaceStore((s) => s.setRequestAuth);
  const folders = useWorkspaceStore((s) => s.synced?.collections.folders ?? {});
  const auth = request.auth ?? { type: 'none' };

  return (
    <>
      <FolderAuthBypassCue
        requestAuth={auth}
        folderId={request.folderId}
        folders={folders}
        onUseFolderAuth={() => setRequestAuth(request.id, { type: 'inherit' })}
      />
      <AuthEditor
        auth={auth}
        onChange={(next) => setRequestAuth(request.id, next)}
        idPrefix={request.id}
      />
    </>
  );
});
