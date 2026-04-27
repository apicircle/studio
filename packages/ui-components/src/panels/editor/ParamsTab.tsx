import type { Request as ApiRequest } from '@apicircle-v2/shared';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { KeyValueRows } from './KeyValueRows';

interface ParamsTabProps {
  request: ApiRequest;
}

export function ParamsTab({ request }: ParamsTabProps) {
  const setRequestQuery = useWorkspaceStore((s) => s.setRequestQuery);

  return (
    <KeyValueRows
      ariaLabel="Params"
      rows={request.query}
      onChange={(rows) => setRequestQuery(request.id, rows)}
      keyPlaceholder="Param key"
      valuePlaceholder="Param value"
    />
  );
}
