// Browser-safe internal `$ref` dereferencer.
//
// The Node build resolves `$ref` chains with `@apidevtools/swagger-parser`,
// which can follow refs into other files and remote URLs — but that pulls in
// ~1 MB of Node-oriented dependencies (fs / path / http resolvers) that cannot
// run in the browser. The web app never has a filesystem or a base path for a
// pasted spec anyway, so external resolution was never meaningful there.
//
// This resolver handles the one case that matters for an in-memory,
// single-document spec: **in-document JSON Pointer refs** (`#/components/...`
// on OpenAPI 3, `#/definitions/...` on Swagger 2.0). It:
//   • deep-clones the doc with every internal `$ref` inlined,
//   • breaks reference cycles by substituting `{}` (so the downstream
//     `schemaToExample` walk — which has no cycle guard — can never loop),
//   • leaves external refs (anything not starting with `#/`) in place and
//     reports each once as a warning so the web import UI can tell the user
//     to use the Desktop app / CLI / VS Code for full resolution.

export interface DereferenceResult {
  doc: unknown;
  warnings: string[];
}

/** Decode a single JSON Pointer segment (`~1` → `/`, `~0` → `~`). */
function decodeSegment(seg: string): string {
  return seg.replace(/~1/g, '/').replace(/~0/g, '~');
}

/**
 * Resolve in-document `$ref`s against `root`. Pure — returns a new document
 * and never mutates the input. See the module header for the external-ref /
 * cycle contract.
 */
export function dereferenceInternal(root: unknown): DereferenceResult {
  const warnings: string[] = [];
  const externalSeen = new Set<string>();
  const unresolvedSeen = new Set<string>();

  if (!root || typeof root !== 'object') return { doc: root, warnings };

  const resolvePointer = (ref: string): unknown => {
    // Strip the leading "#/" then walk the remaining pointer segments.
    const segments = ref.slice(2).split('/').map(decodeSegment);
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

  // `stack` holds the refs currently being expanded along THIS path, so a
  // ref that points back into its own ancestry (a cycle) is caught and
  // broken. A ref reused across sibling branches is not a cycle — each
  // branch expands with its own stack copy.
  const walk = (node: unknown, stack: Set<string>): unknown => {
    if (Array.isArray(node)) return node.map((child) => walk(child, stack));
    if (!node || typeof node !== 'object') return node;

    const obj = node as Record<string, unknown>;
    const ref = obj.$ref;
    if (typeof ref === 'string') {
      if (!ref.startsWith('#/')) {
        if (!externalSeen.has(ref)) {
          externalSeen.add(ref);
          warnings.push(
            `External $ref not resolved in the web app: "${ref}". Open this mock in the ` +
              `Desktop app, CLI, or VS Code extension for full external reference resolution.`,
          );
        }
        return obj;
      }
      if (stack.has(ref)) {
        // Circular reference — break the cycle.
        return {};
      }
      const target = resolvePointer(ref);
      if (target === undefined) {
        if (!unresolvedSeen.has(ref)) {
          unresolvedSeen.add(ref);
          warnings.push(`Unresolved internal $ref: "${ref}"`);
        }
        return {};
      }
      const nextStack = new Set(stack);
      nextStack.add(ref);
      return walk(target, nextStack);
    }

    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
      out[key] = walk(value, stack);
    }
    return out;
  };

  return { doc: walk(root, new Set<string>()), warnings };
}
