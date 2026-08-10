import type { Assertion } from '@apicircle/shared';
import { describe, expect, it } from 'vitest';
import type { ExecutionResult } from '../request/executeRequest';
import { readJsonPath, runAssertions } from './runAssertions';

const baseExec: ExecutionResult = {
  startedAt: '2026-04-27T00:00:00.000Z',
  durationMs: 120,
  status: 200,
  ok: true,
  statusText: 'OK',
  headers: { 'content-type': 'application/json', 'x-request-id': 'abc-123' },
  body: '{"id":42,"name":"alice","scores":[10,20,30]}',
  bodyKind: 'json',
  url: 'https://api.example.com',
  method: 'GET',
  authWarnings: [],
};

// A body covering every JSON type, for `type` assertions.
const typedExec: ExecutionResult = {
  ...baseExec,
  body: '{"n":1,"s":"x","b":true,"nil":null,"arr":[1,2],"obj":{"k":1}}',
};

const a = (overrides: Partial<Assertion>): Assertion => ({
  id: 'a1',
  kind: 'status',
  op: 'equals',
  expected: 200,
  ...overrides,
});

describe('readJsonPath', () => {
  const tree = { a: { b: { c: 'hi', list: [1, 2, { x: 'y' }] } } };

  it('returns the root for empty / $ / .', () => {
    expect(readJsonPath(tree, '')).toBe(tree);
    expect(readJsonPath(tree, '$')).toBe(tree);
    expect(readJsonPath(tree, '.')).toBe(tree);
  });

  it('reads a dotted path', () => {
    expect(readJsonPath(tree, 'a.b.c')).toBe('hi');
    expect(readJsonPath(tree, '$.a.b.c')).toBe('hi');
  });

  it('supports bracket array indexing', () => {
    expect(readJsonPath(tree, 'a.b.list[1]')).toBe(2);
    expect(readJsonPath(tree, 'a.b.list[2].x')).toBe('y');
  });

  it('returns undefined for missing segments', () => {
    expect(readJsonPath(tree, 'a.missing.c')).toBeUndefined();
    expect(readJsonPath(tree, 'a.b.list[99]')).toBeUndefined();
  });

  it('returns undefined when traversing through a non-object', () => {
    expect(readJsonPath('hello', 'a')).toBeUndefined();
  });

  it('handles a $ prefix without a following dot', () => {
    expect(readJsonPath({ a: 5 }, '$a')).toBe(5);
  });
});

describe('runAssertions: status', () => {
  it('passes when status equals expected and snapshots the assertion definition', () => {
    expect(
      runAssertions([a({ kind: 'status', op: 'equals', expected: 200 })], baseExec)[0],
    ).toEqual({
      assertionId: 'a1',
      kind: 'status',
      op: 'equals',
      expected: 200,
      passed: true,
      detail: 'status: 200 equals 200',
    });
  });

  it('fails when request never completed (status null)', () => {
    const result = runAssertions([a({ kind: 'status', op: 'equals', expected: 200 })], {
      ...baseExec,
      status: null,
    })[0];
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/did not complete/);
  });

  it('supports lt / gt / not-equals', () => {
    expect(
      runAssertions([a({ kind: 'status', op: 'lt', expected: 300 })], baseExec)[0]?.passed,
    ).toBe(true);
    expect(
      runAssertions([a({ kind: 'status', op: 'gt', expected: 199 })], baseExec)[0]?.passed,
    ).toBe(true);
    expect(
      runAssertions([a({ kind: 'status', op: 'not-equals', expected: 500 })], baseExec)[0]?.passed,
    ).toBe(true);
  });

  it('fails with detail when expected is not numeric', () => {
    const result = runAssertions(
      [a({ kind: 'status', op: 'equals', expected: 'two hundred' })],
      baseExec,
    )[0];
    expect(result.passed).toBe(false);
    expect(result.detail).toMatch(/expected a number/);
  });

  it('contains/matches are unsupported for numeric values', () => {
    const r = runAssertions([a({ kind: 'status', op: 'contains', expected: '20' })], baseExec)[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not supported/);
  });
});

describe('runAssertions: duration', () => {
  it('passes when duration is below threshold', () => {
    const r = runAssertions([a({ kind: 'duration', op: 'lt', expected: 500 })], baseExec)[0];
    expect(r.passed).toBe(true);
  });

  it('fails when duration is above threshold', () => {
    const r = runAssertions([a({ kind: 'duration', op: 'lt', expected: 100 })], baseExec)[0];
    expect(r.passed).toBe(false);
  });
});

