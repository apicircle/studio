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

interface Section {
  title: string;
  content: string;
}

export function formatRequestRunDocument(run: RequestRun): string {
  const sections: Section[] = [
    requestSummarySection(run, run.requestId),
    ...requestWireSections(run),
  ];
  return formatSections(`Run ${run.id} — ${run.requestId}`, sections);
}

/**
 * Format a captured plan run as a YAML document. Each step expands into the
 * SAME depth of wire detail the single-request run document shows — request
 * name, method, url, status, duration, request + response headers, the
 * response body preview, and the assertion verdicts — so the History view
 * surfaces *what came back and why a step passed or failed* instead of an
 * opaque `requestRunId`.
 *
 * `requestsById` maps requestId → its current definition so a step reads as the
 * human-readable request name; callers pass `state.synced.collections.requests`.
 * It's optional so the formatter stays a pure helper testable without a
 * workspace — the name then falls back to the captured requestId.
 */
export function formatPlanRunDocument(
  run: PlanRun,
  requestRuns: ReadonlyArray<RequestRun>,
  requestsById: Record<string, { name: string }> = {},
): string {
  const summary = {
    plan: run.planId,
    startedAt: run.startedAt,
    durationMs: run.durationMs,
    withAssertions: run.withAssertions,
    stepCount: run.steps.length,
    passCount: run.steps.filter((s) => s.passed).length,
  };

  let out = `# API Circle Plan Run ${run.id} — ${run.planId}\n\n`;
  out += `${stepDivider('summary')}\n${YAML.stringify(summary, { lineWidth: 0 }).trimEnd()}\n\n`;

  run.steps.forEach((step, i) => {
    const rr = requestRuns.find((r) => r.id === step.requestRunId);
    const name = rr ? (requestsById[rr.requestId]?.name ?? rr.requestId) : '(no run captured)';
    out += `${stepDivider(`step ${i + 1} — ${name}  [${step.passed ? 'PASS' : 'FAIL'}]`)}\n`;

    if (!rr) {
      // Skipped / orphaned step — no RequestRun was captured. Still surface the
      // step's pass flag + the run id so the row isn't a dead end.
      out += `passed: ${step.passed}\nrequestRunId: ${step.requestRunId}\n`;
      out += '(no request run was captured for this step — it was skipped or unresolved)\n\n';
      return;
    }

    const stepSummary: Record<string, unknown> = {
      passed: step.passed,
      request: name,
      status: statusLabel(rr),
      method: rr.method,
      url: rr.url,
      durationMs: rr.durationMs,
      ok: rr.ok,
    };
    if (rr.error) stepSummary.error = rr.error;

    const sections: Section[] = [
      { title: 'summary', content: YAML.stringify(stepSummary, { lineWidth: 0 }).trimEnd() },
      ...requestWireSections(rr, run.withAssertions),
    ];
    out += `${renderSectionBody(sections)}\n\n`;
  });

  return out.trimEnd() + '\n';
}

// ---------------------------------------------------------------------------
// Section builders (shared between the request-run and plan-run documents).
// ---------------------------------------------------------------------------

function requestSummarySection(run: RequestRun, displayName: string): Section {
  const summary: Record<string, unknown> = {
    request: displayName,
    status: statusLabel(run),
    durationMs: run.durationMs,
    ok: run.ok,
    method: run.method,
    url: run.url,
    startedAt: run.startedAt,
  };
  if (run.error) summary.error = run.error;
  return { title: 'summary', content: YAML.stringify(summary, { lineWidth: 0 }).trimEnd() };
}

/**
 * The wire sections of a captured run — request headers, request body (when
 * present), response headers, assertion verdicts, and the response body
 * preview. Shared by both documents so they render identically. When
 * `noteEmptyAssertions` is set (a plan run launched with assertions) a request
 * that declares none gets an explicit note rather than a silent omission.
 */
function requestWireSections(run: RequestRun, noteEmptyAssertions = false): Section[] {
  const sections: Section[] = [];

  sections.push({
    title: 'requestHeaders',
    content: YAML.stringify(lowercaseKeys(run.requestHeaders), { lineWidth: 0 }).trimEnd(),
  });

  if (run.requestBodyPreview !== null) {
    sections.push({ title: 'requestBody', content: run.requestBodyPreview });
  }

  sections.push({
    title: 'responseHeaders',
    content: YAML.stringify(lowercaseKeys(run.responseHeaders), { lineWidth: 0 }).trimEnd(),
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
  } else if (noteEmptyAssertions) {
    sections.push({ title: 'assertions', content: '(none defined on this request)' });
  }

  sections.push({
    title: `responseBody (${run.responseBodyKind})${run.responseTruncated ? ' — truncated' : ''}`,
    content: run.responseBodyPreview,
  });

  return sections;
}

function statusLabel(run: RequestRun): string {
  return run.status === null ? 'Network error' : `${run.status} ${run.statusText ?? ''}`.trim();
}

function lowercaseKeys(headers: Record<string, string>): Record<string, string> {
  return Object.fromEntries(Object.entries(headers).map(([k, v]) => [k.toLowerCase(), v]));
}

function renderSectionBody(sections: Section[]): string {
  return sections.map((s) => `# ── ${s.title} ──\n${s.content}`).join('\n\n');
}

function formatSections(name: string, sections: Section[]): string {
  // trimEnd() before the final newline so a last section whose content carries
  // trailing whitespace (e.g. a response body ending in '\n') doesn't leave a
  // double newline at EOF — matching the original whole-document trim.
  return `# API Circle ${name}\n\n${renderSectionBody(sections).trimEnd()}\n`;
}

function stepDivider(title: string): string {
  return `# ═══════════ ${title} ═══════════`;
}
