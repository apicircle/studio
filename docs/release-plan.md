# API Circle Studio — Public Release Plan

Anchor date: **2026-04-28** (today). Target release window: **2026-05-20 to 2026-05-26**.

The plan splits in two halves:

- **Block A (you, ~5 days)** — manual exploration of every feature; capture friction; implement the must-fixes you find.
- **Block B (me, ~10 days)** — once Block A lands, I revisit, write the missing E2E coverage, raise coverage thresholds, set up signing/publishing pipelines, and write onboarding.

## Sheet 1 — Master timeline

| #   | Phase                                | Owner    | Start      | End        | Deliverable                                                                         | Gate / exit criteria                                       |
| --- | ------------------------------------ | -------- | ---------- | ---------- | ----------------------------------------------------------------------------------- | ---------------------------------------------------------- |
| 1   | Block A — manual QA pass + fixes     | You      | 2026-04-29 | 2026-05-03 | List of issues + commits closing the must-fixes                                     | A list of "what's left" handed to me                       |
| 2   | Block B.1 — bug triage               | Me       | 2026-05-04 | 2026-05-04 | Triage doc: which Block A items I take vs defer to v0.2                             | 1-day turnaround                                           |
| 3   | Block B.2 — Phase 2 E2E suite        | Me       | 2026-05-05 | 2026-05-07 | Playwright specs for Mocks panel, MCP panel, font picker, favicon, full plan run    | All P-phase golden paths green                             |
| 4   | Block B.3 — coverage uplift          | Me       | 2026-05-08 | 2026-05-09 | Hit per-package thresholds (shared 100/100, core 95/90, new packages 90/80)         | `pnpm test --coverage` green                               |
| 5   | Block B.4 — Help Center + onboarding | Me       | 2026-05-10 | 2026-05-12 | Help sections for Mocks/MCP/CLI; first-run wizard; example workspace seed           | New user lands → reaches first successful Send in ≤ 90 sec |
| 6   | Block B.5 — release pipeline + npm   | Me       | 2026-05-13 | 2026-05-14 | Working `release.yml`, npm scope claimed, dry-run publish on a `next` tag           | First `0.1.0-rc.1` published successfully                  |
| 7   | Block B.6 — homepage + repo public   | Me       | 2026-05-15 | 2026-05-16 | GitHub Pages landing site, README polished, license consistent, repo flipped public | URL goes live                                              |
| 8   | Internal beta                        | You + me | 2026-05-17 | 2026-05-19 | Self-test the full flow on a clean machine, flush remaining issues                  | Zero P0 / P1 bugs open                                     |
| 9   | **Public 0.1.0**                     | Me       | 2026-05-20 | —          | Tag, publish to npm, announce                                                       | Release notes published                                    |
| 10  | Post-launch fixes                    | Me       | 2026-05-21 | 2026-05-26 | First patch release based on user feedback                                          | 0.1.1 cut by end of week                                   |

## Sheet 2 — Block A: things to test in your 5-day pass

A checklist organised by panel. Anything that doesn't behave as you'd expect is a Block A item — capture it as a one-line bug note (panel, action, expected, actual). Don't worry about fixing everything; the goal is **finding** issues. We triage on day 1 of Block B.

### Workspace panel

- [ ] First boot — does the empty state make sense without context?
- [ ] Connect a GitHub PAT — required scopes guidance clear?
- [ ] Auto-create branch — branch name modal prefilled correctly?
- [ ] Push to save — does `workspace.json` actually appear on GitHub?
- [ ] Create PR — does the PR body editor work, does the URL come back?
- [ ] Refresh — does the conflict resolver trigger when both sides changed?
- [ ] Update token without logout — preserves working branch state?
- [ ] Disconnect repo — local state cleaned up?

### Editor panel

- [ ] Create / rename / delete request
- [ ] Switch method — Content-Type header auto-syncs?
- [ ] Body editor — JSON / text / form-data / urlencoded / binary / xml / graphql
- [ ] Form-data file upload — file persists across reload?
- [ ] Headers autocomplete — suggests on empty input?
- [ ] Query params — survive serialization?
- [ ] Auth dropdown — all 15 schemes render?
- [ ] OAuth2 token request flows — actually fetch a token?
- [ ] Send to httpbin.org/anything — response renders correctly?
- [ ] Assertions — add status / header / json-path / duration; verdicts correct?
- [ ] Context vars + extractions — round-trip a token from one request to another?
- [ ] cURL import — paste a real-world cURL string?

### Environments panel

- [ ] Create env, add encrypted variable
- [ ] Toggle active env — substitution works?
- [ ] Priority list reorder — drag and drop?
- [ ] Delete env that's referenced — block or warn?

