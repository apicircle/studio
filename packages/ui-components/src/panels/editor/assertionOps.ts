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
  return { op };
}
