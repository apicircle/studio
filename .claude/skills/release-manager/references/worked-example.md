# Worked example — 1.1.2

The real transform that defines the release-notes step: the **1.1.2
`CHANGELOG.md` entry** (input) and the **shipped GitHub release body** (output).
Study the deltas, not just the shapes.

---

## INPUT — the `CHANGELOG.md` entry

```markdown
## 1.1.2 - 2026-06-19

Version-alignment release. The 1.1.1 bump only touched the VS Code extension
(`apicircle-vscode`); all other `@apicircle/*` packages stayed at 1.1.0. This
release brings every package in the monorepo to a single consistent **1.1.2**
so that version numbers are uniform across the board going forward. It also
folds in the desktop external-write auto-refresh watcher hardening and the
accompanying E2E reliability fixes landed since 1.1.0.

### Version alignment

All `@apicircle/*` packages — `shared`, `core`, `git`, `ui-components`,
`mock-server-core`, `mcp-server`, `cli`, plus `apps/web`, `apps/desktop`,
`apps/vscode`, and the e2e suites — now ship at **1.1.2**.

### Fixed

- **Desktop external-write auto-refresh — watcher robustness on edge-case
  filesystems** — the workspace file watcher
  (`apps/desktop/src/main/workspaceFile/workspaceWatcher.ts`) now treats
  `fs.watch` events whose filename the OS omits (`filename === null` …) as
  "the watched target may have changed," for both the per-directory
  `workspace.json` and the root `registry.json` emit branches … This hardens
  the MCP/CLI → desktop live-refresh path on overlayfs / heavily-loaded hosts.

### Tests

- **Desktop `external-write-refresh` E2E fixture corrected (orphan request)** —
  the regression test simulated an external MCP/CLI write by adding a top-level
  request to `collections.requests` only. A real write goes through
  `applyMutation` → `applyRequestCreate`, which also appends … The fixture now
  mirrors `applyRequestCreate` exactly. Not a product bug …

- **Desktop `external-write-refresh` E2E hardened against a boot-churn write
  race** — … The test now waits for `workspace.json` and `registry.json` to
  reach genuine on-disk quiescence (size+mtime stable, JSON parseable) before
  writing … so no product change was warranted.

### VS Code — Marketplace README polish

Follow-up to the 1.1.1 Marketplace README rewrite, addressing one issue that
only surfaces when the README is rendered standalone …

- **Broken `LICENSE` link** — the "See repo-root LICENSE" link used a relative
  `../../LICENSE` path which resolved on GitHub but 404'd on both the Visual
  Studio Marketplace and Open VSX detail pages. Swapped for the absolute
  `https://github.com/apicircle/studio/blob/main/LICENSE`.

### Docs — Phase-process artifacts retired

Now that the VS Code extension has shipped … Both are removed in favour of
cleaner, evergreen references …

- **`docs/vscode-extension.md` deleted** (1865 lines). The doc was organised as
  a Phase 1 → Phase 12 development chronicle … duplicated material that already
  lives in the root README, the extension README, CLAUDE.md …
- **`docs/vscode-extension-install-publish.md` deleted** (340 lines). …
- **`docs/apicircle-yaml-format.md` deleted** (508 lines). …
- **Live references swept** — CLAUDE.md §9 doc index, root README …
- **Historical CHANGELOG mentions preserved** — …
```

---

## OUTPUT — the GitHub release body

```markdown
A version-alignment release — every `@apicircle/*` package is brought to a single consistent **1.1.2** — folding in desktop external-write auto-refresh watcher hardening, E2E reliability fixes, a VS Code Marketplace README polish, and a phase-process docs cleanup landed since 1.1.0.

## Highlights

- **Unified versioning** — the 1.1.1 bump only touched the VS Code extension (`apicircle-vscode`); every other `@apicircle/*` package stayed at 1.1.0. This release aligns the entire monorepo to a single **1.1.2** so version numbers are uniform across the board going forward.
- **Desktop auto-refresh hardening** — the workspace file watcher now survives `fs.watch` events whose filename the OS omits (`filename === null`, seen on some Linux filesystems under load), keeping the MCP/CLI → desktop live-refresh path reliable on overlayfs / heavily-loaded hosts.
- **E2E reliability** — the desktop `external-write-refresh` regression test is fixed against an orphan-request fixture bug and a boot-churn write race that made it flaky on Windows under full-suite I/O load.
- **VS Code Marketplace polish** — fixed the broken `LICENSE` link that 404'd on the Marketplace / Open VSX detail pages (relative repo paths don't resolve there).
- **Docs slimmed** — three phase-process / runbook artifacts (2,713 lines total) retired now that the VS Code extension has shipped and is published.

## Fixed

- **Desktop external-write auto-refresh — watcher robustness on edge-case filesystems** — the workspace file watcher now treats `fs.watch` events whose filename the OS omits as "the watched target may have changed," for both the per-directory `workspace.json` and the root `registry.json` branches, instead of dropping them. Stat-based self-write suppression still discards byte-for-byte-unchanged events, so there's no false external-change or refresh loop.

## Tests

- **`external-write-refresh` fixture corrected (orphan request)** — the regression test now mirrors `applyRequestCreate` exactly, appending the request to `collections.tree.children` (not just `collections.requests`) so the simulated external write renders in the editor sidebar. Not a product bug.
- **`external-write-refresh` hardened against a boot-churn write race** — the test now waits for `workspace.json` and `registry.json` to reach genuine on-disk quiescence (size+mtime stable, JSON parseable) before writing, encoding its real premise: an idle, fully-booted desktop. No product change warranted.

## VS Code

- **Marketplace README — broken `LICENSE` link fixed** — the "See repo-root LICENSE" link used a relative `../../LICENSE` path that resolved on GitHub but 404'd on the Visual Studio Marketplace and Open VSX detail pages. Swapped for the absolute `https://github.com/apicircle/studio/blob/main/LICENSE`.

## Docs

- **`docs/vscode-extension.md` deleted** (1,865 lines) — a Phase 1→12 development chronicle whose live content already lives in the READMEs, CLAUDE.md, and `apps/vscode/package.json`.
- **`docs/vscode-extension-install-publish.md` deleted** (340 lines) — a one-shot maintainer publication runbook, now automated by `.github/workflows/vscode.yml`.
- **`docs/apicircle-yaml-format.md` deleted** (508 lines) — superseded by VS Code's live completion / hover / diagnostics + the registered JSON Schema.
- **Live references swept** across CLAUDE.md §9, the root README, `docs/auth.md`, `docs/qa/README.md`, and the VS Code CI workflow.

## Install

- **Desktop** — download from the [Releases page](https://github.com/apicircle/studio/releases) (Windows / macOS / Linux)
- **Web** — [studio.apicircle.dev](https://studio.apicircle.dev)
- **npm** — `npm install @apicircle/cli` / `@apicircle/mcp-server` / `@apicircle/core` / `@apicircle/shared` / `@apicircle/mock-server-core`
- **VS Code** — install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=apicircle.apicircle-vscode) or [Open VSX](https://open-vsx.org/extension/apicircle/apicircle-vscode)

> **macOS install note:** the desktop build is unsigned. Run `xattr -d com.apple.quarantine /Applications/API\ Circle\ Studio.app` once after install. See [`docs/installing.md`](docs/installing.md).

## Breaking Changes

None.

## Packages

All `@apicircle/*` packages ship at **1.1.2**: `shared`, `core`, `git`, `ui-components`, `mock-server-core`, `mcp-server`, `cli`, plus `apps/web`, `apps/desktop`, `apps/vscode`, and the e2e suites.

**Full Changelog**: https://github.com/apicircle/studio/compare/v1.1.0...v1.1.2
```

---

## What changed in the transform (read these deltas)

1. **Intro** — 4 sentences → 1 flowing em-dash sentence; front-loads the buckets.
2. **`## Highlights` is new** — synthesized, one per theme, reader-facing value.
   Note "Docs slimmed" sums the three deleted docs (1865+340+508 = **2,713
   lines**) — a detail the CHANGELOG never states outright. Synthesis like that
   is allowed _because every input fact is present_; you're aggregating, not
   inventing.
3. **Heading demotion + subtitle strip** — `### VS Code — Marketplace README
polish` → `## VS Code`; `### Docs — Phase-process artifacts retired` →
   `## Docs`.
4. **Section prose intros dropped** — the VS Code and Docs blurbs between heading
   and bullets are gone; only bullets survive.
5. **Bullets tightened** — file paths and reproduction counts (`6/6 fail`,
   `8/8 by forcing…`) removed from the Tests bullets; bold lead-ins canonicalized
   (`Desktop \`external-write-refresh\` E2E fixture corrected`→`\`external-write-refresh\` fixture corrected`).
6. **`### Version alignment` lifted out** — it feeds the intro, the "Unified
   versioning" highlight, and the `## Packages` block; it is not its own body
   section.
7. **Boilerplate appended** — Install, macOS note, Breaking Changes, Packages,
   Full Changelog. Compare base is **v1.1.0**, not v1.1.1 (1.1.1 was never tagged).
