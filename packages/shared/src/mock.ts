// Mock-server schema. Two halves:
//
//   • `MockServer` lives in WorkspaceSynced — definitions push to git so
//     teams share their mock libraries.
//   • `MockRuntime` lives in WorkspaceLocal — runtime status (port, pid,
//     request count) is per-host and never round-trips through git.
//
// Endpoints are first-class objects with their own request schema,
// pre-validation rules, conditional response rules, and a default
// response. Response bodies support every type the request editor
// supports (none / json / text / xml / form-data / urlencoded / binary)
// — binary bodies hold an `attachment` reference, the same shape used
// by request bodies in the editor, so the same Global Assets storage
// flow applies.
//
// Sources are tagged unions over the formats we ingest. `kind: 'manual'`
// is the lowest-friction path: the user defines endpoints in the editor
// directly. The other kinds carry the verbatim raw spec; the parser in
// `@apicircle/mock-server-core` derives a `MockEndpoint[]` from it.

import type { AttachmentRef, HttpMethod } from './types';

// ---------------------------------------------------------------------------
// Response body — discriminated union, same body types the request editor
// supports so users have one mental model across the app.
// ---------------------------------------------------------------------------

export type MockResponseBodyType =
  | 'none'
  | 'json'
  | 'text'
  | 'xml'
  | 'urlencoded'
  | 'form-data'
  | 'binary';

export type MockResponseBody =
  | { type: 'none'; content: '' }
  | { type: 'json'; content: string }
  | { type: 'text'; content: string }
  | { type: 'xml'; content: string }
  | { type: 'urlencoded'; content: string }
  | {
      type: 'form-data';
      content: '';
      formRows: Array<{ key: string; value: string; enabled: boolean }>;
    }
  | {
      type: 'binary';
      content: '';
      /** Attachment ref into Global Assets — same shape as request bodies. */
      attachment?: AttachmentRef;
    };

// ---------------------------------------------------------------------------
// Response config — status, headers, body, latency. Used both for the
// default response and inside response rules.
// ---------------------------------------------------------------------------

export interface MockResponseConfig {
  status: number;
  headers: Array<{ key: string; value: string; enabled: boolean }>;
  body: MockResponseBody;
  /** Optional artificial latency before responding. */
  delayMs?: number;
  /**
   * Optional response-shape multipliers. At runtime, each multiplier reads a
   * value from the request (a query/path/header param or a JSON-path slice of
   * the request body) and repeats the array element at `targetJsonPath` inside
   * the response body that many times. Used to drive page-size aware mock
   * responses without templating the body manually.
   *
   * The persisted shape is an array so the feature can grow to N multipliers
   * without a schema migration. For now the authoring surfaces (editors, MCP
   * tools) cap the list at {@link MAX_RESPONSE_MULTIPLIERS}; the runtime applies
   * every entry it finds (so a future cap bump — or a hand-edit — needs no
   * engine change). Only fires when `body.type === 'json'`; ignored otherwise.
   */
  multipliers?: MockResponseMultiplier[];
}

/**
 * How many response multipliers the authoring surfaces (desktop/web editor,
 * VS Code lenses, MCP tools) allow per response. The persisted shape is an
 * array, so raising this to N — or removing the gate — is the ONLY change
 * needed to support multiple multipliers; no data migration, no engine change.
 */
export const MAX_RESPONSE_MULTIPLIERS = 1;

// ---------------------------------------------------------------------------
// Response multipliers — repeat an array element inside the response body
// based on a value pulled from the inbound request.
// ---------------------------------------------------------------------------

export type MockMultiplierSourceKind = 'query' | 'pathParam' | 'header' | 'body-json-path';

export interface MockMultiplierSource {
  kind: MockMultiplierSourceKind;
  /** Query/path/header name, or JSON path into the request body (e.g. "$.page.size"). */
  key: string;
}

export interface MockResponseMultiplier {
  id: string;
  /** Optional user-facing label. */
  name?: string;
  source: MockMultiplierSource;
  /**
   * JSON path into the *response body* pointing at the array to repeat
   * (e.g. "$.items"). The first element of that array becomes the repeated
   * template — additional elements are discarded.
   */
  targetJsonPath: string;
  /** Used when source is missing or non-numeric. */
  defaultCount: number;
  /** Optional inclusive lower bound on the resolved count. */
  min?: number;
  /** Optional inclusive upper bound on the resolved count. */
  max?: number;
}

// ---------------------------------------------------------------------------
// Request schema — declarative description of the endpoint's expected
// inputs. Drives both the editor UI (auto-extracts `{path}` slots,
// surfaces query/cookie/header lists) and the runtime documentation /
// OpenAPI export.
// ---------------------------------------------------------------------------

