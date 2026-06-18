import * as YAML from 'yaml';
import type {
  Request,
  Assertion,
  ContextExtraction,
  RequestAuth,
  RequestBody,
} from '@apicircle/shared';
import { findPathPlaceholders, parseUrlQuery } from '@apicircle/core';
import { unknownTopLevelKeys, isPresentNonArray, isPresentNonMapping } from './yamlStructure';

const KNOWN_REQUEST_KEYS = [
  'name',
  'method',
  'url',
  'pathParams',
  'query',
  'headers',
  'cookies',
  'auth',
  'body',
  'assertions',
  'extractions',
  'contextVars',
] as const;

// =============================================================================
// Request YAML projection.
//
// Converts a Request (the canonical JSON-shape stored in workspace.json) into
// a human-friendly YAML document that VS Code's native text editor renders.
// On save, parses the YAML back into a Partial<Request> patch suitable for
// `request.update`.
//
// Round-trip discipline:
//   - YAML keys exactly mirror the Request field names (no renames)
//   - Optional fields with empty values are omitted from YAML output to keep
//     diffs minimal
//   - Comments at the top of the document explain what's editable and what's not
//   - id, createdAt, updatedAt, folderId, bodySchemaId, graphqlSchemaId are
//     read-only (not present in output) — editing them would break referential
//     integrity. Folder moves use the TreeView drag-drop, not YAML edit.
// =============================================================================

interface RequestYamlOutput {
  name: string;
  method: string;
  url: string;
  pathParams?: Record<string, string>;
  query?: Array<{ key: string; value: string; enabled: boolean }>;
  headers?: Array<{ key: string; value: string; enabled: boolean }>;
  cookies?: Array<{ key: string; value: string; enabled: boolean }>;
  auth?: RequestAuth;
  body?: RequestBody;
  assertions?: Assertion[];
  extractions?: ContextExtraction[];
  contextVars?: Array<{ key: string; value: string }>;
}

const HEADER_COMMENT = `# API Circle Request — edit fields below and save (Ctrl+S) to commit.
# Read-only system fields are intentionally not present in this projection.
# Folder moves use the TreeView; schema references are managed via the Assets view.
`;

/**
 * When body.type is `json` and the content is parseable JSON, pretty-print it
 * so the YAML projection emits a readable block scalar (`content: |-\n  {\n
 *  "key": "value"\n}`) instead of a wall-of-text single-line string. JSON
 * parsing tolerates the indentation we add, so the round-trip is lossless —
 * the parser reads back the same string regardless of whether it was minified
 * or pretty-printed before save.
 *
 * Invalid JSON (or other body types) passes through unchanged.
 */
function projectBody(body: RequestBody): RequestBody {
  if (body.type !== 'json') return body;
  const trimmed = body.content.trim();
  if (trimmed.length === 0) return body;
  // Skip strings that are already multi-line — assume the user formatted them
  // intentionally and don't re-flow whitespace.
  if (body.content.includes('\n')) return body;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return { ...body, content: JSON.stringify(parsed, null, 2) };
  } catch {
    return body;
  }
}

