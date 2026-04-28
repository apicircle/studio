import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useVariableScope } from '../../editors/useVariableScope';
import { KeyValueRows } from './KeyValueRows';

interface ParamsTabProps {
  request: ApiRequest;
}

export function ParamsTab({ request }: ParamsTabProps) {
  const setRequestQuery = useWorkspaceStore((s) => s.setRequestQuery);
  const scope = useVariableScope(request);

  return (
    <KeyValueRows
      ariaLabel="Params"
      rows={request.query}
      onChange={(rows) => setRequestQuery(request.id, rows)}
      keyPlaceholder="Param key"
      valuePlaceholder="Param value"
      valueScope={scope}
    />
  );
}
