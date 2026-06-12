import * as YAML from 'yaml';
import type {
  HttpMethod,
  MockConditionClause,
  MockConditionOp,
  MockConditionScope,
  MockEndpoint,
  MockResponseConfig,
  MockResponseRule,
  MockResponseMultiplier,
  MockValidationRule,
  MockRequestSchema,
  MockParamDef,
  MockResponseBody,
} from '@apicircle/shared';
import { unknownTopLevelKeys, isPresentNonArray, isPresentNonMapping } from './yamlStructure';

const KNOWN_ENDPOINT_KEYS = [
  'id',
  'name',
  'method',
  'pathPattern',
  'description',
  'example',
  'requestSchema',
  'requestValidation',
  'responseRules',
  'defaultResponse',
] as const;

// =============================================================================
// Mock endpoint YAML projection.
//
// Each MockEndpoint round-trips through its own apicircle:// virtual document
// (apicircle://<wsId>/mocks/<mockId>/<endpointId>.endpoint.yaml). The
// projection mirrors the canonical MockEndpoint shape — every editable field
// (requestSchema / requestValidation / responseRules / defaultResponse) shows
// up so a user can hand-edit any of it in YAML, just like the request YAML.
//
// `id` is intentionally rendered as a read-only annotation at the top of the
// document — the parser ignores any edits to it (the id is part of the URI).
// =============================================================================

const HEADER_COMMENT = `# API Circle Mock Endpoint — edit fields below and save (Ctrl+S).
#
# The CodeLens row above each section lets you scaffold validation rules,
# response rules, multipliers, and switch the default response body type
# or status. Every save round-trips through mock.upsert so the change lands
# in workspace.json and is picked up by the desktop / web app + Git workflow.
#
# Read-only: id (set from the URI). Everything else is editable.
`;

export function serializeEndpointToYaml(endpoint: MockEndpoint): string {
  const out = projectEndpoint(endpoint);
  const doc = new YAML.Document(out);
  doc.commentBefore = HEADER_COMMENT.replace(/^# /gm, ' ').trimEnd();
  return doc.toString({ lineWidth: 0 });
}

export interface ParsedEndpointYaml {
  /** The endpoint as reconstructed from the YAML. Id is forced by the caller
   *  to match the URI so the parser cannot drift the identity. */
  endpoint: Omit<MockEndpoint, 'id'>;
  warnings: string[];
}

export class EndpointYamlParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'EndpointYamlParseError';
  }
}