describe('runAssertions: header', () => {
  it('passes when header equals expected (case-insensitive lookup)', () => {
    const r = runAssertions(
      [a({ kind: 'header', op: 'equals', target: 'Content-Type', expected: 'application/json' })],
      baseExec,
    )[0];
    expect(r.passed).toBe(true);
  });

  it('fails when target missing and op != not-equals', () => {
    const r = runAssertions(
      [a({ kind: 'header', op: 'equals', target: 'X-Missing', expected: 'x' })],
      baseExec,
    )[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not present/);
  });

  it('passes "not-equals" when header is missing', () => {
    const r = runAssertions(
      [a({ kind: 'header', op: 'not-equals', target: 'X-Missing', expected: 'x' })],
      baseExec,
    )[0];
    expect(r.passed).toBe(true);
  });

  it('contains and matches ops work on header values', () => {
    expect(
      runAssertions(
        [a({ kind: 'header', op: 'contains', target: 'content-type', expected: 'json' })],
        baseExec,
      )[0]?.passed,
    ).toBe(true);
    expect(
      runAssertions(
        [a({ kind: 'header', op: 'matches', target: 'x-request-id', expected: '^abc-' })],
        baseExec,
      )[0]?.passed,
    ).toBe(true);
  });

  it('matches op fails gracefully on invalid regex', () => {
    const r = runAssertions(
      [a({ kind: 'header', op: 'matches', target: 'content-type', expected: '[' })],
      baseExec,
    )[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not a valid regex/);
  });

  it('fails fast when target is missing', () => {
    const r = runAssertions(
      [a({ kind: 'header', op: 'equals', target: undefined, expected: 'x' })],
      baseExec,
    )[0];
    expect(r.passed).toBe(false);
  });
});

describe('runAssertions: json-path', () => {
  it('passes equals against a numeric path', () => {
    const r = runAssertions(
      [a({ kind: 'json-path', op: 'equals', target: 'id', expected: 42 })],
      baseExec,
    )[0];
    expect(r.passed).toBe(true);
  });

  it('passes contains against a string path', () => {
    const r = runAssertions(
      [a({ kind: 'json-path', op: 'contains', target: 'name', expected: 'lic' })],
      baseExec,
    )[0];
    expect(r.passed).toBe(true);
  });

  it('reads array indices', () => {
    const r = runAssertions(
      [a({ kind: 'json-path', op: 'equals', target: 'scores[1]', expected: 20 })],
      baseExec,
    )[0];
    expect(r.passed).toBe(true);
  });

  it('fails when target missing', () => {
    const r = runAssertions(
      [a({ kind: 'json-path', op: 'equals', target: undefined, expected: 1 })],
      baseExec,
    )[0];
    expect(r.passed).toBe(false);
  });

  it('fails when body is not JSON', () => {
    const r = runAssertions([a({ kind: 'json-path', op: 'equals', target: 'id', expected: 1 })], {
      ...baseExec,
      body: 'not json',
    })[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not valid JSON/);
  });

  it('fails when path not found and op is not "not-equals"', () => {
    const r = runAssertions(
      [a({ kind: 'json-path', op: 'equals', target: 'missing', expected: 1 })],
      baseExec,
    )[0];
    expect(r.passed).toBe(false);
  });

  it('passes "not-equals" when path is missing', () => {
    const r = runAssertions(
      [a({ kind: 'json-path', op: 'not-equals', target: 'missing', expected: 1 })],
      baseExec,
    )[0];
    expect(r.passed).toBe(true);
  });
});

