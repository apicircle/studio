import type { Assertion } from '@apicircle/shared';

/** JSON type names offered by the `type` operator's value picker. */
export const JSON_TYPES = ['string', 'number', 'boolean', 'array', 'object', 'null'] as const;

/**
 * Switching the operator reshapes `expected`: `exists` needs no value (cleared),
 * `type` needs a JSON-type name (seeded to `string` unless it already is one), and
 * every comparison op keeps whatever value is there. Shared by the request editor's
 * AssertionsTab and the linked-workspace override editor so both reshape identically.
 */
export function opChangePatch(current: Assertion, op: Assertion['op']): Partial<Assertion> {
  if (op === 'exists') return { op, expected: '' };
  if (op === 'type') {
    const alreadyType = (JSON_TYPES as readonly string[]).includes(String(current.expected));
    return { op, expected: alreadyType ? current.expected : 'string' };
  }
  if (op === 'matches-schema') return { op, expected: schemaSeed(current.expected) };
  return { op };
}

/** A default `expected` for a `matches-schema` op — keep an existing JSON-object string, else seed
 *  an empty object schema (`{}`, which accepts anything until the user fills it in). */
function schemaSeed(expected: Assertion['expected']): string {
  return typeof expected === 'string' && expected.trim().startsWith('{') ? expected : '{}';
}

/**
 * Switching the KIND reshapes op + expected: `json-schema` requires the `matches-schema` op and a
 * JSON-schema string; leaving `json-schema` (where op was `matches-schema`, invalid elsewhere)
 * resets to a plain `equals` comparison. Other kind switches keep the current op/value.
 */
export function kindChangePatch(current: Assertion, kind: Assertion['kind']): Partial<Assertion> {
  if (kind === 'json-schema')
    return { kind, op: 'matches-schema', expected: schemaSeed(current.expected) };
  if (current.op === 'matches-schema') return { kind, op: 'equals', expected: '' };
  return { kind };
}
