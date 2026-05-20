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