describe('runAssertions: pass explanations', () => {
  // Every pass case must populate `detail` with a positive description so the
  // Editor / Execution / History response panels can render assertions that
  // got passed alongside the why — not just a green checkmark.

  it('numeric equals → "X equals Y"', () => {
    const r = runAssertions([a({ kind: 'status', op: 'equals', expected: 200 })], baseExec)[0];
    expect(r.detail).toBe('status: 200 equals 200');
  });

  it('numeric not-equals → "X does not equal Y"', () => {
    const r = runAssertions([a({ kind: 'status', op: 'not-equals', expected: 500 })], baseExec)[0];
    expect(r.detail).toBe('status: 200 does not equal 500');
  });

  it('numeric lt / gt → comparator phrasing', () => {
    expect(
      runAssertions([a({ kind: 'status', op: 'lt', expected: 300 })], baseExec)[0]?.detail,
    ).toBe('status: 200 < 300');
    expect(
      runAssertions([a({ kind: 'duration', op: 'gt', expected: 50 })], baseExec)[0]?.detail,
    ).toBe('duration: 120 > 50');
  });

  it('header equals / contains / matches → quoted explanations', () => {
    expect(
      runAssertions(
        [
          a({
            kind: 'header',
            op: 'equals',
            target: 'Content-Type',
            expected: 'application/json',
          }),
        ],
        baseExec,
      )[0]?.detail,
    ).toBe('header "Content-Type": "application/json" equals "application/json"');

    expect(
      runAssertions(
        [a({ kind: 'header', op: 'contains', target: 'content-type', expected: 'json' })],
        baseExec,
      )[0]?.detail,
    ).toBe('header "content-type": "application/json" contains "json"');

    expect(
      runAssertions(
        [a({ kind: 'header', op: 'matches', target: 'x-request-id', expected: '^abc-' })],
        baseExec,
      )[0]?.detail,
    ).toBe('header "x-request-id": "abc-123" matches /^abc-/');
  });

  it('header not-equals on missing header → explains the absence', () => {
    const r = runAssertions(
      [a({ kind: 'header', op: 'not-equals', target: 'X-Missing', expected: 'x' })],
      baseExec,
    )[0];
    expect(r.detail).toBe('header "X-Missing" not present (passes not-equals)');
  });

  it('json-path equals against numeric path → numeric phrasing', () => {
    expect(
      runAssertions(
        [a({ kind: 'json-path', op: 'equals', target: 'id', expected: 42 })],
        baseExec,
      )[0]?.detail,
    ).toBe('path "id": 42 equals 42');
  });

  it('json-path contains against string path → quoted phrasing', () => {
    expect(
      runAssertions(
        [a({ kind: 'json-path', op: 'contains', target: 'name', expected: 'lic' })],
        baseExec,
      )[0]?.detail,
    ).toBe('path "name": "alice" contains "lic"');
  });

  it('json-path not-equals on missing path → explains the absence', () => {
    const r = runAssertions(
      [a({ kind: 'json-path', op: 'not-equals', target: 'missing', expected: 1 })],
      baseExec,
    )[0];
    expect(r.detail).toBe('path "missing" not found (passes not-equals)');
  });
});

describe('runAssertions: exists', () => {
  // `expected` is irrelevant for `exists`; the fixtures leave the default 200.
  it('status exists → passes when the request completed, fails when it did not', () => {
    expect(runAssertions([a({ kind: 'status', op: 'exists' })], baseExec)[0]).toMatchObject({
      passed: true,
      detail: 'status is present',
    });
    const nullStatus = runAssertions([a({ kind: 'status', op: 'exists' })], {
      ...baseExec,
      status: null,
    })[0];
    expect(nullStatus).toMatchObject({ passed: false, detail: 'status is not present' });
  });

  it('duration always exists', () => {
    expect(runAssertions([a({ kind: 'duration', op: 'exists' })], baseExec)[0]).toMatchObject({
      passed: true,
      detail: 'duration is present',
    });
  });

  it('header exists → present vs missing', () => {
    expect(
      runAssertions([a({ kind: 'header', op: 'exists', target: 'content-type' })], baseExec)[0],
    ).toMatchObject({ passed: true, detail: 'header "content-type" is present' });
    expect(
      runAssertions([a({ kind: 'header', op: 'exists', target: 'X-Missing' })], baseExec)[0],
    ).toMatchObject({ passed: false, detail: 'header "X-Missing" is not present' });
  });

  it('json-path exists → present vs missing', () => {
    expect(
      runAssertions([a({ kind: 'json-path', op: 'exists', target: 'id' })], baseExec)[0],
    ).toMatchObject({ passed: true, detail: 'path "id" is present' });
    expect(
      runAssertions([a({ kind: 'json-path', op: 'exists', target: 'missing' })], baseExec)[0],
    ).toMatchObject({ passed: false, detail: 'path "missing" is not present' });
  });

  it('json-path exists still fails fast when the body is not JSON', () => {
    const r = runAssertions([a({ kind: 'json-path', op: 'exists', target: 'id' })], {
      ...baseExec,
      body: 'not json',
    })[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/not valid JSON/);
  });
});

