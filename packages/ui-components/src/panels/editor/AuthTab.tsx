// Per-request auth editor. Thin wrapper that wires the request's auth +
// store action to the reusable <AuthEditor>. The editor itself (form per
// type, OAuth2, AWS SigV4 etc.) lives in ./AuthEditor.

import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { AuthEditor } from './AuthEditor';

interface AuthTabProps {
  request: ApiRequest;
}

export function AuthTab({ request }: AuthTabProps) {
  const setRequestAuth = useWorkspaceStore((s) => s.setRequestAuth);
  const auth = request.auth ?? { type: 'none' };

  return (
    <AuthEditor
      auth={auth}
      onChange={(next) => setRequestAuth(request.id, next)}
      idPrefix={request.id}
    />
  );
}
