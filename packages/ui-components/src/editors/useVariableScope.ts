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

interface ScopeOptions {
  /**
   * Override the workspace's `priorityOrder` (e.g. an execution plan's
   * `envPriorityOrder`). Empty/undefined means "use the workspace order".
   */
  envPriorityOrderOverride?: readonly string[];
}

export function useVariableScope(
  request: ApiRequest | null,
  opts: ScopeOptions = {},
): ResolutionScope {
  const environments = useWorkspaceStore((s) => s.synced?.environments.items ?? {});
  const workspacePriorityOrder = useWorkspaceStore(
    (s) => s.synced?.environments.priorityOrder ?? [],
  );
  const globalContext = useWorkspaceStore((s) => s.local?.globalContext ?? {});
  const secretEntries = useWorkspaceStore((s) => s.local?.secretIndex.entries ?? {});

  const override = opts.envPriorityOrderOverride;

  return useMemo(() => {
    // Workspace globalContext is the lowest contextVars layer; per-request
    // contextVars layer on top of that. Mirrors workspaceStore.resolveRequest.
    const ctx: Record<string, string> = { ...globalContext };
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

    const priorityOrder = override && override.length > 0 ? [...override] : workspacePriorityOrder;
    const priorityEnvs = priorityOrder.map((name) => envToMap(environments[name]));

    const secrets: Record<string, string> = {};
    for (const entry of Object.values(secretEntries)) {
      if (entry.label) secrets[entry.label] = SECRET_MASK;
    }

    return { contextVars: ctx, activeEnv: {}, priorityEnvs, secrets };
  }, [environments, workspacePriorityOrder, override, request, globalContext, secretEntries]);
}

/**
 * Active-context scope for the global "Variables" button in the top bar.
 * Picks the right scope based on which panel is active:
 *   - editor:    request-bound scope (uses workspace priorityOrder)
 *   - execution: plan-bound scope (uses the active plan's envPriorityOrder if any)
 *   - any other: workspace scope (no per-request contextVars)
 */
export function useActiveVariableScope(): ResolutionScope {
  const activePanel = useWorkspaceStore((s) => s.activePanel);
  const activeRequestId = useWorkspaceStore((s) => s.local?.ui.activeRequestId ?? null);
  const editorRequest = useWorkspaceStore((s) =>
    activeRequestId ? (s.synced?.collections.requests[activeRequestId] ?? null) : null,
  );
  const activePlanId = useWorkspaceStore((s) => s.activePlanId);
  const planEnvOrder = useWorkspaceStore((s) =>
    activePlanId ? (s.local?.executionPlans[activePlanId]?.envPriorityOrder ?? []) : [],
  );

  const requestForScope = activePanel === 'editor' ? editorRequest : null;
  const overrideForScope = activePanel === 'execution' ? planEnvOrder : undefined;
  return useVariableScope(requestForScope, { envPriorityOrderOverride: overrideForScope });
}
