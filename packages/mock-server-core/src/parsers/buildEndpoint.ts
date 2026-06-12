// Helpers shared by every parser (OpenAPI / Postman / Insomnia) that wrap
// the legacy "flat" parsed shape (status / headers / body string) into the
// current `MockEndpoint` schema (defaultResponse + responseRules + validation).
//
// Parsers stay agnostic about validation / response rules — those are
// authoring-time concerns. They emit endpoints with empty `requestValidation`
// and `responseRules` and a single `defaultResponse` that holds the parsed
// 2xx (OpenAPI) / first example (Postman/Insomnia) payload.

import type {
  HttpMethod,
  MockEndpoint,
  MockParamDef,
  MockRequestSchema,
  MockResponseBody,
  MockResponseBodyType,
  MockResponseConfig,
} from '@apicircle/shared';
import { generateId, makeDefaultRequestSchema } from '@apicircle/shared';

export interface ParsedResponseShape {
  status: number;
  /** Wire-shape headers — `enabled` is added when wrapping into the endpoint. */
  headers: Array<{ key: string; value: string }>;
  body: string;
  /** Optional artificial latency. */
  delayMs?: number;
}

export interface BuildEndpointInput {
  id: string;
  /** User-friendly label; defaults to "{METHOD} {pathPattern}" when omitted. */
  name?: string;
  method: HttpMethod;
  pathPattern: string;
  description?: string;
  example?: string;
  response: ParsedResponseShape;
  /** Declared inputs extracted from the spec (path / query / header / cookie
   *  params + body docs). Defaults to an empty schema when the source carries
   *  no parameters. */
  requestSchema?: MockRequestSchema;
}

/** Build a `MockParamDef` with a fresh id. Shared by the OpenAPI / Postman /
 *  Insomnia parsers so an imported endpoint's declared params land in the
 *  requestSchema editor (VS Code / Web / Desktop / MCP). */
export function paramDef(
  name: string,
  opts?: { typeHint?: string; required?: boolean; description?: string; example?: string },
): MockParamDef {
  return {
    id: generateId(),
    name,
    typeHint: opts?.typeHint,
    required: opts?.required,
    description: opts?.description,
    example: opts?.example,
  };
}

function bodyTypeForContentType(contentType: string | undefined): MockResponseBodyType {
  if (!contentType) return 'json';
  const main = contentType.toLowerCase().split(';')[0]?.trim() ?? '';
  if (main.includes('json')) return 'json';
  if (main.includes('xml')) return 'xml';
  if (main === 'application/x-www-form-urlencoded') return 'urlencoded';
  if (main === 'multipart/form-data') return 'form-data';
  if (main === 'application/octet-stream') return 'binary';
  if (main.startsWith('text/')) return 'text';
  return 'text';
}

function bodyFromString(content: string, type: MockResponseBodyType): MockResponseBody {
  switch (type) {
    case 'none':
      return { type: 'none', content: '' };
    case 'binary':
      return { type: 'binary', content: '' };
    case 'form-data':
      return { type: 'form-data', content: '', formRows: [] };
    default:
      return { type, content };
  }
}

/** Wrap a flat status/headers/body parse into a `MockResponseConfig`. */
function buildMockResponse(parsed: ParsedResponseShape): MockResponseConfig {
  const contentType = parsed.headers.find((h) => h.key.toLowerCase() === 'content-type')?.value;
  const bodyType = bodyTypeForContentType(contentType);
  return {
    status: parsed.status,
    headers: parsed.headers.map((h) => ({ ...h, enabled: true })),
    body: bodyFromString(parsed.body, bodyType),
    ...(parsed.delayMs !== undefined ? { delayMs: parsed.delayMs } : {}),
  };
}

/** Compose a new `MockEndpoint` with sensible empty defaults for the rest. */
export function buildMockEndpoint(input: BuildEndpointInput): MockEndpoint {
  return {
    id: input.id,
    name: input.name ?? `${input.method} ${input.pathPattern}`,
    method: input.method,
    pathPattern: input.pathPattern,
    description: input.description,
    requestSchema: input.requestSchema ?? makeDefaultRequestSchema(),
    requestValidation: [],
    responseRules: [],
    defaultResponse: buildMockResponse(input.response),
    example: input.example,
  };
}