export interface MockParamDef {
  /** Stable id so the editor can reorder rows without losing focus. */
  id: string;
  name: string;
  /** Free-form type hint (e.g. 'string', 'integer', 'uuid'). Documentation only. */
  typeHint?: string;
  required?: boolean;
  description?: string;
  example?: string;
}

export interface MockRequestSchema {
  /** Declared path params (auto-derived from `{slot}` segments in pathPattern + manual entries). */
  pathParams: MockParamDef[];
  queryParams: MockParamDef[];
  headers: MockParamDef[];
  cookies: MockParamDef[];
  /** Optional documentation for the expected request body shape. */
  body?: {
    description?: string;
    example?: string;
  };
}

// ---------------------------------------------------------------------------
// Pre-validation rules — fail-fast checks the runtime applies BEFORE the
// response-rules engine. The user picks a `failResponse` to return when
// any rule fails. Each rule has a `kind` discriminator + targeting.
// ---------------------------------------------------------------------------

export type MockValidationKind =
  | 'header-required'
  | 'header-equals'
  | 'header-matches'
  | 'query-required'
  | 'query-equals'
  | 'query-matches'
  | 'cookie-required'
  | 'body-required'
  | 'content-type-equals';

export interface MockValidationRule {
  id: string;
  kind: MockValidationKind;
  /** Header / query / cookie name being validated (empty for body / content-type). */
  target: string;
  /** Expected literal or regex (when applicable). */
  expected?: string;
  /** Friendly message surfaced into the failResponse body / debugger. */
  message?: string;
  /**
   * Disable without deleting — disabled rules are skipped during request
   * validation but stay in the editor for what-if debugging. Defaults to
   * `true` for newly authored rules.
   */
  enabled: boolean;
  /** Response returned when this rule fails. */
  failResponse: MockResponseConfig;
}

// ---------------------------------------------------------------------------
// Response rules — when/then conditional responses. The runtime evaluates
// rules in declaration order; the first rule whose `when` clauses all
// match wins. If no rule matches, the endpoint's `defaultResponse` is
// returned.
// ---------------------------------------------------------------------------

export type MockConditionScope = 'query' | 'pathParam' | 'header' | 'cookie' | 'body-json-path';
export type MockConditionOp =
  | 'equals'
  | 'not-equals'
  | 'matches'
  | 'gt'
  | 'lt'
  | 'gte'
  | 'lte'
  | 'present'
  | 'absent';

export interface MockConditionClause {
  id: string;
  scope: MockConditionScope;
  /** Name of the query/header/cookie/path-param OR a JSON-path for body matches. */
  target: string;
  op: MockConditionOp;
  /** Comparison value (omitted for present/absent ops). */
  value?: string;
}

export interface MockResponseRule {
  id: string;
  /** User-facing rule label (e.g. "Page 1 — small response"). */
  name: string;
  /** Disable without deleting — useful for what-if testing. */
  enabled: boolean;
  /** AND-combined clauses; rule fires only when every clause matches. */
  when: MockConditionClause[];
  response: MockResponseConfig;
}

/**
 * How many `when` clauses the authoring surfaces (VS Code lenses, desktop/web
 * editor, MCP tools) allow per response rule. The persisted shape is an array
 * and the runtime AND-combines every clause it finds, so raising this to N — or
 * removing the gate — is the ONLY change needed to support multi-clause rules;
 * no data migration, no engine change. Mirrors {@link MAX_RESPONSE_MULTIPLIERS}.
 */
export const MAX_RESPONSE_RULE_CONDITIONS = 1;

// ---------------------------------------------------------------------------
// Endpoints + Servers
// ---------------------------------------------------------------------------

export interface MockEndpoint {
  /** Stable id; survives spec re-parses so per-endpoint overrides keep matching. */
  id: string;
  /** User-friendly label for the sidebar / picker. Defaults to "{METHOD} {pathPattern}". */
  name: string;
  method: HttpMethod;
  /** OpenAPI-style path template, e.g. `/pets/{id}`. Hono routes get derived from this. */
  pathPattern: string;
  description?: string;
  /** Declarative input schema — drives editor UI + runtime docs. */
  requestSchema: MockRequestSchema;
  /** Pre-validation gates evaluated before response rules. */
  requestValidation: MockValidationRule[];
  /** Conditional response rules (first match wins). */
  responseRules: MockResponseRule[];
  /** Fallback response when no rule matches. */
  defaultResponse: MockResponseConfig;
  /** Optional: name of the OpenAPI example chosen when multiple were present. */
  example?: string;
}

