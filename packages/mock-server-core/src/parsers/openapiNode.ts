// Node-only OpenAPI parse entry point.
//
// Wraps the isomorphic `parseOpenApiToEndpoints` with swagger-parser as the
// `$ref` dereferencer so the Desktop main process, CLI, MCP server, and VS
// Code extension host get full external-file / remote reference resolution.
// The browser build never imports this module — it uses the in-document
// resolver baked into `openapi.ts` — so swagger-parser (~1 MB, Node-oriented)
// stays out of the web bundle.

import SwaggerParser from '@apidevtools/swagger-parser';
import { dereferenceInternal } from './refDeref';
import {
  parseOpenApiToEndpoints,
  parseOpenApiRequestBodies,
  type ParseOpenApiOptions,
  type ParseOpenApiResult,
  type ParseOpenApiRequestBodiesResult,
} from './openapi';

async function swaggerDereference(root: unknown) {
  try {
    // swagger-parser mutates `$ref` chains in place and returns the doc.
    // Its types assume a path input + an `info` block, narrower than our
    // in-memory object, so cast through unknown.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (await (SwaggerParser as any).dereference(root)) as unknown;
    return { doc, warnings: [] as string[] };
  } catch (err) {
    // Fall back to the in-document resolver so a spec swagger-parser rejects
    // (e.g. a validation quirk) still yields the internal-ref shape rather
    // than raw `$ref` objects.
    const fallback = dereferenceInternal(root);
    return {
      doc: fallback.doc,
      warnings: [
        `swagger-parser failed: ${err instanceof Error ? err.message : 'unknown error'}; ` +
          'falling back to in-document reference resolution',
        ...fallback.warnings,
      ],
    };
  }
}

/** Node variant of {@link parseOpenApiToEndpoints} using swagger-parser. */
export function parseOpenApiToEndpointsNode(
  source: string,
  format: 'json' | 'yaml' = 'json',
  opts: ParseOpenApiOptions = {},
): Promise<ParseOpenApiResult> {
  return parseOpenApiToEndpoints(source, format, opts, { dereference: swaggerDereference });
}

/** Node variant of {@link parseOpenApiRequestBodies} using swagger-parser, so
 *  request-body schemas behind external / remote `$ref`s resolve fully on the
 *  Desktop main, CLI, MCP, and VS Code host surfaces. */
export function parseOpenApiRequestBodiesNode(
  source: string,
  format: 'json' | 'yaml' = 'json',
): Promise<ParseOpenApiRequestBodiesResult> {
  return parseOpenApiRequestBodies(source, format, { dereference: swaggerDereference });
}
