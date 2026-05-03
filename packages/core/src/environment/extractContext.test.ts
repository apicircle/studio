import { describe, expect, it } from 'vitest';
import type { ContextExtraction } from '@apicircle/shared';
import { extractContext } from './extractContext';
import type { ExecutionResult } from '../request/executeRequest';

const baseResult = (overrides: Partial<ExecutionResult> = {}): ExecutionResult => ({
  startedAt: 't',
  durationMs: 1,
  status: 200,
  ok: true,
  statusText: 'OK',
  headers: {},
  body: '',
  bodyKind: 'empty',
  url: 'https://x',
  method: 'GET',
  authWarnings: [],
  ...overrides,
});

const ext = (overrides: Partial<ContextExtraction>): ContextExtraction => ({
  id: 'e1',
  variable: 'OUT',
  source: 'body',
  path: '',
  enabled: true,
  ...overrides,
});

describe('extractContext', () => {
  it('returns the status as a string for source=status', () => {
    const out = extractContext(baseResult({ status: 201 }), [ext({ source: 'status' })]);
    expect(out.extracted).toEqual({ OUT: '201' });
    expect(out.warnings).toEqual([]);
  });

  it('reads case-insensitive headers', () => {
    const out = extractContext(baseResult({ headers: { 'X-Request-Id': 'abc-123' } }), [
      ext({ source: 'header', path: 'x-request-id' }),
    ]);
    expect(out.extracted).toEqual({ OUT: 'abc-123' });
  });

  it('warns and emits an empty string when a header is missing', () => {
    const out = extractContext(baseResult(), [ext({ source: 'header', path: 'X-Missing' })]);
    expect(out.extracted).toEqual({ OUT: '' });
    expect(out.warnings[0]).toMatch(/Header "X-Missing" not found/);
  });

  it('reads JSON body via dot+bracket notation', () => {
    const body = JSON.stringify({ data: { token: 'tk-1', items: [{ id: 7 }] } });
    const out = extractContext(baseResult({ body, bodyKind: 'json' }), [
      ext({ source: 'body', path: 'data.token', variable: 'TOKEN' }),
      ext({ source: 'body', path: 'data.items[0].id', variable: 'ID', id: 'e2' }),
    ]);
    expect(out.extracted).toEqual({ TOKEN: 'tk-1', ID: '7' });
  });

  it('warns when body is not JSON', () => {
    const out = extractContext(baseResult({ body: '<not json>', bodyKind: 'text' }), [
      ext({ source: 'body', path: 'whatever' }),
    ]);
    expect(out.warnings[0]).toMatch(/Body is not JSON/);
    expect(out.extracted).toEqual({ OUT: '' });
  });

  it('reads cookies from a Set-Cookie header', () => {
    const out = extractContext(
      baseResult({ headers: { 'set-cookie': 'session=abc; Path=/; HttpOnly' } }),
      [ext({ source: 'cookie', path: 'session' })],
    );
    expect(out.extracted).toEqual({ OUT: 'abc' });
  });

  it('skips disabled extractions', () => {
    const out = extractContext(baseResult({ status: 200 }), [
      ext({ source: 'status', enabled: false }),
    ]);
    expect(out.extracted).toEqual({});
  });

  it('stringifies non-string JSON values for body extractions', () => {
    const body = JSON.stringify({ flag: true, nested: { count: 5 }, arr: [1, 2] });
    const out = extractContext(baseResult({ body }), [
      ext({ source: 'body', path: 'flag', variable: 'FLAG' }),
      ext({ source: 'body', path: 'nested', variable: 'NESTED', id: 'e2' }),
      ext({ source: 'body', path: 'arr', variable: 'ARR', id: 'e3' }),
    ]);
    expect(out.extracted).toEqual({
      FLAG: 'true',
      NESTED: '{"count":5}',
      ARR: '[1,2]',
    });
  });

  it('warns when the variable name is empty', () => {
    const out = extractContext(baseResult(), [ext({ variable: '   ' })]);
    expect(out.warnings[0]).toMatch(/empty variable name/);
    expect(out.extracted).toEqual({});
  });
});
