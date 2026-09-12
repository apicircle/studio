// Node-only OpenAPI parse entry point.
//
// Wraps the isomorphic `parseOpenApiToEndpoints` with swagger-parser as the
// `$ref` dereferencer for the Desktop main process, CLI, MCP server, and VS Code
// extension host. The browser build never imports this module — it uses the
// in-document resolver baked into `openapi.ts` — so swagger-parser (~1 MB,
// Node-oriented) stays out of the web bundle.
//
// **In-document refs only.** A spec always arrives here as an in-memory string:
// a pasted document, a workspace spec asset, a mock source pulled from git, an
// MCP or CLI argument. None of those carries a base directory worth trusting,
// and json-schema-ref-parser resolves a relative ref against the PROCESS
// working directory — the customer repo for the CLI, the install directory for
// the Desktop app. On its defaults it follows any `$ref` in the document, an
// `example` value included (where OpenAPI means the ref as literal data), reads
// that file or opens that connection, and inlines the content — which then ends
// up in a mock response body or a collection example that git sync can push. So
// external resolution stays off: `resolve.external: false` keeps the file and
// http resolvers out of the run entirely, and every ref left unresolved is named
// in a warning rather than fetched behind the user's back.

import SwaggerParser from '@apidevtools/swagger-parser';
import { dereferenceInternal } from './refDeref';
import {
  parseOpenApiToEndpoints,
  parseOpenApiRequestBodies,
  type ParseOpenApiOptions,
  type ParseOpenApiResult,
  type ParseOpenApiRequestBodiesResult,
} from './openapi';

/** An external `$ref` is one whose target is another document — anything that
 *  doesn't start with `#` (the same test json-schema-ref-parser applies). */
function isExternalRef(ref: unknown): ref is string {
  return typeof ref === 'string' && !ref.startsWith('#');
}

/** Every distinct external `$ref` in the document, in the order the walk meets
 *  them. Iterative, and skipping nodes it has already seen, so neither a deeply
 *  nested document nor a YAML alias graph (js-yaml returns one shared object per
 *  anchor) can make this throw or blow up. */
function collectExternalRefs(root: unknown): string[] {
  const refs: string[] = [];
  const seenRefs = new Set<string>();
  const seenNodes = new Set<object>();
  const queue: unknown[] = [root];

  for (let i = 0; i < queue.length; i += 1) {
    const node = queue[i];
    if (!node || typeof node !== 'object') continue;
    if (seenNodes.has(node)) continue;
    seenNodes.add(node);

    const ref = (node as Record<string, unknown>).$ref;
    if (isExternalRef(ref) && !seenRefs.has(ref)) {
      seenRefs.add(ref);
      refs.push(ref);
    }
    // Object.values covers array elements too, so arrays need no special case.
    for (const value of Object.values(node)) queue.push(value);
  }

  return refs;
}

async function swaggerDereference(root: unknown) {
  try {
    // Collected before the call: swagger-parser dereferences in place, and the
    // pristine document is the cheaper one to walk.
    const warnings = collectExternalRefs(root).map(
      (ref) =>
        `External $ref not resolved: "${ref}". Spec parsing never reads files or opens ` +
        `network connections — inline the referenced definition into this document.`,
    );
    // swagger-parser mutates `$ref` chains in place and returns the doc.
    // Its types assume a path input + an `info` block, narrower than our
    // in-memory object, so cast through unknown.
    //
    // `resolve.external: false` makes json-schema-ref-parser skip its resolve
    // pass outright — no file or http resolver is consulted, external refs stay
    // in the document as written, and in-document pointers (circular ones
    // included) resolve exactly as they did before.
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const doc = (await (SwaggerParser as any).dereference(root, {
      resolve: { external: false },
    })) as unknown;
    return { doc, warnings };
  } catch (err) {
    // Fall back to the in-document resolver so a spec swagger-parser rejects
    // (e.g. a validation quirk) still yields the internal-ref shape rather
    // than raw `$ref` objects. It reports the external refs itself, under the
    // same never-fetched contract.
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
 *  request-body schemas behind in-document `$ref`s resolve on the Desktop main,
 *  CLI, MCP, and VS Code host surfaces. */
export function parseOpenApiRequestBodiesNode(
  source: string,
  format: 'json' | 'yaml' = 'json',
): Promise<ParseOpenApiRequestBodiesResult> {
  return parseOpenApiRequestBodies(source, format, { dereference: swaggerDereference });
}
