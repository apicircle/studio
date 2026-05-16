# APICircle Studio QA Run — run-2026-05-14-01

- **Started**: 2026-05-14
- **Tester**: Claude Cowork
- **Build identifier**: git `6ca7dbf` (`6ca7dbf2f8885acd054c15a51bf613de776d23ae`)
- **Last commit subject**: `feat(ui-components): add AppIcon component and lazy loading for ImportModal`
- **Platform under test**: web (Chrome) + desktop (Electron)
- **App URL (web)**: http://localhost:5173
- **Run scope**: `--all` (both workbooks)
- **Source plans (READ-ONLY)**:
  - `docs/qa/web-app-manual-test-cases.xlsx` — 3,348 rows
  - `docs/qa/desktop-app-manual-test-cases.xlsx` — 3,736 rows
- **Results workbooks (under test)**:
  - `docs/qa/results/web-run-2026-05-14-01.xlsx`
  - `docs/qa/results/desktop-run-2026-05-14-01.xlsx`
- **Evidence directory**: `docs/qa/results/evidence/run-2026-05-14-01/`

## Session strategy

The scoped subset is enormous (7,084 total rows). A single Cowork session
cannot run all of these. This run uses the results workbook as the
source of truth — any row left at `Status = Not Run` is fair game for a
future session to pick up.

Order of execution this session:

1. Web — module `Workspace Management` (33 rows) as harness validation
2. Web — High-priority rows, grouped by module
3. Desktop — bulk-mark Electron-only rows `Skipped` (no Electron driver
   available in this Cowork session) and execute CLI / file-system rows
   that don't need the Electron shell
4. Web — Medium and Low priority, time permitting

A summary will be generated with `tc_results.py summarize` and a
`RUN-REPORT.md` written into this directory at session end.
