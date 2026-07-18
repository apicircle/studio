# Changelog — API Circle Studio for VS Code

All notable changes to the **API Circle Studio** VS Code extension are documented
here. This is the file the VS Code Marketplace and the Open VSX "Changes" tab
render. The format follows [Keep a Changelog](https://keepachangelog.com/); the
extension version lives in `package.json`.

> Monorepo-wide release notes (web, desktop, CLI, MCP, npm packages) live in the
> repository-root [`CHANGELOG.md`](../../CHANGELOG.md). This file is the
> extension-focused subset that ships inside the `.vsix`.

## 1.3.0 - 2026-07-18

### Added

- **Promote mock endpoints into a collection.** A mock server's endpoint node
  now has an **Add to Collection** action, and the server node has **Add All to
  Collection** — promote one endpoint or the whole mock at once. Promoted
  requests land in a `<name> (mock)` folder with a
  `{{MOCK_BASE_URL}}:{{MOCK_PORT}}<path>` URL, backed by a dedicated, activated
  **Mock** environment (`MOCK_BASE_URL` + `MOCK_PORT`, prefilled from the mock's
  port else `8080`) — so the request is runnable and easy to retarget. Behaves
  identically to the Desktop/Web app and the MCP server (`mock.promote_endpoint`
  / `mock.promote_to_collection`); all three go through one shared builder in
  `@apicircle/core`.

## 1.1.4 - 2026-06-22

### Added

- **Per-plan environment selection.** A new **API Circle: Set Plan Environments…**
  command lets you choose which environments — local **and** linked — overlay a
  plan's runs, and in what priority order. Reach it from the Execution view's
  inline 🌐 button, the plan's right-click menu, the Command Palette, or the
  `◆ Plan environments…` CodeLens on a plan YAML. Pick none to inherit the
  workspace-wide order. The choice round-trips through the plan YAML's
  `envPriorityOrder:` block (still editable directly, with completion).

### Fixed

- **Execution plans now appear in the Execution view.** Plans created in the
  Desktop app or CLI — and shared with your team through Git — were invisible in
  the extension, because it was still reading a deprecated, device-local store.
  The Execution view, plan YAML, `▶ Run Plan`, step enable/disable, and the
  history plan names now read the Git-synced plan store, so plans round-trip
  across Desktop, CLI, MCP, and VS Code. Creating or editing a plan in the
  extension now persists to that shared store too.
- **`▶ Run Plan` CodeLens targets the correct plan after a rename** — it now
  resolves the plan by its stable id (the `?id=` URI query) instead of the
  file-name slug.
- **Plans created in an earlier extension version are preserved.** If you
  authored plans with a pre-1.1.4 build (which stored them device-locally), the
  extension now lifts them into the Git-synced store on load instead of showing
  an empty Execution view — no plans are lost on upgrade.

### Changed

- **Embedded MCP server (bundled in the extension).** The `plan.*` and
  `prompt.*_plan_*` tools now read and write the Git-synced plan store. Plan
  authoring tools (`plan.create`, `plan.update`, `prompt.create_plan`) accept
  structured `envPriorityOrder` entries — a bare string is a local env name, and
  `{ kind: "linked", linkedWorkspaceId, envName }` targets a linked env — and
  `plan.update` can now toggle `stopOnAssertionFailure`.
