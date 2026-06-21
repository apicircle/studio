---
name: release-changelog
description: >-
  Generate the GitHub Release body for an API Circle Studio version by
  reformatting that version's CHANGELOG.md entry into the project's fixed
  release-notes template (intro → Highlights → per-section bodies → Install →
  Breaking Changes → Packages → Full Changelog). Use this whenever the user
  asks to create, write, draft, or generate release notes / release changelog
  content / a GitHub release body / "the release" for a version — e.g. "create
  release changelog content for 1.1.4", "generate the release notes for the
  next version", "draft the GitHub release for vX.Y.Z", or anytime they mention
  turning a CHANGELOG entry into release content. Trigger even if they don't say
  the word "template" — any request to produce GitHub-release / release-notes
  content from CHANGELOG.md belongs here.
---

# Release changelog content

Turn one version's entry in [`CHANGELOG.md`](../../../CHANGELOG.md) into the
**GitHub Release body** that ships on
`https://github.com/apicircle/studio/releases`.

The CHANGELOG is the exhaustive, contributor-facing engineering record. The
release body is the **reader-facing** version: a skimmer wants "what's in this
for me," up top, in plain language, with the install paths and the compare link
attached. This skill is the transform between the two. It is **not** a rewrite
of the facts — every claim in the release body must already be true in the
CHANGELOG entry. You are reformatting and tightening, not inventing.

A fully worked before/after (the real 1.1.2 entry → its shipped release body)
lives in [`references/worked-example.md`](references/worked-example.md). Read it
once before your first generation — it shows every transform concretely.

## Inputs

1. **Target version** — from the user's request (e.g. "1.1.4"). If they didn't
   name one, default to the **topmost dated entry** in `CHANGELOG.md`
   (`## x.y.z - YYYY-MM-DD`) and say which one you picked. If the only relevant
   content is still under `## Unreleased`, use that and tell the user it's
   unreleased (the version/date/Packages lines will be your best guess — flag
   them).
2. **The CHANGELOG entry** — the slice from `## <version> - <date>` down to the
   next `## ` header. Grep for `^## ` to get line numbers, then read just that
   range.
3. **The compare base** — the most recent **git tag** strictly below the target
   version. Run `git tag --list 'v*' --sort=-v:refname` and take the first tag
   that is lower than the target. This is **not** always the previous CHANGELOG
   header: a version that only bumped one package may never have been tagged
   (1.1.1 was a VS Code-only bump and was never tagged, which is why 1.1.2's
   compare link is `v1.1.0...v1.1.2`). Make the intro's "since X" wording match
   whatever base you choose.

## Workflow

1. Read the worked example (first run only).
2. Resolve the three inputs above.
3. Extract the CHANGELOG entry's intro paragraph (if any) and its `### Section`
   blocks.
