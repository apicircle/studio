// =============================================================================
// Shared structural guards for the apicircle:// YAML parsers.
//
// The parsers tolerate a lot of value-level slop (coercing + warning), but a
// renamed / mistyped TOP-LEVEL key is a different class of mistake: the parser
// would silently drop the whole section on save (e.g. `defaultRespons:` →
// the endpoint loses its default response). These helpers let each parser
// reject that structural drift so the FS provider blocks the save with a clear
// message instead of committing the data loss.
// =============================================================================

/** Top-level keys present in `obj` that aren't in the `known` allowlist. */
export function unknownTopLevelKeys(
  obj: Record<string, unknown>,
  known: readonly string[],
): string[] {
  const allow = new Set(known);
  return Object.keys(obj).filter((k) => !allow.has(k));
}

/** True when `value` is present (not undefined/null) but not an array. */
export function isPresentNonArray(value: unknown): boolean {
  return value !== undefined && value !== null && !Array.isArray(value);
}

/** True when `value` is present (not undefined/null) but not a plain mapping. */
export function isPresentNonMapping(value: unknown): boolean {
  return (
    value !== undefined && value !== null && (typeof value !== 'object' || Array.isArray(value))
  );
}
