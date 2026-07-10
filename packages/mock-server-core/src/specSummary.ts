// OpenAPI / Swagger 2.0 spec detection + summary.
//
// A lightweight, browser-safe pass over a file's text that answers "is this
// an API spec, and if so, what does it declare?" WITHOUT the full endpoint
// materialization (`parseOpenApiToEndpoints`) or `$ref` dereferencing. It is
// what a Global File Asset stores as `SpecAssetMeta` on upload, so every
// consumer — the Assets panel, the mock "run/import from spec" flows, and (in
// the Lens edition) the code-vs-spec drift check — reads one authoritative
// summary instead of re-parsing the blob.

import yaml from 'js-yaml';
import type { SpecAssetMeta } from '@apicircle/shared';

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

function tryParse(text: string, format: 'json' | 'yaml'): unknown {
  try {
    return format === 'yaml' ? yaml.load(text) : JSON.parse(text);
  } catch {
    return undefined;
  }
}

/** Sniff JSON vs YAML from a filename hint first, then the content. */
function sniffFormat(text: string, filename?: string): 'json' | 'yaml' {
  const lower = filename?.toLowerCase() ?? '';
  if (lower.endsWith('.json')) return 'json';
  if (lower.endsWith('.yaml') || lower.endsWith('.yml')) return 'yaml';
  return text.trimStart().startsWith('{') ? 'json' : 'yaml';
}

/**
 * Detect whether `text` is an OpenAPI 3.x / Swagger 2.0 document and, if so,
 * summarise it. Returns `null` for anything that isn't a spec (a plain JSON
 * file, a random upload, unparseable bytes) so the caller leaves the asset's
 * `spec` field undefined.
 *
 * `filenameHint` disambiguates JSON vs YAML; the parser also falls back to the
 * other format if the hinted one fails. Pure + synchronous — no `$ref`
 * resolution, no network, no endpoint build. Operation count is the sum of
 * HTTP methods across `paths`, which is exactly the presence-drift denominator
 * the Lens edition compares code against.
 */
export function summarizeSpec(text: string, filenameHint?: string): SpecSummary | null {
  const primary = sniffFormat(text, filenameHint);
  const secondary = primary === 'json' ? 'yaml' : 'json';
  let format: 'json' | 'yaml' = primary;
  let parsed = tryParse(text, primary);
  if (parsed === undefined) {
    parsed = tryParse(text, secondary);
    format = secondary;
  }
  if (!parsed || typeof parsed !== 'object') return null;

  const doc = parsed as Record<string, unknown>;
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
  if (!paths || Object.keys(paths).length === 0) {
    warnings.push('The spec declares no paths.');
  } else {
    for (const item of Object.values(paths)) {
      if (!item || typeof item !== 'object') continue;
      for (const key of Object.keys(item)) {
        if (HTTP_METHODS.has(key.toLowerCase())) operationCount += 1;
      }
    }
    if (operationCount === 0) warnings.push('The spec declares paths but no operations.');
  }

  return { dialect, format, title, version, operationCount, warnings };
}
