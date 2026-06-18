import { describe, it, expect } from 'vitest';
import type { ExecutionResult } from '@apicircle/core';
import { formatResponseDocument } from './responseDocument';

function makeResult(over: Partial<ExecutionResult> = {}): ExecutionResult {
  return {
    startedAt: '2026-01-01T00:00:00Z',
    durationMs: 142,
    status: 200,
    ok: true,
    statusText: 'OK',
    headers: { 'content-type': 'application/json' },
    body: '{"user":{"id":"123"}}',
    bodyKind: 'json',
    url: 'https://api.example.com/users/123',
    method: 'GET',
    authWarnings: [],
    ...over,
  };
}

describe('formatResponseDocument', () => {
  it('includes a header naming the request', () => {
    const doc = formatResponseDocument({ requestName: 'Get user', result: makeResult() });
    expect(doc).toContain('API Circle Response — Get user');
  });

  it('includes summary section with status, duration, size, URL', () => {
    const doc = formatResponseDocument({ requestName: 'x', result: makeResult() });
    expect(doc).toContain('status: 200 OK');
    expect(doc).toContain('durationMs: 142');
    expect(doc).toContain('finalUrl: https://api.example.com/users/123');
  });

  it('reports "Network error" when status is null', () => {
    const doc = formatResponseDocument({
      requestName: 'x',
      result: makeResult({ status: null, statusText: '', error: 'ECONNREFUSED' }),
    });
    expect(doc).toContain('Network error');
    expect(doc).toContain('ECONNREFUSED');
  });

  it('lowercases response header keys for consistency', () => {
    const doc = formatResponseDocument({
      requestName: 'x',
      result: makeResult({ headers: { 'Content-Type': 'application/json', ETag: '"abc"' } }),
    });
    expect(doc).toContain('content-type:');
    expect(doc).toContain('etag:');
  });

  it('includes assertion verdicts when supplied', () => {
    const doc = formatResponseDocument({
      requestName: 'x',
      result: makeResult(),
      assertionVerdicts: [
        {
          assertionId: 'a1',
          kind: 'status',
          op: 'equals',
          expected: 200,
          passed: true,
          detail: 'status: 200 equals 200',
        },
      ],
    });
    expect(doc).toContain('assertions');
    expect(doc).toContain('status');
    expect(doc).toContain('passed: true');
  });

  it('includes extracted variables when supplied', () => {
    const doc = formatResponseDocument({
      requestName: 'x',
      result: makeResult(),
      extractedVars: { token: 'abc123' },
    });
    expect(doc).toContain('extracted');
    expect(doc).toContain('token:');
  });

  it('embeds the response body verbatim', () => {
    const body = '{"user":{"id":"123"}}';
    const doc = formatResponseDocument({ requestName: 'x', result: makeResult({ body }) });
    expect(doc).toContain('body (json)');
    expect(doc).toContain(body);
  });

  it('notes truncation when responseTruncated is set', () => {
    const doc = formatResponseDocument({
      requestName: 'x',
      result: makeResult({ responseTruncated: true, body: 'x'.repeat(50) }),
    });
    expect(doc).toContain('truncatedAt');
  });
});