export function parseEndpointFromYaml(text: string): ParsedEndpointYaml {
  let parsed: unknown;
  try {
    parsed = YAML.parse(text);
  } catch (e) {
    throw new EndpointYamlParseError(`Invalid YAML: ${e instanceof Error ? e.message : String(e)}`);
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new EndpointYamlParseError(
      'Document root must be a mapping with name / method / pathPattern / etc.',
    );
  }
  const obj = parsed as Record<string, unknown>;
  const warnings: string[] = [];

  const unknown = unknownTopLevelKeys(obj, KNOWN_ENDPOINT_KEYS);
  if (unknown.length > 0) {
    throw new EndpointYamlParseError(
      `Unknown field(s): ${unknown.join(', ')}. Rename or remove them — saving an unrecognized endpoint structure is blocked to prevent silent data loss.`,
    );
  }
  if (isPresentNonArray(obj.requestValidation)) {
    throw new EndpointYamlParseError('`requestValidation` must be a list.');
  }
  if (isPresentNonArray(obj.responseRules)) {
    throw new EndpointYamlParseError('`responseRules` must be a list.');
  }
  if (isPresentNonMapping(obj.requestSchema)) {
    throw new EndpointYamlParseError('`requestSchema` must be a mapping.');
  }
  if (isPresentNonMapping(obj.defaultResponse)) {
    throw new EndpointYamlParseError('`defaultResponse` must be a mapping.');
  }

  const name = stringOrThrow(obj.name, 'name');
  const method = stringOrThrow(obj.method, 'method').toUpperCase();
  if (!['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'HEAD', 'OPTIONS'].includes(method)) {
    throw new EndpointYamlParseError(
      `Invalid method "${method}" — must be GET/POST/PUT/PATCH/DELETE/HEAD/OPTIONS.`,
    );
  }
  const pathPattern = stringOrThrow(obj.pathPattern, 'pathPattern');

  const description =
    typeof obj.description === 'string' && obj.description.length > 0 ? obj.description : undefined;
  const example =
    typeof obj.example === 'string' && obj.example.length > 0 ? obj.example : undefined;

  const requestSchema = parseRequestSchema(obj.requestSchema, warnings);
  const requestValidation = parseValidationRules(obj.requestValidation, warnings);
  const responseRules = parseResponseRules(obj.responseRules, warnings);
  const defaultResponse = parseResponseConfig(obj.defaultResponse, warnings, 'defaultResponse');

  return {
    endpoint: {
      name,
      method: method as HttpMethod,
      pathPattern,
      description,
      example,
      requestSchema,
      requestValidation,
      responseRules,
      defaultResponse,
    },
    warnings,
  };
}

// ---------------------------------------------------------------------------
// Project (in-memory MockEndpoint → YAML-ready object)
// ---------------------------------------------------------------------------

function projectEndpoint(ep: MockEndpoint): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: ep.id,
    name: ep.name,
    method: ep.method,
    pathPattern: ep.pathPattern,
  };
  if (ep.description) out.description = ep.description;
  if (ep.example) out.example = ep.example;
  // requestSchema declares the endpoint's expected inputs (path / query /
  // header / cookie param defs, body docs). It drives the desktop UI's
  // editor + the OpenAPI export on the desktop side. For mock endpoints
  // built in VS Code that have no params declared, it's just empty noise —
  // hide it from the YAML projection unless something is actually
  // populated. Round-trip preserves whatever the desktop app or an import
  // wrote into it: parseRequestSchema reads the field if present, defaults
  // to empty arrays when absent.
  if (isRequestSchemaNonEmpty(ep.requestSchema)) {
    out.requestSchema = projectRequestSchema(ep.requestSchema);
  }
  if (ep.requestValidation.length > 0) {
    out.requestValidation = ep.requestValidation.map(projectValidationRule);
  } else {
    out.requestValidation = [];
  }
  if (ep.responseRules.length > 0) {
    out.responseRules = ep.responseRules.map(projectResponseRule);
  } else {
    out.responseRules = [];
  }
  out.defaultResponse = projectResponseConfig(ep.defaultResponse);
  return out;
}

function isRequestSchemaNonEmpty(schema: MockRequestSchema): boolean {
  if (schema.pathParams.length > 0) return true;
  if (schema.queryParams.length > 0) return true;
  if (schema.headers.length > 0) return true;
  if (schema.cookies.length > 0) return true;
  if (schema.body && (schema.body.description || schema.body.example)) return true;
  return false;
}

function projectRequestSchema(schema: MockRequestSchema): Record<string, unknown> {
  const out: Record<string, unknown> = {
    pathParams: schema.pathParams.map(projectParam),
    queryParams: schema.queryParams.map(projectParam),
    headers: schema.headers.map(projectParam),
    cookies: schema.cookies.map(projectParam),
  };
  if (schema.body) out.body = schema.body;
  return out;
}

function projectParam(p: MockParamDef): Record<string, unknown> {
  const out: Record<string, unknown> = { id: p.id, name: p.name };
  if (p.typeHint) out.typeHint = p.typeHint;
  if (p.required !== undefined) out.required = p.required;
  if (p.description) out.description = p.description;
  if (p.example !== undefined) out.example = p.example;
  return out;
}

function projectValidationRule(rule: MockValidationRule): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: rule.id,
    kind: rule.kind,
    target: rule.target,
    enabled: rule.enabled,
  };
  if (rule.expected !== undefined) out.expected = rule.expected;
  if (rule.message !== undefined) out.message = rule.message;
  out.failResponse = projectResponseConfig(rule.failResponse);
  return out;
}

