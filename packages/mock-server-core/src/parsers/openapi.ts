// OpenAPI / Swagger 2.0 → MockEndpoint[] parser.
//
// Two-step pipeline:
//   1. Parse the source string (JSON or YAML) and dereference all `$ref`
//      chains up-front — the mock server doesn't carry a $ref resolver at
//      runtime, so every endpoint ships a self-contained body. The
//      dereferencer is INJECTED (`deps.dereference`) so this module stays
//      browser-safe by default: the web build uses `dereferenceInternal`
//      (in-document refs only), while the Node build (`openapiNode.ts`)
//      passes swagger-parser for full external-file / remote resolution.
//   2. Walk `paths.{path}.{method}.responses.{status}.content.{mediaType}`
//      and pull either an `example`, the first `examples` entry, or
//      synthesize one from the schema via `schemaToExample`.
//
// We pick the lowest 2xx response when multiple are present (200 wins
// over 201; if neither, take the first 2xx). Errors and 5xx are ignored
// — mock servers should default to the success path; users override via
// the editor when they want failure cases.

import yaml from 'js-yaml';
import type { HttpMethod, MockEndpoint, MockRequestSchema } from '@apicircle/shared';
import { makeDefaultRequestSchema } from '@apicircle/shared';
import { schemaToExample, type JsonSchemaLike } from '../faker/schemaToExample';
import { paramDef } from './buildEndpoint';
import { buildMockEndpoint } from './buildEndpoint';
import { dereferenceInternal, type DereferenceResult } from './refDeref';

/**
 * A `$ref` dereferencer: takes the parsed spec object and returns a
 * fully-dereferenced document plus any non-fatal warnings. Injected so the
 * browser build can use the in-document-only resolver while the Node build
 * swaps in swagger-parser. May be sync or async.
 */
export type DereferenceFn = (root: unknown) => DereferenceResult | Promise<DereferenceResult>;

export interface ParseOpenApiDeps {
  /** Defaults to the browser-safe {@link dereferenceInternal}. */
  dereference?: DereferenceFn;
}

const SUPPORTED_METHODS: ReadonlyArray<HttpMethod> = [
  'GET',
  'POST',
  'PUT',
  'PATCH',
  'DELETE',
  'HEAD',
  'OPTIONS',
];

interface OpenApiParameter {
  name?: string;
  in?: string; // 'path' | 'query' | 'header' | 'cookie'
  required?: boolean;
  description?: string;
  schema?: JsonSchemaLike;
  // Swagger 2.0 carries `type` directly on the parameter (no `schema`).
  type?: string;
  example?: unknown;
}

interface OpenApiOperation {
  operationId?: string;
  summary?: string;
  responses?: Record<string, OpenApiResponse>;
  parameters?: OpenApiParameter[];
  // OpenAPI 3.x request body. Swagger 2.0 has no `requestBody`; it models the
  // body as a single `in: 'body'` parameter instead (see
  // {@link parseOpenApiRequestBodies}).
  requestBody?: OpenApiRequestBody;
  // Swagger 2.0 carries `produces` / `consumes` here. We honor `produces` as a
  // response content-type fallback, and `consumes` as the request-body content
  // type for an `in: 'body'` parameter.
  produces?: string[];
  consumes?: string[];
}

/**
 * OpenAPI 3.x request body object. Only the media-type `schema`s matter for
 * contract extraction — examples live on the response side. Swagger 2.0 has no
 * equivalent object; its body is a single `in: 'body'` parameter carrying a
 * `schema` (handled in {@link pickRequestBody}).
 */
interface OpenApiRequestBody {
  content?: Record<string, { schema?: JsonSchemaLike }>;
  required?: boolean;
  description?: string;
}

interface OpenApiResponse {
  description?: string;
  content?: Record<
    string,
    { example?: unknown; examples?: Record<string, { value?: unknown }>; schema?: JsonSchemaLike }
  >;
  // Swagger 2.0
  schema?: JsonSchemaLike;
  examples?: Record<string, unknown>;
  headers?: Record<string, { schema?: JsonSchemaLike; example?: unknown }>;
}

export interface ParseOpenApiOptions {
  /**
   * When the OpenAPI doc has multiple 2xx responses, this picks which one
   * becomes the mock. Default: the lowest numeric 2xx (200 wins over 201).
   */
  preferStatus?: number;
}

export interface ParseOpenApiResult {
  endpoints: MockEndpoint[];
  warnings: string[];
}

/**
 * One operation's request body, extracted by {@link parseOpenApiRequestBodies}.
 * Consumers (e.g. the Lens code-vs-spec contract-drift check) join it back to
 * the parsed endpoint table by `(method, path)`.
 */
