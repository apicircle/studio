// Browser-safe internal `$ref` dereferencer.
//
// The Node build resolves `$ref` chains with `@apidevtools/swagger-parser`,
// which pulls in ~1 MB of Node-oriented dependencies (fs / path / http
// resolvers) that cannot run in the browser. The web app has no filesystem and
// no base path for a pasted spec, so there is nothing here for those resolvers
// to do — and the Node build turns external resolution off too, for the same
// reason: an in-memory spec carries no base path worth trusting.
//
// This resolver handles the one case that matters for an in-memory,
// single-document spec: **in-document JSON Pointer refs** (`#/components/...`
// on OpenAPI 3, `#/definitions/...` on Swagger 2.0). It:
//   • copies the doc with every internal `$ref` inlined — ONCE per node. Every
//     use of a `$ref` shares one resolved object, and a node the input already
//     shares (js-yaml hands back one object per YAML anchor) stays shared in the
//     copy. The result is a DAG no larger than the input, so a few KB of `$ref`
//     or alias fan-out can no longer expand past memory here. Whoever walks the
//     result as a tree bounds that walk itself: `faker/schemaToExample.ts`
//     spends a per-operation budget,
//   • breaks reference cycles where the walk meets a node it is still copying,
//     so the result never contains a cycle. The break is the schema
//     `{ "x-apicircle-unresolved": "cycle" }` — an empty schema to every
//     validator and example generator (an unknown keyword constrains nothing),
//     and a marker a contract reader can tell apart from a schema that really
//     is `{}`. A pointer that leads nowhere becomes
//     `{ "x-apicircle-unresolved": "missing" }` the same way,
//   • leaves external refs (anything not starting with `#/`) in place and
//     reports each once as a warning. No surface follows them: a spec always
//     reaches us as an in-memory string with no trustworthy base directory,
//     so the Node build disables external resolution too (`openapiNode.ts`).
//     The files a split spec points at reach the parsers only as text someone
//     supplied, bundled into the document first (`specBundle.ts`).

export interface DereferenceResult {
  doc: unknown;
  warnings: string[];
}

/** The key a schema the resolver could not produce carries, with the reason. */
export const UNRESOLVED_KEY = 'x-apicircle-unresolved';

/** Why a schema was left unresolved: a reference cycle was broken there, an
 *  in-document pointer led nowhere, or (stamped by the request-body reader in
 *  `openapi.ts`) an external `$ref` named a document nobody supplied. */
export type UnresolvedReason = 'cycle' | 'missing' | 'external-ref';

/** The schema standing in for one the resolver could not produce. */
function unresolved(reason: UnresolvedReason): Record<string, unknown> {
  return { [UNRESOLVED_KEY]: reason };
}

/**
 * Decode one JSON Pointer segment taken from a URI fragment: percent-decoding
 * first, then `~1` → `/` and `~0` → `~` (RFC 6901 §4, §6). A stray `%` stays literal.
 */
export function decodePointerSegment(seg: string): string {
  let decoded = seg;
  try {
    decoded = decodeURIComponent(seg);
  } catch {
    // not a valid percent-encoding: the segment is read as written
  }
  return decoded.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Resolve in-document `$ref`s against `root`. Pure — returns a new document
 * and never mutates the input. See the module header for the sharing /
 * external-ref / cycle contract.
 */
export function dereferenceInternal(root: unknown): DereferenceResult {
  const warnings: string[] = [];
  const externalSeen = new Set<string>();
  const unresolvedSeen = new Set<string>();

  if (!root || typeof root !== 'object') return { doc: root, warnings };

  const resolvePointer = (ref: string): unknown => {
    // Strip the leading "#/" then walk the remaining pointer segments.
    const segments = ref.slice(2).split('/').map(decodePointerSegment);
    let cur: unknown = root;
    for (const seg of segments) {
      if (cur && typeof cur === 'object' && seg in (cur as Record<string, unknown>)) {
        cur = (cur as Record<string, unknown>)[seg];
      } else {
        return undefined;
      }
    }
    return cur;
  };

  // Each input node is copied once: `copies` maps it to its copy, so a node met
  // again — the target of a `$ref` used many times, or a YAML alias — resolves
  // to the copy already built. `onPath` holds the nodes being copied along the
  // current path; meeting one of THOSE again is a cycle, broken with `{}`. A
  // `$ref` object is a node like any other, so a chain of refs that leads back
  // to itself is caught the same way.
  const copies = new Map<object, unknown>();
  const onPath = new Set<object>();

  const resolveRef = (obj: Record<string, unknown>, ref: string): unknown => {
    if (!ref.startsWith('#/')) {
      if (!externalSeen.has(ref)) {
        externalSeen.add(ref);
        warnings.push(
          `External $ref not resolved: "${ref}". Spec parsing never reads files or opens ` +
            `network connections — upload the file it points at under the spec's ` +
            `Referenced files, or inline the definition into this document.`,
        );
      }
      return obj;
    }
    const target = resolvePointer(ref);
    if (target === undefined) {
      if (!unresolvedSeen.has(ref)) {
        unresolvedSeen.add(ref);
        warnings.push(`Unresolved internal $ref: "${ref}"`);
      }
      return unresolved('missing');
    }
    return walk(target);
  };

  const copy = (node: object): unknown => {
    if (Array.isArray(node)) return node.map((child: unknown) => walk(child));
    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === 'string') return resolveRef(obj, ref);
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = walk(value);
    }
    return out;
  };

  const walk = (node: unknown): unknown => {
    if (!node || typeof node !== 'object') return node;
    // Circular reference — break the cycle.
    if (onPath.has(node)) return unresolved('cycle');
    if (copies.has(node)) return copies.get(node);
    onPath.add(node);
    const out = copy(node);
    onPath.delete(node);
    copies.set(node, out);
    return out;
  };

  return { doc: walk(root), warnings };
}
