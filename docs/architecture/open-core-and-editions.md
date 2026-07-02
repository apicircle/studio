# Open-core architecture & editions

API Circle Studio (this repository) is the **open core** — the source-available,
freely-usable API client: Git-backed workspaces, collections, environments,
mocks, MCP integration, and the CLI / desktop / web / VS Code surfaces.

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
- **Composable entry points** — the CLI program builder and the MCP server's
  injectable tool list let an out-of-tree package add commands / tools without
  forking the binary.
- **Typed extension points** — exported tool / handler types and, where present,
  UI extension registries.
- **UI panel registry** — the React shell (`packages/ui-components`) accepts
  edition-contributed top-nav panels via the optional `App` `extraPanels` prop
  (`ExtraPanelDef`, `layout/extraPanels.tsx`), rendered through `PanelTabs` /
  `PanelContent` / `Sidebar`. Additive and a no-op when empty — Studio registers
  none, so its panels are unchanged.

The proven template already in this repo is the MCP server's dependency
injection: tool handlers depend on the `WorkspaceProvider` / `Workspaces` /
`MockController` interfaces, and `createMcpServer` accepts an injectable tool
list. New seams follow that shape.

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
