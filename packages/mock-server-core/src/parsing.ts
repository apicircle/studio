// Browser-safe parsing entry point for @apicircle/mock-server-core.
//
// Exposes the spec → MockEndpoint[] half of the engine WITHOUT the Node
// runtime (Hono node-server, port finder) or swagger-parser. Import this
// from browser/renderer code (the web + desktop UI in `@apicircle/ui-
// components`); import the package root (`index.ts`) from Node surfaces
// (CLI, MCP, Desktop main, VS Code host) to get full external-`$ref`
// resolution via swagger-parser.
//
// Subpath: `@apicircle/mock-server-core/parsing`.

import type { MockServerSource, MockEndpoint } from '@apicircle/shared';
import { parseOpenApiToEndpoints, type ParseOpenApiResult } from './parsers/openapi';
import { parsePostmanToEndpoints } from './parsers/postman';
import { parseInsomniaToEndpoints } from './parsers/insomnia';

export { parseOpenApiToEndpoints } from './parsers/openapi';
export type {
  ParseOpenApiOptions,
  ParseOpenApiResult,
  DereferenceFn,
  ParseOpenApiDeps,
} from './parsers/openapi';
export { parsePostmanToEndpoints } from './parsers/postman';
export { parseInsomniaToEndpoints } from './parsers/insomnia';
export { schemaToExample } from './faker/schemaToExample';
export type { JsonSchemaLike } from './faker/schemaToExample';
export { dereferenceInternal, type DereferenceResult } from './parsers/refDeref';

export interface ParseSourceResult {
  endpoints: MockEndpoint[];
  warnings: string[];
}

/** Signature of an OpenAPI parser, so the source dispatch can be pointed at
 *  either the browser-safe or the swagger-parser-backed implementation. */
export type OpenApiParser = (spec: string, format: 'json' | 'yaml') => Promise<ParseOpenApiResult>;

/**
 * Shared source dispatch. `openApiParser` defaults to the browser-safe
 * in-document parser; the Node index injects the swagger-parser variant so
 * the same switch serves both surfaces without duplication.
 */
export async function parseSourceToEndpointsWith(
  source: MockServerSource,
  openApiParser: OpenApiParser = (spec, format) => parseOpenApiToEndpoints(spec, format),
): Promise<ParseSourceResult> {
  switch (source.kind) {
    case 'openapi':
      return openApiParser(source.spec, source.format);
    case 'postman':
      return parsePostmanToEndpoints(source.collection);
    case 'insomnia':
      return parseInsomniaToEndpoints(source.export);
    case 'manual':
      return { endpoints: source.endpoints, warnings: [] };
  }
}

/**
 * Browser-safe source dispatch — resolves in-document `$ref`s only. External
 * (other-file / remote) refs are left unresolved and reported as warnings.
 * The caller persists `endpoints` onto `MockServer.endpoints`.
 */
export function parseSourceToEndpoints(source: MockServerSource): Promise<ParseSourceResult> {
  return parseSourceToEndpointsWith(source);
}
