import type { Request as ApiRequest } from '@apicircle/shared';
import { suggestHeaders } from '@apicircle/core';
import { useWorkspaceStore } from '../../store/workspaceStore';
import { useVariableScope } from '../../editors/useVariableScope';
import { KeyValueRows } from './KeyValueRows';

interface HeadersTabProps {
  request: ApiRequest;
}

export function HeadersTab({ request }: HeadersTabProps) {
  const setRequestHeaders = useWorkspaceStore((s) => s.setRequestHeaders);
  const scope = useVariableScope(request);

  return (
    <KeyValueRows
      ariaLabel="Headers"
      rows={request.headers}
      onChange={(rows) => setRequestHeaders(request.id, rows)}
      keyPlaceholder="Header name"
      valuePlaceholder="Header value"
      keySuggestions={(prefix) =>
        suggestHeaders(prefix, 30).map((h) => ({ name: h.name, description: h.description }))
      }
      valueScope={scope}
    />
  );
}
