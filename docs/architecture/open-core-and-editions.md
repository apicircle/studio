# Open-core architecture & editions

API Circle Studio (this repository) is the **open core** — the source-available,
freely-usable API client: Git-backed workspaces, collections, environments,
mocks, desktop / web / VS Code surfaces, and compatibility with Lens-owned CLI/MCP automation.

A separate **proprietary edition**, developed in a private repository, builds
_on top of_ this open core to add paid, account-based capabilities. That edition
is out of scope for this repo. What matters here is the contract that keeps the
two in one logical codebase with **no duplication**.

## Single source of truth

This repository is the single source of truth for every open-core package
(`@apicircle/*`). Any edition built on top **consumes** these packages — via the
published npm artifacts or a pinned source checkout — and **never copies,
forks, or vendors** their source. Open-core changes therefore reach every
edition without duplicate work. A downstream consumer that relative-imports core
source instead of depending on the package is a bug.

## Composition over forking — extension seams

Editions layer on through **extension seams** the open-core packages expose, not
by editing those packages. Seams are introduced incrementally, and each is
**additive — a no-op when nothing plugs in** — so the open product is
unaffected:

- **Provider interfaces** — e.g. a Git provider interface in `packages/git`
  (GitHub ships here; other providers implement the same interface out-of-tree).
- **Composable entry points** — Studio keeps additive seams for downstream editions. Current MCP and headless CLI composition lives in API Circle Lens, not in this Studio app.
- **Typed extension points** — exported tool / handler types and, where present,
  UI extension registries.
- **UI panel registry** — the React shell (`packages/ui-components`) accepts
  edition-contributed top-nav panels via the optional `App` `extraPanels` prop
  (`ExtraPanelDef`, `layout/extraPanels.tsx`), rendered through `PanelTabs` /
  `PanelContent` / `Sidebar`. Additive and a no-op when empty — Studio registers
  none, so its panels are unchanged.
- **Sections (modes)** — the optional `App` `sections` prop (`SectionDef`,
  `layout/sections.ts`) groups the panels into top-level modes with a first-run
  landing. With two or more, each mode is a header in the tab strip: the active
  mode is unfolded to its own tabs beside its header, the others are folded, and
  pressing a header opens that mode. Pressing the active mode's header from one
  of its own tabs folds them into the header until the next press, or until
  another panel or mode opens; that fold is view state of the strip, stored
  nowhere, and it changes neither the mode nor the panel. The mode is stored per
  workspace, and so is
  the panel of its own each mode was left on: its header returns there, and a
  landing card opens a mode at the first panel of its own. A panel may be listed
  by more than one section; it is then shared, leads the tab strip in every
  mode, set off by a divider, and opening it never changes the mode.
  `layout/visibleTabs.ts` builds the strip once for `PanelTabs` and
  `KeyboardShortcuts`, so `Ctrl/Cmd + N` selects the Nth tab on screen in every
  mode. Additive and a no-op when empty.
- **Workspace status** — the optional `App` `workspaceStatus` prop is a node the
  top bar shows beside the workspace switcher. `WorkspaceStatusChip` is exported
  for it: the workspace's repository, working branch and unpushed-change count
  (the Workspace page's own figure, recounted once the workspace has been still
  for a moment, plus what each branch change source has included), or the step
  still missing — no Git host, no repository, no
  working branch, or a host the edition has locked. One click opens the
  Workspace page. Additive and a no-op when omitted: Studio passes nothing and
  its top bar is unchanged.
- **Top bar end** — the optional `App` `topBarEnd` prop is a node the top bar
  shows at its far end, after the Help icon: an edition's account menu. The far
  end is for what is reached from anywhere and is no stage of the work. Studio's
  own entry there is the Help Center: a core panel tagged `topBar`
  (`layout/panels.ts`) gets an icon button in the bar instead of a tab in the
  strip, so it has no `Ctrl/Cmd + N`. Such a panel is in place under every
  mode. An edition's sections should list tabs only (`PANELS` without `topBar`),
  so that opening it never moves the mode, and the shell does not move a reader
  off it when the workspace changes. Additive and a no-op when omitted: Studio
  passes nothing, and Help is then the last thing in its top bar.
- **Git host access** — the optional `App` `gitHostAccess` prop
  (`GitHostAccess`, `layout/gitHostAccess.ts`) names the hosts an edition
  registered that the current user may not use, plus an optional notice that
  explains the lock. A locked host stays listed, with a lock, but is never
  offered for a new connection or repo. A session saved on it is kept and can
  be disconnected, but is not used, and nothing refreshes against it in the
  background. The edition that registered the host enforces its use, because its
  provider factory refuses a locked host. Additive and a no-op when omitted:
  open core registers GitHub alone, and GitHub is never locked.