export function serializeRequestToYaml(req: Request): string {
  const out: RequestYamlOutput = {
    name: req.name,
    method: req.method,
    url: req.url,
  };

  if (req.pathParams && Object.keys(req.pathParams).length > 0) out.pathParams = req.pathParams;
  if (req.query.length > 0) out.query = req.query;
  if (req.headers.length > 0) out.headers = req.headers;
  if (req.cookies && req.cookies.length > 0) out.cookies = req.cookies;
  if (req.auth.type !== 'none') out.auth = req.auth;
  if (req.body.type !== 'none') out.body = projectBody(req.body);
  if (req.assertions.length > 0) out.assertions = Array.from(req.assertions);
  if (req.extractions.length > 0) out.extractions = Array.from(req.extractions);
  if (req.contextVars.length > 0) out.contextVars = Array.from(req.contextVars);

  const doc = new YAML.Document(out);
  doc.commentBefore = HEADER_COMMENT.replace(/^# /gm, ' ').trimEnd();
  return doc.toString({ lineWidth: 0 });
}

export interface ParsedRequestYaml {
  patch: Partial<
    Omit<Request, 'id' | 'createdAt' | 'folderId' | 'bodySchemaId' | 'graphqlSchemaId'>
  >;
  warnings: string[];
}

/**
 * Parse a YAML document back into a partial-Request patch suitable for
 * `request.update`. Throws `RequestYamlParseError` on invalid YAML; collects
 * non-fatal issues as warnings (missing optional fields, unknown keys).
 *
 * Defaults are filled in for fields the user removed — never leave a saved
 * Request in a half-shape. The caller takes the patch and applies it via
 * applyMutation against the existing Request.
 */
export function parseRequestFromYaml(text: string): ParsedRequestYaml {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (e) {
    throw new RequestYamlParseError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }

  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new RequestYamlParseError(
      'Document root must be a mapping with `name`, `method`, `url` etc.',
    );
  }

  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  const unknown = unknownTopLevelKeys(obj, KNOWN_REQUEST_KEYS);
  if (unknown.length > 0) {
    throw new RequestYamlParseError(
      `Unknown field(s): ${unknown.join(', ')}. Rename or remove them — saving an unrecognized request structure is blocked to prevent silent data loss.`,
    );
  }
  for (const field of [
    'query',
    'headers',
    'cookies',
    'assertions',
    'extractions',
    'contextVars',
  ] as const) {
    if (isPresentNonArray(obj[field])) {
      throw new RequestYamlParseError(`\`${field}\` must be a list.`);
    }
  }
  for (const field of ['pathParams', 'auth', 'body'] as const) {
    if (isPresentNonMapping(obj[field])) {
      throw new RequestYamlParseError(`\`${field}\` must be a mapping.`);
    }
  }

  const name = stringOrThrow(obj.name, 'name');
  const method = stringOrThrow(obj.method, 'method').toUpperCase();
  const rawUrl = stringOrThrow(obj.url, 'url');

  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new RequestYamlParseError(
      `Invalid method "${method}" — must be GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS`,
    );
  }

  // URL ↔ query / pathParams sync — mirrors the web/desktop URL bar contract.
  // A `?key=val…` typed into the url field gets split: the base lands in
  // `url`, the pairs merge into the existing `query:` rows (by key — existing
  // values get overwritten with the URL-bar value; disabled rows are
  // preserved at the tail; new keys append in URL order). `{name}` / `:name`
  // placeholders in the path surface as `pathParams` entries (existing values
  // preserved; new placeholders get an empty string so the user sees a slot
  // to fill). Stale `pathParams` entries that no longer match a placeholder
  // are kept — the editor surfaces them but doesn't auto-prune (matches the
  // web/desktop behavior in `setRequestPathParams`).
  const { base, query: queryFromUrl } = parseUrlQuery(rawUrl);
  const yamlQuery = normalizeKVRows(obj.query, warnings, 'query');
  const mergedQuery = mergeQueryFromUrl(yamlQuery, queryFromUrl);

  const yamlPathParams = (obj.pathParams as Record<string, string> | undefined) ?? {};
  const placeholders = findPathPlaceholders(base);
  const mergedPathParams: Record<string, string> = { ...yamlPathParams };
  for (const name of placeholders) {
    if (!(name in mergedPathParams)) mergedPathParams[name] = '';
  }

  const patch: ParsedRequestYaml['patch'] = {
    name,
    method: method as Request['method'],
    url: base,
    pathParams:
      Object.keys(mergedPathParams).length > 0 || obj.pathParams !== undefined
        ? mergedPathParams
        : undefined,
    query: mergedQuery,
    headers: normalizeKVRows(obj.headers, warnings, 'headers'),
    cookies: normalizeKVRows(obj.cookies, warnings, 'cookies'),
    auth: (obj.auth as RequestAuth | undefined) ?? { type: 'none' },
    body: (obj.body as RequestBody | undefined) ?? { type: 'none', content: '' },
    assertions: (obj.assertions as Assertion[] | undefined) ?? [],
    extractions: (obj.extractions as ContextExtraction[] | undefined) ?? [],
    contextVars: (obj.contextVars as Array<{ key: string; value: string }> | undefined) ?? [],
  };

  return { patch, warnings };
}

/**
 * Merge query rows parsed from the url-bar `?…` portion into the rows the user
 * authored in the YAML `query:` block. Strategy:
 *   - Walk existing YAML rows in order. If a row's key matches a row from the
 *     URL, replace the value with the URL's (URL is the source of truth for
 *     *enabled* rows, mirroring the web/desktop URL bar).
 *   - Append any URL rows whose key isn't already present, in URL order.
 *   - Disabled YAML rows pass through with their value untouched — the URL
 *     bar can only represent enabled rows, so we don't overwrite a row the
 *     user explicitly disabled with a re-typed URL value.
 */