export type MockServerSource =
  | { kind: 'openapi'; spec: string; format: 'json' | 'yaml' }
  | {
      // A spec-typed Global File Asset (see `GlobalFileAsset.spec`) drives this
      // mock. Unlike `kind: 'openapi'` (a verbatim inline copy), the bytes live
      // once in the asset library and are resolved on create / refresh.
      kind: 'openapi-asset';
      /** id of the Global File Asset holding the OpenAPI/Swagger document. */
      assetId: string;
      format: 'json' | 'yaml';
      /**
       * `linked` — endpoints are derived live from the asset and kept in sync
       * when the asset changes; they are NOT hand-editable ("run the spec
       * directly"). `materialized` — parsed once into editable endpoints the
       * user can modify ("import & edit"); an explicit refresh re-imports.
       */
      mode: 'linked' | 'materialized';
    }
  | { kind: 'postman'; collection: string }
  | { kind: 'insomnia'; export: string }
  | { kind: 'manual'; endpoints: MockEndpoint[] };

/**
 * True when a mock's endpoints are derived live from a spec asset and must not
 * be hand-edited — the source is an asset in `linked` mode. Endpoint-mutating
 * store actions and MCP tools consult this to stay read-only, so "run the spec
 * directly" mocks always reflect the asset.
 */
export function isLinkedMockSource(source: MockServerSource): boolean {
  return source.kind === 'openapi-asset' && source.mode === 'linked';
}

export interface MockServer {
  id: string;
  name: string;
  source: MockServerSource;
  /**
   * Resolved endpoint table — populated when the source is parsed; persisted
   * so the desktop app doesn't re-parse on every start. Empty array for
   * `kind: 'manual'` (the source carries the endpoints) — though in
   * practice we mirror the manual endpoints into both fields so downstream
   * consumers can read either one.
   */
  endpoints: MockEndpoint[];
  /** Default port used when starting; null = pick a free port at start. */
  defaultPort: number | null;
  cors: { enabled: boolean; origins: string[] };
  createdAt: string;
  updatedAt: string;
}

/** Lives in WorkspaceLocal — never pushed to git. */
export interface MockRuntime {
  /** Keyed by mockServerId. Absent = not running. */
  active: Record<string, MockRuntimeEntry>;
}

export interface MockRuntimeEntry {
  port: number;
  /** null in browser-preview mode where there's no OS process. */
  pid: number | null;
  startedAt: string;
  lastError: string | null;
  requestCount: number;
}

// ---------------------------------------------------------------------------
// Defaults & helpers — used when seeding new endpoints / responses.
// ---------------------------------------------------------------------------

// Status-code aware body-type allow-list. Status 200 is the only one
// that supports binary file responses (image / pdf / file-download
// scenarios); error and informational statuses don't typically return
// binary, and 1xx / 204 / 205 / 304 must not have a body at all per
// RFC 7230 §3.3. Use this to drive the body-type picker in the editor.
const NO_BODY_STATUSES = new Set([100, 101, 102, 103, 204, 205, 304]);

export function getAllowedMockResponseBodyTypes(status: number): MockResponseBodyType[] {
  if (NO_BODY_STATUSES.has(status)) return ['none'];
  if (status === 200) {
    return ['none', 'json', 'text', 'xml', 'urlencoded', 'form-data', 'binary'];
  }
  return ['none', 'json', 'text', 'xml', 'urlencoded', 'form-data'];
}

/**
 * If `currentBodyType` isn't allowed for `status`, return a safe
 * fallback (`'json'` for status codes that allow bodies, `'none'`
 * otherwise). Returns `null` when the current type is already
 * allowed — caller can early-return.
 */
export function coerceMockResponseBodyTypeForStatus(
  currentBodyType: MockResponseBodyType,
  status: number,
): MockResponseBodyType | null {
  const allowed = getAllowedMockResponseBodyTypes(status);
  if (allowed.includes(currentBodyType)) return null;
  if (allowed.includes('json')) return 'json';
  return 'none';
}

export function makeDefaultMockResponseBody(type: MockResponseBodyType): MockResponseBody {
  switch (type) {
    case 'none':
      return { type: 'none', content: '' };
    case 'form-data':
      return { type: 'form-data', content: '', formRows: [] };
    case 'binary':
      return { type: 'binary', content: '' };
    default:
      return { type, content: '' };
  }
}

export function makeDefaultMockResponse(): MockResponseConfig {
  return {
    status: 200,
    headers: [{ key: 'Content-Type', value: 'application/json', enabled: true }],
    body: { type: 'json', content: '{\n  "ok": true\n}' },
  };
}

export function makeDefaultRequestSchema(): MockRequestSchema {
  return { pathParams: [], queryParams: [], headers: [], cookies: [] };
}
