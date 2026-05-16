# E2E CI

The E2E suite runs on every PR and every push to `main`. Three jobs:

1. **`playwright`** — full chromium run + strict coverage report. Gates
   the build on a coverage floor and on a regression delta vs main.
2. **`cross-browser-smoke`** — `@smoke`-tagged subset run against
   Firefox + WebKit. Informational; doesn't gate the build.
3. **`visual-baseline`** — pixel-diff baseline of every primary panel.
   Fails the build if a screenshot diverges from the committed baseline.

The workflow lives at [`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml).

## What the build gates on

| Gate                  | Threshold               | Implementation                           |
| --------------------- | ----------------------- | ---------------------------------------- |
| Coverage floor        | strict-live ≥ 25%       | `e2e_coverage_report.py --fail-under 25` |
| Coverage regression   | delta ≥ −2.0 pp vs main | `scripts/e2e_coverage_delta.mjs`         |
| Playwright assertions | 0 failures              | `pnpm test:e2e` exit code                |
| Visual baseline       | 0 unmasked diffs        | `--project=visual-baseline` exit code    |

The two cross-engine smoke projects (firefox + webkit) are surfaced as
artifacts but are _not_ a gate — engine-only drift is informational. Wire
them into the gate later when the suite is stable across all three
engines.

## Artifacts every build publishes

- `playwright-report-${run_id}` — HTML report of the chromium run.
- `e2e-coverage-${run_id}` — strict coverage `.md`, `.json`, and the
  Playwright JSON results. Used by the PR delta script to attribute
  passes to TC-IDs.
- `smoke-report-${run_id}` — HTML report from the firefox + webkit run.
- `playwright-traces-${run_id}` — Playwright traces from failed tests
  (only published on failure).
- `visual-diffs-${run_id}` — diff PNGs when the visual project fails
  (only published on failure).

## Coverage modes (strict vs lenient)

Coverage is computed two ways. **Strict** is the honest number we gate
on; **lenient** is shown alongside for module-level wiring visibility.

- **Strict** counts a TC-ID only when the spec source contains an
  explicit `tc('TC-XX-NNNN', ...)`, `tcRange('TC-XX', from, to, ...)`,
  or `tcCovered('TC-XX-NNNN')` call. The map-usage detector also gives
  credit when a spec dereferences `tcMapXX[key]` (real evidence the spec
  iterates the map). A bare `import { tcMapXX } ... void tcMapXX;` does
  not credit.

- **Lenient** also credits every TC-ID inside any imported `tcMap*.ts`.
  Inflates the headline by giving scaffold imports full credit; useful
  only for tracking which modules are _wired_ to automation.

Run locally:

```bash
python scripts/e2e_coverage_report.py --strict           # honest count
python scripts/e2e_coverage_report.py --strict --json    # CI input
python scripts/e2e_coverage_report.py                    # lenient (legacy)
```

## Manual-residue tier

Cases that are deliberately excluded from automation (cross-OS installer
signing, browser-chrome surfaces, real-IdP live tier, perception perf)
are listed in [`apps/web/e2e/manual-residue.ts`](../../apps/web/e2e/manual-residue.ts).

The coverage script treats residue as authoritative — even if a spec
accidentally credits a residue ID via map-usage, it stays classified as
residue. Add or remove entries in that file when the line moves; do not
scatter residue rationales across specs.

## PR coverage delta

`scripts/e2e_coverage_delta.mjs` runs as the last step of the
`playwright` job on every PR. It:

1. Reads the PR build's strict coverage JSON.
2. Fetches the most-recent successful main run's coverage artifact via
   the GitHub Actions API.
3. Posts (or updates) a sticky PR comment with a delta table.
4. Fails the build (exit 2) if live coverage regressed by more than 2pp.

If no main run with the artifact exists yet (first time the workflow
lands on main), the script treats the baseline as 0% and skips the
regression gate.

## Failure debug recipe

1. **`playwright` failed** — open the `playwright-report-${run_id}`
   artifact; the HTML report links every failed test to its trace.
   Download `playwright-traces-${run_id}` and open with
   `pnpm exec playwright show-trace <trace.zip>` for the timeline.
2. **`cross-browser-smoke` failed** — same recipe; trace and HTML
   report are at `smoke-report-${run_id}`. Most engine-only failures
   trace back to Chromium-specific timing assumptions in the spec.
3. **`visual-baseline` failed** — download `visual-diffs-${run_id}`;
   it contains the actual / expected / diff PNGs. If the change is
   intentional, run
   `pnpm --filter @apicircle/web exec playwright test --project=visual-baseline --update-snapshots`
   locally, commit the updated `__screenshots__/` files, and push.
4. **Coverage gate failed** — the most-common cause is a `test()` that
   got converted to `test.fixme()` or deleted. The strict JSON's
   `gap` array lists every TC-ID that lost coverage; cross-reference
   with the diff to find the spec that lost a `tc()` tag.

## Updating the coverage floor

The current floor is `--fail-under 20` (strict-live ≥ 20%). The number
sits 4pp below the post-S25-tightening baseline (24.2%) — bump it in
[`.github/workflows/e2e.yml`](../../.github/workflows/e2e.yml) as each
S14–S23 module session lands honest per-cell tags. Aim to keep the
floor ~5pp below the running strict-live so a single bad merge fails
the delta gate (≥2pp) before the floor gate.

## Strict-scanner notes (S25 tightening)

After S25 (2026-05-15), the scanner credits a TC-ID only when one of
these patterns appears in a spec:

1. `tc('TC-XX-NNNN', ...)` / `tcCovered('TC-XX-NNNN')` — inline literal.
2. `tc(['TC-XX-NNNN', ...], ...)` — inline array.
3. `tcRange('TC-XX', from, to, ...)` — expanded range.
4. `for (const ... of [Object.entries(]tcMapXX[)])` — real iteration that
   generates a `test()` per cell. Credits the whole map.
5. `tcMapXX['<literal-key>']` — literal-key indexing. Credits just that key.
6. `helperName('<key>')` where `helperName` is a locally-defined
   function that dereferences `tcMapXX[<param>]` — resolves to the TC-ID
   at that key.

A bare `void Object.keys(tcMapXX);` (the S13 retrofit marker) does
**not** credit any cell. It's a static-analysis-friendly no-op, kept in
specs only to satisfy ESLint's no-unused-vars rule on the imported
tcMap until the spec retires it via a real `id()` helper definition.