function mergeQueryFromUrl(
  yamlRows: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
  urlRows: ReadonlyArray<{ key: string; value: string; enabled: boolean }>,
): Array<{ key: string; value: string; enabled: boolean }> {
  if (urlRows.length === 0) return [...yamlRows];
  const urlByKey = new Map<string, { value: string; enabled: boolean }>();
  for (const row of urlRows) urlByKey.set(row.key, { value: row.value, enabled: row.enabled });
  const consumed = new Set<string>();
  const merged = yamlRows.map((row) => {
    if (row.enabled && urlByKey.has(row.key)) {
      const fromUrl = urlByKey.get(row.key)!;
      consumed.add(row.key);
      return { key: row.key, value: fromUrl.value, enabled: true };
    }
    return { ...row };
  });
  for (const row of urlRows) {
    if (consumed.has(row.key)) continue;
    merged.push({ key: row.key, value: row.value, enabled: true });
  }
  return merged;
}

function stringOrThrow(value: unknown, field: string): string {
  if (typeof value !== 'string') {
    throw new RequestYamlParseError(`Field "${field}" must be a string`);
  }
  return value;
}

function normalizeKVRows(
  value: unknown,
  warnings: string[],
  field: string,
): Array<{ key: string; value: string; enabled: boolean }> {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push(`${field} should be a list of {key, value, enabled} rows`);
    return [];
  }
  return value.map((row, i) => {
    if (typeof row !== 'object' || row === null) {
      warnings.push(`${field}[${i}] is not an object`);
      return { key: '', value: '', enabled: true };
    }
    const r = row as Record<string, unknown>;
    // A mistyped row key (e.g. `keyy:`) would silently drop the value on save —
    // block it like the top-level structural guard.
    const unknown = unknownTopLevelKeys(r, ['key', 'value', 'enabled']);
    if (unknown.length > 0) {
      throw new RequestYamlParseError(
        `${field}[${i}]: unknown field(s) ${unknown.join(', ')}. Rows are { key, value, enabled }.`,
      );
    }
    return {
      key: typeof r.key === 'string' ? r.key : '',
      value: typeof r.value === 'string' ? r.value : '',
      enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    };
  });
}

export class RequestYamlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'RequestYamlParseError';
  }
}

/**
 * Run the YAML buffer through the parse → serialize round-trip and return the
 * canonical projection (the same shape the FS provider's `readFile` would
 * produce after the save has been applied). Used by the on-will-save hook to
 * reflect the URL ↔ query/pathParams sync in the buffer at save time, so the
 * user sees `?key=val` typed into `url:` move into the `query:` block, and
 * `{name}` placeholders surface as `pathParams:` entries — without having to
 * close and reopen the document.
 *
 * Returns `null` when the buffer is already canonical (nothing to rewrite),
 * or when parsing fails (let `writeFile`'s parser surface the error message
 * via FileSystemError; the on-will-save hook isn't the right place to block
 * a save with a popup).
 */
export function projectRequestYaml(text: string): string | null {
  let patch: ParsedRequestYaml['patch'];
  try {
    patch = parseRequestFromYaml(text).patch;
  } catch {
    return null;
  }
  // Synthesize a full Request shape from the patch — `serializeRequestToYaml`
  // never emits id / createdAt / updatedAt / folderId / *SchemaId, so the
  // placeholder values here are never observed. Every emitted field comes from
  // the patch (with the same defaults `parseRequestFromYaml` already filled in
  // for missing optionals).
  const projected: Request = {
    id: 'preview',
    folderId: null,
    createdAt: '',
    updatedAt: '',
    name: patch.name ?? '',
    method: patch.method ?? 'GET',
    url: patch.url ?? '',
    pathParams: patch.pathParams,
    query: patch.query ?? [],
    headers: patch.headers ?? [],
    cookies: patch.cookies ?? [],
    auth: patch.auth ?? { type: 'none' },
    body: patch.body ?? { type: 'none', content: '' },
    assertions: patch.assertions ?? [],
    extractions: patch.extractions ?? [],
    contextVars: patch.contextVars ?? [],
  };
  const yaml = serializeRequestToYaml(projected);
  return yaml === text ? null : yaml;
}