function projectResponseRule(rule: MockResponseRule): Record<string, unknown> {
  return {
    id: rule.id,
    name: rule.name,
    enabled: rule.enabled,
    when: rule.when.map((c) => {
      const out: Record<string, unknown> = {
        id: c.id,
        scope: c.scope,
        target: c.target,
        op: c.op,
      };
      if (c.value !== undefined) out.value = c.value;
      return out;
    }),
    response: projectResponseConfig(rule.response),
  };
}

function projectResponseConfig(cfg: MockResponseConfig): Record<string, unknown> {
  const out: Record<string, unknown> = {
    status: cfg.status,
    headers: cfg.headers,
    body: projectResponseBody(cfg.body),
  };
  if (cfg.delayMs !== undefined && cfg.delayMs !== 0) out.delayMs = cfg.delayMs;
  if (cfg.multipliers && cfg.multipliers.length > 0) {
    out.multipliers = cfg.multipliers.map(projectMultiplier);
  }
  return out;
}

function projectResponseBody(body: MockResponseBody): Record<string, unknown> {
  const out: Record<string, unknown> = {
    type: body.type,
    content: prettyJsonContent(body),
  };
  if (body.type === 'form-data') {
    (out as { formRows?: unknown }).formRows = body.formRows;
  } else if (body.type === 'binary' && body.attachment) {
    (out as { attachment?: unknown }).attachment = body.attachment;
  }
  return out;
}

/**
 * When body.type is `json` and the content is parseable JSON, pretty-print
 * it so the YAML projection emits a readable block scalar instead of a
 * wall-of-text single-line string. Indentation is dropped on JSON.parse, so
 * the round-trip stays byte-identical between projection cycles.
 */
function prettyJsonContent(body: MockResponseBody): string {
  if (body.type !== 'json') return body.content;
  const trimmed = body.content.trim();
  if (trimmed.length === 0) return body.content;
  if (body.content.includes('\n')) return body.content;
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return JSON.stringify(parsed, null, 2);
  } catch {
    return body.content;
  }
}

function projectMultiplier(m: MockResponseMultiplier): Record<string, unknown> {
  const out: Record<string, unknown> = {
    id: m.id,
    source: m.source,
    targetJsonPath: m.targetJsonPath,
    defaultCount: m.defaultCount,
  };
  if (m.name) out.name = m.name;
  if (m.min !== undefined) out.min = m.min;
  if (m.max !== undefined) out.max = m.max;
  return out;
}

// ---------------------------------------------------------------------------
// Parse (YAML → MockEndpoint)
// ---------------------------------------------------------------------------

function stringOrThrow(value: unknown, field: string): string {
  if (typeof value !== 'string' || value.length === 0) {
    throw new EndpointYamlParseError(`Field "${field}" is required and must be a string.`);
  }
  return value;
}

// Known keys for each nested object shape. A renamed / mistyped key here (e.g.
// `idd:` instead of `id:`) would otherwise silently regenerate an id or drop a
// field on save — so we reject it, mirroring the top-level guard.
const KNOWN_PARAM_KEYS = ['id', 'name', 'typeHint', 'required', 'description', 'example'] as const;
const KNOWN_SCHEMA_BODY_KEYS = ['description', 'example'] as const;
const KNOWN_VALIDATION_KEYS = [
  'id',
  'kind',
  'target',
  'expected',
  'message',
  'enabled',
  'failResponse',
] as const;
const KNOWN_RULE_KEYS = ['id', 'name', 'enabled', 'when', 'response'] as const;
const KNOWN_CLAUSE_KEYS = ['id', 'scope', 'target', 'op', 'value'] as const;
const KNOWN_RESPONSE_KEYS = [
  'status',
  'headers',
  'body',
  'delayMs',
  'multipliers',
  'multiplier',
] as const;
const KNOWN_BODY_KEYS = ['type', 'content', 'formRows', 'attachment'] as const;
const KNOWN_MULTIPLIER_KEYS = [
  'id',
  'name',
  'source',
  'targetJsonPath',
  'defaultCount',
  'min',
  'max',
] as const;
const KNOWN_SOURCE_KEYS = ['kind', 'key'] as const;
const KNOWN_HEADER_KEYS = ['key', 'value', 'enabled'] as const;

