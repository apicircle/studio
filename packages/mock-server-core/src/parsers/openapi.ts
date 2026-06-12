// OpenAPI / Swagger 2.0 → MockEndpoint[] parser.
//
// Two-step pipeline:
//   1. Parse the source string (JSON or YAML) and run swagger-parser's
//      `dereference` so all `$ref` chains are resolved up-front. The mock
//      server doesn't carry a $ref resolver at runtime — every endpoint
//      ships a self-contained body.
//   2. Walk `paths.{path}.{method}.responses.{status}.content.{mediaType}`
//      and pull either an `example`, the first `examples` entry, or
//      synthesize one from the schema via `schemaToExample`.
//
// We pick the lowest 2xx response when multiple are present (200 wins
// over 201; if neither, take the first 2xx). Errors and 5xx are ignored
// — mock servers should default to the success path; users override via
// the editor when they want failure cases.

import SwaggerParser from '@apidevtools/swagger-parser';
import yaml from 'js-yaml';
import type { HttpMethod, MockEndpoint, MockRequestSchema } from '@apicircle/shared';
import { makeDefaultRequestSchema } from '@apicircle/shared';
import { schemaToExample, type JsonSchemaLike } from '../faker/schemaToExample';
import { paramDef } from './buildEndpoint';
import { buildMockEndpoint } from './buildEndpoint';

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
  // Swagger 2.0 carries `produces` here; we honor it as a fallback for
  // content-type when `responses[status].content` is absent.
  produces?: string[];
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
 * Parse an OpenAPI / Swagger 2.0 spec string and return the mock endpoint
 * table. `format` is a hint — the parser will fall back to JSON.parse if
 * YAML parse fails.
 */
export async function parseOpenApiToEndpoints(
  source: string,
  format: 'json' | 'yaml' = 'json',
  opts: ParseOpenApiOptions = {},
): Promise<ParseOpenApiResult> {
  const warnings: string[] = [];

  const raw = format === 'yaml' ? safeYamlLoad(source) : safeJsonParse(source);
  if (!raw || typeof raw !== 'object') {
    return { endpoints: [], warnings: ['Could not parse OpenAPI source'] };
  }

  // SwaggerParser.dereference takes either a path or an in-memory object
  // and mutates `$ref` chains in place so downstream code can ignore refs
  // entirely. Cast through unknown — the SDK's types are narrower than we
  // need (they assume a path input and an `info` block).
  let api: Record<string, unknown>;
  try {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const dereffed = await (SwaggerParser as any).dereference(raw);
    api = dereffed as Record<string, unknown>;
  } catch (err) {
    warnings.push(
      `swagger-parser failed: ${err instanceof Error ? err.message : 'unknown error'}; ` +
        'falling back to raw spec',
    );
    api = raw as Record<string, unknown>;
  }

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
