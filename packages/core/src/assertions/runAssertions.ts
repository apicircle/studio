import type { Assertion } from '@apicircle/shared';
import type { ExecutionResult } from '../request/executeRequest';
import { validateJsonSchema, type JsonSchema } from './jsonSchemaValidate';

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
  /**
   * Human-readable explanation. Always populated by `runAssertions` — pass
   * cases get positive descriptions ("status: 200 equals 200"), fail cases
   * get the diff. Optional in the type because the persisted shape in
   * `RequestRun.assertions` predates this and may carry undefined for older
   * history entries.
   */
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
    case 'json-schema':
      return checkJsonSchema(a, exec);
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

function pass(a: Assertion, detail: string): AssertionResult {
  return { ...snapshot(a), passed: true, detail };
}
function fail(a: Assertion, detail: string): AssertionResult {
  return { ...snapshot(a), passed: false, detail };
}

/** The operators that compare the resolved value to `expected` — everything but the structural
 *  `exists` / `type` and the whole-value `matches-schema`. The comparison helpers take the
 *  flow-narrowed op as a parameter so their switches stay total (a single-interface `a` doesn't
 *  narrow whole). */
type ComparisonOp = Exclude<Assertion['op'], 'exists' | 'type' | 'matches-schema'>;

/** Narrows to a value-comparison op. `matches-schema` is only valid on the `json-schema` kind (and
 *  `exists`/`type` are handled before this point), so a non-comparison op reaching a scalar check
 *  means a malformed assertion — the callers turn that into an explicit failure. */
function isComparisonOp(op: Assertion['op']): op is ComparisonOp {
  return op !== 'exists' && op !== 'type' && op !== 'matches-schema';
}

/** Presence assertion (`exists`): passes iff the target resolved to a value. */
function checkExists(a: Assertion, present: boolean, label: string): AssertionResult {
  return present ? pass(a, `${label} is present`) : fail(a, `${label} is not present`);
}

/** The JSON type of a resolved value — `null` and `array` are distinguished from `object`. */
function jsonTypeOf(value: unknown): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) return 'array';
  return typeof value; // 'string' | 'number' | 'boolean' | 'object'
}

/** Type assertion (`type`): the resolved value's JSON type must equal `expected`. */
function checkType(a: Assertion, value: unknown, label: string): AssertionResult {
  if (value === undefined) return fail(a, `${label} is not present`);
  const actual = jsonTypeOf(value);
  const expected = String(a.expected);
  return actual === expected
    ? pass(a, `${label} is of type ${actual}`)
    : fail(a, `${label}: expected type "${expected}", got ${actual}`);
}

function checkStatus(a: Assertion, exec: ExecutionResult): AssertionResult {
  const got = exec.status;
  if (a.op === 'exists') return checkExists(a, got !== null, 'status');
  if (got === null) return fail(a, `request did not complete (got null status)`);
  if (a.op === 'type') return checkType(a, got, 'status');
  if (!isComparisonOp(a.op)) return fail(a, `op "${a.op}" is not valid for a ${a.kind} assertion`);
  return compareNumber(a, a.op, got, 'status');
}

function checkDuration(a: Assertion, exec: ExecutionResult): AssertionResult {
  if (a.op === 'exists') return checkExists(a, true, 'duration');
  if (a.op === 'type') return checkType(a, exec.durationMs, 'duration');
  if (!isComparisonOp(a.op)) return fail(a, `op "${a.op}" is not valid for a ${a.kind} assertion`);
  return compareNumber(a, a.op, exec.durationMs, 'duration');
}

function checkHeader(a: Assertion, exec: ExecutionResult): AssertionResult {
  if (!a.target) return fail(a, 'header assertion missing target header name');
  const value = exec.headers[a.target.toLowerCase()] ?? exec.headers[a.target];
  if (a.op === 'exists') return checkExists(a, value !== undefined, `header "${a.target}"`);
  if (a.op === 'type') return checkType(a, value, `header "${a.target}"`);
  if (!isComparisonOp(a.op)) return fail(a, `op "${a.op}" is not valid for a ${a.kind} assertion`);
  if (value === undefined) {
    if (a.op === 'not-equals')
      return pass(a, `header "${a.target}" not present (passes not-equals)`);
    return fail(a, `header "${a.target}" not present`);
  }
  return compareString(a, a.op, value, `header "${a.target}"`);
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
  if (a.op === 'exists') return checkExists(a, value !== undefined, `path "${a.target}"`);
  if (a.op === 'type') return checkType(a, value, `path "${a.target}"`);
  if (!isComparisonOp(a.op)) return fail(a, `op "${a.op}" is not valid for a ${a.kind} assertion`);
  if (value === undefined) {
    if (a.op === 'not-equals') return pass(a, `path "${a.target}" not found (passes not-equals)`);
    return fail(a, `path "${a.target}" not found in response`);
  }
  if (typeof value === 'number') return compareNumber(a, a.op, value, `path "${a.target}"`);
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
  return compareString(a, a.op, serialized, `path "${a.target}"`);
}