function rejectUnknownKeys(
  obj: Record<string, unknown>,
  known: readonly string[],
  label: string,
): void {
  const unknown = unknownTopLevelKeys(obj, known);
  if (unknown.length > 0) {
    throw new EndpointYamlParseError(
      `${label}: unknown field(s) ${unknown.join(', ')}. Rename or remove them — saving an unrecognized structure is blocked to prevent silent data loss.`,
    );
  }
}

function parseRequestSchema(value: unknown, warnings: string[]): MockRequestSchema {
  if (value === undefined || value === null) {
    return { pathParams: [], queryParams: [], headers: [], cookies: [] };
  }
  if (typeof value !== 'object' || Array.isArray(value)) {
    warnings.push('requestSchema should be a mapping.');
    return { pathParams: [], queryParams: [], headers: [], cookies: [] };
  }
  const r = value as Record<string, unknown>;
  return {
    pathParams: parseParamList(r.pathParams, warnings, 'pathParams'),
    queryParams: parseParamList(r.queryParams, warnings, 'queryParams'),
    headers: parseParamList(r.headers, warnings, 'headers'),
    cookies: parseParamList(r.cookies, warnings, 'cookies'),
    body: parseRequestSchemaBody(r.body),
  };
}

function parseRequestSchemaBody(value: unknown): MockRequestSchema['body'] {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return undefined;
  const v = value as Record<string, unknown>;
  rejectUnknownKeys(v, KNOWN_SCHEMA_BODY_KEYS, 'requestSchema.body');
  const out: { description?: string; example?: string } = {};
  if (typeof v.description === 'string') out.description = v.description;
  if (typeof v.example === 'string') out.example = v.example;
  return out;
}

function parseParamList(value: unknown, warnings: string[], field: string): MockParamDef[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push(`requestSchema.${field} should be a list.`);
    return [];
  }
  return value
    .filter((entry, i): entry is Record<string, unknown> => {
      if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
        warnings.push(`requestSchema.${field}[${i}] is not an object.`);
        return false;
      }
      return true;
    })
    .map((row, i) => {
      rejectUnknownKeys(row, KNOWN_PARAM_KEYS, `requestSchema.${field}[${i}]`);
      return {
        id: typeof row.id === 'string' ? row.id : `${field}-${i}`,
        name: typeof row.name === 'string' ? row.name : '',
        typeHint: typeof row.typeHint === 'string' ? row.typeHint : undefined,
        required: typeof row.required === 'boolean' ? row.required : undefined,
        description: typeof row.description === 'string' ? row.description : undefined,
        example: typeof row.example === 'string' ? row.example : undefined,
      };
    });
}

function parseValidationRules(value: unknown, warnings: string[]): MockValidationRule[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push('requestValidation should be a list.');
    return [];
  }
  return value
    .map((entry, i) => parseSingleValidationRule(entry, warnings, i))
    .filter((r): r is MockValidationRule => r !== null);
}

function parseSingleValidationRule(
  entry: unknown,
  warnings: string[],
  index: number,
): MockValidationRule | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    warnings.push(`requestValidation[${index}] is not an object.`);
    return null;
  }
  const r = entry as Record<string, unknown>;
  rejectUnknownKeys(r, KNOWN_VALIDATION_KEYS, `requestValidation[${index}]`);
  const validKinds = new Set([
    'header-required',
    'header-equals',
    'header-matches',
    'query-required',
    'query-equals',
    'query-matches',
    'cookie-required',
    'body-required',
    'content-type-equals',
  ]);
  if (typeof r.kind !== 'string' || !validKinds.has(r.kind)) {
    warnings.push(`requestValidation[${index}].kind "${String(r.kind)}" is invalid.`);
    return null;
  }
  return {
    id: typeof r.id === 'string' ? r.id : `v${index}`,
    kind: r.kind as MockValidationRule['kind'],
    target: typeof r.target === 'string' ? r.target : '',
    expected: typeof r.expected === 'string' ? r.expected : undefined,
    message: typeof r.message === 'string' ? r.message : undefined,
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    failResponse: parseResponseConfig(
      r.failResponse,
      warnings,
      `requestValidation[${index}].failResponse`,
    ),
  };
}

