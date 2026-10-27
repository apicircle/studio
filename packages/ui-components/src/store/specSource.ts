// Read a spec asset as ONE document, together with the files it points at.
//
// A spec asset can be split across files: its `$ref`s name other documents,
// which the user supplies as ordinary file assets mapped under the spec's
// `spec.externalRefs` (target → asset). Every reader of a spec asset's text —
// the mock resolver, "Import to collection", the one-file download, and the
// Lens drift readers — goes through `readSpecAssetSource`, which reads the spec
// and each mapped file from IndexedDB and bundles them (`bundleSpec`), so they
// all see the same full document. A self-contained spec comes back byte for
// byte as uploaded.
//
// The pure helpers below decide which uploaded file stands for which missing
// reference, and carry the user's mappings across a re-resolve.

import type { GlobalFileAsset, SpecExternalRef, WorkspaceSynced } from '@apicircle/shared';
import type { SpecReference } from '@apicircle/mock-server-core/parsing';
import { getAttachment } from '../persistence/attachments';

export interface SpecAssetSource {
  /** The spec, bundled with every mapped file it reaches. */
  text: string;
  format: 'json' | 'yaml';
  /** Every other document the spec reaches, each supplied or not. */
  references: SpecReference[];
  /** The targets of `references` still missing a file. */
  missing: string[];
  warnings: string[];
}

const decoder = new TextDecoder();

/** The file asset a reference is mapped to, while that asset still exists. */
export function mappedAsset(
  synced: WorkspaceSynced,
  ref: SpecExternalRef,
): GlobalFileAsset | undefined {
  return ref.assetId ? synced.globalAssets.files?.[ref.assetId] : undefined;
}

/** The ids of every spec asset that reads `assetId` as one of its referenced files. */
export function specsMapping(
  synced: WorkspaceSynced | null | undefined,
  assetId: string,
): string[] {
  return Object.values(synced?.globalAssets.files ?? {})
    .filter((a) => a.spec?.externalRefs?.some((r) => r.assetId === assetId))
    .map((a) => a.id);
}

/** The ids of every file asset in the workspace — which mapped files still exist. */
export function fileAssetIds(synced: WorkspaceSynced | null | undefined): Set<string> {
  return new Set(Object.keys(synced?.globalAssets.files ?? {}));
}

/** The references of a spec asset that have no (live) file yet. */
export function missingRefs(synced: WorkspaceSynced, asset: GlobalFileAsset): SpecExternalRef[] {
  return (asset.spec?.externalRefs ?? []).filter((r) => !mappedAsset(synced, r));
}

/** How many of a spec asset's references have no (live) file yet, against the
 *  workspace's file registry — what a spec picker shows beside the op count. */
export function countMissingRefs(
  asset: GlobalFileAsset,
  files: Readonly<Record<string, GlobalFileAsset>> | undefined,
): number {
  return (asset.spec?.externalRefs ?? []).filter((r) => !(r.assetId && files?.[r.assetId])).length;
}

/** `· 2 referenced files missing`, or nothing when none is. */
export function missingRefsLabel(missing: number): string {
  return missing > 0 ? ` · ${missing} referenced file${missing === 1 ? '' : 's'} missing` : '';
}

/**
 * Read spec asset `assetId` with its mapped files and bundle them into one
 * document. `output` picks the format to write (the one-file download asks for
 * the spec's own); by default a bundle is JSON, a self-contained spec its own
 * text. `null` when the asset is gone or its bytes are not on this device. A
 * mapped file whose bytes are not on this device counts as missing.
 */