export interface OpenApiRequestBodySpec {
  method: HttpMethod;
  path: string;
  /** The chosen media type — a JSON one is preferred when several are present. */
  contentType: string;
  schema: JsonSchemaLike;
  required: boolean;
}

export interface ParseOpenApiRequestBodiesResult {
  requestBodies: OpenApiRequestBodySpec[];
  warnings: string[];
}

/**
 * Parse an OpenAPI / Swagger 2.0 spec string and return the mock endpoint
 * table. `format` is a hint — the parser will fall back to JSON.parse if
 * YAML parse fails.
 *
 * The `$ref` dereferencer defaults to the browser-safe in-document resolver;
 * the Node entry point (`parseOpenApiToEndpointsNode`) injects swagger-parser
 * for full external-reference resolution.
 */
export async function parseOpenApiToEndpoints(
  source: string,
  format: 'json' | 'yaml' = 'json',
  opts: ParseOpenApiOptions = {},
  deps: ParseOpenApiDeps = {},
): Promise<ParseOpenApiResult> {
  const warnings: string[] = [];

  const raw = format === 'yaml' ? safeYamlLoad(source) : safeJsonParse(source);
  if (!raw || typeof raw !== 'object') {
    return { endpoints: [], warnings: ['Could not parse OpenAPI source'] };
  }

  // Dereference `$ref` chains up-front so downstream code can ignore refs
  // entirely. The dereferencer is injected (browser: in-document only;
  // Node: swagger-parser); it surfaces its own warnings (external refs it
  // couldn't resolve, cycles it broke).
  const dereference = deps.dereference ?? dereferenceInternal;
  const { doc, warnings: derefWarnings } = await dereference(raw);
  warnings.push(...derefWarnings);
  const api = (doc && typeof doc === 'object' ? doc : raw) as Record<string, unknown>;

  const paths = (api.paths ?? {}) as Record<string, Record<string, OpenApiOperation>>;
  const endpoints: MockEndpoint[] = [];
  let endpointId = 0;

  for (const [path, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== 'object') continue;
    // Path-item-level parameters apply to every operation under the path; an
    // operation's own parameters override them by (name, in).
    const pathItemParams = (ops as { parameters?: OpenApiParameter[] }).parameters ?? [];
    for (const method of Object.keys(ops)) {
      const upper = method.toUpperCase() as HttpMethod;
      if (!SUPPORTED_METHODS.includes(upper)) continue;
      const op = ops[method];
      if (!op || typeof op !== 'object') continue;

      const built = buildEndpointFromOp(
        path,
        upper,
        op,
        pathItemParams,
        opts,
        warnings,
        endpointId++,
      );
      if (built) endpoints.push(built);
    }
  }

  return { endpoints, warnings };
}

/**
 * Extract each operation's **request body** schema from an OpenAPI / Swagger
 * 2.0 spec — the one part of an operation's contract that the mock pipeline
 * deliberately drops. `MockEndpoint` carries no request-body shape (the mock
 * server never validates request bodies), so {@link parseOpenApiToEndpoints}
 * skips it; this returns it separately, leaving the mock endpoint shape
 * untouched.
 *
 * Callers that need an operation's full contract (e.g. the Lens code-vs-spec
 * contract-drift check) run this alongside {@link parseOpenApiToEndpoints} and
 * join the two by `(method, path)`. The `$ref` dereferencer is injected exactly
 * as there (browser: in-document; Node: swagger-parser via the
 * `parseOpenApiRequestBodiesNode` entry point).
 *
 * Each operation with a resolvable body yields `{ method, path, contentType,
 * schema, required }`:
 *   - OpenAPI 3.x — from `requestBody.content[mediaType].schema`, preferring a
 *     JSON media type (mirrors {@link pickResponsePayload}).
 *   - Swagger 2.0 — from the `in: 'body'` parameter's `schema`, with the
 *     content type taken from the operation's `consumes` (default JSON).
 *
 * Operations without a body (GET/DELETE, or a body with no resolvable schema)
 * are omitted from the result.
 */
