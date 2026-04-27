import type { Assertion } from '@apicircle-v2/shared';
import type { ExecutionResult } from '../request/executeRequest';

export interface AssertionResult {
  assertionId: string;
  passed: boolean;
  detail?: string;
}

export function runAssertions(
  assertions: ReadonlyArray<Assertion>,
  exec: ExecutionResult,
): AssertionResult[] {
  return assertions.map((a) => runOne(a, exec));
}

function runOne(a: Assertion, exec: ExecutionResult): AssertionResult {
  switch (a.kind) {
    case 'status':
      return checkStatus(a, exec);
    case 'duration':
      return checkDuration(a, exec);
    case 'header':
      return checkHeader(a, exec);
    case 'json-path':
      return checkJsonPath(a, exec);
  }
}

function pass(id: string): AssertionResult {
  return { assertionId: id, passed: true };
}
function fail(id: string, detail: string): AssertionResult {
  return { assertionId: id, passed: false, detail };
}

function checkStatus(a: Assertion, exec: ExecutionResult): AssertionResult {
  const got = exec.status;
  if (got === null) return fail(a.id, `request did not complete (got null status)`);
  return compareNumber(a, got, 'status');
}

function checkDuration(a: Assertion, exec: ExecutionResult): AssertionResult {
  return compareNumber(a, exec.durationMs, 'duration');
}

function checkHeader(a: Assertion, exec: ExecutionResult): AssertionResult {
  if (!a.target) return fail(a.id, 'header assertion missing target header name');
  const value = exec.headers[a.target.toLowerCase()] ?? exec.headers[a.target];
  if (value === undefined) {
    if (a.op === 'not-equals') return pass(a.id);
    return fail(a.id, `header "${a.target}" not present`);
  }
  return compareString(a, value, `header "${a.target}"`);
}

function checkJsonPath(a: Assertion, exec: ExecutionResult): AssertionResult {
  if (!a.target) return fail(a.id, 'json-path assertion missing path');
  let parsed: unknown;
  try {
    parsed = JSON.parse(exec.body);
  } catch {
    return fail(a.id, 'response body is not valid JSON');
  }
  const value = readJsonPath(parsed, a.target);
  if (value === undefined) {
    if (a.op === 'not-equals') return pass(a.id);
    return fail(a.id, `path "${a.target}" not found in response`);
  }
  if (typeof value === 'number') return compareNumber(a, value, `path "${a.target}"`);
  // For non-primitive values (objects, arrays), serialize as JSON so the
  // user gets a meaningful diff string rather than `[object Object]`.
  const serialized =
    typeof value === 'string'
      ? value
      : typeof value === 'boolean'
        ? String(value)
        : value === null
          ? 'null'
          : JSON.stringify(value);
  return compareString(a, serialized, `path "${a.target}"`);
}

function compareNumber(a: Assertion, actual: number, label: string): AssertionResult {
  const expected = Number(a.expected);
  if (!Number.isFinite(expected))
    return fail(a.id, `${label}: expected a number, got "${a.expected}"`);
  switch (a.op) {
    case 'equals':
      return actual === expected
        ? pass(a.id)
        : fail(a.id, `${label}: expected ${expected}, got ${actual}`);
    case 'not-equals':
      return actual !== expected
        ? pass(a.id)
        : fail(a.id, `${label}: expected not to equal ${expected}`);
    case 'lt':
      return actual < expected
        ? pass(a.id)
        : fail(a.id, `${label}: expected < ${expected}, got ${actual}`);
    case 'gt':
      return actual > expected
        ? pass(a.id)
        : fail(a.id, `${label}: expected > ${expected}, got ${actual}`);
    case 'contains':
    case 'matches':
      return fail(a.id, `${label}: op "${a.op}" not supported for numeric values`);
  }
}

function compareString(a: Assertion, actual: string, label: string): AssertionResult {
  const expected = String(a.expected);
  switch (a.op) {
    case 'equals':
      return actual === expected
        ? pass(a.id)
        : fail(a.id, `${label}: expected "${expected}", got "${actual}"`);
    case 'not-equals':
      return actual !== expected
        ? pass(a.id)
        : fail(a.id, `${label}: expected not to equal "${expected}"`);
    case 'contains':
      return actual.includes(expected)
        ? pass(a.id)
        : fail(a.id, `${label}: expected to contain "${expected}", got "${actual}"`);
    case 'matches': {
      let re: RegExp;
      try {
        re = new RegExp(expected);
      } catch {
        return fail(a.id, `${label}: expected pattern is not a valid regex: ${expected}`);
      }
      return re.test(actual)
        ? pass(a.id)
        : fail(a.id, `${label}: did not match pattern /${expected}/`);
    }
    case 'lt':
    case 'gt':
      return fail(a.id, `${label}: op "${a.op}" not supported for string values`);
  }
}

/**
 * Read a dotted-path value from a JSON tree. Supports `a.b.c` and bracket
 * indexing `arr[0]`. Returns `undefined` for missing segments.
 */
export function readJsonPath(root: unknown, path: string): unknown {
  if (!path || path === '$' || path === '.') return root;
  const trimmed = path.startsWith('$.')
    ? path.slice(2)
    : path.startsWith('$')
      ? path.slice(1)
      : path;
  const segments = trimmed
    .replace(/\[(\d+)\]/g, '.$1')
    .split('.')
    .filter((s) => s.length > 0);
  let current: unknown = root;
  for (const seg of segments) {
    if (current === null || typeof current !== 'object') return undefined;
    current = (current as Record<string, unknown>)[seg];
    if (current === undefined) return undefined;
  }
  return current;
}