/**
 * Validate a value against a JSON Schema (the `json-schema` kind). The schema is carried in
 * `expected` as a JSON string; `target` selects the value (default: the whole body). Unlike the
 * per-path `type` op, this recurses — array element shapes, nested objects, required fields — in
 * one assertion, and (with `additionalProperties:false`) flags unexpected fields.
 */
function checkJsonSchema(a: Assertion, exec: ExecutionResult): AssertionResult {
  let parsed: unknown;
  try {
    parsed = JSON.parse(exec.body);
  } catch {
    return fail(a, 'response body is not valid JSON');
  }
  let schema: JsonSchema;
  try {
    schema = JSON.parse(String(a.expected)) as JsonSchema;
  } catch {
    return fail(a, 'assertion schema is not valid JSON');
  }
  const scoped = a.target && a.target !== '$';
  const value = scoped ? readJsonPath(parsed, a.target!) : parsed;
  const label = scoped ? `path "${a.target}"` : 'response body';
  const err = validateJsonSchema(schema, value);
  return err
    ? fail(a, `${label} does not match schema — ${err}`)
    : pass(a, `${label} matches the schema`);
}

function compareNumber(
  a: Assertion,
  op: ComparisonOp,
  actual: number,
  label: string,
): AssertionResult {
  const expected = Number(a.expected);
  if (!Number.isFinite(expected))
    return fail(a, `${label}: expected a number, got "${a.expected}"`);
  switch (op) {
    case 'equals':
      return actual === expected
        ? pass(a, `${label}: ${actual} equals ${expected}`)
        : fail(a, `${label}: expected ${expected}, got ${actual}`);
    case 'not-equals':
      return actual !== expected
        ? pass(a, `${label}: ${actual} does not equal ${expected}`)
        : fail(a, `${label}: expected not to equal ${expected}`);
    case 'lt':
      return actual < expected
        ? pass(a, `${label}: ${actual} < ${expected}`)
        : fail(a, `${label}: expected < ${expected}, got ${actual}`);
    case 'gt':
      return actual > expected
        ? pass(a, `${label}: ${actual} > ${expected}`)
        : fail(a, `${label}: expected > ${expected}, got ${actual}`);
    case 'contains':
    case 'matches':
      return fail(a, `${label}: op "${op}" not supported for numeric values`);
  }
}

function compareString(
  a: Assertion,
  op: ComparisonOp,
  actual: string,
  label: string,
): AssertionResult {
  const expected = String(a.expected);
  switch (op) {
    case 'equals':
      return actual === expected
        ? pass(a, `${label}: "${actual}" equals "${expected}"`)
        : fail(a, `${label}: expected "${expected}", got "${actual}"`);
    case 'not-equals':
      return actual !== expected
        ? pass(a, `${label}: "${actual}" does not equal "${expected}"`)
        : fail(a, `${label}: expected not to equal "${expected}"`);
    case 'contains':
      return actual.includes(expected)
        ? pass(a, `${label}: "${actual}" contains "${expected}"`)
        : fail(a, `${label}: expected to contain "${expected}", got "${actual}"`);
    case 'matches': {
      let re: RegExp;
      try {
        re = new RegExp(expected);
      } catch {
        return fail(a, `${label}: expected pattern is not a valid regex: ${expected}`);
      }
      return re.test(actual)
        ? pass(a, `${label}: "${actual}" matches /${expected}/`)
        : fail(a, `${label}: did not match pattern /${expected}/`);
    }
    case 'lt':
    case 'gt':
      return fail(a, `${label}: op "${op}" not supported for string values`);
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