function parseResponseRules(value: unknown, warnings: string[]): MockResponseRule[] {
  if (value === undefined || value === null) return [];
  if (!Array.isArray(value)) {
    warnings.push('responseRules should be a list.');
    return [];
  }
  return value
    .map((entry, i) => parseSingleResponseRule(entry, warnings, i))
    .filter((r): r is MockResponseRule => r !== null);
}

function parseSingleResponseRule(
  entry: unknown,
  warnings: string[],
  index: number,
): MockResponseRule | null {
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    warnings.push(`responseRules[${index}] is not an object.`);
    return null;
  }
  const r = entry as Record<string, unknown>;
  rejectUnknownKeys(r, KNOWN_RULE_KEYS, `responseRules[${index}]`);
  const name = typeof r.name === 'string' ? r.name : `Rule ${index + 1}`;
  const when = Array.isArray(r.when)
    ? r.when
        .map((c, ci): MockConditionClause | null => {
          if (!c || typeof c !== 'object' || Array.isArray(c)) {
            warnings.push(`responseRules[${index}].when[${ci}] is not an object.`);
            return null;
          }
          const w = c as Record<string, unknown>;
          rejectUnknownKeys(w, KNOWN_CLAUSE_KEYS, `responseRules[${index}].when[${ci}]`);
          const clause: MockConditionClause = {
            id: typeof w.id === 'string' ? w.id : `c${ci}`,
            scope: (typeof w.scope === 'string' ? w.scope : 'query') as MockConditionScope,
            target: typeof w.target === 'string' ? w.target : '',
            op: (typeof w.op === 'string' ? w.op : 'equals') as MockConditionOp,
          };
          if (typeof w.value === 'string') clause.value = w.value;
          return clause;
        })
        .filter((c): c is MockConditionClause => c !== null)
    : [];
  // A response rule with no `when` clause is dead: the runtime engine skips it
  // (see `evaluateResponseRules` — "a clause-less rule never fires"), so it can
  // never produce a response. Block the save so the user adds a condition (the
  // ✚ Add condition lens on the rule's `when:` row) or removes the rule.
  if (when.length === 0) {
    throw new EndpointYamlParseError(
      `responseRules[${index}] ("${name}") must declare at least one \`when\` condition. ` +
        'A rule with no conditions never fires (the runtime skips it), so it does nothing — ' +
        'add a condition or remove the rule.',
    );
  }
  return {
    id: typeof r.id === 'string' ? r.id : `r${index}`,
    name,
    enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
    when,
    response: parseResponseConfig(r.response, warnings, `responseRules[${index}].response`),
  };
}

function parseResponseConfig(value: unknown, warnings: string[], path: string): MockResponseConfig {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(`${path} is missing or not an object — using defaults.`);
    return defaultResponseConfig();
  }
  const r = value as Record<string, unknown>;
  rejectUnknownKeys(r, KNOWN_RESPONSE_KEYS, path);
  const status =
    typeof r.status === 'number' && Number.isInteger(r.status) && r.status >= 100 && r.status <= 599
      ? r.status
      : 200;
  const headers = Array.isArray(r.headers)
    ? r.headers
        .filter(
          (h): h is Record<string, unknown> => !!h && typeof h === 'object' && !Array.isArray(h),
        )
        .map((h, hi) => {
          rejectUnknownKeys(h, KNOWN_HEADER_KEYS, `${path}.headers[${hi}]`);
          return {
            key: typeof h.key === 'string' ? h.key : '',
            value: typeof h.value === 'string' ? h.value : '',
            enabled: typeof h.enabled === 'boolean' ? h.enabled : true,
          };
        })
    : [];
  const body = parseResponseBody(r.body, warnings, `${path}.body`);
  const out: MockResponseConfig = { status, headers, body };
  if (typeof r.delayMs === 'number' && Number.isInteger(r.delayMs) && r.delayMs > 0) {
    out.delayMs = r.delayMs;
  }
  // Multipliers are a list. Also tolerate a single `multiplier:` mapping
  // (hand-edits / legacy) by wrapping it.
  const rawList: unknown[] = Array.isArray(r.multipliers)
    ? (r.multipliers as unknown[])
    : r.multiplier !== undefined && r.multiplier !== null
      ? [r.multiplier]
      : [];
  if (rawList.length > 0) {
    const list = rawList
      .map((m, mi) => parseMultiplier(m, warnings, `${path}.multipliers[${mi}]`))
      .filter((m): m is MockResponseMultiplier => m !== null);
    if (list.length > 0) out.multipliers = list;
  }
  return out;
}

