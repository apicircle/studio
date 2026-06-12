// Response-rule evaluator. Pure: takes an endpoint + the inbound request
// context and returns the response config to send back. Disabled rules are
// skipped; the first rule whose every clause matches wins. If no rule
// matches, `defaultResponse` is returned.
//
// This module also defines `RequestContext` — the runtime-side view of an
// inbound request, normalized so all evaluators read from the same shape.

import type {
  MockConditionClause,
  MockConditionOp,
  MockConditionScope,
  MockEndpoint,
  MockResponseConfig,
} from '@apicircle/shared';

export interface RequestContext {
  /** Lowercased query keys → first value (repeats are dropped). */
  query: Record<string, string>;
  /** Path params resolved by Hono — original case preserved. */
  pathParams: Record<string, string>;
  /** Lowercased header names → value. */
  headers: Record<string, string>;
  /** Parsed cookies (Cookie header). Names case-preserved. */
  cookies: Record<string, string>;
  /** Raw body text (best-effort — empty string when unread or non-text). */
  bodyText: string;
  /** Parsed JSON body when the Content-Type advertised JSON; otherwise undefined. */
  bodyJson: unknown;
}

export function evaluateResponseRules(
  endpoint: MockEndpoint,
  ctx: RequestContext,
): MockResponseConfig {
  for (const rule of endpoint.responseRules) {
    if (!rule.enabled) continue;
    if (rule.when.length === 0) continue; // Defensive: a clause-less rule never fires.
    if (rule.when.every((clause) => matchesClause(clause, ctx))) {
      return rule.response;
    }
  }
  return endpoint.defaultResponse;
}

function matchesClause(clause: MockConditionClause, ctx: RequestContext): boolean {
  const actual = readScopeValue(clause.scope, clause.target, ctx);
  return applyOp(clause.op, actual, clause.value);
}

function readScopeValue(
  scope: MockConditionScope,
  target: string,
  ctx: RequestContext,
): string | undefined {
  switch (scope) {
    case 'query':
      return ctx.query[target];
    case 'pathParam':
      return ctx.pathParams[target];
    case 'header':
      return ctx.headers[target.toLowerCase()];
    case 'cookie':
      return ctx.cookies[target];
    case 'body-json-path':
      return resolveJsonPathString(ctx.bodyJson, target);
  }
}

function applyOp(
  op: MockConditionOp,
  actual: string | undefined,
  expected: string | undefined,
): boolean {
  switch (op) {
    case 'present':
      return actual !== undefined && actual !== '';
    case 'absent':
      return actual === undefined || actual === '';
    case 'equals':
      return actual !== undefined && expected !== undefined && actual === expected;
    case 'not-equals':
      return actual === undefined || expected === undefined || actual !== expected;
    case 'matches': {
      if (actual === undefined || expected === undefined) return false;
      try {
        const re = compileMaybeFlaggedRegex(expected);
        return re.test(actual);
      } catch {
        return false;
      }
    }
    case 'gt':
    case 'lt':
    case 'gte':
    case 'lte': {
      if (actual === undefined || expected === undefined) return false;
      const a = Number(actual);
      const e = Number(expected);
      if (!Number.isFinite(a) || !Number.isFinite(e)) return false;
      switch (op) {
        case 'gt':
          return a > e;
        case 'lt':
          return a < e;
        case 'gte':
          return a >= e;
        case 'lte':
          return a <= e;
      }
    }
  }
}

/**
 * Accept either a raw regex source (`^bearer .+`) or `/source/flags` form.
 * Mirrors how the editor surfaces the placeholder `/^bearer .+/i`.
 */
function compileMaybeFlaggedRegex(input: string): RegExp {
  const m = /^\/(.*)\/([a-z]*)$/.exec(input);
  if (m) return new RegExp(m[1], m[2]);
  return new RegExp(input);
}

/**
 * Walk a `$.foo.bar[0]` style JSON path on a parsed body. Returns a string
 * coercion of the resolved value, or undefined when the path doesn't
 * resolve. Supports dot segments + numeric `[idx]`.
 *
 * Kept tiny + dependency-free — full jsonpath-plus support can land later
 * if users need the more exotic operators.
 */
function resolveJsonPathString(body: unknown, jsonPath: string): string | undefined {
  const value = resolveJsonPath(body, jsonPath);
  if (value === undefined || value === null) return undefined;
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  return JSON.stringify(value);
}

export function resolveJsonPath(body: unknown, jsonPath: string): unknown {
  if (body === undefined || body === null) return undefined;
  let path = jsonPath.trim();
  if (path.startsWith('$')) path = path.slice(1);
  if (path.startsWith('.')) path = path.slice(1);
  if (path === '') return body;

  let cursor: unknown = body;
  // Manual O(n) tokenizer: alternates dotted keys and `[…]` brackets.
  // Implemented as a state machine instead of a regex to avoid CodeQL's
  // polynomial-regex detector on user-authored JSON paths from mock rules.
  for (const key of iterJsonPathTokens(path)) {
    if (cursor === undefined || cursor === null) return undefined;
    if (Array.isArray(cursor)) {
      const idx = Number(key);
      if (!Number.isInteger(idx)) return undefined;
      cursor = cursor[idx];
      continue;
    }
    if (typeof cursor === 'object') {
      cursor = (cursor as Record<string, unknown>)[key];
      continue;
    }
    return undefined;
  }
  return cursor;
}

function* iterJsonPathTokens(path: string): Iterable<string> {
  let i = 0;
  while (i < path.length) {
    const ch = path[i];
    if (ch === '.' || ch === ']') {
      i++;
      continue;
    }
    if (ch === '[') {
      const close = path.indexOf(']', i + 1);
      if (close === -1) return;
      const inner = path.slice(i + 1, close);
      if (inner.length > 0) yield inner;
      i = close + 1;
      continue;
    }
    let j = i + 1;
    while (j < path.length) {
      const c = path[j];
      if (c === '.' || c === '[' || c === ']') break;
      j++;
    }
    yield path.slice(i, j);
    i = j;
  }
}