- **Branch change sources** — the optional `App` `branchChangeSources` prop
  (`BranchChangeSource[]`, `layout/branchChanges.ts`) lets an edition that
  changes OTHER files on the working branch — the Lens Code editor saves code
  into a local clone — join Studio's review, push and pull request. A source
  reports a live summary, renders its own section of the changes preview,
  pushes its part after Studio's commit (`pushBranchChanges` in the store:
  Studio first, so its secret scan and divergence check run before anything is
  written; then each source; then `recordBranchPush`, which adopts the new head
  and refreshes) and adds its part to the PR description. With a source
  registered the changes preview is where the push is chosen and made: it names
  the branch and repository, takes the commit message, says why a source cannot
  push (`blockedReason`), and ends in "Push N changes" counting Studio's changes
  (unless left out) and what each source has included. Additive and a no-op
  when omitted: with no source the working-branch card is byte-identical
  (pinned by `BranchCardGolden.test.tsx`).
- **Workspace access** — the optional `App` `workspaceAccess` prop
  (`WorkspaceAccess`, `layout/workspaceAccess.ts`) caps how many workspaces stay
  open; those beyond the cap are locked, never deleted. The workspace that is
  open always keeps a slot, so a cap that comes down (or has not loaded yet)
  never locks the user out of what they are editing; the remaining slots go
  oldest first. This seam is NOT a no-op when omitted: the default is a cap of
  one, because a build with no edition attached is the free tier. A locked
  workspace, or New workspace at the cap, opens the policy's `lockedNotice`.
  The default (`WorkspaceLockedNotice`) says nothing has been deleted and links
  to the pricing page, since open core has no account to upgrade; an edition
  passes its own notice with its own upgrade path.

- **Workspace-sharing switch** — `WORKSPACE_SHARING_ENABLED`
  (`packages/shared/src/types.ts`), read through `isWorkspaceSharingEnabled()`
  in `ui-components/src/layout/workspaceSharing.ts` and mirrored in the VS Code
  extension. Unlike the seams above this one is NOT additive and NOT
  edition-configurable: it is hard-coded `false`, and there is deliberately no
  prop, context or setting an edition can pass to turn it on, because a
  user-reachable toggle would make a withheld feature discoverable. It hides
  the Link Workspace / linked-content / Releases / Topics cluster on every
  surface while leaving the types, patch variants and core helpers live, so the
  data round-trips and re-enabling is a code change rather than a migration.

The historical MCP dependency-injection template moved to API Circle Lens with the current MCP server. New Studio seams should remain additive and no-op when nothing plugs in. Two deliberate exceptions are above, each with its rationale: the workspace-sharing switch, and the workspace cap's default of one.

## Workspace-directory sidecar contract

The Git-backed workspace directory — `.apicircle/workspace-<id>/` — is **shared
space.** API Circle owns `workspace.json`, `workspace.local.json`, and
`attachments/`, but external tools (including any edition built on the open
core) may store their own data in **sibling files or subdirectories** under that
directory — for example, an external analysis or indexing tool keeping a cache
alongside the workspace.

**Every API Circle writer MUST preserve files it does not own:**

- **Disk writes** — `saveToFile` (and the desktop mirror via `saveWorkspaceById`)
  write only the workspace JSON files and never clean the directory; siblings
  are left intact.
- **Git push** — the commit tree is built with `base_tree`, inheriting every
  path not explicitly overridden, so sidecar files committed to the repo survive
  a push untouched. The only deletions emitted are explicit `{ path, sha: null }`
  markers for queued attachment removals.
- **Remote parse** — `parseWorkspaceJson` preserves unknown fields (it only
  strips prototype-pollution keys).

The only path that removes the directory wholesale is an explicit workspace
**delete** (`deleteWorkspaceById` → `fs.rm` recursive), which is the intended
semantics.

These guarantees are locked by regression tests in
`packages/core/src/workspace/fileBackedWorkspace.test.ts`,
`packages/ui-components/src/store/pushWorkspace.test.ts`, and
`packages/core/src/git/parseWorkspaceJson.test.ts`. **Do not introduce a write
path that cleans the workspace directory or rebuilds the Git tree from
scratch** — it would silently delete sidecar data an external tool depends on.