export async function parseOpenApiRequestBodies(
  source: string,
  format: 'json' | 'yaml' = 'json',
  deps: ParseOpenApiDeps = {},
): Promise<ParseOpenApiRequestBodiesResult> {
  const warnings: string[] = [];

  const raw = format === 'yaml' ? safeYamlLoad(source) : safeJsonParse(source);
  if (!raw || typeof raw !== 'object') {
    return { requestBodies: [], warnings: ['Could not parse OpenAPI source'] };
  }

  // Same dereference contract as parseOpenApiToEndpoints: resolve `$ref`s
  // up-front (browser: in-document only; Node: swagger-parser) so the walk
  // below only ever sees inline schemas.
  const dereference = deps.dereference ?? dereferenceInternal;
  const { doc, warnings: derefWarnings } = await dereference(raw);
  warnings.push(...derefWarnings);
  const api = (doc && typeof doc === 'object' ? doc : raw) as Record<string, unknown>;

  const paths = (api.paths ?? {}) as Record<string, Record<string, OpenApiOperation>>;
  const requestBodies: OpenApiRequestBodySpec[] = [];

  for (const [path, ops] of Object.entries(paths)) {
    if (!ops || typeof ops !== 'object') continue;
    // Swagger 2.0 body params may live at the path-item level; merge them in
    // with operation-level precedence (as buildRequestSchema does for the
    // other param kinds).
    const pathItemParams = (ops as { parameters?: OpenApiParameter[] }).parameters ?? [];
    for (const method of Object.keys(ops)) {
      const upper = method.toUpperCase() as HttpMethod;
      if (!SUPPORTED_METHODS.includes(upper)) continue;
      const op = ops[method];
      if (!op || typeof op !== 'object') continue;

      const body = pickRequestBody(upper, path, op, pathItemParams);
      if (body) requestBodies.push(body);
    }
  }

  return { requestBodies, warnings };
}

/** Extract one operation's request body — OpenAPI 3.x `requestBody` first, then
 *  the Swagger 2.0 `in: 'body'` parameter (operation-level winning over
 *  path-item-level). Returns `null` when there's no resolvable body schema.
 *  Pure. */
function pickRequestBody(
  method: HttpMethod,
  path: string,
  op: OpenApiOperation,
  pathItemParams: OpenApiParameter[],
): OpenApiRequestBodySpec | null {
  // OpenAPI 3.x: `requestBody.content` keyed by media type — prefer JSON, the
  // same preference pickResponsePayload applies to responses.
  const requestBody = op.requestBody;
  if (requestBody?.content) {
    const content = requestBody.content;
    const mediaTypes = Object.keys(content);
    const preferred = mediaTypes.find((m) => m.toLowerCase().includes('json')) ?? mediaTypes[0];
    if (preferred) {
      const entry = content[preferred];
      if (entry.schema) {
        return {
          method,
          path,
          contentType: preferred,
          schema: entry.schema,
          required: requestBody.required ?? false,
        };
      }
    }
  }

  // Swagger 2.0: the body is a single `in: 'body'` parameter; its content type
  // comes from `consumes` (default JSON). Operation params are checked before
  // path-item params so an operation-level body wins.
  for (const p of [...(op.parameters ?? []), ...pathItemParams]) {
    if (p && p.in === 'body' && p.schema) {
      return {
        method,
        path,
        contentType: op.consumes?.[0] ?? 'application/json',
        schema: p.schema,
        required: typeof p.required === 'boolean' ? p.required : false,
      };
    }
  }

  return null;
}

/** Merge path-item + operation parameters (operation wins by name+in) and map
 *  them into a `MockRequestSchema`. Pure. */
function buildRequestSchema(
  pathItemParams: OpenApiParameter[],
  op: OpenApiOperation,
): MockRequestSchema {
  const merged = new Map<string, OpenApiParameter>();
  for (const p of [...pathItemParams, ...(op.parameters ?? [])]) {
    if (p && typeof p === 'object' && typeof p.name === 'string') {
      merged.set(`${p.in ?? 'query'}:${p.name}`, p);
    }
  }
  const schema = makeDefaultRequestSchema();
  for (const p of merged.values()) {
    const rawType = p.schema?.type ?? p.type;
    const typeHint = p.schema?.format ?? (Array.isArray(rawType) ? rawType[0] : rawType);
    const exampleVal = p.example ?? p.schema?.example;
    const def = paramDef(p.name as string, {
      typeHint: typeof typeHint === 'string' ? typeHint : undefined,
      required: typeof p.required === 'boolean' ? p.required : undefined,
      description: typeof p.description === 'string' ? p.description : undefined,
      example:
        exampleVal === undefined
          ? undefined
          : typeof exampleVal === 'string'
            ? exampleVal
            : JSON.stringify(exampleVal),
    });
    switch (p.in) {
      case 'path':
        schema.pathParams.push(def);
        break;
      case 'query':
        schema.queryParams.push(def);
        break;
      case 'header':
        schema.headers.push(def);
        break;
      case 'cookie':
        schema.cookies.push(def);
        break;
      default:
        // Swagger 2.0 `in: body` / `in: formData` aren't request-param schema
        // entries — skip them (the body shape is documented elsewhere).
        break;
    }
  }
  return schema;
}

