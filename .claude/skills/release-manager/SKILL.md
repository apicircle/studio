---
name: release-manager
description: >-
  Cut and ship a new version of API Circle Studio end to end — the whole release
  lifecycle, not just one piece. Use this whenever the user wants to release,
  ship, cut, publish, or tag a version (e.g. "cut the 1.1.6 release", "ship the
  next version", "do the release", "publish to npm"), bump the version across the
  monorepo ("bump version to X.Y.Z across all packages"), write or update a
  CHANGELOG.md entry for a version, or generate the GitHub Release body / release
  notes for a version ("draft the release notes for 1.1.6", "write the GitHub
  release for vX.Y.Z", "turn the changelog entry into release content"). This
  skill OWNS release-notes generation — it absorbed the former release-changelog
  skill — so any request to turn a CHANGELOG entry into a GitHub release body
  belongs here. Trigger even if the user names only one step (just the bump, just
  the notes); the skill knows where that step sits in the lifecycle. Does NOT
  cover the in-product workspace "releases" feature (release.publish / deprecate
  / yank that linked consumers pin to) — that's a product surface, not a ship.
---

# Release manager

The single runbook for shipping a version of API Circle Studio: version bump →
CHANGELOG → quality gates → release notes → push + tag → hand npm to Lens →
verify.

## How a release ships here — read this first

A release is **CI-driven**. You never publish from your laptop. Your job is to
land the right _source edits_ on `main` — uniform version bumps plus a CHANGELOG
entry — and produce the one _outward-facing artifact_ CI can't write for you: the
GitHub Release body. **Pushing those edits to `main`, then the `v<version>`
tag, is the act of releasing.** The workflows do the rest, except npm: the Lens
repo publishes that once it syncs the commit.

| When this happens                        | Workflow                | What it does                                                                                                          |
| ---------------------------------------- | ----------------------- | --------------------------------------------------------------------------------------------------------------------- |
| push to `main` (web/packages touched)    | `deploy-web.yml`        | rebuilds `apps/web` → GitHub Pages (studio.apicircle.dev)                                                             |
| push to `main` (vscode/upstream touched) | `vscode-publish.yml`    | publishes the VS Code extension to Marketplace + Open VSX (`--skip-duplicate`)                                        |
| you push the `v<version>` tag            | `desktop-release.yml`   | builds Win/macOS/Linux Electron installers and publishes them to a **GitHub Release** with `electron-updater` indexes |
| the version reaches Lens `main` (a sync) | Lens `release-core.yml` | publishes the **3 public** `@apicircle/*` npm packages at the synced version (skips any already on npm)               |

Three things to internalize:

- **npm is published from the Lens repo, not here.** This repo has no npm
  workflow and holds no npm token. Lens vendors it with
  `pnpm sync:studio --apply`, and Lens's `release-core.yml` publishes `shared`,
  `core` and `mock-server-core` when a sync carrying a new version reaches Lens
  `main`. A Studio version is not on npm until that sync lands.
- **You push the `v<version>` tag.** A tag pushed by a person starts
  `desktop-release.yml`, which builds the installers and creates the GitHub
  Release. A tag pushed with the workflow token starts no workflow, which is why
  every Desktop Release run in the old `release.yml` era was a manual dispatch.
- **Everything is idempotent.** npm publish skips live versions, `vsce`/`ovsx`
  use `--skip-duplicate`, re-running a workflow is a safe no-op. A half-finished
  release is recovered by **re-running**, not by cleanup.

## The runbook

### 0. Preflight

- Clean tree on `main` (`git status`); all feature work for this version merged.
- Pick the **target version** + bump type. Semver: patch = fixes only, minor =
  new features, major = breaking. The project is pre-launch with zero installed
  users, so minor-for-features is the norm and majors are rare.
- See what's shipping: `git log --oneline "v<last-tag>"..HEAD` and
  `git tag --list 'v*' --sort=-v:refname`.

### 1. Bump every package to the target version

One release = **one version across the whole monorepo** (root + all 14 workspace
packages). This is non-negotiable: `desktop-release.yml` hard-fails when the
`v*` tag doesn't equal `apps/desktop/package.json`, and a mixed npm set is
incoherent for consumers. Use the bundled helper — it reads the package globs
from `pnpm-workspace.yaml`, so it can't drift from the real layout:

```bash
node .claude/skills/release-manager/scripts/bump-version.mjs <version> --dry  # preview
node .claude/skills/release-manager/scripts/bump-version.mjs <version>        # apply
pnpm install --lockfile-only   # refresh pnpm-lock.yaml to the new versions
git diff                        # eyeball it
```

The 15 manifests: root `package.json`; `packages/{shared,core,git,ui-components,mock-server-core,desktop-shell}`; `apps/{web,desktop,vscode}`; `e2e/{web,desktop,mock,vscode}`; `examples/mock-server`.

> Changesets is installed (`pnpm changeset`, `pnpm release`) but is **not** the
> shipping path — Lens's `release-core.yml` publishes whatever version is
> checked in, with no changeset PR. Don't open a changeset PR unless the user
> explicitly asks for that flow. There is no `release:publish` script: npm
> publishing happens only in Lens.

### 2. Write the CHANGELOG entry

Add a new entry at the **top** of [`CHANGELOG.md`](../../../CHANGELOG.md),
directly under the macOS-quarantine banner:

```markdown
## <version> - <YYYY-MM-DD>

<one-paragraph intro: the release's character + the headline buckets>

### Added

- **Bold lead-in.** What changed, where it's visible, why it matters.

### Fixed

- ...
```

Section order: `Added → Changed → Fixed → Removed → Deprecated → Security →
Tests → Docs`, plus `VS Code …` and `Version alignment` blocks where relevant.
This is the **exhaustive, contributor-facing** record — be precise; file paths,
function names, and internals belong here (they get trimmed for the reader-facing
release body in step 4). Match the house voice: em-dash asides, backticked
identifiers, bold lead-ins, sentence case.

### 3. Run the quality gates

Never ship red. From the repo root:

```bash
pnpm lint && pnpm check && pnpm test && pnpm build
```

If UI or e2e-covered behavior changed, also `pnpm test:e2e`. These mirror what
`ci.yml` runs anyway — catching a failure locally beats a failed release. (For a
fuller dress rehearsal, `pnpm ci:local -- --list`.)

### 4. Generate the GitHub Release body (release notes)

Transform the CHANGELOG entry into the reader-facing release body — the part CI
can't author. The CHANGELOG is the engineering record; the release body is "what's
in this for me," up top, in plain language, with install paths and a compare link.
It is a **reformat, not a rewrite** — every claim must already be true in the
CHANGELOG entry.

- **Template + transform rules:** [`references/release-notes.md`](references/release-notes.md)
- **A full worked before/after (1.1.2):** [`references/worked-example.md`](references/worked-example.md) — read it once before your first generation.

Emit the whole body inside one fenced ` ```markdown ` block so the user can copy
it wholesale. Then offer to save it to `release-notes-<version>.md`. **Do not run
`gh release` yourself unless asked** — publishing is outward-facing, and
`desktop-release.yml` auto-creates the GitHub Release from the tag; the body is
pasted onto it (or `gh release edit "v<version>" --notes-file …` on request).

### 5. Commit, push, and tag — this is the release

Stage the bump + lockfile + CHANGELOG and commit with a Conventional Commit
(commitlint + Husky enforce this; never `--no-verify`). The repo's established
message:

```
chore: bump version to <version> across all packages
```

Then push `main` and tag the release commit:

```bash
git push origin main
git tag -a "v<version>" -m "Release v<version>"
git push origin "v<version>"
```

**These pushes publish the release.** `main` redeploys the web app and publishes
the VS Code extension; the tag builds the desktop installers and creates the
GitHub Release. Treat both like any hard-to-reverse outward-facing action:
confirm with the user before pushing unless they've already told you to proceed.

### 6. Hand npm to Lens

npm is published from the Lens repo, not from here. In the Lens checkout
(`../lens`), vendor this commit and get it to Lens `main`; that push runs Lens's
`release-core.yml`, which publishes `shared`, `core` and `mock-server-core` at the
new version. The sync lands in another repo with its own gates, so confirm with
the user before starting it. Lens's `docs/releasing-npm.md` is the runbook.

```bash
pnpm sync:studio --apply   # in ../lens, then pnpm verify, commit, and merge to main
```

### 7. Watch and verify

```bash
gh run list --branch main --limit 5             # the Deploy web + VS Code publish runs
gh run watch <run-id>                            # follow one to green
gh run list --workflow desktop-release.yml --limit 3   # installers building off the tag
gh release view "v<version>"                     # the GitHub Release + assets
npm view @apicircle/core version                 # once the Lens sync is on its main
```

**Done when:** `v<version>` exists, the desktop installers are attached to the
GitHub Release, the release body is the one from step 4, and — once the Lens sync
reaches its `main` — the 3 npm packages show the new version.

## Load-bearing rules

- **Only 3 packages publish to npm:** `shared`, `core`, `mock-server-core` — and
  the Lens repo publishes them (the allowlist is `RELEASE_PACKAGES` in Lens's
  `.github/workflows/release-core.yml`). `git`, `ui-components` and
  `desktop-shell` are workspace-private; `apps/*`, `e2e/*`, `examples/*` never
  publish. The CLI and MCP server are Lens products (`@apicircle-lens/cli`) —
  never list them in a Studio release.
- **`@apicircle` is the npm _username_ `apicircle`, not an org.** The publish
  token (`NPM_TOKEN`) lives in the Lens repo and must come from that account;
  this repo holds none.
- **Packing goes through pnpm, not npm** — pnpm rewrites `workspace:*`
  specifiers to real versions and applies `publishConfig`; an npm-packed
  tarball would be uninstallable (`EUNSUPPORTEDPROTOCOL`). Lens's workflow packs
  with pnpm and uploads the tarball with npm.
- **The release-notes compare base is the most recent `v*` tag strictly _below_
  the target — not always the previous CHANGELOG header.** A version that bumped
  only one package may never have been tagged (1.1.1 was VS Code-only and untagged,
  so 1.1.2's compare link is `v1.1.0...v1.1.2`).
- **Desktop builds are unsigned** until signing certs are funded — the macOS
  quarantine note rides at the top of `CHANGELOG.md` and inside the release
  `## Install` block. Don't drop it.
- **No invented facts in the release body.** If it would claim something not in
  the CHANGELOG entry, either cut it or go add it to the CHANGELOG first (and say
  so).

## Inputs you resolve every time

1. **Target version** — from the user; else default to the topmost dated
   `## x.y.z - YYYY-MM-DD` in `CHANGELOG.md` and say which one you picked. If the
   only relevant content is under `## Unreleased`, use it and flag that the
   version/date are your best guess.
2. **The CHANGELOG slice** — from `## <version>` down to the next `## `. Grep
   `^## ` for line numbers, then read just that range.
3. **The compare base** — `git tag --list 'v*' --sort=-v:refname`; take the first
   tag lower than the target.

## What's bundled

- `scripts/bump-version.mjs` — dependency-free helper that bumps every workspace
  manifest (root + 14 packages) to one version. Has a `--dry` preview.
- `references/release-notes.md` — the GitHub Release body template + the
  CHANGELOG→release transform rules.
- `references/worked-example.md` — the real 1.1.2 CHANGELOG entry → shipped
  release body, with the deltas annotated.
