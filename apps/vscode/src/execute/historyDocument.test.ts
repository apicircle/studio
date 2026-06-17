import { describe, it, expect } from 'vitest';
import type { RequestRun, PlanRun } from '@apicircle/shared';
import { formatRequestRunDocument, formatPlanRunDocument } from './historyDocument';

function run(over: Partial<RequestRun> = {}): RequestRun {
  return {
    id: 'run-1',
    requestId: 'req-abc',
    startedAt: '2026-01-01T00:00:00.000Z',
    durationMs: 142,
    status: 200,
    statusText: 'OK',
    ok: true,
    url: 'https://api.example.com/users/123',
    method: 'GET',
    requestHeaders: { 'X-Trace': 'abc' },
    requestBodyPreview: null,
    responseHeaders: { 'Content-Type': 'application/json' },
    responseBodyPreview: '{"user":{"id":"123"}}',
    responseBodyKind: 'json',
    responseTruncated: false,
    assertions: [],
    ...over,
  };
}

describe('formatRequestRunDocument', () => {
  it('includes a heading with the request id', () => {
    const doc = formatRequestRunDocument(run());
    expect(doc).toContain('Run run-1');
    expect(doc).toContain('req-abc');
  });

  it('includes summary with status, duration, method, url', () => {
    const doc = formatRequestRunDocument(run());
    expect(doc).toContain('status: 200 OK');
    expect(doc).toContain('durationMs: 142');
    expect(doc).toContain('method: GET');
    expect(doc).toContain('url: https://api.example.com/users/123');
  });

  it('shows "Network error" when status is null', () => {
    const doc = formatRequestRunDocument(
      run({ status: null, statusText: '', error: 'ECONNREFUSED' }),
    );
    expect(doc).toContain('Network error');
    expect(doc).toContain('ECONNREFUSED');
  });

  it('lowercases header keys for consistency with response viewer', () => {
    const doc = formatRequestRunDocument(
      run({ responseHeaders: { 'Content-Type': 'application/json' } }),
    );
    expect(doc).toContain('content-type:');
  });

  it('omits requestBody section when preview is null', () => {
    const doc = formatRequestRunDocument(run({ requestBodyPreview: null }));
    expect(doc).not.toContain('requestBody');
  });

  it('includes requestBody when preview is non-null', () => {
    const doc = formatRequestRunDocument(run({ requestBodyPreview: '{"foo":1}' }));
    expect(doc).toContain('requestBody');
    expect(doc).toContain('{"foo":1}');
  });

  it('includes assertion verdicts when present', () => {
    const doc = formatRequestRunDocument(
      run({
        assertions: [
          {
            assertionId: 'a1',
            kind: 'status',
            op: 'equals',
            expected: 200,
            passed: true,
            detail: 'matched',
          },
        ],
      }),
    );
    expect(doc).toContain('assertions');
    expect(doc).toContain('passed: true');
    expect(doc).toContain('matched');
  });

  it('marks truncated response body', () => {
    const doc = formatRequestRunDocument(run({ responseTruncated: true }));
    expect(doc).toContain('truncated');
  });

  it('embeds response body verbatim', () => {
    const doc = formatRequestRunDocument(run({ responseBodyPreview: '{"user":{"id":"123"}}' }));
    expect(doc).toContain('{"user":{"id":"123"}}');
  });
});

describe('formatPlanRunDocument', () => {
  function plan(): PlanRun {
    return {
      id: 'plan-run-1',
      planId: 'pl-xyz',
      startedAt: '2026-01-01T00:00:00Z',
      durationMs: 500,
      withAssertions: true,
      steps: [
        { requestRunId: 'rr1', passed: true },
        { requestRunId: 'rr2', passed: false },
      ],
    };
  }

  it('summarizes step count + pass count', () => {
    const doc = formatPlanRunDocument(plan(), []);
    expect(doc).toContain('stepCount: 2');
    expect(doc).toContain('passCount: 1');
  });

  it('joins step rows with their RequestRun status/method/url', () => {
    const reqRuns: RequestRun[] = [
      run({ id: 'rr1', method: 'POST', url: 'https://x.com/a', status: 201 }),
      run({ id: 'rr2', method: 'GET', url: 'https://x.com/b', status: 500 }),
    ];
    const doc = formatPlanRunDocument(plan(), reqRuns);
    expect(doc).toContain('https://x.com/a');
    expect(doc).toContain('POST');
    expect(doc).toContain('status: 201');
    expect(doc).toContain('status: 500');
  });

  it('passed: false rows surface as failures', () => {
    const doc = formatPlanRunDocument(plan(), []);
    expect(doc).toContain('passed: false');
  });
});