### Secret Vault (modal)

- [ ] Vault tab — origin badges (workspace vs linked) correct?
- [ ] "Where used" expander — shows actual references?
- [ ] Sessions tab — update token preserves PR state?
- [ ] Delete a key with non-empty `usedIn` — blocked correctly?

### Link Workspace panel

- [ ] Search marketplace — public repos with topic tag?
- [ ] Link private — correct PAT scope?
- [ ] Pin version — confirm dialog gates the change?
- [ ] Required secret keys — input fields appear on the card?
- [ ] Publish v0.1.0 of own workspace — `releases.self.versions[]` updates?

### Execution panel

- [ ] Build a 4-step plan — drag/drop reorder?
- [ ] Run without assertions — all green?
- [ ] Run with assertions — failures surface per-step?
- [ ] Plan-level env priority — overrides global correctly?

### History panel

- [ ] After Send + plan run — both appear?
- [ ] Detail view — request snapshot, response, assertion verdicts?
- [ ] Clear history — confirm dialog?
- [ ] Verify nothing from history leaks into git push

### Mocks panel (Phase 2 — desktop only)

- [ ] Create mock from OpenAPI YAML
- [ ] Start — does it bind a port?
- [ ] curl against `localhost:<port>` — returns expected fixture?
- [ ] Stop — port released?
- [ ] Web build banner — clear that this is desktop-only?

### MCP panel (Phase 2 — desktop only)

- [ ] Pick each AI client — config snippet differs sensibly?
- [ ] Copy snippet — clipboard works?
- [ ] Default config path — actually correct on your OS?
- [ ] Tool catalog list — all 40 names visible?
- [ ] Wire snippet into Claude Desktop on your machine — does it work end-to-end?

### Theme + Font picker (just shipped)

- [ ] Switch through all 6 themes — every panel readable?
- [ ] Switch through all 7 fonts — does each render correctly?
- [ ] Reload — both choices persist?
- [ ] High Contrast theme + axe-core — passes WCAG 2.1 AA?

### Help Center

- [ ] **Already known stale** — note which sections you want updated
- [ ] Search — finds the right section?

### Browser tab + favicon

- [ ] Tab shows the Orbit favicon
- [ ] Tab title reads "API Circle Studio"
- [ ] Both look right on dark + light browser themes

### Cross-cutting

- [ ] Reload mid-edit — work persists?
- [ ] Two browser tabs — `BroadcastChannel` keeps them in sync?
- [ ] Network offline — graceful failure modes?
- [ ] Slow API (`/slow?ms=10000`) — duration assertion fires?
- [ ] Large request body (5 MB JSON) — editor responsive?

### CLI

- [ ] `npx @apicircle/cli mock ./fixtures/petstore.yaml` — boots
- [ ] `npx @apicircle/cli import openapi ./spec.yaml` — appends to workspace
- [ ] `npx @apicircle/cli mcp` — accepts JSON-RPC `tools/list`?
- [ ] `apicircle --help` — clear?

## Sheet 3 — Block B: what I'll do after your fixes

