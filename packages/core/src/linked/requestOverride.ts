import type { Request as ApiRequest, RequestOverridePatch } from '@apicircle/shared';

// =============================================================================
// Linked-request override helpers — the field-level delta a consumer layers on
// top of a linked workspace's source request.
//
//   mergeRequestOverride(base, patch)   → the EFFECTIVE request the consumer
//                                         sees / sends (source + their edits).
//   computeRequestOverridePatch(base,   → the delta that reproduces `effective`
//     effective)                          from `base` (only diverging fields).
//
// The two are inverses: merge(base, compute(base, eff)) ≡ eff. Pure + shared by
// runPlan, the web editor, and the VS Code linked-request projection so the
// override semantics never drift.
// =============================================================================

// The overridable fields — must mirror `RequestOverridePatch` in
// `@apicircle/shared` (identity / asset-ref fields are NOT overridable).
const OVERRIDABLE_FIELDS = [
  'name',
  'method',
  'url',
  'headers',
  'query',
  'pathParams',
  'cookies',
  'body',
  'auth',
  'contextVars',
  'extractions',
  'assertions',
] as const;

type OverridableField = (typeof OVERRIDABLE_FIELDS)[number];

/** Layer a consumer's override patch onto a source request. */
export function mergeRequestOverride(base: ApiRequest, patch: RequestOverridePatch): ApiRequest {
  const merged: ApiRequest = { ...base };
  const p = patch as Record<string, unknown>;
  const target = merged as unknown as Record<string, unknown>;
  for (const field of OVERRIDABLE_FIELDS) {
    if (p[field] !== undefined) target[field] = p[field];
  }
  return merged;
}

/**
 * Compute the minimal override patch that turns `base` into `effective` —
 * only the overridable fields that structurally differ. Returns `{}` when the
 * effective request is identical to the source (caller drops the override).
 */
export function computeRequestOverridePatch(
  base: ApiRequest,
  effective: ApiRequest,
): RequestOverridePatch {
  const baseRec: Record<string, unknown> = { ...base };
  const effRec: Record<string, unknown> = { ...effective };
  const patch: RequestOverridePatch = {};
  const patchRec = patch as Record<string, unknown>;
  for (const field of OVERRIDABLE_FIELDS) {
    if (JSON.stringify(baseRec[field]) !== JSON.stringify(effRec[field])) {
      patchRec[field] = effRec[field];
    }
  }
  return patch;
}

/** True when an override patch has no diverging fields (safe to drop). */
export function isEmptyOverridePatch(patch: RequestOverridePatch): boolean {
  return (
    Object.keys(patch).filter((k) => OVERRIDABLE_FIELDS.includes(k as OverridableField)).length ===
    0
  );
}
