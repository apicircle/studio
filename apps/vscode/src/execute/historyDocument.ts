import * as YAML from 'yaml';
import type { RequestRun, PlanRun } from '@apicircle/shared';

// =============================================================================
// History run-detail formatter.
//
// Produces a YAML document for a captured RequestRun or PlanRun, suitable
// for opening via the ApicircleFsProvider /history/<runId>.yaml URI.
// The historyStore in the FS provider caches the formatted output so
// clicking from the HistoryView opens instantly.
// =============================================================================

export function formatRequestRunDocument(run: RequestRun): string {
  const summary: Record<string, unknown> = {
    request: run.requestId,
    status: run.status === null ? 'Network error' : `${run.status} ${run.statusText ?? ''}`.trim(),
    durationMs: run.durationMs,
    ok: run.ok,
    method: run.method,
    url: run.url,
    startedAt: run.startedAt,
  };
  if (run.error) summary.error = run.error;

  const sections: Array<{ title: string; content: string }> = [];

  sections.push({ title: 'summary', content: YAML.stringify(summary, { lineWidth: 0 }).trimEnd() });

  const reqHeaders = Object.fromEntries(
    Object.entries(run.requestHeaders).map(([k, v]) => [k.toLowerCase(), v]),
  );
  sections.push({
    title: 'requestHeaders',
    content: YAML.stringify(reqHeaders, { lineWidth: 0 }).trimEnd(),
  });

  if (run.requestBodyPreview !== null) {
    sections.push({ title: 'requestBody', content: run.requestBodyPreview });
  }

  const respHeaders = Object.fromEntries(
    Object.entries(run.responseHeaders).map(([k, v]) => [k.toLowerCase(), v]),
  );
  sections.push({
    title: 'responseHeaders',
    content: YAML.stringify(respHeaders, { lineWidth: 0 }).trimEnd(),
  });

  if (run.assertions.length > 0) {
    const formatted = run.assertions.map((a) => ({
      passed: a.passed,
      kind: a.kind,
      op: a.op,
      target: a.target,
      expected: a.expected,
      detail: a.detail,
    }));
    sections.push({
      title: 'assertions',
      content: YAML.stringify(formatted, { lineWidth: 0 }).trimEnd(),
    });
  }

  sections.push({
    title: `responseBody (${run.responseBodyKind})${run.responseTruncated ? ' — truncated' : ''}`,
    content: run.responseBodyPreview,
  });

  return formatSections(`Run ${run.id} — ${run.requestId}`, sections);
}

export function formatPlanRunDocument(
  run: PlanRun,
  requestRuns: ReadonlyArray<RequestRun>,
): string {
  const stepRuns = run.steps.map((s, i) => {
    const rr = requestRuns.find((r) => r.id === s.requestRunId);
    return {
      stepIndex: i + 1,
      passed: s.passed,
      requestRunId: s.requestRunId,
      status: rr?.status ?? null,
      method: rr?.method ?? '',
      url: rr?.url ?? '',
    };
  });
  const summary = {
    plan: run.planId,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    withAssertions: run.withAssertions,
    stepCount: run.steps.length,
    passCount: run.steps.filter((s) => s.passed).length,
  };
  const sections = [
    { title: 'summary', content: YAML.stringify(summary, { lineWidth: 0 }).trimEnd() },
    { title: 'steps', content: YAML.stringify(stepRuns, { lineWidth: 0 }).trimEnd() },
  ];
  return formatSections(`Plan Run ${run.id} — ${run.planId}`, sections);
}

function formatSections(name: string, sections: Array<{ title: string; content: string }>): string {
  let out = `# APICircle ${name}\n\n`;
  for (const s of sections) {
    out += `# ── ${s.title} ──\n`;
    out += s.content;
    out += '\n\n';
  }
  return out.trimEnd() + '\n';
}