| #    | Item                                                 | Estimate | Notes                                                                                          |
| ---- | ---------------------------------------------------- | -------- | ---------------------------------------------------------------------------------------------- |
| B-01 | Triage your Block A list                             | 1 day    | Per item: take now vs defer to v0.2                                                            |
| B-02 | Fix the CLI binary packaging gap                     | 0.5 day  | Bundle workspace deps inline in tsup config so `@yao-pkg/pkg` produces a self-contained binary |
| B-03 | Fix desktop main resolution gap                      | 0.5 day  | Either pre-build deps or switch desktop main to tsup                                           |
| B-04 | Playwright specs — Mocks panel                       | 0.5 day  | Create mock → start → curl → stop                                                              |
| B-05 | Playwright specs — MCP panel                         | 0.5 day  | Snippet copy, client switch, catalog visible                                                   |
| B-06 | Playwright specs — Font + favicon                    | 0.25 day | Pick each font, reload, verify                                                                 |
| B-07 | Playwright specs — Plan execution full flow          | 0.5 day  | Plan with mixed assertions, history capture                                                    |
| B-08 | Playwright specs — Cross-tab sync, conflict resolver | 0.5 day  | Existing scenarios already covered? Verify                                                     |
| B-09 | Coverage uplift — close per-package gaps             | 1 day    | shared / core / git / new packages all to plan thresholds                                      |
| B-10 | Mutation tests (Stryker) on `core` + `shared`        | 0.5 day  | ≥ 80% kill rate gate                                                                           |
| B-11 | Help Center — Mocks section                          | 0.5 day  | New section + cross-links                                                                      |
| B-12 | Help Center — MCP section                            | 0.5 day  | Cross-link to docs/connect-your-ai-client.md                                                   |
| B-13 | Help Center — CLI section                            | 0.5 day  | Subcommand reference                                                                           |
| B-14 | Help Center — refresh other sections for Phase 2     | 0.25 day | Mention font picker, "AI assistant" cross-link                                                 |
| B-15 | First-run modal                                      | 1 day    | Three-way choice (Example / GitHub / Blank)                                                    |
| B-16 | Example workspace seed                               | 0.5 day  | Wire `examples/demo-workspace/`                                                                |
| B-17 | Empty-state CTAs                                     | 0.5 day  | Replace "no items" with action buttons                                                         |
| B-18 | Coachmark tooltips on first visit per panel          | 1 day    | Skippable, persisted in WorkspaceLocal.ui                                                      |
| B-19 | npm scope claim + token dry-run                      | 0.5 day  | Need your npm account                                                                          |
| B-20 | Apply to SignPath.io for free Windows OSS signing    | 0.25 day | Submit; approval is async (1-3 weeks)                                                          |
| B-21 | Publish `0.1.0-rc.1` to npm via release workflow     | 0.5 day  | Includes verification on a clean Node install                                                  |
| B-22 | GitHub Pages landing site                            | 1 day    | Hero, install, demo gif, docs links                                                            |
| B-23 | README polish + license reconciliation               | 0.5 day  | Unified to custom source-available license across root + publishable packages                  |
| B-24 | Repo flip private → public                           | 0.25 day | After everything else lands                                                                    |
| B-25 | Internal beta on a clean Windows + macOS machine     | 1 day    | You + me, parallel                                                                             |
| B-26 | Tag `v0.1.0` + GitHub Release + npm publish          | 0.25 day | Triggered by changeset PR merge                                                                |
| B-27 | Announcement post (optional)                         | 0.5 day  | If you want a launch post — Twitter/X, HN, dev.to                                              |

**Block B total:** ~13 person-days; with parallelism, ~10 calendar days.

## Sheet 4 — Risks and mitigations

| Risk                                                                         | Likelihood | Impact | Mitigation                                                                                       |
| ---------------------------------------------------------------------------- | ---------- | ------ | ------------------------------------------------------------------------------------------------ |
| Block A finds a fundamental design issue (e.g. mutation API needs reshaping) | Low        | High   | Spend extra week on B.1 if needed; slip launch by 1 week                                         |
| SignPath.io OSS application denied or slow                                   | Med        | Med    | Ship Windows unsigned with documented SmartScreen workaround as backup plan                      |
| `@apicircle` npm scope already taken                                         | Low        | High   | Have a backup name ready (e.g. `@apicircle-studio`)                                              |
| CLI binary packaging fails on @yao-pkg/pkg                                   | Med        | Med    | Drop platform binaries from v0.1.0; ship npm-only; users install via `npx`                       |
| Web build first-paint regressed by webfont download                          | Low        | Low    | Default `system-mono` doesn't fetch any webfont; only kicks in if user picks JetBrains/Inter/etc |
| Coverage thresholds slip in Block A fixes                                    | High       | Low    | B-09 catches it before publish                                                                   |
| OAuth2 flows fail in production due to environment differences               | Med        | High   | Already have golden-path tests; add manual verification in B-25                                  |

## Sheet 5 — Definition of "shipped"

A `0.1.0` tag on `main` is "shipped" only if all of:

1. CI green (typecheck, lint, format, unit + integration, e2e, bundle size, coverage)
2. Coverage gates hold per package (no `/* istanbul ignore */` comments without code-review reasons)
3. Web app deployed to GitHub Pages, reachable on the public URL
4. CLI installable via `npx @apicircle/cli`
5. Desktop installer downloadable from the release (unsigned + documented for v0.1.0)
6. Help Center has sections for every panel currently visible
7. First-run modal works; example workspace loads cleanly
8. README on the public repo includes install + quickstart + AI client snippet
9. CHANGELOG entry written

## How to use this doc

- Day 1 (2026-04-29): start your Block A pass. Note issues as you find them — append to a list at the bottom of this doc, or open as GitHub issues if you've already moved the repo public.
- Daily check-in (10 min, async): drop me a short update on what you covered + flagged.
- Day 5 (2026-05-03): hand the list to me, I take over.

If you need to extend Block A by a couple of days, that's fine — the schedule has the May 17-19 internal beta as buffer. Just don't compress Block B; that's where the launch readiness actually gets earned.

---

_Last updated: 2026-04-28_
