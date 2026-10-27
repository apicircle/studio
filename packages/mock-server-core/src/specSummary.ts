// OpenAPI / Swagger 2.0 spec detection + summary.
//
// A lightweight, browser-safe pass over a file's text that answers "is this
// an API spec, and if so, what does it declare?" WITHOUT the full endpoint
// materialization (`parseOpenApiToEndpoints`) or schema dereferencing. It is
// what a Global File Asset stores as `SpecAssetMeta` on upload, so every
// consumer — the Assets panel, the mock "run/import from spec" flows, and (in
// the Lens edition) the code-vs-spec drift check — reads one authoritative
// summary instead of re-parsing the blob.
//
// Run it on a spec bundled with its referenced files (`bundleSpec`) and the
// path items those files hold are counted too: a path item that is an
// in-document `$ref` is followed, one that is still an external `$ref` is
// counted as unread and named in a warning.

import type { SpecAssetMeta } from '@apicircle/shared';
import { bundleSpec, parseSpecText } from './parsers/specBundle';
import { decodePointerSegment } from './parsers/refDeref';

/** The eight OpenAPI Path-Item operation keys. Everything else under a path
 *  (`parameters`, `summary`, `$ref`, `servers`, …) is not an operation. */
const HTTP_METHODS: ReadonlySet<string> = new Set([
  'get',
  'put',
  'post',
  'delete',
  'options',
  'head',
  'patch',
  'trace',
]);

/** The spec summary minus the caller-stamped `parsedAt` (kept side-effect-free). */
export type SpecSummary = Omit<SpecAssetMeta, 'parsedAt'>;

/** Follow an in-document JSON Pointer (`#/a/b`) through `doc`; `undefined` when it leads nowhere. */
function followPointer(doc: unknown, ref: string): unknown {
  let cur: unknown = doc;
  for (const segment of ref.slice(2).split('/').map(decodePointerSegment)) {
    if (!cur || typeof cur !== 'object' || !(segment in cur)) return undefined;
    cur = (cur as Record<string, unknown>)[segment];
  }
  return cur;
}

/**
 * Detect whether `text` is an OpenAPI 3.x / Swagger 2.0 document and, if so,
 * summarise it. Returns `null` for anything that isn't a spec (a plain JSON
 * file, a random upload, unparseable bytes) so the caller leaves the asset's
 * `spec` field undefined.
 *
 * `filenameHint` disambiguates JSON vs YAML (the parser also falls back to the
 * other format) and names the spec's own file, so a `$ref` back to it is not
 * listed as another document. Pure + synchronous — no schema dereferencing, no
 * network, no endpoint build. Operation count is the sum of HTTP methods across
 * `paths`, which is exactly the presence-drift denominator the Lens edition
 * compares code against. `externalRefs` lists the other documents the spec's own
 * `$ref`s name, none supplied; mapping them to files is the caller's (the store).
 */
export function summarizeSpec(text: string, filenameHint?: string): SpecSummary | null {
  const parsed = parseSpecText(text, filenameHint);
  if (!parsed || !parsed.doc || typeof parsed.doc !== 'object') return null;
  const { format } = parsed;

  const doc = parsed.doc as Record<string, unknown>;
  const dialect: SpecSummary['dialect'] | null =
    typeof doc.openapi === 'string'
      ? 'openapi-3'
      : typeof doc.swagger === 'string'
        ? 'swagger-2'
        : null;
  if (!dialect) return null;

  const info =
    doc.info && typeof doc.info === 'object' ? (doc.info as Record<string, unknown>) : {};
  const title = typeof info.title === 'string' ? info.title : undefined;
  const version = typeof info.version === 'string' ? info.version : undefined;

  const warnings: string[] = [];
  const paths =
    doc.paths && typeof doc.paths === 'object' ? (doc.paths as Record<string, unknown>) : undefined;
  let operationCount = 0;
  let unreadPathItems = 0;
  if (!paths || Object.keys(paths).length === 0) {
    warnings.push('The spec declares no paths.');
  } else {
    for (const raw of Object.values(paths)) {
      let item = raw;
      const ref = item && typeof item === 'object' ? (item as { $ref?: unknown }).$ref : undefined;
      if (typeof ref === 'string') {
        if (!ref.startsWith('#/')) {
          unreadPathItems += 1;
          continue;
        }
        item = followPointer(doc, ref);
      }
      if (!item || typeof item !== 'object') continue;
      for (const key of Object.keys(item)) {
        if (HTTP_METHODS.has(key.toLowerCase())) operationCount += 1;
      }
    }
    if (unreadPathItems > 0) {
      warnings.push(
        `${unreadPathItems} path item${unreadPathItems === 1 ? ' lives' : 's live'} in other ` +
          `files — upload them under Referenced files to count their operations.`,
      );
    } else if (operationCount === 0) {
      warnings.push('The spec declares paths but no operations.');
    }
  }

  const references = bundleSpec({ text, filename: filenameHint ?? '' }, new Map()).references;
  const summary: SpecSummary = { dialect, format, title, version, operationCount, warnings };
  if (references.length > 0) summary.externalRefs = references.map((r) => ({ target: r.target }));
  return summary;
}