function buildEndpointFromOp(
  path: string,
  method: HttpMethod,
  op: OpenApiOperation,
  pathItemParams: OpenApiParameter[],
  opts: ParseOpenApiOptions,
  warnings: string[],
  index: number,
): MockEndpoint | null {
  const responses = op.responses ?? {};
  const candidates = Object.keys(responses)
    .filter((code) => /^2\d\d$/.test(code))
    .map((code) => Number(code));
  if (candidates.length === 0) {
    warnings.push(`No 2xx response defined for ${method} ${path} — skipping`);
    return null;
  }
  const status = opts.preferStatus
    ? candidates.includes(opts.preferStatus)
      ? opts.preferStatus
      : Math.min(...candidates)
    : Math.min(...candidates);
  const response = responses[String(status)];
  if (!response) {
    warnings.push(`Response ${status} missing for ${method} ${path}`);
    return null;
  }

  const { contentType, body, exampleName } = pickResponsePayload(response, op);

  const headers = pickResponseHeaders(response, contentType);

  return buildMockEndpoint({
    id: `op-${index}-${method.toLowerCase()}-${slug(path)}`,
    method,
    pathPattern: path,
    example: exampleName,
    requestSchema: buildRequestSchema(pathItemParams, op),
    response: { status, headers, body },
  });
}

function pickResponsePayload(
  response: OpenApiResponse,
  op: OpenApiOperation,
): { contentType: string; body: string; exampleName: string | undefined } {
  // OpenAPI 3.x: `response.content` is keyed by media type.
  if (response.content) {
    const mediaTypes = Object.keys(response.content);
    const preferred =
      mediaTypes.find((m) => m.toLowerCase().includes('json')) ??
      mediaTypes[0] ??
      'application/json';
    const entry = response.content[preferred];
    if (entry) {
      if (entry.example !== undefined) {
        return {
          contentType: preferred,
          body: stringifyForContentType(entry.example, preferred),
          exampleName: undefined,
        };
      }
      if (entry.examples) {
        const firstExampleName = Object.keys(entry.examples)[0];
        if (firstExampleName) {
          const v = entry.examples[firstExampleName];
          return {
            contentType: preferred,
            body: stringifyForContentType(v?.value, preferred),
            exampleName: firstExampleName,
          };
        }
      }
      if (entry.schema) {
        return {
          contentType: preferred,
          body: stringifyForContentType(schemaToExample(entry.schema), preferred),
          exampleName: undefined,
        };
      }
    }
  }

  // Swagger 2.0 fallback.
  if (response.schema) {
    const ct = (op.produces && op.produces[0]) ?? 'application/json';
    return {
      contentType: ct,
      body: stringifyForContentType(schemaToExample(response.schema), ct),
      exampleName: undefined,
    };
  }
  if (response.examples) {
    const firstName = Object.keys(response.examples)[0];
    if (firstName) {
      const v = response.examples[firstName];
      return {
        contentType: firstName,
        body: stringifyForContentType(v, firstName),
        exampleName: firstName,
      };
    }
  }

  return {
    contentType: 'application/json',
    body: '{}',
    exampleName: undefined,
  };
}

type ParsedHeader = { key: string; value: string };

function pickResponseHeaders(response: OpenApiResponse, contentType: string): ParsedHeader[] {
  const headers: ParsedHeader[] = [{ key: 'Content-Type', value: contentType }];
  if (response.headers) {
    for (const [name, def] of Object.entries(response.headers)) {
      if (name.toLowerCase() === 'content-type') continue;
      const value = def.example !== undefined ? def.example : schemaToExample(def.schema);
      if (value === undefined || value === null) continue;
      // Header values must be strings. Strings pass through; everything
      // else gets JSON-encoded — covers objects/arrays/numbers/booleans
      // without ever falling back to "[object Object]".
      const text = typeof value === 'string' ? value : JSON.stringify(value);
      headers.push({ key: name, value: text });
    }
  }
  return headers;
}

function stringifyForContentType(value: unknown, contentType: string): string {
  if (value === undefined || value === null) return '';
  if (typeof value === 'string') return value;
  if (contentType.toLowerCase().includes('json')) {
    return JSON.stringify(value, null, 2);
  }
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

function slug(s: string): string {
  return (
    s
      .replace(/[^a-z0-9]+/gi, '-')
      .replace(/^-|-$/g, '')
      .toLowerCase() || 'root'
  );
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}

function safeYamlLoad(s: string): unknown {
  try {
    return yaml.load(s);
  } catch {
    return safeJsonParse(s);
  }
}
