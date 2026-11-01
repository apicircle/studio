// A split spec read again: the one rule for what its reference list and summary
// become once its files are bundled in.
//
// A spec asset split across files keeps its references in `spec.externalRefs`
// (target → the file asset supplying it). Whenever the spec or one of its files
// is read again (`bundleSpec`), the references are what the bundle reached, the
// user's mappings are carried over, and the operation count and warnings are
// counted on the bundle. The Assets panel's store applies this, and so does a
// headless reader that supplies the files itself (the Lens MCP server), so both
// leave the same record behind.

import type { SpecAssetMeta, SpecExternalRef } from '@apicircle/shared';
import type { BundleSpecResult, SpecReference } from './parsers/specBundle';
import { summarizeSpec } from './specSummary';

/**
 * The spec's reference list after a re-read: every reference the bundle
 * reached, in its order, keeping the file the user mapped to each — unless
 * that file asset is gone, which makes the reference missing again. A mapping
 * whose target the spec no longer reaches is dropped.
 */
export function mergeExternalRefs(
  previous: readonly SpecExternalRef[] | undefined,
  references: readonly SpecReference[],
  liveAssetIds: ReadonlySet<string>,
): SpecExternalRef[] {
  const mapped = new Map((previous ?? []).map((r) => [r.target, r.assetId]));
  return references.map(({ target }) => {
    const assetId = mapped.get(target);
    return assetId && liveAssetIds.has(assetId) ? { target, assetId } : { target };
  });
}

/**
 * What spec asset `meta` becomes once it has been read again as `bundle` (the
 * spec bundled with its mapped files): the references `bundle` reached, with
 * the user's mappings kept (`mergeExternalRefs`); the operation count of the
 * bundle, so the path items the supplied files hold count; its warnings, then
 * the bundler's; and `parsedAt`. A bundle that no longer reads as a spec keeps
 * the count and warnings `meta` had. With no references left, `externalRefs`
 * is dropped. `filename` is the spec's own, which names the file a reference
 * back to it means. Pure.
 */
export function resolvedSpecMeta(
  meta: SpecAssetMeta,
  bundle: Pick<BundleSpecResult, 'text' | 'references' | 'warnings'>,
  filename: string,
  liveAssetIds: ReadonlySet<string>,
  parsedAt: string,
): SpecAssetMeta {
  const summary = summarizeSpec(bundle.text, filename);
  const externalRefs = mergeExternalRefs(meta.externalRefs, bundle.references, liveAssetIds);
  const next: SpecAssetMeta = {
    ...meta,
    operationCount: summary?.operationCount ?? meta.operationCount,
    warnings: [...(summary?.warnings ?? meta.warnings), ...bundle.warnings],
    parsedAt,
    externalRefs,
  };
  if (externalRefs.length === 0) delete next.externalRefs;
  return next;
}
