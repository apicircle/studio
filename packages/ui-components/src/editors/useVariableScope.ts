// Build a ResolutionScope suitable for autocomplete from the live workspace
// store. Encrypted env values and vault secrets are surfaced as masked
// placeholders — the popup needs the *names*, not the plaintext.
//
// This deliberately avoids the full async decrypt path used at send time
// (workspaceStore.resolveRequest). Autocomplete should be instant; secrets
// stay encrypted at rest.

import { useMemo } from 'react';
import type { ResolutionScope } from '@apicircle/core';
import type { Request as ApiRequest } from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';

const SECRET_MASK = '••••';

export function useVariableScope(request: ApiRequest | null): ResolutionScope {
  const environments = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const activeEnvName = useWorkspaceStore((s) => s.synced?.environments.activeName ?? null);
  const priorityOrder = useWorkspaceStore((s) => s.synced?.environments.priorityOrder ?? []);
  const secretEntries = useWorkspaceStore((s) => s.local?.secretIndex.entries ?? {});

  return useMemo(() => {
    const ctx: Record<string, string> = {};
    if (request) {
      for (const v of request.contextVars) if (v.key) ctx[v.key] = v.value;
    }

    const envToMap = (env?: {
      variables: ReadonlyArray<{ key: string; value: string; encrypted: boolean }>;
    }): Record<string, string> => {
      const out: Record<string, string> = {};
      if (!env) return out;
      for (const row of env.variables) {
        if (!row.key) continue;
        out[row.key] = row.encrypted ? SECRET_MASK : row.value;
      }
      return out;
    };

    const activeEnv = envToMap(activeEnvName ? environments[activeEnvName] : undefined);
    const priorityEnvs = priorityOrder
      .filter((name) => name !== activeEnvName)
      .map((name) => envToMap(environments[name]));

    const secrets: Record<string, string> = {};
    for (const entry of Object.values(secretEntries)) {
      if (entry.label) secrets[entry.label] = SECRET_MASK;
    }

    return { contextVars: ctx, activeEnv, priorityEnvs, secrets };
  }, [activeEnvName, environments, priorityOrder, request, secretEntries]);
}
