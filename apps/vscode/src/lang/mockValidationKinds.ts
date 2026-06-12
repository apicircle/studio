import type { MockRequestSchema, MockValidationKind, MockValidationRule } from '@apicircle/shared';
import { getHeaderValues, suggestHeaders } from '@apicircle/core';

// =============================================================================
// Single source of truth for the mock pre-request validation kinds.
//
// Shared by the endpoint CodeLens provider (which gates the per-field
// ◆ Kind / ◆ Target / ◆ Value lenses) and the mockEndpointEdits commands
// (which reshape a rule when the kind changes). Keeping the table — and the
// pure reshaping logic — in one place means the lens and the command can
// never disagree about whether a kind needs a target / expected value.
// =============================================================================

export interface ValidationKindDef {
  kind: MockValidationKind;
  /** Quick-pick label. */
  label: string;
  /** Quick-pick description / hover. */
  description: string;
  /** Does this kind validate a named header / query / cookie? */
  needsTarget: boolean;
  /** Does this kind compare against an expected literal / regex? */
  needsExpected: boolean;
  /**
   * Placeholder target seeded when switching INTO this kind from a kind that
   * had no (or an empty) target. Header kinds suggest a common API-key header;
   * query kinds an `apiKey` param; cookie a `session` cookie. Kinds that don't
   * use a target seed `''`.
   */
  defaultTarget: string;
}

export const VALIDATION_KINDS: readonly ValidationKindDef[] = [
  {
    kind: 'header-required',
    label: 'Header — required',
    description: 'Header MUST be present.',
    needsTarget: true,
    needsExpected: false,
    defaultTarget: 'X-Api-Key',
  },
  {
    kind: 'header-equals',
    label: 'Header — equals',
    description: 'Header value equals an expected string.',
    needsTarget: true,
    needsExpected: true,
    defaultTarget: 'X-Api-Key',
  },
  {
    kind: 'header-matches',
    label: 'Header — matches regex',
    description: 'Header value matches a regex.',
    needsTarget: true,
    needsExpected: true,
    defaultTarget: 'X-Api-Key',
  },
  {
    kind: 'query-required',
    label: 'Query — required',
    description: 'Query param MUST be present.',
    needsTarget: true,
    needsExpected: false,
    defaultTarget: 'apiKey',
  },
  {
    kind: 'query-equals',
    label: 'Query — equals',
    description: 'Query param value equals an expected string.',
    needsTarget: true,
    needsExpected: true,
    defaultTarget: 'apiKey',
  },
  {
    kind: 'query-matches',
    label: 'Query — matches regex',
    description: 'Query param value matches a regex.',
    needsTarget: true,
    needsExpected: true,
    defaultTarget: 'apiKey',
  },
  {
    kind: 'cookie-required',
    label: 'Cookie — required',
    description: 'Cookie MUST be present.',
    needsTarget: true,
    needsExpected: false,
    defaultTarget: 'session',
  },
  {
    kind: 'body-required',
    label: 'Body — required',
    description: 'Request must include a non-empty body.',
    needsTarget: false,
    needsExpected: false,
    defaultTarget: '',
  },
  {
    kind: 'content-type-equals',
    label: 'Content-Type — equals',
    description: 'Request Content-Type matches an expected value.',
    needsTarget: false,
    needsExpected: true,
    defaultTarget: '',
  },
];

const KIND_BY_NAME = new Map<string, ValidationKindDef>(VALIDATION_KINDS.map((d) => [d.kind, d]));

export function validationKindDef(kind: string): ValidationKindDef | undefined {
  return KIND_BY_NAME.get(kind);
}

/** Whether a kind validates a named target and/or compares an expected value.
 *  Unknown kinds default to `{ target: true, expected: false }` so a
 *  hand-edited YAML with a typo'd kind still surfaces the target lens. */
export function validationKindNeeds(kind: string): { target: boolean; expected: boolean } {
  const def = KIND_BY_NAME.get(kind);
  if (!def) return { target: true, expected: false };
  return { target: def.needsTarget, expected: def.needsExpected };
}