export async function readSpecAssetSource(
  synced: WorkspaceSynced,
  assetId: string,
  opts: { output?: 'json' | 'yaml' } = {},
): Promise<SpecAssetSource | null> {
  const asset = synced.globalAssets.files?.[assetId];
  if (!asset) return null;
  const record = await getAttachment(asset.slotId);
  if (!record) return null;
  const documents = new Map<string, string>();
  for (const ref of asset.spec?.externalRefs ?? []) {
    const file = mappedAsset(synced, ref);
    const bytes = file ? await getAttachment(file.slotId) : null;
    if (bytes) documents.set(ref.target, decoder.decode(bytes.bytes));
  }
  const { bundleSpec } = await import('@apicircle/mock-server-core/parsing');
  const out = bundleSpec(
    { text: decoder.decode(record.bytes), filename: asset.filename },
    documents,
    opts,
  );
  return {
    ...out,
    missing: out.references.filter((r) => !r.supplied).map((r) => r.target),
  };
}

/**
 * The spec's reference list after a re-resolve: every reference the bundle
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

/** The last path segment of a target (a URL's path included). */
function baseName(target: string): string {
  let path = target;
  try {
    if (/^[a-z][a-z\d+.-]*:\/\//i.test(target)) path = new URL(target).pathname;
  } catch {
    // not a parseable URL: read it as a path
  }
  return path.slice(path.lastIndexOf('/') + 1);
}

/** A target without its leading `../` hops — the part a picked folder can hold. */
function withoutHops(target: string): string {
  return target.replace(/^(\.\.\/)+/, '');
}

/** A picked file's path inside the folder the user chose (`webkitRelativePath`
 *  minus the folder's own name), or just its name for a plain pick. */
export function pickedPath(file: File): string {
  const rel = (file as File & { webkitRelativePath?: string }).webkitRelativePath ?? '';
  const slash = rel.indexOf('/');
  return slash < 0 ? file.name : rel.slice(slash + 1);
}

/**
 * Decide which picked file supplies which missing target.
 *   1. By path: the file's path inside the picked folder equals the target, or
 *      ends with it (the user picked a folder above the spec's) — a target's
 *      leading `../` hops are ignored, since a picked folder can hold the file
 *      but not say where it sat above the spec.
 *   2. By name: a file whose name is the target's last segment, when exactly
 *      one missing target and exactly one picked file have that name.
 * Files that match nothing are returned unmatched; a file named like the spec
 * itself (the root, picked along with its folder) is set aside silently.
 */
export function matchUploadsToTargets(
  files: readonly File[],
  missingTargets: readonly string[],
  specFilename: string,
): { matched: Map<string, File>; unmatched: File[] } {
  const matched = new Map<string, File>();
  const open = new Set(missingTargets);
  const rest: File[] = [];
  for (const file of files) {
    const path = pickedPath(file);
    const target = [...open].find((t) => {
      const want = withoutHops(t);
      return path === want || path.endsWith(`/${want}`);
    });
    if (target !== undefined && path.includes('/')) {
      matched.set(target, file);
      open.delete(target);
    } else rest.push(file);
  }
  const unmatched: File[] = [];
  for (const file of rest) {
    const byName = [...open].filter((t) => baseName(t) === file.name);
    const sameName = rest.filter((f) => f.name === file.name).length;
    if (byName.length === 1 && sameName === 1) {
      matched.set(byName[0], file);
      open.delete(byName[0]);
    } else if (file.name !== specFilename) {
      unmatched.push(file);
    }
  }
  return { matched, unmatched };
}

/** The one-file spec to download or save: the spec bundled in its own format,
 *  named `<base>.bundled.<ext>`. `null` while any reference is still missing. */
export async function bundledSpecFile(
  synced: WorkspaceSynced | null,
  assetId: string,
): Promise<{ filename: string; text: string; mimeType: string } | null> {
  if (!synced) return null;
  const asset = synced.globalAssets.files?.[assetId];
  if (!asset?.spec) return null;
  const format = asset.spec.format;
  const source = await readSpecAssetSource(synced, assetId, { output: format });
  if (!source || source.missing.length > 0) return null;
  const base = asset.filename.replace(/\.(json|ya?ml)$/i, '');
  return {
    filename: `${base}.bundled.${format === 'yaml' ? 'yaml' : 'json'}`,
    text: source.text,
    mimeType: format === 'yaml' ? 'application/yaml' : 'application/json',
  };
}
