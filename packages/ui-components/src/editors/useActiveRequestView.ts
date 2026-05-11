import type {
  LinkedWorkspace,
  Request as ApiRequest,
  RequestOverridePatch,
} from '@apicircle/shared';
import { useWorkspaceStore } from '../store/workspaceStore';

/**
 * Unified "what's the editor currently editing?" selector. Resolves three
 * cases:
 *
 *   1. **Linked active** — `activeLinkedRequest` is set. Returns the merged
 *      view: source-snapshot request + the consumer's override patch
 *      applied on top. Edits flow through `setRequest*` which routes to
 *      `setLinkedRequestOverride` via the workspaceStore's
 *      `routeLinkedField` helper.
 *
 *   2. **Workspace active** — `local.ui.activeRequestId` set, no linked
 *      override. Returns the local request from
 *      `synced.collections.requests[id]`. Edits commit directly.
 *
 *   3. **Nothing active** — returns `null`. Caller renders the empty
 *      state.
 *
 * Linked-active takes priority when both are set (the editor's old modal
 * could leave `activeLinkedRequest` set after closing — the link is the
 * more specific intent).
 */
export type ActiveRequestView =
  | {
      source: 'workspace';
      request: ApiRequest;
    }
  | {
      source: 'linked';
      request: ApiRequest;
      link: LinkedWorkspace;
      hasOverride: boolean;
      // The raw patch (if any) so the banner can render "X fields locally
      // modified" without the editor re-deriving it.
      patch: RequestOverridePatch | null;
    };

export function useActiveRequestView(): ActiveRequestView | null {
  return useWorkspaceStore((s) => {
    const active = s.activeLinkedRequest;
    if (active) {
      const link = s.synced?.linkedWorkspaces[active.linkedWorkspaceId];
      const snapshot = s.local?.linkedCollections[active.linkedWorkspaceId];
      const base = snapshot?.collections.requests[active.itemId];
      if (!link || !base) return null;
      const overrideKey = `${active.linkedWorkspaceId}:${active.itemId}`;
      const override = s.synced?.linkedOverrides.requests[overrideKey] ?? null;
      const patch = override?.patch ?? null;
      const request = patch ? mergeOverridePatch(base, patch) : base;
      return {
        source: 'linked' as const,
        request,
        link,
        hasOverride: patch !== null && Object.keys(patch).length > 0,
        patch,
      };
    }
    const id = s.local?.ui.activeRequestId ?? null;
    if (!id) return null;
    const request = s.synced?.collections.requests[id];
    if (!request) return null;
    return { source: 'workspace' as const, request };
  });
}

/**
 * Pure-spread merge — every field present on the patch replaces the
 * corresponding field on the source. Identity / lifecycle fields (id,
 * folderId, createdAt, updatedAt, schema refs) are NOT in the patch type
 * so they always come from the source. Mirrors the same logic the plan
 * runner uses internally; kept inline here so the hook stays
 * self-contained.
 */
function mergeOverridePatch(base: ApiRequest, patch: RequestOverridePatch): ApiRequest {
  const merged: ApiRequest = { ...base };
  if (patch.name !== undefined) merged.name = patch.name;
  if (patch.method !== undefined) merged.method = patch.method;
  if (patch.url !== undefined) merged.url = patch.url;
  if (patch.headers !== undefined) merged.headers = patch.headers;
  if (patch.query !== undefined) merged.query = patch.query;
  if (patch.pathParams !== undefined) merged.pathParams = patch.pathParams;
  if (patch.cookies !== undefined) merged.cookies = patch.cookies;
  if (patch.body !== undefined) merged.body = patch.body;
  if (patch.auth !== undefined) merged.auth = patch.auth;
  if (patch.contextVars !== undefined) merged.contextVars = patch.contextVars;
  if (patch.extractions !== undefined) merged.extractions = patch.extractions;
  if (patch.assertions !== undefined) merged.assertions = patch.assertions;
  return merged;
}
