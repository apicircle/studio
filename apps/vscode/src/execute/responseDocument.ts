import * as YAML from 'yaml';
import type { ExecutionResult } from '@apicircle/core';
import type { AssertionResult } from '@apicircle/core';

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