4. Build the release body from the **output structure** below, in order.
5. Emit the whole thing inside one fenced ```markdown block so the user can copy
it wholesale. Then offer to (a) save it to `release-notes-<version>.md`, or
(b) create/update the GitHub release. Do **not** run `gh release` yourself
   unless the user explicitly asks — publishing is outward-facing.

## Output structure

Assemble these blocks in this exact order. Derived blocks come from the
CHANGELOG entry; boilerplate blocks are fixed text with `<version>` / `<prev>`
substituted.

### 1. Intro paragraph (derived)

One or two sentences. Lead with the release's _character_ — "A patch release",
"A version-alignment release", "The first minor-version cut since 1.0.0" — then
name the headline buckets in one flowing line (em-dashes are the house style).
Compress the CHANGELOG's intro paragraph; if the entry has none, synthesize one
from the section contents. Keep `@apicircle/*` and version numbers in backticks/
bold exactly as the CHANGELOG does.

### 2. `## Highlights` (synthesized — this is the editorial core)

A bulleted list, **3–6 items**, ordered by impact, headline change first. Each
item is a **bold theme lead-in** — em-dash — one plain-language sentence on what
changed and why a user cares. Give each major CHANGELOG section/theme one
highlight; this is where you translate engineering-precise bullets into reader
value. Don't copy a CHANGELOG bullet verbatim — distill it.

Example shape (from 1.1.2):
`- **Desktop auto-refresh hardening** — the workspace file watcher now survives
fs.watch events whose filename the OS omits, keeping the MCP/CLI → desktop
live-refresh path reliable on heavily-loaded hosts.`

### 3. Per-section bodies (derived)

For each `### Section` in the CHANGELOG entry, emit a `## Section` block —
preserving the CHANGELOG's section order — with these rules:

- **Demote the heading** `###` → `##`, and **strip any `— subtitle` suffix**:
  `### VS Code — Marketplace README polish` → `## VS Code`;
  `### Docs — Phase-process artifacts retired` → `## Docs`.
- **Drop the section's prose intro paragraph** (the blurb some sections put
  between the heading and the bullets) — keep the bullets.
- **Tighten each bullet to its essence.** Keep the bold lead-in (trim/canonicalize
  it), keep what a user or operator cares about (what changed, where it's
  visible, why). Drop contributor-only internals — exact file paths, function
  names, reproduction counts, bundle-size lines — _unless that detail is the
  point of the item_. Release bullets are noticeably shorter than CHANGELOG
  bullets.
- **`### Version alignment` is special — do NOT emit it as a body section.** Its
  content feeds the intro, a Highlight, and the `## Packages` block below.
- Common headings pass through as-is: `Added`, `Changed`, `Fixed`, `Removed`,
  `Deprecated`, `Security`, `Tests`, `Docs`. `VS Code …` → `VS Code`.

### 4. `## Install` (boilerplate — copy verbatim)

```markdown
## Install

- **Desktop** — download from the [Releases page](https://github.com/apicircle/studio/releases) (Windows / macOS / Linux)
- **Web** — [studio.apicircle.dev](https://studio.apicircle.dev)
- **npm** — `npm install @apicircle/cli` / `@apicircle/mcp-server` / `@apicircle/core` / `@apicircle/shared` / `@apicircle/mock-server-core`
- **VS Code** — install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=apicircle.apicircle-vscode) or [Open VSX](https://open-vsx.org/extension/apicircle/apicircle-vscode)

> **macOS install note:** the desktop build is unsigned. Run `xattr -d com.apple.quarantine /Applications/API\ Circle\ Studio.app` once after install. See [`docs/installing.md`](docs/installing.md).
```

The npm line lists only the **5 publishable packages** (`cli`, `mcp-server`,
`core`, `shared`, `mock-server-core`); `git` and `ui-components` are
workspace-private and never published.

### 5. `## Breaking Changes` (boilerplate)

```markdown
## Breaking Changes

None.
```

Only deviate if the CHANGELOG entry actually documents a breaking change — then
summarize it here instead of "None."

### 6. `## Packages` (boilerplate + entry-specific list)

```markdown
## Packages

All `@apicircle/*` packages ship at **<version>**: `shared`, `core`, `git`, `ui-components`, `mock-server-core`, `mcp-server`, `cli`, plus `apps/web`, `apps/desktop`, `apps/vscode`, and the e2e suites.
```

If the entry's `### Version alignment` section lists a different/extra set (e.g.
1.1.3 also bumped the `examples/mock-server` fixture), use that exact list.

### 7. Full Changelog link (boilerplate)

```markdown
**Full Changelog**: https://github.com/apicircle/studio/compare/v<prev>...v<version>
```

`<prev>` is the compare base from the Inputs step (most recent tag below
`<version>`).

## Guardrails

- **No invented facts.** If the release body would claim something not in the
  CHANGELOG entry, either remove it or go add it to the CHANGELOG first (and say
  so).
- **Match the house voice** — em-dash asides, backticked identifiers, bold
  lead-ins, sentence case. Mirror the worked example's register.
- **Keep it self-consistent** — the intro's "since X", the Highlights, the
  Packages version, and the compare base all reference the same versions.