function parseResponseBody(value: unknown, warnings: string[], path: string): MockResponseBody {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return { type: 'none', content: '' };
  }
  const b = value as Record<string, unknown>;
  rejectUnknownKeys(b, KNOWN_BODY_KEYS, path);
  const type = typeof b.type === 'string' ? b.type : 'none';
  const content = typeof b.content === 'string' ? b.content : '';
  switch (type) {
    case 'none':
      return { type: 'none', content: '' };
    case 'json':
    case 'text':
    case 'xml':
    case 'urlencoded':
      return { type, content };
    case 'form-data': {
      const formRows = Array.isArray(b.formRows)
        ? b.formRows
            .filter(
              (r): r is Record<string, unknown> =>
                !!r && typeof r === 'object' && !Array.isArray(r),
            )
            .map((r, ri) => {
              rejectUnknownKeys(r, KNOWN_HEADER_KEYS, `${path}.formRows[${ri}]`);
              return {
                key: typeof r.key === 'string' ? r.key : '',
                value: typeof r.value === 'string' ? r.value : '',
                enabled: typeof r.enabled === 'boolean' ? r.enabled : true,
              };
            })
        : [];
      return { type: 'form-data', content: '', formRows };
    }
    case 'binary': {
      const attachment =
        b.attachment && typeof b.attachment === 'object' && !Array.isArray(b.attachment)
          ? (b.attachment as MockResponseBody & { type: 'binary' })['attachment']
          : undefined;
      return { type: 'binary', content: '', attachment };
    }
    default:
      warnings.push(`${path} has unknown type "${type}" — defaulting to none.`);
      return { type: 'none', content: '' };
  }
}

function parseMultiplier(
  value: unknown,
  warnings: string[],
  path: string,
): MockResponseMultiplier | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    warnings.push(`${path} is not an object.`);
    return null;
  }
  const m = value as Record<string, unknown>;
  rejectUnknownKeys(m, KNOWN_MULTIPLIER_KEYS, path);
  const source = m.source as Record<string, unknown> | undefined;
  if (source && typeof source === 'object' && !Array.isArray(source)) {
    rejectUnknownKeys(source, KNOWN_SOURCE_KEYS, `${path}.source`);
  }
  const sourceKind = source && typeof source.kind === 'string' ? source.kind : 'query';
  return {
    id: typeof m.id === 'string' ? m.id : 'm-new',
    name: typeof m.name === 'string' ? m.name : undefined,
    source: {
      kind: sourceKind as MockResponseMultiplier['source']['kind'],
      key: source && typeof source.key === 'string' ? source.key : '',
    },
    targetJsonPath: typeof m.targetJsonPath === 'string' ? m.targetJsonPath : '$.items',
    defaultCount:
      typeof m.defaultCount === 'number' && Number.isInteger(m.defaultCount) ? m.defaultCount : 10,
    min: typeof m.min === 'number' && Number.isInteger(m.min) ? m.min : undefined,
    max: typeof m.max === 'number' && Number.isInteger(m.max) ? m.max : undefined,
  };
}

function defaultResponseConfig(): MockResponseConfig {
  return {
    status: 200,
    headers: [],
    body: { type: 'none', content: '' },
  };
}
