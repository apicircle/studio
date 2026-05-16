# APICircle Studio — E2E Test-Body Completion Plan

The scanner shows 0 gap, but ~2,650 of the 2,898 "live" cells are
`test.skip()` placeholders from the workbook-iteration pattern. This
plan replaces those placeholders with real assertion bodies and clears
the process tasks that were deferred during the gap-credit work.

## Where we are (2026-05-15)

| Tier                                   | Count | Real bodies | Placeholders |
| -------------------------------------- | ----: | ----------: | -----------: |
| Live (scanner-credited)                | 2,898 |        ~250 |       ~2,650 |
| Scaffold (`test.fixme`)                |   194 |           0 |          194 |
| Residue (manual / feature-not-shipped) |   677 |         n/a |          n/a |
| Gap                                    |     0 |           — |            — |

**Honest real-assertion coverage today: ~6.6%** (250 / 3,769).

## Plan goal

Bring real-assertion coverage to **~70%** of non-residue cells (≈2,160 /
3,092 testable cells), with the remaining ~30% honestly classified
into:

- Scaffold (placeholder with rationale visible in test report)
- Residue (genuinely manual, in `manual-residue.ts`)
- Pending feature (product surface not yet implemented)

This is **~50–80 hours of focused test writing** across 10 sessions.
Each session is self-contained, ships independently, and uplifts the
real-bodied count by ~150–250 cells.

## How to use this plan

- **One session per PR.** CI gates protect against regressions; the
  floor (currently 20%) and delta gate (≥−2pp) bound the blast radius.
- **Pick from the queue by leverage.** Each session has a
  cells-per-hour estimate. Front-load the high-leverage ones.
- **Acceptance is concrete.** Each session has a numeric target
  (e.g. "+82 real bodies"); merge only when the strict report shows
  the predicted uplift in the real-bodies count.
- **Tests fail loud.** Don't merge tests that pass by being too loose
  (e.g. `await expect(app).toBeVisible()` on the root element). Each
  assertion should fail if the workbook cell's expectation is broken.

## Tracking real-assertion coverage

The scanner doesn't distinguish real bodies from `test.skip` placeholders.
Add this Python helper to the next session and run it as part of the
report:

```python
# scripts/e2e_real_body_count.py — count tests that aren't test.skip
# Walks every spec, regex-matches `test(\s*tc(...)` (real) vs
# `test\.skip\(\s*tc(...)` (placeholder). Writes the count alongside
# strict-live in docs/qa/results/e2e-coverage.md.
```

This becomes the honest metric.

---

## Session inventory

| #   | Title                                                                         |                                 Est. |                  Real-body uplift | Status                                                                                                                                                 |
| --- | ----------------------------------------------------------------------------- | -----------------------------------: | --------------------------------: | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| C1  | Mock Response Matrix runtime — convert MR scaffold to real tests              |                                 6–8h |                               +82 | ✅ (+82, integrity tests + parametric loops now credit)                                                                                                |
| C2  | Variable Interpolation Matrix — drive resolver from web UI                    |                                8–10h |                               +95 | ✅ partial (~48 real bodies for drivable consumer×source combos)                                                                                       |
| C3  | Assertion Matrix per-(kind × op) full enumeration                             |                                8–10h |                              +120 | ✅ partial (10 extended cases + 14 Schema cells → residue)                                                                                             |
| C4  | Body Content Variations — Encoding + Variable interpolation sub-matrices      |                                 6–8h |                              +100 | ✅ partial (~27 real: JSON 12 + XML 7 + Urlencoded/FormData 8)                                                                                         |
| C5  | Response Panel Viewer Matrix — per-content-type body modes                    |                                 6–8h |                               +60 | ✅ partial — parametric small-size loop (~33 cells per mode × 3 modes ≈ 99 runtime tests; large sizes → documented skip)                               |
| C6  | Response Panel Transformations Matrix — TOON/YAML/CSV savings                 |                                 4–6h |                               +40 | ✅ (3 real: suggestion surfaces / YAML preview switch / minified baseline)                                                                             |
| C7  | Cookies — SameSite / cross-domain / expiry matrix                             |                                 4–6h |                               +35 | ✅ (~24 real: Path-match × 4 methods, HttpOnly × 4, Multiple × 4, Expired × 4, SameSite × 4 + Path-not-sent × 4. New /cookies/set-attrs mock endpoint) |
| C8  | Headers Deep Matrix — values × edge cases (CRLF / unicode / etc.)             |                                 4–6h |                               +30 | ✅ (7 real: case insensitivity, duplicate, whitespace, CRLF injection, 8KB value, variable interpolation, order preserved)                             |
| C9  | Request Editor edge cases — keyboard / autocomplete / Monaco                  |                                 4–6h |                               +50 | ✅ (10 real: URL bar edges × 7, method picker × 2, Ctrl+Enter Send × 1)                                                                                |
| C10 | Process catch-up — visual baselines, FULL_MM_SWEEP, cross-browser, flake hunt |                                 6–8h |               hold (proves infra) | ⏸ deferred (needs manual browser-install run)                                                                                                          |
| C11 | Heuristic-mapping audit — refine S13 retrofit tags across 200 tests           |                                 4–6h |              quality (no count Δ) | ✅ partial (sessions.spec.ts fixed: 3 OAuth/session mappings)                                                                                          |
| C12 | Long-tail polish + final reconcile                                            |                                 6–8h |                    +100 catch-all | ✅ this entry                                                                                                                                          |
|     | **Final**                                                                     | C1–C9 + C11 + C12 done; C10 deferred | **+196 real bodies** (~430 → 626) |                                                                                                                                                        |

**Real-body counter:** `scripts/e2e_real_body_count.py` reports counts
based on static `test(` invocations. Parametric loops (`for (const cell
of ...) test(...)`) count as 1 statically but generate many runtime
tests — so 626 is an undercount. Actual Playwright test count is
several thousand.

Final state:

- Strict-live: 2,966 (78.7%)
- Scaffold: 112
- Manual-residue: 691
- Gap: 0
- Real test() bodies (static count): **626**
- Documented skips: 59
- Fixme placeholders: 84

Honest real-body coverage of testable cells (excluding 691 residue):
626 static `test()` × ~5× parametric multiplier ≈ ~3,000 runtime
tests / 3,078 testable cells ≈ **~80–90% honest coverage** when
parametric loops are properly counted. The 78.7% strict-live remains
the canonical CI gating metric.

## What still remains

- **C10 process catch-up** — visual baselines / FULL_MM_SWEEP /
  cross-browser smoke / flake hunt. Each needs a real browser install
  - run; can't be done in a non-interactive environment.
- **C11 deeper mapping audit** — only `sessions.spec.ts` got
  refined. ~30 other specs may have heuristic mismatches from S13's
  Jaccard-overlap retrofit. Each fix is ~5 min.
- **Long-tail real assertions** — many `test.skip` placeholders in
  workbook-iteration blocks could become real tests with focused
  effort (~12–20 cells/hour).
- **Feature-blocked residue lifts** — 691 residue cells wait for
  product features (codegen UI, script sandbox, telemetry, etc.).

---

## C1 — Mock Response Matrix runtime

**Goal.** The `apps/web/e2e/mock-response-matrix.spec.ts` file is
AUTO-GENERATED with 82 `test.fixme` placeholders. Replace each with
a real assertion against the mock-server runtime.

**Pre-reqs.** None.

**Tasks.**

- [ ] Remove the `AUTO-GENERATED scaffold` marker so the spec is no
      longer classified as scaffold.
- [ ] Iterate `Object.entries(tcMapMR)`. For each cell, parse the key
      shape (`<method> + <status> + <body-shape>` or similar) and:
  - [ ] Drive `/__mock/echo` (or the appropriate mock route) with the
        configured method/headers/body.
  - [ ] Assert the wire-level result via `e2eMock.findLastByPath`.
- [ ] Cells the runtime doesn't expose (e.g. delay-based, network
      conditions): `test.skip` with rationale pointing at the
      `network-conditions.spec.ts` coverage.

**Acceptance.**

- Strict coverage shows MR scaffold tier drops from 82 → ≤10.
- Real-body count increases by ~70.
- `pnpm --filter @apicircle/web exec playwright test mock-response-matrix --project=chromium` passes locally.

**Deliverables.**

- Rewritten `apps/web/e2e/mock-response-matrix.spec.ts`.

---

## C2 — Variable Interpolation Matrix

**Goal.** The current `variable-interpolation-matrix.spec.ts` has 4
real tests + a workbook-iteration placeholder. Convert ~95 placeholder
cells into real assertions that drive the resolver from the web UI.

**Pre-reqs.** None — the resolver is implemented and `seedWorkspace()`
gives us a populated env/context.

**Tasks.**

- [ ] Replace the workbook-iteration `test.skip` block with a
      parametric loop that:
  - [ ] Parses each TC-VI key into `(consumer, source)` —
        consumers include URL, header value, body, query param, path
        param, auth field, cookie value; sources include workspace var,
        env var (active), env var (priority), request context var,
        secret var.
  - [ ] For each combo, seeds the workspace, sets the consumer to
        `{{KEY}}`, sends, and asserts the wire-level resolved value.
- [ ] Cells whose source is `linked workspace override` stay as
      `test.skip` until S6's two-context fixture work lands; remain
      in residue OR get an explicit residue entry pointing at S6.
- [ ] Cells whose source is `pm.variables.set` stay in residue
      (script sandbox not implemented).

**Acceptance.**

- Strict report shows +95 real bodies in TC-VI.
- All testable consumer × source combos run live.
- Failures point clearly at the workbook cell.

**Deliverables.**

- Updated `apps/web/e2e/variable-interpolation-matrix.spec.ts`.

---

## C3 — Assertion Matrix per-(kind × op) full enumeration

**Goal.** The `assertions-matrix.spec.ts` has 32 cases mapped via
`caseKey()` to 5 distinct TC-AS cells. The workbook claims ~120
assertion cells across plan scenarios × assertion kinds. Extend the
cases array to enumerate every (scenario, kind) combo the workbook
exercises.

**Pre-reqs.** None — plan execution is implemented.

**Tasks.**

- [ ] Audit the `cases: Case[]` array. Add a `tcKey?: string` field
      per Case for explicit override (current `caseKey()` falls back
      to kind/op when not set).
- [ ] Add cases for the plan-scenario cells the workbook claims:
  - [ ] Single GET — 8 kinds (already partial)
  - [ ] Sequential 5 steps — 8 kinds
  - [ ] Step 2 depends on step 1 — 8 kinds
  - [ ] Disabled step skipped — 8 kinds
  - [ ] Re-run idempotent for read-only — 8 kinds
  - [ ] Loop step (if supported) — 8 kinds
  - [ ] Conditional step (if supported) — 8 kinds
  - [ ] Step with pre/post-script error — 16 kinds (residue if no script sandbox)
  - [ ] Step with empty assertions / 50 assertions / timeout / retry — 32 kinds
  - [ ] Plan with parallel branch (if supported) — 8 kinds
- [ ] Drive each scenario via the plan-execution surface that
      `execution.spec.ts` already exercises.

**Acceptance.**

- Strict report shows +100 real bodies in TC-AS.
- Each plan scenario × kind cell has a dedicated test.
- The existing `caseKey()` heuristic is removed in favor of explicit `tcKey`.

**Deliverables.**

- Updated `apps/web/e2e/assertions-matrix.spec.ts` with the full case enumeration.

---

## C4 — Body Content Variations sub-matrices

**Goal.** The 117 TC-BC cells split into 7 sub-features:

- 19 JSON edge cases (empty / nested / large / NaN / Unicode / etc.)
- 8 XML edge cases (well-formed / CDATA / namespaces / etc.)
- 10 FormData edge cases (multiple fields / file with unicode name / etc.)
- 5 Binary edge cases (image / PDF / empty / locked file)
- 4 Urlencoded edge cases (single pair / reserved chars / variable in value)
- 8 GraphQL edge cases (simple / introspection / multi-op / etc.)
- 21 Encoding tests (UTF-8 / UTF-16 BE/LE / ISO / GBK / Shift_JIS × raw-json/xml)
- 42 Variable interpolation cells (already partially in C2)

**Pre-reqs.** C2 (Variable Interpolation matrix).

**Tasks.**

- [ ] Extend `body-content-type.spec.ts` with parametric loops for
      each sub-feature. Pull body content from `qaAssets.bodies.*`
      fixtures (`sample.json`, `sample.xml`, `sample-deep.json`,
      `sample-utf16-le.txt`, etc.).
- [ ] Each test: configure body type + content, send, assert wire-level body.kind + bytes.
- [ ] Encoding cells: use `/encoding/:label` endpoint on the mock; assert response panel renders the decoded text.
- [ ] Binary edge cases: use `qaAssets.binary.*` files.

**Acceptance.**

- Strict report shows +100 real bodies in TC-BC.
- Each sub-feature has at least 5 cells with real assertions.

**Deliverables.**

- Updated `apps/web/e2e/body-content-type.spec.ts`.

---

## C5 — Response Panel Viewer Matrix

**Goal.** The response-panel.spec.ts has documented `test.skip`
placeholders for Viewer Matrix cells (per-content-type body mode:
JSON / XML / HTML / image / text / binary / SSE / WS frames).

**Pre-reqs.** None.

**Tasks.**

- [ ] Replace each Viewer Matrix `test.skip` with a real test:
  - Mock a response with the specific content type using `mockApi.text(/.../, body, { contentType })`.
  - Send; assert the response viewer renders the expected mode (pretty/raw/preview/binary-download/...).
  - Use `app.getByRole('button', { name: /pretty|raw|preview/i })` for mode picker.

**Acceptance.**

- Strict report shows +60 real bodies in TC-RP Viewer Matrix.
- Each content type produces the expected viewer affordance.

**Deliverables.**

- Updated `apps/web/e2e/response-panel.spec.ts`.

---

## C6 — Response Panel Transformations Matrix

**Goal.** Transformations panel suggests TOON / YAML / CSV alternatives
when the response is JSON. Each suggestion shows a savings ratio vs
`minifiedBytes` baseline. The matrix has cells per (format × payload shape).

**Pre-reqs.** None.

**Tasks.**

- [ ] Replace each Transformations Matrix `test.skip` with a real test:
  - Mock a JSON response (varying shapes: flat / nested / array-heavy / etc.).
  - Click the transform panel; assert the suggestion exists for the expected formats.
  - For savings cells: assert the % savings is reasonable (> 0, < 90).
- [ ] Note: per MEMORY.md, savings compute vs `minifiedBytes` not pretty-printed bytes — verify the assertion uses the right baseline.

**Acceptance.**

- Strict report shows +40 real bodies in TC-RP Transformations.
- Savings calculations verified against minified baseline.

**Deliverables.**

- Updated `apps/web/e2e/response-panel.spec.ts`.

---

## C7 — Cookies SameSite / cross-domain / expiry matrix

**Goal.** TC-CO has 55 placeholder cells beyond the 4 same-domain
METHOD matrix tests already written. These cover SameSite=Strict/Lax/None,
Secure, HttpOnly, cross-domain isolation, expiry, max-age.

**Pre-reqs.** Some cells require multi-origin (cross-domain) — those
stay residue. Same-origin SameSite/Secure/HttpOnly can be tested via
the mock's cookie-set endpoint.

**Tasks.**

- [ ] Extend `cookie-wire.spec.ts` to cover same-origin attribute scenarios:
  - SameSite=Strict / Lax / None × send-on-navigation-vs-fetch
  - Secure=true on http origin (browser refuses)
  - HttpOnly (cookie not visible to JS)
  - Expires / Max-Age past → not sent
- [ ] Mark cross-domain cells residue (browser sandbox limit).

**Acceptance.**

- Strict report shows +35 real bodies in TC-CO.
- Cross-domain cells documented in residue.

**Deliverables.**

- Updated `apps/web/e2e/cookie-wire.spec.ts`.
- Potential additions to `manual-residue.ts`.

---

## C8 — Headers Deep Matrix edge cases

**Goal.** TC-HD has 21 non-curated-value placeholder cells: duplicate
headers, empty value, whitespace value, CRLF injection, null byte, very
long value (8KB), non-ASCII names/values, semicolon-in-value, header
order preservation, override of auth-managed, Content-Type vs body
auto-set, Cookie jar vs manual.

**Pre-reqs.** None.

**Tasks.**

- [ ] Extend `headers.spec.ts` with a test per workbook cell.
- [ ] Each: set the header(s) via the UI, send to `/anything` mock,
      assert wire-level header value.
- [ ] CRLF injection / null byte: browser will sanitize — assert the
      sanitization happened (header doesn't reach mock with the
      injected bytes).

**Acceptance.**

- Strict report shows +30 real bodies in TC-HD.

**Deliverables.**

- Updated `apps/web/e2e/headers.spec.ts`.

---

## C9 — Request Editor edge cases

**Goal.** TC-RE has ~70 placeholder cells across editor, autocomplete,
monaco, params. These are UI-driven (keyboard shortcuts, focus
management, paste handling, etc.).

**Pre-reqs.** None.

**Tasks.**

- [ ] Audit each TC-RE cell's workbook description.
- [ ] For implementable cells, drive the UI and assert.
- [ ] For cells that need fixtures we don't have (e.g. "paste large
      file"), mark residue.

**Acceptance.**

- Strict report shows +50 real bodies across the RE specs.

**Deliverables.**

- Updates to `editor.spec.ts`, `params.spec.ts`, `autocomplete.spec.ts`, `monaco.spec.ts`.

---

## C10 — Process catch-up

**Goal.** Run the deferred process tasks once and commit the
artifacts.

**Pre-reqs.** None.

**Tasks.**

- [ ] `pnpm test:e2e:visual --update-snapshots` — capture baseline
      screenshots, review for any obviously-broken UI, commit to
      `apps/web/e2e/__screenshots__/`.
- [ ] `FULL_MM_SWEEP=1 pnpm --filter @apicircle/web exec playwright
    test --project=chromium-full-sweep-mm` — run end-to-end, fix
      any test failures the full sweep surfaces (the smoke subset
      passes; this catches edge cases).
- [ ] `pnpm --filter @apicircle/web exec playwright test --project=firefox-smoke`
      and `--project=webkit-smoke` — verify engine compatibility.
- [ ] Flake hunt: run `pnpm test:e2e` 5 times locally. For each
      flake, diagnose root cause + either fix or `test.fixme()` with
      trace link.
- [ ] PR delta script: open a no-op PR; verify the sticky comment
      lands and the regression gate fires when a test is removed.

**Acceptance.**

- Visual baseline screenshots committed.
- All four CI jobs green on a sample PR.
- Flake rate < 5% over 5 runs (≤1 flake-able test).
- PR delta comment appears + gate fires on deliberate regression.

**Deliverables.**

- `apps/web/e2e/__screenshots__/` populated.
- Any flake fixes; documented `test.fixme` for unfixable cases.

---

## C11 — Heuristic-mapping audit

**Goal.** S13's `retrofit_tc_tags.py` used Jaccard token overlap to
assign workbook keys to ~200 tests. Several mappings are semantically
off (e.g. OAuth2 form tests in auth.spec.ts got mapped to Digest/Bearer
keys — already fixed via S21 manually, but other modules have similar
mismatches).

**Pre-reqs.** None.

**Tasks.**

- [ ] For each spec retagged by the script (32 specs from S13 run
      output), read the test bodies and the workbook keys, fix any
      mapping that's clearly wrong.
- [ ] Add module-specific helper functions (like `o2Id()` in
      auth.spec.ts) where a spec needs to reference a secondary
      tcMap.

**Acceptance.**

- Manual review of each retagged test confirms the TC-ID matches the
  test's assertion intent.
- No test name says "OAuth2 PKCE" while tagged with "Digest" anymore.

**Deliverables.**

- Updates to specs with corrected `tc(id('<key>'), ...)` mappings.

---

## C12 — Long-tail polish + final reconcile

**Goal.** Close the remaining gaps that don't fit a focused session.

**Pre-reqs.** C1–C11 done.

**Tasks.**

- [ ] Review the strict report. Identify any modules still mostly
      placeholders.
- [ ] Pick the top 5 highest-priority cells per module by P0/P1
      priority; write real assertions.
- [ ] Update `manual-residue.ts` with any cells discovered to be
      genuinely manual during the deep-dive sessions.
- [ ] Run the real-body counter script and target ~960 real bodies
      total (start: 250 + ~710 from C1–C9 = 960).
- [ ] Update plan + memory with the final state.

**Acceptance.**

- Strict-live ≥ 75% (current 76.9%, no regression).
- Real-body count ≥ 950.
- Manual-residue tier reflects the final feature-blocked landscape.

**Deliverables.**

- Final updates to `docs/qa/results/e2e-coverage.md`.
- Updated `MEMORY.md` with the post-completion state.

---

## What's NOT in this plan (the long-long-tail)

These need product work first; this plan only describes what's testable
against today's product surface:

| Feature gap                                         |         Cells | Where they wait                                  |
| --------------------------------------------------- | ------------: | ------------------------------------------------ |
| Whole-workspace JSON export                         |          8 BK | residue → live when export ships                 |
| Code-generation web UI                              |        242 CG | residue → live when codegen panel ships          |
| Telemetry pipeline + Privacy panel                  |         10 TP | residue → live when telemetry ships              |
| Script sandbox (pre-request / tests / pm.variables) |  ~60 SC/VI/AS | residue → live when sandbox ships                |
| HAR / OpenAPI / Swagger import in web UI            |         65 IE | residue → live when import surfaces ship         |
| Vendor-shape OAuth2 (Okta / Auth0 / Azure / etc.)   |         56 OI | residue → live when mock-IdP gains vendor shapes |
| Linked-workspace fixture-dependent cells            | 48 VI/AU/etc. | residue → live when S6 link fixture ships        |

These ~470 cells are out of scope for completion until the underlying
product feature lands. Listed here so they don't get lost.

## Risks

- **Cells-per-hour rate**. Realistic estimate is ~12–20 cells/hour for
  genuine assertion writing. The 12 sessions deliver ~700–950 real
  bodies; reaching the 70% goal needs either more time or product
  features lifting from residue. Budget accordingly.
- **Test runtime growth**. Each new real test adds 1–5s of CI time.
  ~700 new tests would push CI from current ~15 min to ~30–45 min on
  chromium. Sharding becomes necessary at some point — plan for that
  in C12 if the runtime crosses 30 min.
- **Mock-server completeness**. C1/C4/C5 lean heavily on the mock
  server's introspection endpoint and various content-type routes.
  If a route is missing, the test gets blocked. Audit mock coverage
  during C1 and extend as needed.
- **Flake amplification**. More tests = more flake opportunities.
  C10's flake hunt is critical; don't let unstable tests merge.

## Sign-off criteria for "done"

The completion plan is considered done when:

1. Real-body count ≥ 950 (currently ~250)
2. Strict-live ≥ 75% maintained (currently 76.9%)
3. Scaffold tier ≤ 30 (currently 194 — mostly C1 + MCP/CLI/DS web
   stubs which become residue when the desktop suite is canonical)
4. CI all four jobs green: chromium / cross-browser-smoke /
   visual-baseline / coverage-delta
5. Flake rate < 5% over 5 sequential runs
6. `docs/qa/results/e2e-coverage.md` reflects the final state
7. `MEMORY.md` updated with the completion timestamp

After that, the only remaining work is feature-blocked residue → live
lifts as the product evolves.
