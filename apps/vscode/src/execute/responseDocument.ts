import * as YAML from 'yaml';
import type { ExecutionResult } from '@apicircle/core';
import type { AssertionResult } from '@apicircle/core';
import type { Request as ApiRequest } from '@apicircle/shared';

// =============================================================================
// Response document builder — formats an ExecutionResult (plus optional
// assertion verdicts) as a human-readable YAML document opened beside the
// request's YAML editor when the user clicks Send.
//
// The document is informational only: no two-way binding, no save handler.
// Editing it is harmless but doesn't change anything.
// =============================================================================

export interface FormatResponseOptions {
  requestName: string;
  result: ExecutionResult;
  assertionVerdicts?: AssertionResult[];
  /** Per-extraction results (extractions defined on the source request). */
  extractedVars?: Record<string, string>;
}

export function formatResponseDocument(opts: FormatResponseOptions): string {
  const { requestName, result, assertionVerdicts, extractedVars } = opts;

  const summary: Record<string, unknown> = {
    request: requestName,
    status:
      result.status === null
        ? 'Network error'
        : `${result.status} ${result.statusText ?? ''}`.trim(),
    durationMs: result.durationMs,
    size: result.body.length,
    finalUrl: result.url,
    method: result.method,
  };
  if (result.error) summary.error = result.error;
  if (result.responseTruncated) summary.truncatedAt = `${result.body.length} bytes`;

  const headersPretty = Object.fromEntries(
    Object.entries(result.headers).map(([k, v]) => [k.toLowerCase(), v]),
  );

  const sections: Array<{ title: string; content: string }> = [];

  // Summary section
  sections.push({
    title: 'summary',
    content: YAML.stringify(summary, { lineWidth: 0 }).trimEnd(),
  });

  // Response headers
  sections.push({
    title: 'responseHeaders',
    content: YAML.stringify(headersPretty, { lineWidth: 0 }).trimEnd(),
  });

  // Assertion verdicts
  if (assertionVerdicts && assertionVerdicts.length > 0) {
    const formatted = assertionVerdicts.map((v) => ({
      passed: v.passed,
      kind: v.kind,
      op: v.op,
      target: v.target,
      expected: v.expected,
      detail: v.detail,
    }));
    sections.push({
      title: 'assertions',
      content: YAML.stringify(formatted, { lineWidth: 0 }).trimEnd(),
    });
  }

  // Extracted variables
  if (extractedVars && Object.keys(extractedVars).length > 0) {
    sections.push({
      title: 'extracted',
      content: YAML.stringify(extractedVars, { lineWidth: 0 }).trimEnd(),
    });
  }

  // Auth warnings
  if (result.authWarnings.length > 0) {
    sections.push({
      title: 'authWarnings',
      content: YAML.stringify(
        result.authWarnings.map((w) => ({ code: w.code, message: w.message })),
        { lineWidth: 0 },
      ).trimEnd(),
    });
  }

  // Response body
  sections.push({
    title: `body (${result.bodyKind})`,
    content: result.body,
  });

  return formatSections(requestName, sections);
}

function formatSections(name: string, sections: Array<{ title: string; content: string }>): string {
  let out = `# APICircle Response — ${name}\n\n`;
  for (const s of sections) {
    out += `# ── ${s.title} ──\n`;
    out += s.content;
    out += '\n\n';
  }
  return out.trimEnd() + '\n';
}

/**
 * Placeholder content for the response tab while the request is in flight.
 * The send command opens this tab beside the request editor the instant the
 * user clicks ▶ Send so the click has immediate visual confirmation, then
 * swaps in the real response (or a cancel / error notice) when the executor
 * resolves.
 */
export function formatPendingResponseDocument(opts: {
  requestName: string;
  request: ApiRequest;
  startedAt: string;
}): string {
  const summary = {
    request: opts.requestName,
    status: 'Sending…',
    method: opts.request.method,
    url: opts.request.url,
    startedAt: opts.startedAt,
  };
  const sections = [
    {
      title: 'summary',
      content: YAML.stringify(summary, { lineWidth: 0 }).trimEnd(),
    },
    {
      title: 'body',
      content:
        '# The response will appear here when the send completes.\n' +
        '# Click ✖ Cancel on the request CodeLens or press Esc in the request\n' +
        '# editor to abort the send.',
    },
  ];
  return formatSections(opts.requestName, sections);
}

/**
 * Replacement content for the response tab when the user cancels mid-flight.
 * Shape mirrors the success and pending documents so the swap is jarring-free.
 */
export function formatCancelledResponseDocument(opts: {
  requestName: string;
  request: ApiRequest;
  startedAt: string;
  durationMs: number;
}): string {
  const summary = {
    request: opts.requestName,
    status: 'Cancelled',
    method: opts.request.method,
    url: opts.request.url,
    startedAt: opts.startedAt,
    durationMs: opts.durationMs,
  };
  const sections = [
    { title: 'summary', content: YAML.stringify(summary, { lineWidth: 0 }).trimEnd() },
    {
      title: 'body',
      content: '# The send was aborted before a response was received.',
    },
  ];
  return formatSections(opts.requestName, sections);
}

/**
 * Replacement content for the response tab when the executor throws before
 * a response landed (network error, timeout, unreachable host, etc.).
 */
export function formatFailedResponseDocument(opts: {
  requestName: string;
  request: ApiRequest;
  startedAt: string;
  durationMs: number;
  error: string;
}): string {
  const summary = {
    request: opts.requestName,
    status: 'Failed',
    method: opts.request.method,
    url: opts.request.url,
    startedAt: opts.startedAt,
    durationMs: opts.durationMs,
    error: opts.error,
  };
  const sections = [
    { title: 'summary', content: YAML.stringify(summary, { lineWidth: 0 }).trimEnd() },
    {
      title: 'body',
      content:
        '# The send failed before a response was received. Check the error\n' +
        '# field above for the underlying cause (network / DNS / TLS / timeout).',
    },
  ];
  return formatSections(opts.requestName, sections);
}
