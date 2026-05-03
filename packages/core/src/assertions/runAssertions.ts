import type { Assertion } from '@apicircle/shared';
import type { ExecutionResult } from '../request/executeRequest';

/**
 * Result of evaluating one assertion against a response. Carries a snapshot
 * of the assertion definition so downstream UI (History detail view, run
 * exports, plan reports) can render the verdict without joining back to the
 * source request — which may have been renamed, edited, or deleted by the
 * time the user looks at history.
 */
export interface AssertionResult {
  assertionId: string;
  kind: Assertion['kind'];
  op: Assertion['op'];
  target?: string;
  expected: string | number;
  passed: boolean;
  /** Human-readable description of the failure (or pass detail). */
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

function snapshot(
  a: Assertion,
): Pick<AssertionResult, 'assertionId' | 'kind' | 'op' | 'target' | 'expected'> {
  return {
    assertionId: a.id,
    kind: a.kind,
    op: a.op,
    target: a.target,
    expected: a.expected,
  };
}

function pass(a: Assertion, detail?: string): AssertionResult {
  return { ...snapshot(a), passed: true, ...(detail ? { detail } : {}) };
}
function fail(a: Assertion, detail: string): AssertionResult {
  return { ...snapshot(a), passed: false, detail };
}

function checkStatus(a: Assertion, exec: ExecutionResult): AssertionResult {
  const got = exec.status;
  if (got === null) return fail(a, `request did not complete (got null status)`);
  return compareNumber(a, got, 'status');
}

function checkDuration(a: Assertion, exec: ExecutionResult): AssertionResult {
  return compareNumber(a, exec.durationMs, 'duration');
}

function checkHeader(a: Assertion, exec: ExecutionResult): AssertionResult {
  if (!a.target) return fail(a, 'header assertion missing target header name');
  const value = exec.headers[a.target.toLowerCase()] ?? exec.headers[a.target];
  if (value === undefined) {
    if (a.op === 'not-equals') return pass(a);
    return fail(a, `header "${a.target}" not present`);
  }
  return compareString(a, value, `header "${a.target}"`);
}

function checkJsonPath(a: Assertion, exec: ExecutionResult): AssertionResult {
  if (!a.target) return fail(a, 'json-path assertion missing path');
  let parsed: unknown;
  try {
    parsed = JSON.parse(exec.body);
  } catch {
    return fail(a, 'response body is not valid JSON');
  }
  const value = readJsonPath(parsed, a.target);
  if (value === undefined) {
    if (a.op === 'not-equals') return pass(a);
    return fail(a, `path "${a.target}" not found in response`);
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
    return fail(a, `${label}: expected a number, got "${a.expected}"`);
  switch (a.op) {
    case 'equals':
      return actual === expected
        ? pass(a)
        : fail(a, `${label}: expected ${expected}, got ${actual}`);
    case 'not-equals':
      return actual !== expected ? pass(a) : fail(a, `${label}: expected not to equal ${expected}`);
    case 'lt':
      return actual < expected
        ? pass(a)
        : fail(a, `${label}: expected < ${expected}, got ${actual}`);
    case 'gt':
      return actual > expected
        ? pass(a)
        : fail(a, `${label}: expected > ${expected}, got ${actual}`);
    case 'contains':
    case 'matches':
      return fail(a, `${label}: op "${a.op}" not supported for numeric values`);
  }
}

function compareString(a: Assertion, actual: string, label: string): AssertionResult {
  const expected = String(a.expected);
  switch (a.op) {
    case 'equals':
      return actual === expected
        ? pass(a)
        : fail(a, `${label}: expected "${expected}", got "${actual}"`);
    case 'not-equals':
      return actual !== expected
        ? pass(a)
        : fail(a, `${label}: expected not to equal "${expected}"`);
    case 'contains':
      return actual.includes(expected)
        ? pass(a)
        : fail(a, `${label}: expected to contain "${expected}", got "${actual}"`);
    case 'matches': {
      let re: RegExp;
      try {
        re = new RegExp(expected);
      } catch {
        return fail(a, `${label}: expected pattern is not a valid regex: ${expected}`);
      }
      return re.test(actual) ? pass(a) : fail(a, `${label}: did not match pattern /${expected}/`);
    }
    case 'lt':
    case 'gt':
      return fail(a, `${label}: op "${a.op}" not supported for string values`);
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
