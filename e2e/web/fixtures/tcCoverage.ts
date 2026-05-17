// TC-ID coverage tagging — every Playwright test that automates one or
// more manual test cases from docs/qa/{web,desktop}-app-manual-test-cases.xlsx
// names itself with the IDs it covers so the coverage report
// (scripts/e2e_coverage_report.py) can cross-reference.
//
// Three forms:
//
//   // Single test ↔ single workbook row.
//   test(tc('TC-MM-0001', 'GET + body=none'), async ({ ... }) => { ... });
//
//   // Single test that covers several workbook rows (e.g. a wire-level
//   // check that proves multiple scenarios at once).
//   test(tc(['TC-MM-0010', 'TC-MM-0011'], 'POST with body'), ...);
//
//   // Parameterised range — credits TC-XX-from .. TC-XX-to inclusively.
//   // The coverage script expands the range when computing strict credit.
//   test.describe(tcRange('TC-MM', 1, 56, 'Method × Body sweep'), ...);
//
//   // Inside a runtime block when a single test exercises multiple
//   // rows that aren't known at file-parse time. Logs a structured
//   // marker to stdout; the coverage script's --from-results mode
//   // counts it.
//   await tcCovered('TC-MM-0042');
//
// All four forms are picked up by the coverage scanner.

export type TcId = `TC-${string}`;

const TC_ID_RE = /^TC-[A-Z0-9]{2,3}-\d{4}$/;

function validate(id: string): asserts id is TcId {
  if (!TC_ID_RE.test(id)) {
    throw new Error(`Invalid TC-ID format: "${id}". Expected TC-XX-NNNN.`);
  }
}

/**
 * Format a test name with the TC-IDs it automates.
 *
 * @param ids One TC-ID or a list of TC-IDs covered by this test.
 * @param title Human-readable description of what the test does.
 * @param opts.smoke Append the `@smoke` tag so the firefox-smoke /
 *   webkit-smoke Playwright projects pick this test up via their
 *   `grep: /@smoke/`. Reserve for fundamental, fast, deterministic
 *   tests that prove the app boots and core flows work — not for
 *   feature-specific or flaky cases.
 */
export function tc(
  ids: TcId | readonly TcId[],
  title: string,
  opts: { smoke?: boolean } = {},
): string {
  const list = Array.isArray(ids) ? ids : [ids as TcId];
  if (!list.length) throw new Error('tc() requires at least one TC-ID');
  for (const id of list) validate(id);
  const prefix = list.join(',');
  const suffix = opts.smoke ? ' @smoke' : '';
  return `[${prefix}] ${title}${suffix}`;
}

/**
 * Format a range of consecutive TC-IDs. Useful when a parameterized loop
 * covers many sibling rows (e.g. method × body matrix).
 */
export function tcRange(prefix: string, from: number, to: number, title: string): string {
  if (to < from) throw new Error('tcRange: `to` must be >= `from`');
  if (!/^TC-[A-Z0-9]{2,3}$/.test(prefix)) {
    throw new Error(`Invalid tcRange prefix: "${prefix}". Expected TC-XX.`);
  }
  const pad = (n: number) => n.toString().padStart(4, '0');
  return `[${prefix}-${pad(from)}..${prefix}-${pad(to)}] ${title}`;
}

/**
 * Runtime coverage marker. Call inside a test body when a single test
 * exercises additional TC-IDs beyond what its `test(tc(...))` title
 * declares — emits a structured stdout line that the coverage script's
 * `--from-results` mode counts.
 *
 * The static `tc()` form is preferred (more discoverable, fail-fast on
 * typos). Use `tcCovered()` only when the additional TC-IDs are
 * computed at runtime (e.g. parameterised parametric loops where the
 * file source doesn't enumerate every concrete TC-ID).
 *
 * The structured log line shape is:
 *   ::tc-covered::TC-XX-NNNN
 *
 * Playwright captures stdout; CI parses these markers to build a
 * post-run coverage attribution that's independent of source scanning.
 */
export function tcCovered(id: TcId): void {
  validate(id);
  // Single line, no decoration, so parsers don't have to handle
  // multi-line wrapping. Use console.log so Playwright's stdout
  // attachment picks it up.
  // eslint-disable-next-line no-console
  console.log(`::tc-covered::${id}`);
}