describe('runAssertions: type', () => {
  const jp = (target: string, expected: string) =>
    runAssertions([a({ kind: 'json-path', op: 'type', target, expected })], typedExec)[0];

  it('matches every JSON type (number, string, boolean, null, array, object)', () => {
    expect(jp('n', 'number')).toMatchObject({ passed: true, detail: 'path "n" is of type number' });
    expect(jp('s', 'string')).toMatchObject({ passed: true, detail: 'path "s" is of type string' });
    expect(jp('b', 'boolean')).toMatchObject({ passed: true });
    expect(jp('nil', 'null')).toMatchObject({ passed: true, detail: 'path "nil" is of type null' });
    expect(jp('arr', 'array')).toMatchObject({
      passed: true,
      detail: 'path "arr" is of type array',
    });
    expect(jp('obj', 'object')).toMatchObject({
      passed: true,
      detail: 'path "obj" is of type object',
    });
  });

  it('fails on a type mismatch with a descriptive diff', () => {
    expect(jp('n', 'string')).toMatchObject({
      passed: false,
      detail: 'path "n": expected type "string", got number',
    });
  });

  it('fails when the path is not present', () => {
    expect(jp('missing', 'string')).toMatchObject({
      passed: false,
      detail: 'path "missing" is not present',
    });
  });

  it('works for header (always a string), status, and duration', () => {
    expect(
      runAssertions(
        [a({ kind: 'header', op: 'type', target: 'content-type', expected: 'string' })],
        baseExec,
      )[0],
    ).toMatchObject({ passed: true, detail: 'header "content-type" is of type string' });
    expect(
      runAssertions(
        [a({ kind: 'header', op: 'type', target: 'X-Missing', expected: 'string' })],
        baseExec,
      )[0],
    ).toMatchObject({ passed: false, detail: 'header "X-Missing" is not present' });
    expect(
      runAssertions([a({ kind: 'status', op: 'type', expected: 'number' })], baseExec)[0],
    ).toMatchObject({
      passed: true,
      detail: 'status is of type number',
    });
    expect(
      runAssertions([a({ kind: 'duration', op: 'type', expected: 'number' })], baseExec)[0],
    ).toMatchObject({
      passed: true,
      detail: 'duration is of type number',
    });
  });

  it('a null status is reported as not completed, not as type null', () => {
    const r = runAssertions([a({ kind: 'status', op: 'type', expected: 'null' })], {
      ...baseExec,
      status: null,
    })[0];
    expect(r.passed).toBe(false);
    expect(r.detail).toMatch(/did not complete/);
  });
});

describe('runAssertions: comparison fail + serialization branches', () => {
  it('numeric comparisons report failures (equals / not-equals / gt)', () => {
    expect(
      runAssertions([a({ kind: 'status', op: 'equals', expected: 500 })], baseExec)[0].passed,
    ).toBe(false);
    expect(
      runAssertions([a({ kind: 'status', op: 'not-equals', expected: 200 })], baseExec)[0].passed,
    ).toBe(false);
    expect(
      runAssertions([a({ kind: 'status', op: 'gt', expected: 500 })], baseExec)[0].passed,
    ).toBe(false);
  });

  it('string comparisons cover equals / not-equals / contains / matches failures + unsupported lt', () => {
    const h = (op: Assertion['op'], expected: string) =>
      runAssertions([a({ kind: 'header', op, target: 'content-type', expected })], baseExec)[0];
    expect(h('equals', 'text/html').passed).toBe(false);
    expect(h('not-equals', 'text/html').passed).toBe(true);
    expect(h('not-equals', 'application/json').passed).toBe(false);
    expect(h('contains', 'xml').passed).toBe(false);
    const noMatch = h('matches', '^xml');
    expect(noMatch.passed).toBe(false);
    expect(noMatch.detail).toMatch(/did not match/);
    const unsupported = h('lt', 'x');
    expect(unsupported.passed).toBe(false);
    expect(unsupported.detail).toMatch(/not supported for string values/);
  });

  it('serializes non-primitive json-path values for comparison (boolean / null / object)', () => {
    const jp = (target: string, expected: string) =>
      runAssertions([a({ kind: 'json-path', op: 'equals', target, expected })], typedExec)[0];
    expect(jp('b', 'true').passed).toBe(true);
    expect(jp('nil', 'null').passed).toBe(true);
    expect(jp('obj', '{"k":1}').passed).toBe(true);
  });
});