/**
 * Reshape a validation rule when its kind changes:
 *  - drop the target when the new kind has none; seed a placeholder when the
 *    new kind needs one and the current target is blank;
 *  - drop `expected` when the new kind doesn't compare a value; seed an empty
 *    `expected` (so the YAML renders an `expected:` row + its ◆ Value lens)
 *    when the new kind needs one and none is set.
 *
 * Pure — returns a new rule, never mutates the input.
 */
export function applyValidationKindChange(
  rule: MockValidationRule,
  newKind: MockValidationKind,
): MockValidationRule {
  const needs = validationKindNeeds(newKind);
  const def = KIND_BY_NAME.get(newKind);

  let target = rule.target;
  if (!needs.target) target = '';
  else if (target.trim().length === 0) target = def?.defaultTarget ?? '';

  let expected = rule.expected;
  if (!needs.expected) expected = undefined;
  else if (expected === undefined) expected = '';

  return { ...rule, kind: newKind, target, expected };
}

/**
 * Names the endpoint already declares for the family a kind targets — header
 * kinds read `requestSchema.headers`, query kinds `queryParams`, cookie kinds
 * `cookies`. Used to seed the ◆ Target quick-pick with the endpoint's own
 * declared params before falling back to the global header catalogue / custom
 * entry. Returns `[]` for kinds with no target (body / content-type).
 */
export function schemaParamNames(kind: string, schema: MockRequestSchema): string[] {
  let list: { name: string }[] = [];
  if (kind.startsWith('header-')) list = schema.headers;
  else if (kind.startsWith('query-')) list = schema.queryParams;
  else if (kind.startsWith('cookie-')) list = schema.cookies;
  return list.map((p) => p.name).filter((n) => n.trim().length > 0);
}

export interface TargetCandidate {
  name: string;
  description?: string;
}

/**
 * Ordered, de-duplicated (case-insensitive) candidate target names for the
 * ◆ Target picker:
 *   1. the endpoint's own declared params for the kind's family;
 *   2. for header kinds, the curated global header catalogue — the same
 *      `HTTP_HEADERS_MAP` the Web + Desktop header editors surface.
 * Returns `[]` for kinds with no target. The command appends its own
 * "✏ Custom…" escape hatch.
 */
export function validationTargetCandidates(
  kind: string,
  schema: MockRequestSchema,
): TargetCandidate[] {
  if (!validationKindNeeds(kind).target) return [];
  const out: TargetCandidate[] = [];
  const seen = new Set<string>();
  const push = (name: string, description?: string): void => {
    const key = name.toLowerCase();
    if (key.length === 0 || seen.has(key)) return;
    seen.add(key);
    out.push({ name, description });
  };
  for (const name of schemaParamNames(kind, schema)) push(name, 'declared on this endpoint');
  if (kind.startsWith('header-')) {
    for (const h of suggestHeaders('', undefined, 'request')) push(h.name, h.description);
  }
  return out;
}

/**
 * Curated expected-value choices for the ◆ Value picker, keyed off the kind +
 * target:
 *   - content-type-equals → the Content-Type media-type catalogue;
 *   - header-equals       → the picked header's known values (may be empty);
 *   - everything else (regex / query-equals / no-value kinds) → [] — the
 *     command falls back to a free-text / regex input.
 */
export function expectedValueCatalogue(kind: string, target: string): string[] {
  if (kind === 'content-type-equals') return getHeaderValues('Content-Type');
  if (kind === 'header-equals') return getHeaderValues(target);
  return [];
}

/**
 * Curated value choices for a response-rule when-clause's ◆ Value picker, keyed
 * off the clause `scope` + `target`:
 *   - header scope → the picked header's known values (e.g. Content-Type media
 *     types when target is `Content-Type`) — may be empty;
 *   - every other scope (query / pathParam / cookie / body-json-path) → [] —
 *     the command falls back to a free-text input.
 * The clause `value` is omitted entirely for the `present` / `absent` ops, so
 * callers gate the lens on the op before reaching this.
 */
export function conditionValueCandidates(scope: string, target: string): string[] {
  if (scope === 'header') return getHeaderValues(target);
  return [];
}
