import type { AssetUsage, WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';

// Build a map of `globalFileAssetId` → AssetUsage by scanning every place a
// file asset can be bound:
//
//   - request bodies: form-data file rows (`row.globalFileAssetId`), binary
//     bodies (`body.attachment.globalFileAssetId`)
//   - mock-server endpoints: `defaultResponse.body`, every
//     `requestValidation[].failResponse.body`, every `responseRules[].response.body`
//
// Mirrors the `usedInAggregator.ts` pattern verbatim:
//   1. `aggregateAssetUsage(synced)` is pure and walks the synced doc.
//   2. `recomputeAssetUsage(synced, local)` produces the next `local` with
//      `assetUsageIndex` refreshed, returning the original reference when
//      nothing changed so the debounced persister can short-circuit.
//
// Called from `commitSynced` after every mutation, in lockstep with
// `recomputeUsedIn`. Cost: O(requests + mock endpoints) per call, no string
// scanning — every reference is a structured field lookup.

export function aggregateAssetUsage(synced: WorkspaceSynced): Record<string, AssetUsage> {
  const out: Record<string, AssetUsage> = {};
  const push = (
    assetId: string,
    where: 'request' | 'mock',
    value: string | { mockId: string; endpointId: string },
  ) => {
    let entry = out[assetId];
    if (!entry) {
      entry = { requests: [], mockEndpoints: [], total: 0 };
      out[assetId] = entry;
    }
    if (where === 'request') {
      const id = value as string;
      if (!entry.requests.includes(id)) {
        entry.requests.push(id);
        entry.total += 1;
      }
    } else {
      const ref = value as { mockId: string; endpointId: string };
      if (
        !entry.mockEndpoints.some((e) => e.mockId === ref.mockId && e.endpointId === ref.endpointId)
      ) {
        entry.mockEndpoints.push(ref);
        entry.total += 1;
      }
    }
  };

  for (const req of Object.values(synced.collections.requests)) {
    if (req.body.type === 'binary' && req.body.attachment?.globalFileAssetId) {
      push(req.body.attachment.globalFileAssetId, 'request', req.id);
    }
    if (req.body.type === 'form-data' && req.body.formRows) {
      for (const row of req.body.formRows) {
        if (row.kind === 'file' && row.globalFileAssetId) {
          push(row.globalFileAssetId, 'request', req.id);
        }
      }
    }
  }

  for (const server of Object.values(synced.mockServers ?? {})) {
    for (const endpoint of server.endpoints) {
      const ref = { mockId: server.id, endpointId: endpoint.id };
      const defaultBody = endpoint.defaultResponse.body;
      if (defaultBody.type === 'binary' && defaultBody.attachment?.globalFileAssetId) {
        push(defaultBody.attachment.globalFileAssetId, 'mock', ref);
      }
      for (const rule of endpoint.requestValidation ?? []) {
        const body = rule.failResponse.body;
        if (body.type === 'binary' && body.attachment?.globalFileAssetId) {
          push(body.attachment.globalFileAssetId, 'mock', ref);
        }
      }
      for (const rule of endpoint.responseRules ?? []) {
        const body = rule.response.body;
        if (body.type === 'binary' && body.attachment?.globalFileAssetId) {
          push(body.attachment.globalFileAssetId, 'mock', ref);
        }
      }
    }
  }

  return out;
}

/**
 * Convenience: walk the workspace and return the SAME local doc with
 * `assetUsageIndex` refreshed. Returns the original reference when nothing
 * changed so callers can short-circuit persists. Cleared entries (assets
 * that exist in the registry but have zero references) get an empty record
 * `{ requests: [], mockEndpoints: [], total: 0 }` so the UI can show an
 * "Unused" badge without falling back to "unknown."
 */
export function recomputeAssetUsage(
  synced: WorkspaceSynced,
  local: WorkspaceLocal,
): WorkspaceLocal {
  const files = synced.globalAssets.files;
  if (!files || Object.keys(files).length === 0) {
    // No assets — drop any stale index. Cheaper than re-walking everything.
    if (!local.assetUsageIndex || Object.keys(local.assetUsageIndex).length === 0) {
      return local;
    }
    const next: WorkspaceLocal = { ...local };
    delete next.assetUsageIndex;
    return next;
  }

  const live = aggregateAssetUsage(synced);
  const next: Record<string, AssetUsage> = {};
  for (const id of Object.keys(files)) {
    next[id] = live[id] ?? { requests: [], mockEndpoints: [], total: 0 };
  }
  if (sameUsageIndex(local.assetUsageIndex, next)) return local;
  return { ...local, assetUsageIndex: next };
}

function sameUsageIndex(
  a: Record<string, AssetUsage> | undefined,
  b: Record<string, AssetUsage>,
): boolean {
  const aKeys = Object.keys(a ?? {});
  const bKeys = Object.keys(b);
  if (aKeys.length !== bKeys.length) return false;
  for (const k of bKeys) {
    const x = a?.[k];
    const y = b[k];
    if (!x) return false;
    if (x.total !== y.total) return false;
    if (x.requests.length !== y.requests.length) return false;
    if (x.mockEndpoints.length !== y.mockEndpoints.length) return false;
    for (let i = 0; i < x.requests.length; i++) {
      if (x.requests[i] !== y.requests[i]) return false;
    }
    for (let i = 0; i < x.mockEndpoints.length; i++) {
      if (
        x.mockEndpoints[i].mockId !== y.mockEndpoints[i].mockId ||
        x.mockEndpoints[i].endpointId !== y.mockEndpoints[i].endpointId
      ) {
        return false;
      }
    }
  }
  return true;
}
