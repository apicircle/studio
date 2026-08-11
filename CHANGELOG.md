# Changelog

> ### ⚠️ macOS install note — remove the quarantine flag
>
> The desktop builds are **unsigned** until code-signing certificates are
> funded. On macOS Sequoia and newer, this means that after dragging
> **API Circle Studio** into `/Applications`, the first launch can fail with
> _"API Circle Studio is damaged and can't be opened. You should move it to
> the Trash."_ — and the **Open Anyway** button under System Settings →
> Privacy & Security may not appear at all. The binary is fine; macOS is
> refusing to run anything carrying the download-quarantine extended
> attribute from an unidentified developer.
>
> Open **Terminal** and run this once to strip the flag, then re-launch the
> app from `/Applications`:
>
> ```
> xattr -d com.apple.quarantine /Applications/API\ Circle\ Studio.app
> ```
>
> If Terminal answers `No such xattr` the flag was already absent — ignore
> the message. Repeat the command once per auto-update until signed builds
> ship. Full per-platform walk-through:
> [`docs/installing.md`](docs/installing.md).

## Unreleased

### Added

- **New assertion kind — `json-schema` (`@apicircle/shared`, `@apicircle/core`).**
  Validates a whole value against a JSON Schema (carried in `expected` as a JSON string;
  `target` selects the value, default the response body) — the only kind that checks structure
  recursively in ONE assertion: nested objects, required fields, and **array element shapes**
  (an empty array passes, so it never false-fails), and, with `additionalProperties: false`,
  unexpected fields. Backed by a small dependency-free validator (`jsonSchemaValidate.ts`)
  covering `type` (incl. nullable type-arrays + `integer`), `properties`/`required`,
  `additionalProperties`, `items`, `enum`, and string `pattern`; failures report the first
  mismatch as a `$`-rooted path. Wired into the request editor's Assertions tab (a "JSON schema"
  kind with a schema editor) and the MCP `assertion.create` / `prompt.create_assertion` tools.
  Purely additive — every existing assertion evaluates exactly as before. _(Authoring in the
  linked-override editor and the VS Code request YAML, plus the Help Center section, land in a
  follow-up; a `json-schema` assertion created anywhere already RUNS everywhere via the shared
  engine.)_
- **Two new assertion operators — `exists` and `type` (`@apicircle/shared`,
  `@apicircle/core`).** `exists` passes when the target resolves (a present header or
  JSON path) and ignores `expected`; `type` checks a value's JSON type against
  `expected` (`string` / `number` / `boolean` / `array` / `object` / `null`, with
  `null` and `array` distinguished from `object`). Wired end to end: the request
  editor's Assertions tab (the value field hides for `exists` and becomes a JSON-type
  dropdown for `type`), the linked-workspace override editor, the MCP `assertion.*` /
  `prompt.*` tools, and the VS Code request YAML (completion list + JSON schema). The
  Help Center's Assertions section documents both. Purely additive — every existing
  assertion evaluates exactly as before.
- **Header `brand` seam on `<App>` / `<TopBar>` (`@apicircle/ui-components`).** An
  additive, no-op-in-Studio prop: omit it and the top bar is byte-identical
  ("API Circle Studio" + the tagline). An edition can pass
  `brand={{ name, tagline? }}` to show its own umbrella brand (e.g. "API Circle")
  and, with `tagline: null`, drop the sub-line; leaving `tagline` undefined keeps
  Studio's default. Exported `BrandDef`. No existing prop, default, or the
  Studio-standalone header changed.
- **Issue / PR comment methods on the `GitProvider` contract (`@apicircle/git`).**
  `GitHubClient` gains `listIssueComments` / `createIssueComment` /
  `updateIssueComment` (thin REST wrappers over the issue-comments API — a PR is
  an issue for this endpoint), and the three join the `GitProviderMethod` union so
  any host provider can implement them. Additive; no existing method or type
  changed. This is the write capability an edition's PR-review write-back (post the
  review as an idempotent PR comment) composes on top of.
- **`readAttachmentBytes(slotId)` public accessor (`@apicircle/ui-components`).**
  A narrow, additive export that reads a stored attachment's raw bytes by its
  `GlobalFileAsset.slotId` (or `null` when absent), so an edition / overlay can
  resolve an asset's bytes — e.g. parse a stored OpenAPI spec for code-vs-spec
  drift — without reaching into the internal `AttachmentRecord` shape or the
  IndexedDB layer. Purely additive; no existing behavior changes.
  (`@apicircle/ui-components`)
- **`parseOpenApiRequestBodies(source, format, deps)` parser export
  (`@apicircle/mock-server-core`).** A new additive export that returns each
  operation's **request-body schema** — the one part of an operation's contract
  the mock pipeline deliberately drops (`MockEndpoint` carries no request body,
  since the mock server never validates request bodies). It walks the same
  dereferenced operations as `parseOpenApiToEndpoints` and emits
  `{ method, path, contentType, schema, required }` per operation: OpenAPI 3.x
  `requestBody` content (a JSON media type preferred) and Swagger 2.0
  `in: 'body'` parameters both reduce to the same shape. Exposed browser-safe
  from the `/parsing` subpath and swagger-parser-backed from the Node root
  (mirroring `parseOpenApiToEndpoints`), so a consumer — e.g. the Lens
  code-vs-spec contract-drift check — can read a request body's declared shape
  and join it to the endpoint table by `(method, path)`, without touching
  `MockEndpoint` or the mock runtime. Purely additive.
  (`@apicircle/mock-server-core`)

## 1.3.0 - 2026-07-18

_All workspace packages move to **1.3.0** in lockstep — the published
`@apicircle/shared`, `@apicircle/core`, `@apicircle/mock-server-core`,
`@apicircle/mcp-server`, `@apicircle/cli`, and the `apicircle-vscode` VS Code
extension, plus the private desktop / web / ui-components / git / desktop-shell
packages. Highlights: the **spec asset hub** (upload an OpenAPI/Swagger spec
once, then serve it live or import it as a mock, import it as a collection, and
promote mock endpoints into runnable requests) and **Mock → collection parity**
across the app, the MCP server, and the VS Code extension._

### Added

- **Mock → collection parity across the MCP server + VS Code (catalog 96 → 97).**
  `mock.promote_endpoint` now produces a RUNNABLE request like the app —
  ensuring the active `Mock` environment (`MOCK_BASE_URL` + `MOCK_PORT`,
  prefilled from the mock's port else `8080`, existing values preserved),
  dropping it in a `<name> (mock)` folder, and templating the URL
  `{{MOCK_BASE_URL}}:{{MOCK_PORT}}<path>` — and a new
  `mock.promote_to_collection` tool promotes every endpoint at once. The VS Code
  extension gains matching **Add to Collection** (mock endpoint node) + **Add
  All to Collection** (mock server node) commands. All surfaces go through one
  shared `buildMockPromotion` (`@apicircle/core`), so the web/desktop store, the
  MCP server, and the VS Code extension stay in lockstep.
  (`@apicircle/shared`, `@apicircle/core`, `@apicircle/mcp-server`, VS Code)
- **Spec-typed Global File Assets (additive).** Uploading an OpenAPI 3.x /
  Swagger 2.0 document (`.json` / `.yaml` / `.yml`) into the Global Assets
  **Files** library now parses it once on upload and records a `SpecAssetMeta`
  summary (`dialect`, `format`, `title`, `version`, `operationCount`,
  `warnings`) on the asset. The Assets panel shows a spec badge
  ("OpenAPI 3 · N ops") plus a parsed summary in the file editor, and the MCP
  `assets.list_files` envelope gains a `spec` field (`null` for ordinary files).
  Purely additive — existing assets and non-spec files are untouched. Foundation
  for spec-driven mock servers and code-vs-spec drift.
  (`@apicircle/shared`, `@apicircle/mock-server-core`, `@apicircle/ui-components`,
  `@apicircle/mcp-server`)
- **Mock servers from a spec asset — "run live" vs "import & edit" (additive).**
  A mock server can now be built from an uploaded spec asset (`GlobalFileAsset`)
  in two modes: **linked** ("run live" — endpoints derive from the asset and stay
  in sync; read-only) or **materialized** ("import & edit" — parsed into editable
  endpoints). New `MockServerSource` variant
  `{ kind: 'openapi-asset', assetId, format, mode }` + an `isLinkedMockSource`
  helper; the store resolves the asset's bytes → parses → materializes, auto-
  refreshes linked mocks when the asset changes, and keeps linked mocks read-only
  on every surface. New `refreshMockServer` store action + `mock.refresh` MCP tool
  (catalog **94 → 95**). Two distinct entry points in the Mocks header: **New
  Mock Server → From spec asset** imports a contract as editable endpoints
  (materialized), and **Serve OpenAPI contract** stands up a live, read-only
  server straight from a contract (linked) with a spec preview, name, and port.
  The mock panel shows a "Served directly from contract" callout and a friendly
  source label for a live contract server, and the endpoint editor is fully
  read-only for a linked mock — mutation CTAs (Add rule, Import rule, Add param,
  Add header, Add multiplier, …) are hidden (not just disabled) and their
  empty-state copy drops the "click Add …" hints, every remaining native control
  is disabled via `<fieldset disabled>`, the Monaco response-body editor is
  read-only, and an explanatory banner says why — so a live contract mock can't
  be hand-edited. A live
  contract mock can be **converted to an editable mock** in place (the Mocks
  kebab, the read-only banner, or the panel callout) — this flips it to a
  materialized copy while keeping the spec link, so "Re-import from spec" still
  works. When the contract itself changes, **Update spec…** (the Mocks kebab or
  the panel callout) re-uploads the revised OpenAPI/Swagger file — replacing the
  shared asset's bytes and live-refreshing the linked mock's endpoints. Long
  mock-server names now truncate in the sidebar so the per-server actions menu
  stays reachable.
  (`@apicircle/shared`, `@apicircle/mock-server-core`, `@apicircle/ui-components`,
  `@apicircle/mcp-server`, VS Code)
- **Import an OpenAPI/Swagger spec into a collection (editor, additive).** The
  editor's unified Import modal now recognises OpenAPI 3.x / Swagger 2.0
  (`Auto-detect`, or the explicit "OpenAPI / Swagger" source) — paste or upload a
  spec and it becomes a new folder with one request per operation (method, path,
  query/header/path params). The Global Assets spec editor gains an **Import to
  collection** button that imports straight from the stored asset. `ApiRequest`
  gains additive `specAssetId` + `operationId` back-refs so an imported
  collection knows which spec asset + operation each request came from.
  (`@apicircle/shared`, `@apicircle/ui-components`)
- **Promote mock endpoints into a collection (additive).** A mock's endpoint
  kebab has **Add to collection**, and the server kebab has **Add all to
  collection** (the whole mock at once) — available even on read-only "run live"
  mocks. Promoted requests target the live mock: they land in a
  **"<name> (mock)" folder** with a `{{MOCK_BASE_URL}}:{{MOCK_PORT}}<path>` URL,
  backed by a dedicated, activated **"Mock" environment** (`MOCK_BASE_URL` =
  `http://localhost`; `MOCK_PORT` prefilled from the server's port, else `8080`;
  existing values preserved on re-promote) so you can retarget host/port before
  running. New `promoteMockToCollection` store action alongside
  `promoteMockEndpointToRequest`; `mock.promote_endpoint` was added to the MCP
  server here (catalog 95 → **96**) and later brought to full parity with the
  app — the same env, folder, and templated URL, across MCP + VS Code (see the
  Mock → collection parity entry above). A shared
  `requestShapeFromMockEndpoint(ep, urlPrefix)` mapper keeps promoted +
  OpenAPI-imported requests identical.
  (`@apicircle/ui-components`, `@apicircle/mcp-server`)
- **Spec-asset usage tracking (additive).** The Global Assets usage index now
  counts, per spec asset, the mock servers whose source it is (`openapi-asset`)
  and the requests imported from it (`Request.specAssetId`) — so the Assets
  panel's "Used in N" and the delete confirmation surface the mocks and
  collections a spec backs. This completes the spec-asset hub: upload a spec
  once, then run/import it as a mock, import it as a collection, promote mock
  endpoints into requests, and (in the Lens edition) drift-check code against it,
  all referencing the same asset.
  (`@apicircle/shared`, `@apicircle/ui-components`)
- **UI sections/mode seam (open-core, additive).** Building on the `extraPanels`
  seam, the React shell (`@apicircle/ui-components`) now accepts edition-contributed
  top-level **sections** ("modes") via an optional `App` `sections` prop
  (`SectionDef[]`) — each a named group of panels with an optional `requiresAuth`
  flag. When ≥2 sections are registered the shell renders a first-run **landing**
  (pick a mode) and an always-present **top-bar toggle**, persisting the active mode
  **per workspace** (localStorage keyed by workspace id, mirroring `activePanel`);
  `PanelTabs` then shows only the active section's panels. It is a **strict no-op
  when nothing is registered** — Studio passes no sections, so its tab set, top bar,
  and layout are byte-identical. Sign-in gating for a section lives inside the
  edition (via `requiresAuth`); core gains no entitlement concept. The `SectionDef`
  type is re-exported from the `@apicircle/ui-components` barrel (alongside
  `ExtraPanelDef`) so an edition can type its `sections` array explicitly. New
  `layout/sections.ts` + `layout/SectionLanding.tsx`, wired through `App` /
  `PanelTabs` / `TopBar`; covered by `sections.test.tsx`, `SectionLanding.test.tsx`,
  and the `PanelTabs` / `TopBar` / `App` tests (100% of the changed code). See
  [`docs/architecture/open-core-and-editions.md`](docs/architecture/open-core-and-editions.md).

## 1.2.0 - 2026-07-03

### Added

- **UI panel-registry seam (open-core, additive).** The React shell
  (`@apicircle/ui-components`) now accepts edition-contributed top-nav panels via
  an optional `App` `extraPanels` prop (`ExtraPanelDef[]`), rendered through
  `PanelTabs` / `PanelContent` / `Sidebar`. It is a **strict no-op when nothing
  is registered** — Studio passes no extras, so its panel set, layout, and
  behavior are unchanged (the store's `activePanel` type is widened to accept
  edition ids; the core values it stores are untouched). This lets an edition add
  panels without forking the shell, mirroring the MCP server's injectable-tool
  seam. Covered by `layout/extraPanels.test.tsx` + an `App.test.tsx` integration
  test. See [`docs/architecture/open-core-and-editions.md`](docs/architecture/open-core-and-editions.md).

- **Workspace-directory sidecar contract (open-core seam).** Documented and
  test-locked the guarantee that API Circle's write paths preserve files they
  don't own under `.apicircle/workspace-<id>/`. Disk writes (`saveToFile`, and
  the desktop mirror via `saveWorkspaceById`) write only the workspace JSON
  files and never clean the directory; Git push builds the commit tree with
  `base_tree` so committed sidecar files are inherited untouched; remote parse
  preserves unknown fields. New regression tests in `fileBackedWorkspace.test.ts`
  and `pushWorkspace.test.ts` lock the invariant (the parse path was already
  covered). This lets external tools — and editions built on the open core —
  store data alongside the workspace without it being clobbered. See
  [`docs/architecture/open-core-and-editions.md`](docs/architecture/open-core-and-editions.md).
- **Git provider seam (`GitProvider`).** Extracted a host-agnostic `GitProvider`
  interface plus a tree-shake-safe provider registry (`getGitProvider` /
  `registerGitProvider` / `hasGitProvider` / `gitHostKindFromOrigin`) in
  `@apicircle/git`, derived from `GitHubClient` so the contract can't drift.
  Every app-side construction of the GitHub client — the store, the MCP
  `linked.*` / `release.*` / `marketplace.*` / `repo.*` tools, the CLI
  `release` / `linked` commands, and the VS Code link / repo / send surfaces —
  now resolves through `getGitProvider('github')`, and the provider-agnostic
  helpers depend on the interface. An out-of-tree edition can register
  additional hosts (GitLab / Bitbucket / Azure DevOps) without forking the
  package; `github` is built in and resolved directly (never via an import-time
  side effect). No behavior change for GitHub.
- **CLI composition seam.** `@apicircle/cli` now re-exports its ten
  `register*Command` helpers alongside `buildProgram()`, so an out-of-tree
  (Enterprise) CLI can extend the public program with its own commands — or
  compose a fresh program from a subset of the public commands — without forking
  the binary.
- **Desktop shell seam (`@apicircle/desktop-shell`).** Extracted the reusable
  Electron main-process building blocks — the OS-keychain secrets, mock, MCP, and
  workspace-file IPC bridges, the OAuth2 callback server, and window-state
  persistence — from `apps/desktop/src/main` into a new workspace-private package.
  `apps/desktop` composes it (constructs the managers, calls the `register*Bridge`
  functions) and keeps only the Studio-specific main: window creation, CSP,
  branding, auto-update, and the quit-drain lifecycle. The inline `safeStorage`
  and OAuth2 IPC handlers became `registerSecretsBridge()` / `registerOAuth2Bridge()`
  (with new unit tests), and the shared `assertHttpUrl` guard is exported for the
  window-open handler. **Zero behavior change** — the `window.apicircleDesktop`
  renderer contract and `preload.ts` are byte-identical; validated by the full
  desktop unit + E2E suites and the build smoke. An edition's Electron app can now
  consume the same hardened bridges instead of re-implementing them.
- **MCP `ee.*` tool namespace.** `ToolDef.name` widened from the 94-name public
  catalog (`McpToolName`) to `ExtensionToolName` (`McpToolName | ee.${string}`),
  and `@apicircle/mcp-server` now exports `EnterpriseToolName` / `ExtensionToolName`
  alongside the existing `ToolDef` / `AnyToolDef` / `ToolHandlerContext`. With the
  existing `createMcpServer({ tools })` injection, an out-of-tree (Enterprise)
  package can contribute MCP tools under the reserved `ee.*` prefix without
  touching the public 94-tool catalog (which is unchanged). End-to-end coverage
  via an injected `ee.demo` tool dispatched through a real MCP client.
- **VS Code extension API seam.** The extension's `activate()` now returns a
  stable `ApicircleExtensionApi` (`{ apiVersion, bridge, fsProvider }`), so a
  companion (Enterprise) extension that declares
  `extensionDependencies: ["apicircle.apicircle-vscode"]` can build on the same
  workspace bridge + `apicircle://` virtual filesystem via
  `getExtension(...).exports` — without forking the published extension. Bundle:
  2.80 MB (under the 3.0 MB soft budget).

### Changed

- **`@apicircle/mock-server-core` now ships a browser-safe `./parsing`
  subpath.** The package root keeps swagger-parser (full external-`$ref`
  resolution) for Node consumers (CLI, MCP, Desktop main, VS Code host); the new
  `@apicircle/mock-server-core/parsing` entry exposes the same
  `parseSourceToEndpoints` API without the Node runtime or swagger-parser,
  resolving in-document `$ref`s only. The web bundle imports it lazily (~17 KB
  gzip, no swagger-parser).

### Fixed

- **Importing an OpenAPI / Postman / Insomnia spec now materializes its
  endpoints (Web + Desktop).** Creating a mock "from a spec" in the Web or
  Desktop app previously stored the spec verbatim with `endpoints: []` and
  deferred parsing to "the runtime on Start" — but nothing ever re-parsed it
  (the router serves `MockServer.endpoints` directly), so the imported mock had
  **zero endpoints**. `createMockServer` now parses the source at create time
  and populates the endpoint table right away, matching what the VS Code wizard,
  CLI, and MCP `mock.create_from_*` tools already did. The Desktop app parses in
  its Node main process (via a new `apicircle:mock:parse` IPC bridge → the
  `DesktopMockBridge.parseSpec` surface) for full external-`$ref` resolution;
  the pure-web build resolves in-document `$ref`s and surfaces a warning naming
  any external reference it can't follow. The "Create mock server" modal reports
  the imported endpoint count and lists parser warnings. Covered by a new
  `demoImport.test.ts` guard that imports the shipped
  `examples/swagger-first/apicircle-demo-openapi.yaml` (20 operations) on both
  parse paths, plus a live-browser E2E.

### Version alignment

- All workspace packages move to **1.2.0** in lockstep (root + 15 packages);
  `examples/mock-server` catches up from 1.1.3.

## 1.1.5 - 2026-06-22

### Added

- **VS Code plan editing — readable steps + sidebar actions.** Each step row in
  the plan YAML is annotated with a `# <Request name> · <METHOD> · <folder path>`
  comment (resolved from the workspace) so you read what a step _is_ instead of a
  raw requestId. The plan YAML keeps only **plan-level** CodeLenses — run / env /
  cancel and `✚ Add step…` — and `✚ Add step…` opens a **multi-select** picker
  that **hides requests already in the plan**, shows each request's folder path,
  and offers a **Select all** option. The **per-step actions live on the
  Execution sidebar** (a comment + a lens row + the requestId was too noisy):
  single-click a step to open its request (local and linked both resolve), and
  **Open / Enable-Disable / Change / Remove** are inline buttons + the right-click
  menu on each step node. The plan context menu gained **Add Step to Plan**.
- **VS Code — Run with / without assertions.** The plan editor now shows two run
  lenses, `▶ Run with assertions` and `▶ Run`, mirroring the Desktop / Web
  Execution panel. Launching from the TreeView or palette prompts for the same
  choice. The finish toast reports `N/M steps passed` (with assertions) or
  `N/M requests succeeded (no assertions)` so the verdict is never ambiguous.
- **VS Code — cancel a running plan.** While a plan is executing, the run lens
  swaps to `⏳ Running… (elapsed) · ✖ Cancel` (the plan-side mirror of a request
  send's in-flight Cancel), backed by a new `apicircle.cancelPlanRun` command
  and an `InFlightPlanTracker`. The progress-notification Cancel button still
  works too; both abort the in-flight request and the remaining steps.
- **VS Code — richer plan-run history.** Opening a plan run from the History
  view now expands every step (with a `[PASS]` / `[FAIL]` heading) into the
  **same wire depth as a single-request run** — request name, method, URL,
  status, duration, request + response headers, the response-body preview, and
  the assertion verdicts (kind / op / target / expected / passed / detail) —
  instead of an opaque `requestRunId`, so you can see what each step sent,
  what came back, and why it passed or failed without leaving the document.

### Fixed

- **VS Code — a finished plan run no longer stays stuck on "Running".** The run
  command `await`ed the "Plan finished…" notification _inside_ the progress
  callback — but a plain info toast's promise only settles when the toast is
  dismissed, so the "Running…" progress (and the ⏳ Running CodeLens / in-flight
  state) lingered long after the run completed in a few seconds. Result toasts
  are now fire-and-forget, so the progress closes and the CodeLens reverts to
  `▶ Run` the moment the run + history write finish.
- **VS Code — "Plan environments…" now updates the open editor.** Setting a
  plan's environment priority order (via the CodeLens, the TreeView, or the
  palette) mutated the workspace but left the open plan YAML showing the stale
  `envPriorityOrder:` block until the tab was reopened. Plan mutations now fire
  the FS-provider change event for the plan URI, so the projection refreshes
  immediately (the same mechanism that swaps the response viewer's "Sending…"
  placeholder). Adding / removing / toggling / changing a step refreshes the
  editor the same way.
- **VS Code — no more env prompt on every plan run.** Running a plan no longer
  pops a "Run with an env overlay?" QuickPick. The plan's own environment
  priority order (configured via "Plan environments…") governs the run, matching
  Desktop / Web / the CLI, where the configured order is authoritative and a
  one-off override is an explicit edit rather than an interactive question.
- **VS Code — hardened plan editing.** The structured step / env commands refuse
  to run while the plan editor has unsaved changes (rather than letting the change
  be silently reverted on the next save); the in-flight run tracker is keyed by
  the stable plan id so a rename can't break the Running / Cancel affordance; and
  the Execution view + load path no longer assume `linkedCollections` is present,
  so a linked step (or a partial device-local file) renders/opens instead of
  erroring.

The VS Code extension bundle is **2.80 MB** (under the 3.00 MB soft budget).
No persisted-workspace shape, `WorkspacePatch` variant, MCP tool, or CLI flag
changed — these are VS Code surface improvements only, with no migration.

## 1.1.4 - 2026-06-22

### Fixed

- **VS Code execution plans now load.** Plan definitions moved to the
  Git-synced workspace document (`synced.executionPlans`) in an earlier
  release so teams share them through Git — but the VS Code extension, the
  headless `applyMutation` write path, and the MCP `plan.*` / `prompt.*_plan_*`
  tools were all still reading/writing the deprecated, now-empty
  `WorkspaceLocal.executionPlans`. As a result the Execution view showed no
  plans and newly created plans vanished. Every plan reader/writer now uses
  `synced.executionPlans`, so plans created in Desktop / CLI / MCP appear in
  VS Code (and vice-versa) and round-trip through Git. The `▶ Run Plan`
  CodeLens now resolves the plan from its `?id=` query (it was matching the
  path name-slug), so it targets the right plan after a rename. Affects
  `@apicircle/core`, `@apicircle/mcp-server`, and the VS Code extension.
- **MCP plan tools accepted a malformed `envPriorityOrder`.** `plan.create`,
  `plan.update`, and `prompt.create_plan` declared `envPriorityOrder` as a plain
  string array, but a plan stores `EnvPriorityRef` objects — so an AI client
  setting per-plan environments would have written corrupt refs. The tools now
  accept the same shape as `environment.set_priority` (a bare string is a local
  env name; `{ kind: 'linked', linkedWorkspaceId, envName }` targets a linked
  env) and normalize to `EnvPriorityRef[]` before persisting. `@apicircle/mcp-server`.
- **Legacy plans authored headlessly no longer vanish on upgrade.** Plans
  created by the pre-1.1.4 CLI / MCP / VS Code write path were stored in
  `WorkspaceLocal.executionPlans`. The desktop/web store already lifts those to
  `synced.executionPlans` on load, but the headless read paths did not — so a
  workspace whose only plans were authored via those surfaces would show zero
  plans after upgrading. `loadFromFile` / `withWorkspace` (CLI + both MCP
  providers) and the VS Code `GitWorkspaceProvider` now run the same forward-only
  lift, and the next write persists the corrected shape. `@apicircle/core` +
  VS Code extension.

### Added

- **MCP `plan.update` can now set `stopOnAssertionFailure`.** The patch schema
  previously covered only `name` / `steps` / `envPriorityOrder`, so AI clients
  had no way to toggle a plan's halt-on-first-failure flag. Added it to the
  patch (plan variables remain on the dedicated `plan.set_variables` tool).
  `@apicircle/mcp-server`.
- **Per-plan environment selection in VS Code.** A new
  **API Circle: Set Plan Environments…** command — reachable from the
  Execution-view inline 🌐 button, the plan context menu, the command
  palette, and a `◆ Plan environments…` CodeLens on the plan YAML — lets you
  choose which environments (local **and** linked) overlay a plan's runs and
  in what priority order. Picking none clears the overlay so the plan inherits
  the workspace-wide order. The choice persists through `plan.upsert` and
  surfaces in the plan YAML's `envPriorityOrder:` block (still editable
  directly, with completion). The one-off run-time env override prompt on
  `▶ Run Plan` is unchanged.

### Tests

- **Live-GitHub E2E flakiness hardening.** Removed the recurring GitHub
  eventual-consistency flakes in the `chromium-live-github` suite (specs
  `04` / `08` / `09` / `15` / `16` / `17`). Test-harness only — no product code
  changed:
  - `fetchWithSecondaryRateLimit` now retries transient 5xx (in addition to
    secondary-rate-limit 403/429), with an opt-out for the non-idempotent
    `createRepo` POST. Fixes the `seedRepoIfEmpty` / `ensureWorkspaceJsonOnMain`
    "PUT failed (500)" flakes.
  - `writeRegistryJson` gained the 409/422 re-probe-and-retry loop the other
    Contents-API writers already had (it was the one writer that threw on the
    first SHA conflict).
  - Post-push assertions read the remote by the immutable commit SHA
    (`fetchWorkspaceJson(cfg, ref, { expectedCommitSha })`) instead of the
    branch ref — specs `02`/`08`/`10`/`12`/`15` (spec `12` reads `main` at the
    PR merge commit). `?ref=<sha>` is immutable, so it can't serve the pre-push
    snapshot the branch-ref replica still caches for a few seconds (the spec
    `02` failure where `linkedWorkspaces[linkId]` came back `undefined` across
    all retries under 2-worker load). Spec `16`'s second push (which persists each asset's
    `workingBranchRef` provenance to the remote) is now gated by a new
    `waitForBranchHeadV2` ref barrier so its divergence pre-flight can't race
    the `git/refs` read replica into a spurious `BranchDivergedError`.
  - New `waitForRemoteWorkspace` / `waitForRemoteWorkspaceById` barriers plus a
    read-back barrier in `updateWorkspaceJson` / `updateWorkspaceJsonById` block
    read-modify-writes until pushed data has propagated to the branch-ref read
    replica — used both after a REST write (so a later app refresh sees it) and
    before a REST read-modify-write that follows an app push (specs `09`/`10`/
    `17`), so the RMW can't read a pre-push snapshot and clobber it.
  - Attachment blob reads tolerate the same branch-ref lag: `fetchRepoFileBytesV2`
    retries transient `404`/`429`/`5xx` with backoff (specs `13`/`14`/`16`), and a
    new `waitForRepoFileAbsentV2` polls a path until it reports `404` (spec `13`'s
    post-delete blob-absence check).

### Docs

- `docs/qa/README.md`: documented the live-GitHub eventual-consistency handling
  playbook and corrected the workflow trigger description (nightly + manual
  dispatch; no longer PR/push-gated).

## 1.1.3 - 2026-06-20

Patch release. Rolls every package in the monorepo from 1.1.2 to a single
consistent **1.1.3** and cuts the accumulated Unreleased work — the VS Code
**MCP prompt catalog** editor view and the Desktop MCP one-click **"Remove
config"** button, plus the VS Code publish-workflow and
`APICIRCLE_WORKSPACES_ROOT` resolution fixes — into a dated release.

### Version alignment

All `@apicircle/*` packages — `shared`, `core`, `git`, `ui-components`,
`mock-server-core`, `mcp-server`, `cli`, plus `apps/web`, `apps/desktop`,
`apps/vscode`, the e2e suites, and the `examples/mock-server` fixture (which
had lagged at 1.1.0) — now ship at **1.1.3**.

### Added

- **VS Code — MCP prompt categories open as a readable catalog in the editor.**
  In the MCP view's **Prompts** section, clicking a category row (Workspaces,
  Collections, Environments, Execution, Mocks, Auth, Imports) used to expand it
  inline into a flat list of one-line prompt rows. It now opens a read-only
  Markdown document for that category in the editor — each prompt gets a
  numbered heading, the full prompt text in a copy-ready code block, a **What
  it does** description, a per-category explanation blurb, and the **MCP tools
  it drives**. Per-prompt one-click copy survives the change as a **⧉ Copy
  prompt** CodeLens above each entry (re-using the existing
  `apicircle.copyMcpPrompt` command), and a **↗ Open rendered preview** lens on
  the title opens VS Code's formatted Markdown preview beside the source. The
  category rows are now leaves (the `book` icon signals "opens a document"),
  and a new **API Circle: Browse MCP Prompts** palette command opens any
  category via a QuickPick.

  New surfaces: the `apicircle-prompts:` read-only `TextDocumentContentProvider`
  - Markdown builder + URI helpers (`apps/vscode/src/fs/promptCatalog.ts`), the
    `PromptCatalogCodeLensProvider` (`apps/vscode/src/lang/promptCatalogCodeLens.ts`),
    `openMcpPromptCategoryCommand` (`apps/vscode/src/commands/mcpActions.ts`), and
    the `apicircle.openMcpPromptCategory` command. The shared
    `@apicircle/mcp-server` prompt catalog (`MCP_PROMPTS` /
    `MCP_PROMPT_CATEGORIES`) is unchanged — Desktop/Web's MCP → Prompts surface is
    untouched. Covered by new unit tests (`promptCatalog.test.ts`,
    `promptCatalogCodeLens.test.ts`) plus updated `McpView.test.ts` /
    `mcpActions.test.ts`. VS Code extension bundle: **2.77 MB** (soft budget
    3.00 MB / hard 5.00 MB).

- **Desktop MCP panel — one-click "Remove" for an installed client config.**
  The **Set up your AI client** block (MCP → Connection) already offered a
  one-click **Install config** / **Update config** button that writes the
  `apicircle` entry into the selected AI client's config file. It had no
  inverse — once installed, the only way to undo it was to hand-edit the
  file. This release adds a **Remove** button that appears whenever an
  `apicircle` entry is present (whether the config is current _or_ stale).
  It's gated behind a danger-toned confirmation dialog that names the exact
  config file being edited. Removal is keyed on the entry name, so a stale
  entry pointing at an old workspace path is removed just the same; foreign
  MCP servers and unrelated settings in the file are preserved verbatim, and
  the now-empty `mcpServers` / `context_servers` / `mcp_servers` block is
  stripped to keep the diff tidy. The operation is idempotent and works
  across all seven directly-installable clients (Claude Desktop, Claude Code,
  Codex, Cursor, Windsurf, Zed, Continue) and their JSON / YAML / TOML
  schemas. A malformed config file is left untouched rather than rewritten.

  New surfaces: `uninstallClientConfig` in
  `apps/desktop/src/main/mcp/mcpInstaller.ts`, the
  `apicircle:mcp:uninstallConfig` IPC channel
  (`apps/desktop/src/main/ipc/mcpBridge.ts`), and `uninstallConfig` on the
  `DesktopMcpBridge` contract (`packages/ui-components/src/desktop/bridge.ts`)
  - the preload bridge. Covered by new unit tests in `mcpInstaller.test.ts`
    and UI flow tests in `McpServerPanel.test.tsx`.

### Fixed

- **VS Code publish workflow no longer fails when the version is already
  published to Open VSX (or the VS Code Marketplace).** The `Publish to Open
VSX` step captured `ovsx publish` output and grepped it for `"already
exists"`, but `ovsx` actually reports `"<id> <version> is already
published."` — so a re-run on an unchanged version fell through to the
  failure branch and exited 1, turning the whole `vscode-publish.yml`
  workflow red. Both publish steps now use each tool's native
  `--skip-duplicate` flag (`vsce publish --skip-duplicate` /
  `ovsx publish --skip-duplicate`), which exits 0 with a "Skipping publish."
  log when the exact version already exists while still failing loudly on
  real errors (auth, packaging, network). This removes the fragile
  output-string matching that caused the mismatch. CI/release-only change —
  no extension code, workspace-data, or schema change.

- **VS Code — registry discovery and the MCP config snippet now honor
  `APICIRCLE_WORKSPACES_ROOT`, matching the CLI and desktop.** The extension's
  `discoverRegistryWorkspaces()` and the MCP config snippet's workspace path
  resolved `~/.apicircle/` via `defaultApicircleRoot()` directly, ignoring the
  `APICIRCLE_WORKSPACES_ROOT` override the CLI and desktop already respect — so a
  relocated workspace store (CI, tests, or a power user who moved their store) was
  discovered inconsistently across surfaces. Root resolution is now centralized in
  a shared `resolveApicircleRoot()` (`@apicircle/core/workspace/registry`) that
  honors the override before falling back to `~/.apicircle/`; the CLI's
  `defaultWorkspacesRoot()` and the VS Code extension (registry discovery + MCP
  snippet path) delegate to it, matching the override the desktop already injects
  at boot. The activation integration test is now hermetic — it pins
  `APICIRCLE_WORKSPACES_ROOT` to an empty dir so a dev machine's real
  `~/.apicircle/` can't leak into its workspace-count assertions — and validates
  the registered command set against `package.json`'s `contributes.commands`
  (plus an explicit allowlist of the request-YAML CodeLens-only field editors)
  instead of a hand-maintained list, so a contributed-but-unregistered command
  (palette "command not found") or an unexpected dangling registration can no
  longer silently drift past the test. Covered by new `resolveApicircleRoot` unit
  tests (`workspaceRegistry.test.ts`) and the updated activation suite. No
  workspace-data or schema change. VS Code extension bundle: **2.77 MB** (soft
  budget 3.00 MB / hard 5.00 MB).

- **"Sign in with GitHub" no longer offers a one-click button that can't
  work on the hosted web app or the desktop build.** The button uses
  GitHub's OAuth **device flow**, which a browser can only start through a
  same-origin `/_gh-oauth` relay — GitHub sends no CORS headers on its
  `login/*` endpoints, so a page can't POST to them directly. That relay
  exists **only in the Vite dev server**; the static GitHub Pages deploy
  (studio.apicircle.dev) returned **HTTP 405** for the POST and the packaged
  desktop app (renderer served over `file://`) failed with **"Failed to
  fetch."** The button is now gated to builds where the relay is present via
  a new `isGitHubDeviceFlowAvailable()` check
  (`packages/ui-components/src/layout/dock/githubDeviceFlow.ts`). On the
  hosted web app and desktop, the Secret Vault → Sessions tab now leads with
  the **personal-access-token** path, which calls `api.github.com` directly
  (CORS-allowed) and works everywhere. Forks that stand up their own relay
  can force the button on with `VITE_GH_DEVICE_FLOW=1`. Help Center
  "Sessions" copy updated to match. Covered by new unit tests
  (`githubDeviceFlow.test.ts`), extended panel tests
  (`SecretVaultDockPanel.test.tsx` — button shown vs. hidden), and new
  end-to-end device-flow tests that drive the button through to a connected
  session in a real browser (`e2e/web/sessions.spec.ts`). No workspace-data
  or schema change.

- **Live-GitHub `06-release-update-flow` E2E no longer flakes on a two-commit
  publish race.** The `publishSourceVersionV2` test helper published a new
  release version in one Contents-API commit and then set its `deprecated` /
  `yanked` flags in a **second** commit. The consumer reads the source
  `workspace.json` by branch ref (`?ref=<branch>`, `cache: 'no-store'`), which
  GitHub's Contents API serves with an eventual-consistency lag, so the second
  commit raced that read two ways: the consumer could observe the first commit
  (version advanced, flags still `false`) before the flag commit propagated —
  failing `expect(flagged.deprecated).toBe(true)`; or the flag commit's own
  read-modify-write could read the pre-publish snapshot, find no just-published
  version to flag, and write that stale doc back over the now-converged ref —
  reverting `currentVersion` to the prior release so the consumer's ledger never
  reached the new version (`waitForLinkedLedgerVersionV2` timed out at
  `last=<prior>`). The helper now folds the flags into the single publish
  commit, so when `currentVersion` advances the flags are already present in the
  same atomic snapshot. Test-infrastructure only — no product, schema, or API
  change (`e2e/web/live-github/_helpers.ts`).

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
  `fs.watch` events whose filename the OS omits (`filename === null`, seen on
  some Linux filesystems under load) as "the watched target may have changed,"
  for both the per-directory `workspace.json` and the root `registry.json` emit
  branches, instead of dropping them. The existing stat-based self-write
  suppression still discards events where the file is byte-for-byte unchanged, so
  there's no false external-change or refresh loop. This hardens the MCP/CLI →
  desktop live-refresh path on overlayfs / heavily-loaded hosts.

### Tests

- **Desktop `external-write-refresh` E2E fixture corrected (orphan request)** —
  the regression test simulated an external MCP/CLI write by adding a top-level
  request to `collections.requests` only. A real write goes through
  `applyMutation` → `applyRequestCreate`, which also appends the request to
  `collections.tree.children` (the editor sidebar renders top-level entries from
  the tree, so a request present only in the map is an orphan that renders
  nowhere → a deterministic `getByText('Imported by MCP')` timeout, confirmed by
  running the pre-fix fixture in isolation: 6/6 fail). The fixture now mirrors
  `applyRequestCreate` exactly. Not a product bug — the app writes the tree
  entry correctly on every real external write.

- **Desktop `external-write-refresh` E2E hardened against a boot-churn write
  race** — even with the request in the tree, the test still performed its
  external `workspace.json` write after a fixed `waitForTimeout(500)`. The
  desktop fixture suppresses onboarding by reloading the window, which kicks off
  a second hydrate whose debounced IDB→disk mirror writes can still be draining
  at the 500 ms mark under load. A late mirror write then atomically overwrites
  the test's external write back to boot content; the watcher's stat-based
  self-write suppression matches the post-clobber bytes and (correctly) emits no
  `externalChange`, so the renderer never refreshes — a flaky 30 s timeout on
  Windows under full-suite I/O load (reproduced 8/8 by forcing the write to fire
  during boot churn). The test now waits for `workspace.json` and
  `registry.json` to reach genuine on-disk quiescence (size+mtime stable, JSON
  parseable) before writing, encoding the test's real premise: an idle,
  fully-booted desktop. The underlying clobber window exists only during the
  sub-second boot/reload settle, before which no external client is driving the
  workspace, so no product change was warranted.

### VS Code — Marketplace README polish

Follow-up to the 1.1.1 Marketplace README rewrite, addressing one issue that
only surfaces when the README is rendered standalone on the Marketplace / Open
VSX (relative repo paths don't resolve there):

- **Broken `LICENSE` link** — the "See repo-root LICENSE" link used a relative
  `../../LICENSE` path which resolved on GitHub but 404'd on both the Visual
  Studio Marketplace and Open VSX detail pages. Swapped for the absolute
  `https://github.com/apicircle/studio/blob/main/LICENSE`.

### Docs — Phase-process artifacts retired

Now that the VS Code extension has shipped and is published to the
Marketplace + Open VSX, the multi-phase development chronicle and the
one-shot publication runbook are no longer load-bearing. Both are removed
in favour of cleaner, evergreen references; the live reference surfaces
(root [`README.md`](README.md), [`apps/vscode/README.md`](apps/vscode/README.md),
[`CLAUDE.md`](CLAUDE.md), [`apps/vscode/package.json`](apps/vscode/package.json),
[`scripts/vscode-bundle-budget.mjs`](scripts/vscode-bundle-budget.mjs))
already cover what users and contributors need.

- **`docs/vscode-extension.md` deleted** (1865 lines). The doc was organised
  as a Phase 1 → Phase 12 + Post-launch a–g development chronicle (36 Phase
  headings); §§1–7 (three-surface principle, sidebar layout, commands,
  settings, architecture, dev workflow) duplicated material that already
  lives in the root README, the extension README, CLAUDE.md, and
  `apps/vscode/package.json`. The §14 bundle-budget contract was a
  pointer; the actual contract lives in `scripts/vscode-bundle-budget.mjs`
  itself (with its rationale comments) and is referenced from CLAUDE.md
  §6, the QA README, the VS Code CI workflow, and the budget script — all
  updated.

- **`docs/vscode-extension-install-publish.md` deleted** (340 lines).
  Maintainer-only runbook for the one-shot 1.1.0 → 1.1.1 Marketplace +
  Open VSX publication, now complete and automated by
  `.github/workflows/vscode.yml`. Contained stale facts (93 tools where
  current is 94, 8 sidebar views where current is 9, 1.1.0 status where
  current is 1.1.1).

- **`docs/apicircle-yaml-format.md` deleted** (508 lines). Power-user YAML
  reference that was never wired into CLAUDE.md §9's doc index, the root
  README, the extension README, or any in-product surface; the YAML shape
  is now self-evident from VS Code's live completion / hover / diagnostics
  - the registered JSON Schema
    (`apps/vscode/schemas/apicircle-request.schema.json`).

- **Live references swept** — CLAUDE.md §9 doc index, root README's VS Code
  section trailer, `docs/auth.md` folder-wise-auth cross-reference,
  `docs/qa/README.md` bundle-gate section, `.github/workflows/vscode.yml`
  bundle-budget step comment, and `scripts/vscode-bundle-budget.mjs`
  header comment all updated to drop pointers to the deleted docs. The
  qa README's bundle-threshold numbers were also corrected (`1.8 MB` /
  `2.0 MB` → `3.0 MB` / `5.0 MB`, matching the actual constants in
  `vscode-bundle-budget.mjs`).

- **Historical CHANGELOG mentions preserved** — earlier release-note
  bodies that mentioned the deleted docs by path are left intact as
  archival facts; rewriting them would falsify shipped history.

## 1.1.1 - 2026-06-18

### VS Code — Marketplace presentation

- **Marketplace icon** — replaced the black monochrome-on-white icon with
  the colorful brand mark (purple center disc, colored satellite nodes) on
  the dark `#1f1b2e` galleryBanner background. Visible on both light and
  dark Marketplace themes; file size dropped from 1.3 MB to 18 KB.

- **Marketplace README** — rewrote the extension README from the "Alpha —
  early development / v0.1" placeholder to the full 1.1.0 feature set:
  workspace discovery + switcher, all 17 auth types, folder-wise auth,
  URL-as-source-of-truth, mock endpoint authoring, 94-tool MCP catalog,
  secret vault, and Link Workspaces. Installation now links to the
  Marketplace and Open VSX as primary install paths.

- **`render-icons.mjs`** — the icon generation script now also produces the
  VS Code Marketplace icon from `favicon.svg`, and resolves Playwright from
  `e2e/web` as a fallback when `apps/web` doesn't have it.

## 1.1.0 - 2026-06-17

The first minor-version cut since 1.0.0. Ships the full **VS Code extension**
(Activity Bar, 9 sidebar trees, `apicircle://` virtual YAML editing,
mock-server lifecycle, secret vault, embedded MCP host, Copilot Chat one-click
MCP install, workspace details + switcher), the **Link Workspaces** sidebar
(publish + consume side of the linked-workspace + release loop, including
three-way merge + dedicated sessions + required-secret provisioning), an
end-to-end **mock authoring overhaul** on every surface (per-endpoint
`*.endpoint.yaml` with field-level CodeLens, editable `requestSchema`
everywhere, editable default port, sharper port-bind errors), **MCP
cross-surface config install** for 7 AI clients (Desktop direct-write +
install-state detection), **three-path workspace detection** (Git-backed
`.apicircle/` directories now auto-detected by the MCP binary), **Codex TOML
config support**, **folder-wise auth** with a full gap-closure pass (CLI
`folder` subcommand, linked-folder inspection, CodeLens refresh, OAuth2 folder
lens), **URL-as-source-of-truth** for query + path params in VS Code, a
**CodeQL-driven CI hardening pass** (polynomial regex → manual tokenizers,
TOCTOU → `flag: 'wx'`), and a tool catalog grown from **74 → 94**.

All `@apicircle/*` packages — `shared`, `core`, `git`, `ui-components`,
`mock-server-core`, `mcp-server`, `cli`, plus `apps/web`, `apps/desktop`,
`apps/vscode`, and the e2e suites — ship at **1.1.0**. No installed users, no
migration: the `.apicircle/workspace.json` relocation from 1.0.9 stays as a
hard cutover.

### Git layout — per-workspace subdirectories + registry

- **Second workspace storage relocation.** The synced workspace document
  moved again — from `.apicircle/workspace.json` (the 1.0.9 flat layout)
  into a per-id subdirectory `.apicircle/workspace-<id>/workspace.json`.
  Attachments moved alongside, from `.apicircle/attachments/<slotId>` into
  `.apicircle/workspace-<id>/attachments/<slotId>`. A new
  `.apicircle/registry.json` indexes all workspaces in the repo and tracks
  the active workspace id.

  Current layout (1.1.0+):

  ```
  .apicircle/
  ├── registry.json                        # workspace index
  └── workspace-<id>/
      ├── workspace.json                   # synced workspace doc
      └── attachments/<slotId>             # binary file attachments
  ```

  This is a **hard cutover** — 1.1.0 does not read the 1.0.9 flat layout
  (`.apicircle/workspace.json` at the dotfolder root). The desktop app,
  CLI, MCP server, and VS Code extension all resolve workspace paths via
  `registry.json` → `workspace-<id>/workspace.json`.

  **How to migrate from the 1.0.9 flat layout:**
  - **Re-push (easiest):** open the workspace in the Desktop app (1.1.0+),
    push — the per-id layout lands automatically. Then delete the stale
    `.apicircle/workspace.json` from the dotfolder root.
  - **Manual move:** create the subdirectory and relocate:
    ```bash
    WSID=$(jq -r '.workspaceId' .apicircle/workspace.json)
    mkdir -p ".apicircle/workspace-$WSID/attachments"
    mv .apicircle/workspace.json ".apicircle/workspace-$WSID/workspace.json"
    mv .apicircle/attachments/* ".apicircle/workspace-$WSID/attachments/" 2>/dev/null
    rmdir .apicircle/attachments 2>/dev/null
    echo "{\"activeWorkspaceId\":\"$WSID\",\"workspaces\":[{\"id\":\"$WSID\"}]}" \
      > .apicircle/registry.json
    git add .apicircle && git commit -m "chore: migrate to per-id workspace layout (1.1.0)"
    ```
  - **Export → re-import:** same as the 1.0.9 path — see
    [`docs/migration.md`](docs/migration.md).

  (`packages/core/src/git/repoPaths.ts`,
  `packages/core/src/git/repoPaths.test.ts`)

### MCP — Cross-surface install + prompts + clipboard fix

Three improvements to the MCP integration surface across Desktop, Web, and
VS Code:

- **Desktop direct config install** — the Desktop app now writes MCP config
  entries directly into each AI client's config file (JSON, YAML, or TOML)
  via a per-client Install button in the MCP panel. All 7 installable clients
  supported (Claude Desktop, Claude Code, Codex, Cursor, Windsurf, Zed,
  Continue) — full parity with the VS Code extension's install command.
  Includes install-state detection (absent / installed / update available).
  New bridge methods: `installConfig(client)`, `detectInstallState(client)`.

- **Desktop IPC Codex fix** — selecting Codex in the Desktop MCP panel
  previously threw `"Unknown MCP client: codex"` because the IPC allowlist
  was missing the `codex` entry. Fixed.

- **Clipboard error handling** — extracted a shared `safeCopyToClipboard`
  utility (`packages/ui-components/src/primitives/clipboard.ts`) that wraps
  `navigator.clipboard.writeText` with try-catch + `document.execCommand`
  fallback. Replaced 4 bare clipboard writes in `HowToConnect.tsx` and
  `ConnectionSection.tsx` that silently swallowed rejections and falsely
  showed "Copied".

- **VS Code MCP Prompts** — the VS Code sidebar's MCP view now includes a
  collapsible **Prompts** section with 19 curated starter prompts across 7
  categories (Workspaces, Collections, Environments, Execution, Mocks, Auth,
  Imports). Click any prompt to copy it to the clipboard. The prompts data
  lives in `@apicircle/mcp-server` (sub-path export `./prompts`) so both
  Desktop/Web and VS Code consume the same catalog.

### VS Code — Workspace Details & Switcher

The extension sidebar now has a **Workspace** view at the top that shows:

- **Active workspace name** with a collapsible stats summary (request count,
  folder count, environment count, mock count, plan count).
- **Source** (`git-folder` or `registry`) and the `.apicircle/` directory path.
- **Available workspaces count** when multiple workspaces are discovered.

A new **Switch Workspace** command (`APICircle: Switch Workspace`) opens a
QuickPick listing all discovered workspaces (from open VS Code folders and
`~/.apicircle/registry.json`). Selecting one switches the active workspace and
refreshes all sidebar views instantly. The switch button also appears as an
inline action on the workspace node and in the view title bar when multiple
workspaces are available.

New files: `WorkspaceView.ts`, `switchWorkspace.ts` + tests.

### MCP — three-path workspace detection (Git-backed `.apicircle/` support)

The `apicircle-mcp` binary now auto-detects **three** on-disk layouts when
resolving `--workspace <dir>`:

1. **`registry.json`** → multi-workspace registry root (desktop app).
2. **`workspace.synced.json`** → desktop disk-mirror single-workspace.
3. **`workspace.json`** → Git-backed `.apicircle/` directory.

Previously only layouts 1 and 2 were detected. AI clients (Codex, Cursor,
Claude Code) pointed at a cloned repo's `.apicircle/` directory crashed with
`Cannot read properties of undefined (reading 'createdAt')` because the
binary fell through to the "no workspace found" error or read an empty
`workspace.synced.json`.

- **`GitBackedWorkspaceProvider`** — new provider in `@apicircle/mcp-server`
  that delegates to core `loadFromFile` / `saveToFile` / `withWorkspace`
  with `syncedFilename: 'workspace.json'`. Reads the canonical Git-tracked
  document, writes runtime state to `workspace.local.json` (gitignored),
  and never creates `workspace.synced.json`.
- **`syncedFilename` option** — `@apicircle/core` file-backed workspace
  functions now accept an optional `syncedFilename` override (defaults to
  `workspace.synced.json`). Enables the git-backed provider without
  duplicating locking logic.
- **Defensive null handling** — `SingleWorkspaceAdapter.list()` and
  `MultiWorkspaceProvider` counts builder now use optional chaining so
  an empty `{}` synced document returns graceful defaults instead of
  crashing.
- **`.gitignore`** — `.apicircle/workspace.local.json` is now ignored so
  the MCP server's per-device runtime state doesn't pollute Git status.
- **Help text** — `apicircle-mcp --help` now documents all three valid
  `--workspace` layouts.
- **Tests** — 14 new unit/integration tests covering
  `GitBackedWorkspaceProvider` (8 tests) and boot-detection paths (6 tests).

### VS Code extension — Codex MCP install writes TOML

The "Install MCP for Client → Codex" command now writes
`~/.codex/config.toml` (TOML format, `mcp_servers` snake_case key)
instead of `config.json` (JSON, `mcpServers`). Codex CLI reads TOML,
so the previous JSON write was silently ignored — MCP tools never
appeared in Codex sessions even after installing from VS Code.

- **TOML format support** — added `smol-toml` (~12 KB, pure ESM, zero
  deps) as the parser/serializer. Follows the same pattern as the
  Continue YAML support added in Phase 11.
- **Snake_case key** — Codex uses `[mcp_servers.apicircle]`, not
  `mcpServers`. The new `'mcp_servers-toml'` schema variant handles
  both the key name and the file format.
- **Uninstall** — "Remove API Circle MCP from AI Client" for Codex
  now correctly reads/writes TOML and targets the `mcp_servers` key.
- **Foreign key preservation** — existing Codex settings (`model`,
  `plugins`, `projects`, etc.) survive install/uninstall round-trips.
- **Bundle impact** — 2.44 → 2.74 MB (+300 KB); well within the
  5.0 MB hard budget.

### MCP — 93 → 94 tools: `marketplace.search`

AI clients can now discover workspaces in the API Circle marketplace
without leaving the MCP session. The new `marketplace.search` tool wraps
`GitHubClient.searchMarketplaceRepos` with sort support (`best-match` /
`stars` / `updated`), anonymous browsing (token optional), and the same
error taxonomy as `linked.link`. Use it to browse public workspaces
tagged with `apicircle` on GitHub, then pipe a result's `fullName` into
`linked.link` to wire it up.

- **`marketplace.search`** — `{ query?, sort?, token? }` → up to 30
  results with `fullName`, `owner`, `name`, `description`, `topics`,
  `stargazers`, `defaultBranch`.
- **`searchMarketplaceRepos` sort parameter** — the `@apicircle/git`
  method now accepts an optional `sort: 'stars' | 'updated'`; omit for
  GitHub's default best-match relevance.
- **VS Code welcome view** — the Link Workspaces panel now surfaces
  "Search Marketplace…" and "Link a Workspace…" CTAs alongside the
  existing release publish actions.

### VS Code extension — CodeLens authoring tightening

A grab-bag of editor-affordance fixes driven by direct feedback on the
1.1.0 Marketplace cut. Each one shortens the click-distance from "I want
to edit X" to "the cursor is on X" and lets the user discover available
actions without scrolling or memorizing field names.

- **Mock endpoint `requestSchema`** — the **✚ Body example** lens now
  sits on the `requestSchema:` header line itself (previously buried on
  the `body:` subsection), and is suppressed once a body block exists
  so re-adding can't clobber. The ◆ Example and ◆ Description field
  lenses are no longer emitted inside the body subtree — those slots
  are free-form documentation text, so a free-text picker buys nothing
  over inline editing.
- **Header lens renames** — every "✚ Pick header…" and "✚ Add header"
  CodeLens is now just **✚ Header**, including the response-rule
  header lens and the response-headers add-lens.
- **Send lens highlight** — the request-editor send CTA reads
  **▶▶ SEND REQUEST (Ctrl/Cmd+Enter)** so first-time users notice it
  and discover the keyboard shortcut without hunting through the
  Command Palette.
- **Query / cookie row toggle** — each `- key:` row in `query:` and
  `cookies:` gains a **✓ Enable / ⊘ Disable** lens alongside the
  existing ◆ Key, mirroring the response-header toggle on mock
  endpoints. Disabled rows stay in the YAML for what-if testing but
  aren't sent. (PathParams are a map and can't be "off and still
  send"; no toggle there.) The ◆ Value lens on `query:` value rows is
  removed — the URL bar's `?key=val` syntax round-trips through the
  YAML parser on save, so the inline edit is already the canonical
  path. Cookies keep their ◆ Value lens.
- **OAuth2 / Hawk / JWT enum pickers** — when an `auth:` block resolves
  to one of the six OAuth2 grants, Hawk, or JWT Bearer, the enum-valued
  fields surface a curated picker:
  - Client Credentials → **◆ Client Auth Method**, **◆ Token Type**
  - Authorization Code → **◆ Token Type**
  - PKCE → **◆ Code Challenge Method**, **◆ Token Type**
  - Password / Implicit / Device → **◆ Token Type**
  - Hawk → **◆ Algorithm** (SHA-256 / SHA-1)
  - JWT Bearer → **◆ Algorithm** (HS/RS/PS/ES + EdDSA)
- **+ Add assertion drops a prefilled block** — the multi-step
  QuickPick is gone. Clicking **✚ Add assertion** now inserts a
  `kind: status / op: equals / expected: '200'` scaffold (mirrors
  the "🛡 Add validation rule" UX) and the user refines via the
  per-field ◆ lenses below.
- **Kind-aware assertion ◆ Target and ◆ Expected** — the assertion
  field lenses now dispatch on the entry's `kind:`:
  - `status` → ◆ Expected (status code) opens the curated 100–599 list.
  - `duration` → ◆ Expected (ms) prompts for a non-negative number.
  - `header` → ◆ Target offers the curated response-header catalogue;
    ◆ Expected then drives the value picker for that header.
  - `json-path` → ◆ Target opens the JSON-path picker against the
    latest response for this request; ◆ Expected resolves the literal
    value at that path and pre-fills it.
  - Target slots are HIDDEN for `status` / `duration` (no target
    semantics).

**Deferred (call out so authors don't expect them):** schema-level
codelenses for Digest `algorithm` + `qop` and JWT Bearer `headerPrefix`
were requested but the underlying `DigestAuth` / `JwtBearerAuth` types
don't carry those fields today. Adding them is an additive schema
change that ripples through `authDefaults`, the digest signer, the
OAuth2 token client, `AuthEditor.tsx`, and the OpenAPI export. Out of
scope for this UX-only pass; will be picked up alongside the next
auth-schema refresh.

### VS Code extension — MCP view bug fixes

Two issues reported on the 1.1.0 Marketplace cut, both fixed:

- **"Remove API Circle MCP from AI Client" silently did nothing.** The
  context-menu entry and the inline trash icon on every installed external
  AI client row (Claude Desktop / Claude Code / Cursor / Windsurf / Zed)
  invoke `apicircle.uninstallMcpForClient`. The handler was typed to
  receive a bare client id string, but VS Code passes the `McpNode` tree
  element `{ kind: 'client', client }` on every `view/item/context`
  trigger. The mismatch slipped past the `INSTALLABLE_CLIENTS.includes`
  guard and the command returned without action. Fixed by extracting
  the unwrap into a new exported helper
  `coerceInstallableClientArg` (in `apps/vscode/src/commands/
mcpClientActions.ts`) that normalises both the string and `McpNode`
  shapes, wired into both `apicircle.installMcpForClient` and
  `apicircle.uninstallMcpForClient`. Regression coverage in
  `mcpClientActions.test.ts`.
- **MCP tooltips, toasts, and the two "Remove …" menu titles read
  "APICircle" instead of the spaced brand "API Circle".** The
  displayName / Activity Bar title / configuration title already
  shipped the spaced brand in 1.0.7 — the MCP user-facing strings
  drifted away during P5–P8. Updated tooltips in `McpView.ts`, toasts
  in `mcpClientActions.ts` / `copilotMcpActions.ts` / `mcpActions.ts`,
  and the two `Remove APICircle MCP from …` command titles in
  `package.json`. Command ids (`apicircle.*`), the command-palette
  `category` prefix, the `apicircle` mcpServers key, and the
  `APICircle Runs` OutputChannel name are unchanged — they are
  identifiers, not display strings.

### Folder-wise auth — gap-closure follow-up

The first folder-wise-auth pass left genuine gaps; this pass closes them
all (no deferred items). Adds:

- **`apicircle.newFolder` command** — VS Code now creates folders directly
  (palette, Editor view title button, and per-folder context menu). The
  FS provider's stale `createDirectory` rejection text now references this
  command. validateInput rejects empty + duplicate-sibling names up front;
  the new folder's YAML opens immediately so the user can set folder-level
  auth without an extra step.
- **CLI `apicircle folder` subcommand** — `list`, `create`, `rename`,
  `set-auth`, `clear-auth`, `move`, `delete`. Every subcommand routes
  through `applyMutation` (FileBackedWorkspaceProvider) so semantics match
  every other surface. set-auth covers the LLM-friendly subset (`bearer`,
  `basic`, `api-key`, `custom-header`, `none`, `inherit`); OAuth2 / AWS /
  Hawk / NTLM / JWT folder auth still authors via the VS Code YAML or the
  web/desktop UI (token state needs runtime the CLI doesn't carry).
- **Linked-workspace folder inspection** — new read-only
  `apicircle://<ws>/linked/<linkSlug>/<folderSlug>.folder.yaml?link=&id=`
  URI projects each linked workspace's folder so consumers can see what
  auth their `auth: inherit` requests resolve to. Writes are rejected (the
  consumer doesn't get to mutate the source); the inherited-auth CodeLens
  on linked request YAMLs now reads `◆ Inherits from <Folder> (<type>)
[linked]` and jumps to the linked folder URI.
- **Inherited-auth CodeLens refresh** — the request CodeLens provider now
  subscribes to `bridge.onDidChangeActiveWorkspace` AND the FS provider's
  `onDidChangeFile` (filtered to `.folder.yaml` changes). A folder rename
  or auth edit in another tab re-fires the lens immediately, so the
  surfaced "Inherits from X" text never goes stale.
- **Duplicate-name folder rename now visibly fails** — `applyMutation`
  silently no-ops a colliding rename; the VS Code FS provider's writeFile
  now inspects `changedIds` after `apply` and throws
  `FileSystemError.NoPermissions("A folder named '<name>' already exists
under the same parent. Pick a different name.")` when the rename was
  rejected. Previously the buffer pretended to save.
- **Folder YAML 🔑 Get token lens** — parity with request YAML. A folder
  carrying an OAuth2 grant (any of the six) gets the same Get-token lens
  the request CodeLens emits. The fetch command was extended to accept
  `.folder.yaml` URIs alongside `.req.yaml`.

Net new tests for this follow-up: **23** (4 collision/rename, 4 newFolder
command, 8 CLI subcommand, 2 OAuth2 lens, 3 linked-folder URI, 2 CodeLens
refresh subscriptions).

### VS Code — folder-wise auth surface

Folder-level auth now has a first-class editor in VS Code so descendants
with `auth: { type: inherit }` resolve to something the user can see and
edit, not just something the runtime infers. Three layers move together:

- **New `folder.update` `WorkspacePatch`** — `{ kind: 'folder.update'; id;
patch: Partial<Pick<Folder, 'name' | 'auth'>> }`. Identity (`id` /
  `parentId`) is immutable here; moves still go through `folder.move`.
  Key-presence semantics: a key missing from `patch` leaves the field
  alone, `auth: undefined` explicitly clears the folder-level auth so
  inheriting requests fall through to the next ancestor. Name uniqueness
  among siblings under the same parent is enforced — a colliding rename
  no-ops the patch. Reducer + 8 new tests in
  [`applyMutation.ts`](packages/core/src/workspace/applyMutation.ts) and
  [`applyMutation.test.ts`](packages/core/src/workspace/applyMutation.test.ts).
- **MCP `folder.update` tool extended** — `name` and `auth` (LLM-friendly
  subset matching `prompt.set_request_*`) and a `clearAuth: true` recovery
  hatch alongside the existing `parentId`. Passing both `auth` and
  `clearAuth` is a Zod-refine error.
- **VS Code FS surface** — new
  [`folderYaml.ts`](apps/vscode/src/fs/folderYaml.ts) serializer +
  structural guards, plus a new `apicircle://<ws>/folders/<folderSlug…>
/<folderSlug>.folder.yaml?id=<folderId>` URI kind in the FS provider
  (`ApicircleFsProvider.folderUri`). Clicking a folder in the Editor
  TreeView now opens the YAML; saving dispatches `folder.update`; deleting
  the URI cascades through `folder.delete` (children reparent). The folder
  tab tooltip surfaces the breadcrumb, and the description carries `auth:
<type>` when an explicit folder-level auth is set. Tree contextValue
  switches between `folder` and `folder-with-auth` so the inline `🔑 Edit
Folder Auth` action button can light up only where it matters.
- **Two new commands** — `apicircle.openFolderYaml` (palette + context
  menu) and `apicircle.editFolderAuth` (alias for discoverability). Both
  resolve from a TreeView node or fall back to a folder quick-pick when
  invoked from the palette.
- **Inherited-auth CodeLens** — when a request YAML carries `auth: { type:
inherit }`, the request CodeLens provider now resolves the chain via
  `resolveInheritedAuth` and surfaces `◆ Inherits from <Folder> (<type>)`
  above the `auth:` line. Click → opens the source folder YAML. When no
  ancestor sets explicit auth, the lens reads `◆ Inherits → none` and
  links to the folder picker so the user can fix it.
- **No migrations** — workspaces with existing `Folder.auth` values keep
  working; workspaces without any folder-level auth are unaffected.
- **Bundle impact** — extension bundle is **2.68 MB** (≈+240 KB vs. the
  prior 2.44 MB baseline). Still under the 3 MB soft warn / 5 MB hard
  fail in `scripts/vscode-bundle-budget.mjs`.

### VS Code — request URL is the source of truth for query + path params

The `◆ URL` CodeLens above a `url:` row is gone — the URL is edited inline
like any other scalar, so the field-editor lens was duplicating the obvious
"click here, type" affordance. To make inline editing carry its weight, the
YAML save path now syncs the URL into the structured `query:` / `pathParams:`
blocks the same way the web / desktop URL bar does — and the editor buffer
reflects the canonical projection immediately on Ctrl+S, so the user sees the
sync happen instead of having to close and reopen the doc.

- A `?key=val&…` typed into the `url:` line is split off on save. The base
  lands back in `url:`; each pair merges into the `query:` block by key —
  enabled rows take the URL-bar value, the disabled rows the user paused
  pass through untouched, and any URL key with no matching row appends in
  URL order. A trailing `#fragment` is dropped (fragments aren't sent on
  the wire anyway).
- `{name}` / `:name` placeholders in the URL path surface as `pathParams:`
  entries. Existing values are preserved; new placeholders get an empty
  string so the user sees a slot to fill. Stale entries that no longer
  match a placeholder are kept — the user prunes them deliberately,
  matching the web / desktop `setRequestPathParams` contract.
- `{{TENANT}}` template references and `:colons` inside the query string
  are left alone — only real path placeholders are extracted, matching
  the `findPathPlaceholders` rules already used by `applyPathParams` at
  send time.
- An `onWillSaveTextDocument` hook (`apps/vscode/src/lang/requestSyncOnSave
.ts`) rewrites the buffer to the canonical projection before `writeFile`
  runs, so the URL strips, the new query / pathParams rows appear, and the
  save completes in a single Ctrl+S — no doc reopen required.

Files: `apps/vscode/src/lang/requestCodeLens.ts`,
`apps/vscode/src/fs/requestYaml.ts` (new `projectRequestYaml` helper),
`apps/vscode/src/lang/requestSyncOnSave.ts`, `apps/vscode/src/extension.ts`
(+ matching test updates in `requestCodeLens.test.ts`, `requestYaml.test.ts`,
and new `requestSyncOnSave.test.ts`).

### CI hardening — CodeQL polynomial regex + TOCTOU sweep

A pass over the CodeQL findings that the `vscode.yml` and `codeql.yml`
workflows were surfacing. No behaviour change for any of the touched
helpers — the existing test suites stay green untouched.

**Polynomial regex → manual O(n) scan**

- `@apicircle/mock-server-core` — `resolveJsonPath` (rules) and
  `parsePathSegments` (multipliers) replace their alternation regex
  (`/([^.[\]]+)|\[([^\]]+)\]/g`) with a hand-written tokenizer. Same
  output, no regex backtracking risk on workspace-authored paths.
- `@apicircle/mock-server-core` — `openApiPathToHono` replaces
  `path.replace(/\{[^}]+\}/g, ':$1')` with a manual indexOf scan that
  can't trip the polynomial detector on user-imported OpenAPI specs.
- `@apicircle/core` — `pemToCryptoKey` extracts the BEGIN/END envelope
  with `indexOf` instead of a lazy `[\s\S]*?` regex. Behaviour
  preserved for every PEM shape we accept (RSA / EC / PKCS#8, with or
  without Bag Attributes between markers).
- VS Code extension — `embeddedMcpHost.ts` parses
  `Authorization: Bearer <token>` via `startsWith` + slice instead of
  `/^Bearer\s+(.+)$/i`. Network-sourced header → no regex.

**File-system race conditions (TOCTOU) → atomic `flag: 'wx'` / try/catch**

- `vscodeBridge.createWorkspaceScaffold` — workspace.json + README
  writes use `flag: 'wx'` (atomic create-or-fail) instead of
  `existsSync`-then-`writeFile`. README EEXIST is ignored
  (idempotent). `ensureGitignore` reads via try/catch on ENOENT.
- `openPlanAsNotebook` — notebook file is created with `flag: 'wx'`;
  EEXIST means "open the existing one" without overwriting.
- `mcpActions.openConfigFileFor` — stat probe is wrapped in
  try/catch (ENOENT); the seeded `mcpServers` write uses `flag: 'wx'`
  so a file that appeared mid-prompt isn't truncated.
- `mcpClientActions.removeApicircleEntry` — try/catch on
  `readFileSync` instead of `existsSync`-then-read.
- `mockActions` (spec import) — one `fs.open()` handle for `fstat`
  - `readFile`, so the size we warn about is the size we actually
    load. No gap between stat and read.

**Other CodeQL findings**

- `planNotebookController.extractBodyText` — drop the redundant
  `body !== null` check that CodeQL flagged as comparing an inconvertible
  type. The preceding `!body` early-return already excludes null.

**Lint / dead-code cleanup**

- `apps/vscode` — un-export four file-internal mock-endpoint render
  helpers, three unused `planNotebookSerializer` interfaces, the
  `PLAN_NOTEBOOK_TYPE` constant (was unused), and the
  `SaveMessage` / `CancelMessage` interfaces (still reachable via the
  exported `WebviewToHostMessage` union). `knip` now reports zero
  dead exports for the VS Code workspace.
- `.github/workflows/vscode.yml` — `knip --include apps/vscode,e2e/vscode`
  was misusing `--include` (which selects issue types). Replaced with
  the correct `--workspace apps/vscode --workspace e2e/vscode`.
- `e2e/vscode/src/test/1-validation.test.ts` — drop unused `vscode`
  import.
- Prettier — re-formatted `CHANGELOG.md` and
  `scripts/live-github/sweep-orphans.mjs` (catches the `Quality gates →
Format check` job that was failing on style nits).

### Link Workspaces — final gap closure (resolution, attachments, CLI, live-GH)

Closes every remaining gap so the linked-workspace + send-time pipelines are
complete across core / MCP / CLI / VS Code.

**Core (`@apicircle/core`)**

- New **`resolveRequestForExecution`** + **`applyLinkedEnvironmentOverrides`** +
  **`plaintextEnvMap`** in `@apicircle/core/environment`. Send-time
  `{{variable}}` and secret resolution is now a shared, pure helper layered on
  the existing `buildScope`/`resolveString`/`resolveInheritedAuth` primitives.
  Linked envs are first-class via composite priority keys (`{kind:'linked',
linkedWorkspaceId, envName}`); linkedOverrides are layered before
  interpolation.

**VS Code extension**

- **Send-time resolution** is wired into `apicircle.sendRequest`. The executor
  receives a fully-interpolated request — url, headers, query, body, and every
  auth field — built from local envs + linked envs (with overrides) + the
  vault-decrypted secret layer + provisioned linked secrets. Unresolved
  placeholders surface a non-blocking warning rather than reaching the wire.
- **Linked binary-attachment download.** Linked requests with binary bodies or
  `file` rows fetch their bytes from the source repo's
  `.apicircle/attachments/<slotId>` over GitHub at send time (one cache per
  send). Uses the dedicated PAT when the link's session is dedicated.
- **Linked env-var override editor.** New `apicircle.setLinkedEnvVarOverride`
  command (3 modes: replace value, remove from consumer view, inject new var)
  routes through the `linkedOverride.setEnvVar` / `removeEnvVar` patches.
- **Linked envs in the priority picker.** `setEnvPriorityOrder` includes every
  cached linked workspace's envs alongside locals, ordered together. Persists
  `EnvPriorityRef[]` with both kinds.

**CLI (`@apicircle/cli`)**

- New `apicircle linked` group: `list | link | refresh | unlink`. Uses the
  bundled `@apicircle/git` client; token from `--token` or `GITHUB_TOKEN`.
- New `apicircle release` group: `tag <repo> <version>` (optional `--release`
  for a GitHub Release) and `topics <repo> [--set <list>]` (keeps `apicircle`,
  validates GitHub's topic rules).

**Tests**

- Live-GitHub integration smoke (read-only) at `apps/vscode/test/integration/
liveGitHub.test.ts`. Gated on `APICIRCLE_LIVE_GH_TOKEN` +
  `APICIRCLE_LIVE_GH_REPO` env vars — skipped silently when not set so CI stays
  green without credentials.

### Link Workspaces — gap closure (consume, merge, secrets, headless networking)

Closes every remaining gap in the linked-workspace feature so it's complete
across core / MCP / VS Code, not just manageable.

**Core (`@apicircle/core`)**

- **Field-level auto-merge.** `previewLinkedUpdate` now flags `both-changed`
  entries as `autoMergeable` when the consumer's override touches a disjoint set
  of fields from the source's change; `applyLinkedUpdate` merges those cleanly
  with no user decision. Only genuine same-field conflicts need resolving.
- **`linkedOverride.*` patches** (`setRequest` / `removeRequest` / `setEnvVar` /
  `removeEnvVar` / `clearForLink`) — consumer edits to a linked workspace's
  requests / env-vars, as field-level deltas.
- Shared `mergeRequestOverride` / `computeRequestOverridePatch` /
  `isEmptyOverridePatch` helpers (`@apicircle/core/linked`) — one implementation
  for runPlan, the web editor, and the VS Code projection (runPlan's private
  copy removed).

**MCP — 89 → 93 tools (`@apicircle/mcp-server`)**

- GitHub network ops over stdio: `linked.link`, `linked.refresh`, `release.tag`,
  `repo.set_topics` — each takes a `token` arg or reads `GITHUB_TOKEN`.
  `@apicircle/git` is **bundled** into the published package (a devDependency, so
  it never becomes an unresolvable runtime dep).

**VS Code extension**

- **Linked requests are consumable.** Each linked workspace expands to its cached
  requests; opening one shows the **effective** request (source + your override)
  at `apicircle://<ws>/linked/<link>/<name>.req.yaml`. Editing + saving stores a
  minimal override; **▶ Send** runs it; **↺ Reset to source** / delete drops the
  override. **Discard all modifications** clears a link's overrides at once.
- **Per-entry update resolution.** Review-update now offers _Resolve each_ (a
  decision per conflicting item) alongside the bulk _Accept all source / Keep all
  mine_ — and auto-mergeable changes apply without prompting.
- **Dedicated sessions.** `sessionMode: dedicated` links store a per-link PAT in
  VS Code SecretStorage (🔑 Set / Clear token); fetches use it instead of the
  built-in GitHub session.
- **Required-secret provisioning.** 🔑 Provide value on each required key stores
  an encrypted value in SecretStorage; cleared on unlink.
- Tagging now reads the repo's declared default branch (`GitHubClient.getRepo`)
  rather than probing.

> Update: the platform-wide caveat noted in this entry is now CLOSED — see
> "final gap closure" above. Send-time variable/secret interpolation and
> linked-attachment download are implemented.

### Link Workspaces — full linking lifecycle in VS Code + MCP config tools

Builds on the release-lifecycle slice below: the **consuming** side of the
link loop now works end-to-end in the VS Code extension, not just the
Desktop/Web app, plus four MCP tools for headless link config.

**Core — `applyMutation` linked-workspace variants (`@apicircle/core`)**

- New `linkedWorkspace.upsert` (carries the link record + optional cached
  ledger + collections/environments snapshot), `linkedWorkspace.remove`
  (cascades across `releases.perLink`, `linkedOverrides`,
  `local.linkedCollections`, and the per-link session), and
  `linkedWorkspace.applyUpdate` (atomic result of a three-way merge) patch
  variants + reducers. Purely additive.
- The pure parse + snapshot helpers (`parseLinkedWorkspaceJson`,
  `buildLinkedSnapshot`, `ledgerFromProbe`) are promoted into
  `@apicircle/core/linked` as the single source of truth for the UI store,
  VS Code, and CLI.

**MCP — 85 → 89 tools (`@apicircle/mcp-server`)**

- `linked.list` / `linked.get` / `linked.set_config` / `linked.unlink` expose
  the pure-data link config to any MCP client. Linking + refresh stay
  host-driven (they need a GitHub session).

**VS Code — the "Link Workspaces" view gets its second half**

- A **Linked workspaces** group joins the Releases group. **Link a Workspace…**
  (pick an accessible repo or enter `owner/name`, choose branch + version) and
  **Search Marketplace…** (public `topic:apicircle` repos) use VS Code's
  built-in GitHub session (`vscode.authentication`) + `@apicircle/git`'s
  `GitHubClient`.
- Each link opens an editable `apicircle://<ws>/links/<name>.link.yaml` with
  CodeLens field editors (◆ pin version / scope / session mode / required keys)
  and action lenses **⤓ Review update · ⟳ Refresh ledger · 📓 Changelog ·
  ⊗ Unlink**. Review runs a three-way `previewLinkedUpdate` /
  `applyLinkedUpdate` with a streamlined bulk _accept-source / keep-mine_
  resolution (no webview).
- **Tag Release on GitHub…** + **Edit Repo Topics…** (`repoActions.ts`) operate
  on the workspace's own repo (owner/name derived from the folder's `origin`
  remote), creating `v<x>` tags / GitHub Releases and managing the
  marketplace-driving topics — closing the gap noted below.
- Extension bundle: **~2.52 MB → ~2.61 MB** (`@apicircle/git` is a light
  fetch-based REST client; comfortably under the 3.0 MB soft warn).

### Release lifecycle — VS Code "Link Workspaces" sidebar + MCP tools

The publishing side of the link/release loop is now drivable headlessly and from
VS Code, not just the Desktop/Web Workspace panel. A workspace's **release
ledger** (`synced.releases.self`) — the versions linked consumers pin to — gets
first-class authoring on three surfaces.

**Core — `applyMutation` release variants (`@apicircle/core`)**

- `publishRelease` is split into the async `buildReleaseEntry` (computes the
  SHA-256 `workspaceSnapshot`) and the pure, synchronous `appendReleaseEntry`,
  so the snapshot can be built off-thread and the mutation stays pure.
  `deprecateRelease` / `yankRelease` now take an optional injected `now`
  (defaults preserved — existing callers unchanged).
- Three additive `WorkspacePatch` variants — `release.publish` (carries a
  pre-built `ReleaseVersion`), `release.deprecate`, `release.yank` — with
  matching `applyMutation` reducers. Headless writers (MCP / CLI / VS Code) now
  route release writes through the same choke point the UI uses. Purely
  additive: no migration, existing workspaces load unchanged.

**MCP — 81 → 85 tools (`@apicircle/mcp-server`)**

- New `release.list`, `release.publish`, `release.deprecate`, `release.yank`
  tools wrap the new patches. Any MCP client (Claude Desktop, Cursor, Copilot,
  …) can now publish and manage releases. Tagging on GitHub + marketplace
  topics remain Git operations, not MCP tools. See
  [`docs/mcp-tools-reference.md`](docs/mcp-tools-reference.md).

**VS Code — "Link Workspaces" sidebar replaces the dormant "Marketplace" stub**

- The empty, off-by-default `apicircle.marketplace` view (and its
  `apicircle.enableMarketplace` setting) is replaced by an always-on **Link
  Workspaces** view. Phase 1 surfaces the **Releases** group: the current
  version, every published version (newest-first) with deprecated / withdrawn
  status, and a **Publish release** title button.
- A read-only `apicircle://<ws>/releases/releases.yaml` document with CodeLens
  actions — **▶ Publish release…** on the `currentVersion` line, **⚠ Deprecate**
  / **⛔ Withdraw** on each version row (status-aware: an action already in
  effect isn't offered again). Withdraw requires a typed `WITHDRAW v<x>`
  confirmation. Publishing offers patch / minor / major bumps off the current
  version (or a custom semver) plus a notes prompt.
- Per-version context-menu Deprecate / Withdraw in the tree mirror the CodeLens
  actions. Extension bundle: **~2.44 MB → ~2.52 MB** (`extension.js`,
  comfortably under the 3.0 MB soft warn).

### VS Code extension — authoring feedback follow-ups

A second hands-on pass tightening the `apicircle://` authoring surfaces.
Extension bundle: **~2.44 MB → 2.50 MB** (`extension.js`, comfortably under the
3.0 MB soft warn) — a net wash, since two commands were removed and a small
amount of folder-pick logic added.

**Startup**

- **Open editors are processed on activation.** Beyond discovering
  `.apicircle/workspace.json`, the extension now inspects the editors VS Code
  restored from the previous session: if one is an `apicircle://` virtual YAML
  (request / env / mock / endpoint / …) or the raw `.apicircle/workspace.json`,
  the workspace that editor belongs to becomes the active one — so the sidebar,
  status bar and MCP snippets match what's already on screen instead of
  whatever discovery defaulted to.

**Per-endpoint mock YAML (`*.endpoint.yaml`)**

- **`requestSchema` add-lenses moved onto their subsections.** `✚ Path param` /
  `✚ Query param` / `✚ Header` / `✚ Cookie` now sit directly above their
  respective `pathParams:` / `queryParams:` / `headers:` / `cookies:` lines (and
  `✚ Body example` above `body:` when present), instead of all stacking on the
  `requestSchema:` header.
- **`◆ Required` lens removed.** `required:` is a boolean flag edited directly in
  YAML — the toggle lens (and its `apicircle.toggleMockParamRequired` command)
  are gone.
- **A response rule with no `when` condition is now a save-blocking error.** An
  empty `when:` would match every request and shadow the default response — the
  endpoint parser rejects it (red diagnostic) so you add a condition (the
  `✚ Add condition` lens) or remove the rule.

**Collection request YAML (`*.req.yaml`)**

- **`APICircle: New Request` is now a single folder pick + direct file creation.**
  The old 5-step wizard (method → URL → folder → auth → name) is replaced by one
  prompt — choose an existing folder, the top level, or create a new folder
  inline — after which a ready-to-edit GET scaffold opens in the editor for you
  to tweak and send. (Invoked from a folder's context menu, the pick is skipped.)
- **Form-data `✚ Add text row` / `✚ Add file row` moved onto `formRows:`.** They
  now anchor on the `formRows:` line inside the body block (reading as "add a row
  to _this_ list"); the redundant body-level `⇄ Switch row kind…` lens is gone —
  switching is per-row only (`↻ Switch to text/file` on each entry).
- **Auth `◆ Edit` / `◆ Pick` field lenses removed.** Auth scalar fields are
  edited directly in YAML; the `apicircle.setRequestAuthField` command was
  removed. The `⟳ Format JSON` lens on JSON auth fields (`payload` /
  `jwtHeaders`) is kept.

### VS Code extension — mock & collection authoring overhaul

A sweep across the `apicircle://` authoring surfaces driven by hands-on feedback.
Extension bundle: **2.37 MB → 2.44 MB** (`extension.js`, under the 3.0 MB soft
warn) for the new commands.

**Mock summary (`*.mock.yaml`)**

- **Fixed `↗ Open endpoint` (and Start / Stop / Restart):** the lens read the
  mock id from the URI **path basename**, which is now the human-readable name
  slug — so the command received a slug and missed `synced.mockServers[id]`
  ("Mock no longer exists"). It now reads the id from the `?id=` query.

**Per-endpoint mock YAML (`*.endpoint.yaml`)**

- **Header value suggestions in `when` clauses:** a clause `◆ Value` on a
  `scope: header` condition now offers the header's curated value catalogue
  (e.g. Content-Type media types) via the new `apicircle.setMockClauseValueField`
  command; the lens is hidden entirely for the `present` / `absent` ops (which
  compare nothing).
- **`✚ Add header` moved to the headers block:** the response-rule add-header
  lens now anchors on that rule's `response.headers:` line instead of the rule's
  `- id:` row, so it reads as "add a header to _this_ list".
- **One condition per response rule:** a new `MAX_RESPONSE_RULE_CONDITIONS = 1`
  authoring cap (in `@apicircle/shared`, mirroring `MAX_RESPONSE_MULTIPLIERS`)
  hides `✚ Add condition` once a rule has a clause — in both the VS Code lenses
  and the desktop/web rule editor. The `when` array + engine are unchanged, so
  raising the constant is the only change to allow N.
- **Per-header enable/disable:** every response/validation header key row gets a
  `✓ Enable` / `⊘ Disable` toggle (`apicircle.toggleMockHeaderEnabled`).
- **`requestSchema` authoring:** `✚ Path param · ✚ Query param · ✚ Header ·
✚ Cookie · ✚ Body example` section lenses (or `✚ Add request schema` when the
  block is absent) plus per-param `◆ Name / ◆ Type / ◆ Example / ◆ Description`
  field lenses (the `required` boolean is edited directly in YAML). Path params
  prefill from the `{slot}` segments in the pattern; headers offer the curated
  catalogue.
- **`⟳ Format JSON`** lens on JSON body `content:` rows (endpoint + request YAML)
  reflows a stringified body into pretty, indented JSON
  (`apicircle.formatJson`).

**Collection requests (`*.req.yaml`)**

- **Field-editor `◆` lenses** mirroring the mock surface — `◆ Method`, header
  `◆ Key` / `◆ Value` (catalogue-aware), query / cookie key + value, path-param
  values, **assertions** (`◆ Kind` / `◆ Op` pickers + `◆ Target` / `◆ Expected`),
  and **extractions** (`◆ Source` picker + `◆ Variable` / `◆ Path`). Auth scalar
  fields are edited directly in the YAML (no `◆` field editor).
- **`⟳ Format JSON`** also lands on a **GraphQL body's `variables:`** and on the
  JSON **auth `payload:` / `jwtHeaders:`** fields (the reflow helper now matches
  any JSON-bearing key, with an object/array-only guard so a scalar like
  `status: 200` is never touched). **Robustness:** an **empty** body / variables
  scalar (`content: ''` / bare / blank block) is now **silently skipped** instead
  of raising a "not valid JSON" toast; **multi-line block scalars** reflow
  correctly (mis-indented JSON is normalized); an already-formatted body makes no
  edit; and the result is a plain multiline JSON string that round-trips through
  `parseRequestFromYaml` → the store, so it renders identically in the Web /
  Desktop Monaco editors.
- **Sample-input seeding:** a new request opens with method-appropriate starter
  content — body-bearing methods get a `Content-Type` header + sample JSON body;
  GET gets an `Accept` header + a `page` query param — instead of an empty shell.

**Structural validation (all three surfaces)**

- An `apicircle` **DiagnosticCollection** surfaces parse problems live before
  save: a renamed / mistyped key — at the **top level OR inside any nested
  entry** (a param, validation/response rule, when-clause, header row, response
  body, or multiplier), e.g. `naem:`/`targett:`/`valuee:`), or a section with
  the wrong type (e.g. `responseRules: oops`) — is now a **red Error that blocks
  the save** (previously the field was silently dropped / its id regenerated);
  coercible value-level issues stay yellow Warnings. Applies to endpoint, mock,
  and request YAML.

**Web / Desktop (`@apicircle/ui-components`)**

- **`requestSchema` editor** in the mock endpoint editor (the Endpoint node):
  path / query / header / cookie param tables (name / type / required / example)
  - a "Derive from path" affordance + body-shape docs. This closes the
    cross-surface gap — a mock endpoint's declared inputs round-trip through
    `.apicircle/workspace.json` and are now editable in VS Code **and** the
    Desktop / Web app (previously only VS Code YAML / OpenAPI import could write
    them).

**Mock parsers (`@apicircle/mock-server-core`) — imports now populate `requestSchema`**

- Importing an **OpenAPI / Postman / Insomnia** spec now extracts the declared
  parameters into the endpoint's `requestSchema` instead of leaving it empty:
  OpenAPI operation **+ path-item** `parameters` (`in: path/query/header/cookie`,
  with `required` / `description` / `typeHint` from `schema.format ?? type` /
  `example`); Postman `url.variable` → path, `url.query` → query, `header` →
  headers (disabled rows skipped); Insomnia `:slot` / `{slot}` URL segments →
  path, `parameters` → query, `headers` → headers. So the schema editor (VS Code
  / Web / Desktop) is pre-filled from the spec rather than blank.

**MCP (`@apicircle/mcp-server`) — tool catalog 79 → 81**

- **`mock.set_request_schema`** + **`prompt.set_endpoint_request_schema`** let an
  AI client author an endpoint's `requestSchema` (path / query / header / cookie
  params + body docs), completing the tri-surface + AI parity — the field was
  previously seeded empty by the MCP tools with no way to populate it. Follows
  the existing `mock.set_*` / `prompt.set_*` setter idiom (mock-variant preserves
  param ids; prompt-variant re-ids). README / `docs/mcp-tools-reference.md` /
  `docs/connect-your-ai-client.md` tool counts bumped to **81**.

**CLI:** unaffected — the `apicircle` CLI is a batch runner (import / export /
run / start / workspaces) with no per-endpoint authoring surface; it writes
canonical `WorkspaceSynced` JSON directly (never the YAML projections), and its
`apicircle mcp` subcommand auto-exposes the two new tools with no CLI change.

### Response multipliers — array shape, soft-capped at 1 (extensible to N)

`MockResponseConfig.multipliers` stays a `MockResponseMultiplier[]` **array**,
and a new `MAX_RESPONSE_MULTIPLIERS = 1` constant (in `@apicircle/shared`) caps
how many the authoring surfaces let you add today. The cap is a soft
authoring-UX guardrail — the runtime engine applies every entry it finds, so
**raising the constant to N is the only change needed to support multiple
multipliers**: no schema migration, no persisted-data reshape, no engine change.

This supersedes the brief "single object" reshape from earlier in this
Unreleased window — keeping the array avoids a second migration when N lands.
The cap is enforced in:

- the desktop/web response editor (Add disabled at the cap, "limit reached" hint);
- the VS Code `*.endpoint.yaml` lenses (`✱ Add multiplier` hidden at the cap;
  `✕ Remove multiplier` per entry);
- the MCP tools `mock.set_multipliers` / `prompt.set_endpoint_multipliers`
  (array input; reject `length > MAX`; `[]` clears) and the
  `prompt.create_mock_server` / `prompt.add_mock_endpoint` envelopes
  (`multipliers?` arrays). Tool names/shapes are unchanged from the original
  array surface.

### VS Code extension — mock field-editor completeness pass

Closes the gaps left by the field-editor work:

- **Content-Type reconciliation** — `◆ Body type` now updates the same config's
  `Content-Type` header to match (json → `application/json`, none → drops the
  row), via a shared `reconcileContentType`.
- **Indentation derived from the document everywhere** — the palette
  `switchMockResponseBodyType` / `addMockResponseHeader` commands previously
  hardcoded `ruleId ? 6 : 4` and mis-indented nested response-rule headers / the
  default body; they now read the matched line's indent.
- **Remaining field lenses** — `◆ Value` on when-clause `value:`, and
  `◆ Count` / `◆ Min` / `◆ Max` / `◆ Name` on the multiplier (via shared
  `setMockTextField` / `setMockNumberField` commands).
- **Tests** — a new
  `apps/vscode/src/commands/mockFieldEdits.integration.test.ts` drives every
  field command through the real parse → pick → edit → save → re-parse
  round-trip (the vscode test mock gains a `WorkspaceEdit` + `applyRecordedEdits`
  helper); `MockResponseEditor` gains a component test for the multiplier
  Add-cap; the desktop MCP e2e `set_multipliers` happy-paths now run with real
  args.

### VS Code extension — full field-level CodeLens editing for mock endpoints

The per-endpoint `*.endpoint.yaml` editor gains a ◆ field-editor lens on
essentially every editable scalar, and the `*.mock.yaml` summary gains
per-endpoint navigation:

- **`*.mock.yaml`** — each endpoint row gets an **`↗ Open endpoint`** lens that
  opens its editable `*.endpoint.yaml`.
- **`*.endpoint.yaml` field editors** (each lens sits on the field row and is
  line-addressed, so the same code path works at any nesting depth —
  `defaultResponse`, a `responseRule.response`, or a `validationRule.failResponse`):
  - **`◆ Method`** on `method:`.
  - **`◆ Status`** on every `status:` (common-code quick-pick + custom).
  - **`◆ Key` / `◆ Value`** on each header row — the value picker is
    header-aware (`getHeaderValues`, the same curated catalogue the Web/Desktop
    editors use).
  - **`◆ Body type`** on each body `type:` — rewrites the body subtree, indent
    derived from the document.
  - **`◆ Scope` / `◆ Op` / `◆ Target`** on each response-rule `when`-clause, plus
    **`✚ Add condition`** on `when:`. The target picker offers the endpoint's
    declared params for the clause's scope.
  - **`◆ Kind` / `◆ Key` / `◆ Path`** on the multiplier — `◆ Path` discovers the
    array paths in the default-response JSON body and offers them as a pick.
- **Multiplier authoring**: `✱ Add multiplier` inserts a prefilled sample with
  no prompts and hides once the list is at the cap (`MAX_RESPONSE_MULTIPLIERS`,
  currently 1); `✕ Remove multiplier` removes an entry by id.
- Status / body-type editors moved off the section-header rows onto the field
  rows (less duplication). New commands live in
  `apps/vscode/src/commands/mockFieldEdits.ts` (pure helpers unit-tested);
  VS Code bundle ~2.44 MB (under the 3.0 MB soft budget).

### VS Code extension — mock validation rules author in-editor via CodeLens

Feedback follow-up on the per-endpoint `*.endpoint.yaml` editor. Adding a
request-validation gate used to pop a chain of QuickPick / InputBox dialogs
(kind → target → expected) before anything showed up in the editor. It now
follows the same insert-then-refine model as the rest of the endpoint edits:

- **`🛡 Add validation rule`** drops a prefilled `header-required` rule into
  the YAML with no prompts and reveals its `kind:` row.
- Each validation entry grows three kind-aware per-field CodeLenses:
  - **`◆ Kind`** — pick from the 9 kinds; the `target:` / `expected:` rows
    reshape to match (e.g. `body-required` drops both, `content-type-equals`
    drops the target and seeds a value row, same-family switches keep the
    target).
  - **`◆ Target`** — pick from the endpoint's own declared `requestSchema`
    params first, then — for header kinds — the curated global header
    catalogue (`HTTP_HEADERS_MAP`, the same map the Web + Desktop header
    editors surface), plus a `✏ Custom…` entry.
  - **`◆ Value`** — `content-type-equals` offers the Content-Type catalogue,
    `header-equals` offers the picked header's known values, and the
    `*-matches` kinds collect a validated regex.

Implementation notes:

- New `apps/vscode/src/lang/mockValidationKinds.ts` holds the kind table plus
  the pure reshape / catalogue helpers (`applyValidationKindChange`,
  `validationTargetCandidates`, `expectedValueCatalogue`), shared by the lens
  and the commands so they can never disagree about what a kind needs.
- New commands `apicircle.setMockValidationKind` / `…Target` / `…Expected`
  parse the endpoint, mutate the single rule, and re-render that entry through
  the lossless `renderValidationRule` — `failResponse` and every other field
  round-trip through the parser untouched.
- `EndpointCodeLensProvider` emits the field lenses; `Add Mock Validation
Rule` loses its trailing ellipsis since it no longer prompts.
- Unit + lens + manifest tests added; VS Code bundle ~2.41 MB (well under the
  3.0 MB soft budget). No schema, store, or MCP surface change.

### VS Code extension — response tab opens instantly with "Sending…" placeholder

Follow-up to the in-flight CodeLens work. Even with the lens row swapping
to ⏳ Sending… and the status-bar spinner running, the user was still
staring at an unchanged screen for 1-2 s until the response tab appeared
on the right. Now the response tab opens **the instant the user clicks
▶ Send** — beside the request editor, focus preserved on the request
YAML — pre-filled with a "Sending…" placeholder. When the executor
resolves the same tab swaps in the real response (or a "Cancelled" /
"Failed" notice on the cancel / error paths) without flickering: the FS
provider's `responseStore` is mutated in place and `fireChangedExternal`
triggers VS Code to re-read the open doc.

Implementation notes:

- New formatters in `responseDocument.ts`:
  - `formatPendingResponseDocument` — placeholder rendered when the
    tab first opens: summary block with `status: Sending…`, method,
    url, startedAt, plus a one-liner pointing the user at ✖ Cancel /
    Esc to abort.
  - `formatCancelledResponseDocument` — replaces the placeholder when
    the AbortSignal fires; carries the same summary block with
    `status: Cancelled` + durationMs.
  - `formatFailedResponseDocument` — replaces the placeholder when
    `executeRequest` rejects without an `AbortSignal.aborted`; carries
    `status: Failed`, durationMs, and the underlying error string so
    the tab is self-explanatory without scrolling back to the
    notification toast.
- `sendRequestCommand` flow re-ordered: stash placeholder + open tab
  beside (with `preserveFocus: true` so the cursor stays in the
  request editor) → run `executeRequest` inside `withProgress` → on
  every terminal state, rewrite the store entry and fire a
  `Changed` event on the response URI so the open tab refreshes.
  Test hook `deps.openResponse` keeps its existing
  "called-once-with-final-content" contract; production runs always
  go through the FS provider path.
- Bundle: 2.38 MB (+3 KB). Well under the 3.0 MB soft warn.

Files: `apps/vscode/src/execute/responseDocument.ts`,
`apps/vscode/src/execute/sendRequest.ts`, and four new test cases
covering placeholder open, beside-with-preserve-focus, cancel-path
replacement, and error-path replacement.

### VS Code extension — in-flight Send feedback + name-first tab titles

Two paper-cuts the user flagged in the feedback sweep:

- **▶ Send swaps to ⏳ Sending… · ✖ Cancel while the request is in flight.**
  Previously the 1–2 s between clicking ▶ Send and the response tab opening
  was silent — the user couldn't tell whether the click had landed. The
  request CodeLens now subscribes to a new `InFlightSendTracker` and
  replaces the default `▶ Send · ✚ Add section… · ⤵ New from template…`
  row with `⏳ Sending… (1.2s) · ✖ Cancel` until the executor returns.
  The elapsed counter ticks every 500 ms while a send is in flight and
  the interval is cleared the moment the tracker drains, so idle
  documents pay nothing. The Cancel lens fires `apicircle.cancelOneSend`
  — a new command that aborts only the in-flight send for the URI it
  was clicked on (distinct from the existing `apicircle.cancelSend`
  Esc-bound cancel-all). The send command itself now wraps
  `executeRequest` in `vscode.window.withProgress({ location: Window })`
  so the same status-bar spinner shows up for sends kicked from the
  palette / Ctrl+Enter, and the notification's built-in cancel button
  wires straight to the AbortRegistry. The tracker entry is cleared in
  a `finally` so success / error / cancel all revert the CodeLens row
  in one place.

- **`apicircle:` tab titles now use the request name + folder breadcrumb,
  never the id.** The previous URI shape was
  `apicircle://<ws>/requests/<requestId>.req.yaml` so VS Code showed
  `<requestId>.req.yaml` as the tab label — unreadable when you had
  three or four tabs open, and the user worried they could edit the
  visible id by accident. The new shape is
  `apicircle://<ws>/requests/<folderSlug…>/<nameSlug>.req.yaml?id=<id>`
  — the basename is the slugified request name, the folder chain
  mirrors the workspace tree (so the tab tooltip surfaces the
  breadcrumb), and the id rides in the `?id=` query so identity
  survives renames and folder moves. The same redesign applies to
  `planUri` (`.plan.yaml`), `mockUri` (`.mock.yaml`), `endpointUri`
  (`/<mockSlug>/<endpointSlug>.endpoint.yaml`), `responseUri`
  (`.run.yaml`), and `historyUri` (`.run.yaml`). Sibling-slug
  collisions in the same folder suffix the slug with `~<shortId>` so
  URIs stay unique without the full id leaking into the tab. When
  the user edits `name:` and saves, the `writeFile` path detects the
  URI change, reopens the new URI in the same editor column (cursor
  selection preserved), and closes the stale tab — the tab title
  follows the rename in a single save action. `extractRequestId` in
  `sendRequest` and `addExtraction`'s active-editor lookup both read
  the `?id=` query first; the request CodeLens glob widened from
  `**/requests/*.req.yaml` to `**/requests/**/*.req.yaml` so deep
  folder paths still trigger the lens. New `cancelOneSend` command
  contribution added; the rest of the package.json surface is
  unchanged.

Bundle size: 2.38 MB (was ~2.37 MB; +~13 KB, well under the 3.0 MB
soft warn).

Files: `apps/vscode/src/execute/inFlightTracker.ts` (new) +
`apps/vscode/src/commands/cancelRequestSend.ts` (new),
`execute/sendRequest.ts`, `lang/requestCodeLens.ts`,
`fs/apicircleFsProvider.ts`, `views/EditorView.ts`,
`views/HistoryView.ts`, `views/MockView.ts`,
`views/ExecutionView.ts`, `commands/requestActions.ts`,
`commands/newRequest.ts`, `commands/newRequestFromTemplate.ts`,
`commands/mockActions.ts`, `commands/addExtraction.ts`,
`extension.ts`, `package.json`, and the matching unit / integration
tests.

### VS Code extension — more authoring affordances on the YAML surfaces

Round 5 of the feedback sweep — four asks landed in one pass:

- **Auto-format JSON body content in YAML.** Both `requestYaml.ts` and
  `endpointYaml.ts` now pretty-print `body.content` when
  `body.type === 'json'` and the content is parseable JSON. The
  projection emits a readable block scalar
  (`content: |-\n  {\n    "key": "value"\n  }`) instead of a wall-of-text
  single-line string. `JSON.parse` ignores the indentation we add, so
  the round-trip stays byte-identical between projection cycles. Invalid
  JSON and already-multi-line content pass through unchanged.

- **`requestSchema` is hidden from the endpoint YAML when empty.**
  Answers the "why is this in every endpoint" question — `requestSchema`
  is the declarative input spec the desktop UI + OpenAPI export drive
  off, and 90% of mock endpoints don't populate it. The projection now
  omits the section entirely when all four param arrays are empty AND
  `body` is absent. Round-trip preserves any populated schema (the
  parser still reads the section when present; it just doesn't render
  an empty one).

- **Content-Type header auto-syncs when switching response body type.**
  `apicircle.switchMockResponseBodyType` now also reconciles the
  matching response config's `headers:` block:
  - `json` → `application/json`
  - `xml` → `application/xml`
  - `text` → `text/plain`
  - `urlencoded` → `application/x-www-form-urlencoded`
  - `form-data` → `multipart/form-data`
  - `binary` → `application/octet-stream`
  - `none` → strips the Content-Type row entirely.

  Existing Content-Type rows are updated in place (preserving
  `enabled` flags); if absent and the new type needs one, a new row is
  inserted at the top. All other headers preserved verbatim. Works for
  both `defaultResponse` and per-rule responses.

- **Enable / disable + add-header CodeLens on the endpoint YAML.** Each
  `responseRules` and `requestValidation` entry now gets an
  `⊘ Disable` / `✓ Enable` lens (rendered based on the row's current
  `enabled:` value). `apicircle.toggleMockRuleEnabled` flips the line
  in place. Above `defaultResponse.headers:` (and per-rule
  `response.headers:`), a new `✚ Add header` / `✚ Header` lens fires
  `apicircle.addMockResponseHeader` — a two-step quick-pick over a
  curated catalogue of 8 common response headers (Content-Type,
  Cache-Control, ETag, Location, X-RateLimit-Remaining, X-Request-Id,
  Access-Control-Allow-Origin, Set-Cookie) with preset values per
  header.

- **Per-section "+ Add row" lenses on the request YAML** for the
  remaining sections — `query`, `cookies`, `pathParams`, `assertions`,
  `extractions`. Each fires a focused input flow:
  - `query` / `cookies` — key + value input boxes.
  - `pathParams` — key + value persisted as a YAML map entry (matches
    the canonical `pathParams: Record<string,string>` shape).
  - `assertions` — kind (status / header / json-path / response-time)
    → op (equals / matches / gt / lt / …) → expected → optional name.
  - `extractions` — source (body JSON path / header / cookie / status)
    → variable → path.

  Inline-empty section shapes (`query: []`, `pathParams: {}`) are
  converted to block-form on first insert so the result is well-formed
  YAML.

Test count rose 945 → 966 (+21). Bundle 2.34 MB → 2.37 MB (+30 KB),
still well under the 3.0 MB soft warn. Per-command activation events +
manifest-regression pins added for the 7 new commands (5 request-side,
2 endpoint-side).

### Mock server — editable default port on every surface

Until now the **Default port** field on a `MockServer` was set only at
creation time (the VS Code New Mock wizard, the CLI `--port` flag, or a
hand-edited YAML / MCP write). The Desktop + Web Mocks panel rendered
`Default port: auto` as a read-only row, and there was no one-click
"change the port" affordance from the VS Code Mock view either. Three
parallel changes close the gap:

- **Web + Desktop Mocks panel.** The `ServerSummary` view in
  `packages/ui-components/src/panels/mocks/MockServersPanel.tsx` now
  surfaces a dedicated **Default port** section with an editable input,
  inline validation against 1024–65535, and a "let the runtime pick a
  free port" empty state. Disabled while the mock is running — stop it
  first to change. Persists via a new `setMockServerDefaultPort` store
  action that funnels through the same synced-doc write path as
  `setMockServerName` / `setMockServerCors`. The same Mocks panel ships
  in the desktop and the web build, so the affordance is everywhere.

- **VS Code Mock view.** New `apicircle.setMockPort` command + right-
  click **Set Mock Port…** menu item on the mock row (both `mock-idle`
  and `mock-running`). Pre-fills with the current port and reuses the
  same 1024–65535 validator the New Mock wizard uses. Persists via
  `mock.upsert`; when the mock is running, the prompt warns that the
  new port only takes effect on next Start. The YAML editor in
  `<id>.mock.yaml` still works for users who prefer it — this is a
  one-click alternative.

- **Sharper port-bind errors.** `@apicircle/mock-server-core` now
  exports a typed `MockServerStartError` carrying `code` (`EADDRINUSE`
  / `EACCES` / `EADDRNOTAVAIL` / `INVALID_PORT` / `UNKNOWN`), `port`,
  and `host`. The runtime adapter (`runtime/nodeAdapter.ts`) wraps the
  raw Node `listen EADDRINUSE …` payload into an actionable message:
  `Port <n> on 127.0.0.1 is already in use. Stop the other process or
pick a different port.` Non-integer / out-of-range ports are
  rejected up-front instead of crashing inside `@hono/node-server`.
  Every surface (Desktop, Web mocked through the desktop bridge, VS
  Code, CLI, MCP) inherits the cleaner message automatically.

Schema is unchanged — `MockServer.defaultPort: number | null` already
existed; the field is now just user-editable on every UI surface
instead of write-once.

Follow-on gap closures landed in the same pass:

- **MCP — new `mock.set_default_port` tool** (catalog grows 78 → 79).
  Persists a 1024-65535 port (or `null` for "pick a free port at next
  start") on an existing mock without restarting it. Documented in
  [`docs/mcp-tools-reference.md`](docs/mcp-tools-reference.md) and
  [`docs/connect-your-ai-client.md`](docs/connect-your-ai-client.md).
  Tool count bumped in CLAUDE.md, README.md, the cold-start brief,
  the VS Code MCP view label, and the
  `mcpManager.test.ts` regression test.

- **MCP — tighter `mock.start` schema.** `port` now constrained to
  `z.number().int().min(1024).max(65535).optional()`; out-of-range
  values are rejected at the tool boundary instead of escaping into
  the runtime as `INVALID_PORT`.

- **Web/Desktop — port input editable while running.** Reversed the
  earlier "disabled while running" decision: `defaultPort` is the
  port used at _next_ Start, not the live listener's port. The
  running case now shows `Running on port <n>. New value applies on
next Start.` so the semantics are honest and consistent with the
  VS Code `Set Mock Port…` command.

- **CLI — new `apicircle mocks` subcommand group.** Adds `mocks list`
  (table or `--json`) and `mocks set-port <selector> [port]` for the
  headless surface. The plural `mocks` group operates on persisted
  workspace definitions; the existing singular `mock <spec>` keeps
  its on-the-fly-from-a-file semantics. Selector matches by id or
  case-insensitive name. Omitting the port arg (or passing
  `auto`/`null`) clears back to free-port mode.

- **Desktop E2E — port flow Playwright spec.** `e2e/desktop/mock-servers.spec.ts`
  now drives the real `EADDRINUSE` path: starts two mocks pinned to the
  same port via the desktop bridge, asserts the second start throws a
  `MockServerStartError` whose message names the port and includes
  "already in use". A second test exercises the `PortSection` input
  end-to-end against the renderer's IDB store. Gates regressions on
  the user-facing error copy.

VS Code extension bundle: 2.34 MB → **2.37 MB** (+30 KB, well under the
3.00 MB soft warn / 5.00 MB hard fail). The growth is the
`setMockPortCommand` + the host-side mock-actions register, plus their
test coverage doesn't ship.

### VS Code extension — first-week feedback sweep

Seven observations from a real user sharing screen on a fresh sideload —
each one a five-minute paper-cut individually, but together they made the
extension feel half-finished. Fixed in one pass:

- **Extension display name: "APICircle Studio" → "API Circle Studio".**
  Brings the VS Code surface in line with the desktop's `productName` and
  the macOS install warning copy in this CHANGELOG. The Marketplace
  listing, the Activity Bar tooltip, the Settings page header, and the
  Editor welcome card all now read "API Circle Studio" — the brand has
  one spelling across the three surfaces. Command-palette category stays
  as `APICircle:` since it's a shorthand prefix only power-users see and
  renaming all 58 occurrences would inflate the diff without UX value.

- **Activity Bar + Marketplace icons replaced with the official brand
  mark.** Marketplace icon (`media/icon-marketplace.png`) is the
  user-supplied black/white 1024×1024 PNG — a filled central disc with
  the `>` chevron + paired dot, ringed by six satellite nodes on a
  dashed orbit. The Activity Bar SVG (`media/icon-activitybar.svg`)
  reproduces the same design but swaps the hardcoded black/white for
  `currentColor` strokes/fills + an SVG `<mask>` element for the
  chevron + dot cutouts inside the central disc, because VS Code
  renders activity-bar icons as a mask using the active theme colour
  and any non-`currentColor` paint silently drops out. Six satellite
  rings keep their interior transparent (stroke-only) so the theme
  background shows through cleanly under both light + dark themes.

- **Snapshots: Restore / Delete now show inline.** The two actions were
  only reachable from the right-click context menu, so on hover users
  saw a row with no obvious affordance. Both commands gained an `icon`
  (`$(history)` / `$(trash)`) and an `inline` menu group on
  `snapshot-entry` rows — the icons render in the row's gutter the same
  way mocks' play/stop already do. Context-menu entries retained.

- **MCP: GitHub Copilot install now has a matching uninstall.** The row
  used to flip from "Install" → "✓ installed" with no way back —
  `apicircle.uninstallCopilotMcpConfig` was simply never wired. Added a
  new host helper (`uninstallCopilotMcpConfig` in
  `host/copilotMcpInstall.ts`) that strips the apicircle key from
  `.vscode/mcp.json` while preserving foreign `mcpServers` entries the
  user added by hand, plus the matching command + activation event +
  inline trash + context-menu entries on the `mcp-client-copilot-installed`
  and `-stale` rows. Idempotent — runs on an already-clean file resolve
  as "absent". Six new unit tests in `copilotMcpInstall.test.ts` lock
  the contract.

- **Sidebar rows now have meaningful tooltips.** `EditorView` folder +
  request rows, `EnvironmentView` env rows, `HistoryView` bucket rows
  and global-var rows — none of them set `item.tooltip` before, so the
  user got "Edit cell" generic OS hover or nothing. Folders now show
  `<name> · <N> requests, <M> folders`; request rows show
  `<method> <url>` + auth + body type; env rows show `<name> · <N>
variables (<K> encrypted)`. The `MockView` endpoint row's tooltip
  picked up MarkdownString formatting + a hint pointing at the new
  pencil affordance.

- **Mock endpoints: edit form is now one click away.** The webview
  endpoint editor (P11) already existed, but it was buried under
  `1_actions@3` in the context menu — most users never found it. Added
  `apicircle.editMockEndpoint` as the row's default click action +
  promoted it to the inline group with the pencil icon. The tooltip
  now also points users at it explicitly ("Click ✎ to edit
  method / path / status / body in a form, or open the mock YAML for
  full control").

- **Request YAML: "+ Add section…" CodeLens + "New from template…".**
  The request CodeLens row grew from one lens (`▶ Send`) to three:
  `▶ Send` · `✚ Add section…` · `⤵ New from template…`. The new "Add
  section…" lens opens a quick-pick listing every optional YAML key
  (`pathParams`, `query`, `headers`, `cookies`, `auth`, `body`,
  `contextVars`, `extractions`, `assertions`) — picking a missing
  section inserts a starter scaffold via `WorkspaceEdit`, picking one
  that's already present scrolls cursor to it. One smart lens beats
  seven noisy ones, and every section is discoverable without the user
  having to know the YAML key names by heart. The new
  `apicircle.newRequestFromTemplate` command (also surfaced as a
  `$(file-symlink-file)` view-title button + an entry in the Editor's
  workspace-present welcome card) picks from six starter shapes —
  Simple GET, JSON POST, Bearer-protected GET, Paginated GET, GraphQL
  query, and a five-request REST CRUD scaffold that creates a folder of
  List / Get / Create / Update / Delete requests for a named resource.

- **Mock endpoint sidebar pencil now opens the YAML, and the mock YAML
  stops surfacing per-endpoint editing lenses.** Two follow-up issues
  from the prior round:
  - The inline pencil on each Mock-sidebar endpoint row still routed
    to `apicircle.editMockEndpoint` (the legacy webview form),
    contradicting the row's click action which now opens the YAML.
    Added `apicircle.openMockEndpointYaml` — builds the endpoint URI
    from the tree node's `{serverId, endpointId}` and dispatches
    `vscode.open` — and rewired the inline pencil + the first
    context-menu entry to it. The form editor is now reachable
    _only_ via the second context-menu entry for users who still
    want the GUI form.
  - The mock YAML CodeLens provider was still emitting the
    `⇄ Body type · 🔢 Status · ✚ Response rule · 🛡 Validation rule ·
✱ Multiplier` lenses next to each endpoint summary row inside
    `mocks/<id>.mock.yaml`. Those lenses fired commands that now
    require a `.endpoint.yaml` URI — invoking them from the mock
    YAML triggered the "only runs against endpoint YAML" warning
    toast. Removed the per-endpoint lens row entirely; the mock YAML
    is now a pure lifecycle surface again (`▶ Start Mock` /
    `■ Stop Mock` / `↻ Restart`). Per-endpoint editing lives on
    the `.endpoint.yaml` opened via the pencil or the row click.
  - Updated the mock YAML header comment + the
    `parseMockFromYaml` warning to point users at the per-endpoint
    YAML instead of the old "edit in the desktop app" copy.

  Two new manifest-regression pins: one asserts the inline pencil's
  command is `openMockEndpointYaml`; one extends the post-launch
  command roster so future drops can't lose the command id silently.
  Test count 945 → 960 (+15 cumulative across this round — the
  failing-mockCodeLens-test for the removed per-endpoint emission was
  inverted into a "stays absent" guard).

- **Mock endpoints now edit through a per-endpoint YAML file — same UX
  as request YAML, driven by CodeLens.** Round 4 fixes two user-reported
  issues in one sweep:
  - _Bug:_ the prior round shipped quick-pick / input-box driven
    `addMockResponseRule` / `addMockValidationRule` / `addMockMultiplier`
    commands that DID land via `mock.upsert` (verified the write
    against `workspace.json`), but the mock YAML projection only
    surfaces top-level mock metadata — `name` / `defaultPort` /
    `cors` / endpoint summaries — so any rule / multiplier the user
    added was committed but invisible. That read as "nothing happens
    after clicking through the wizard".
  - _Asked-for UX:_ the user wanted each endpoint to open as its own
    file with CodeLens-driven editing, parallel to request YAML.

  Implemented:
  - New URI scheme: `apicircle://<ws>/mocks/<mockId>/<endpointId>.endpoint.yaml`.
    The FS provider (`ApicircleFsProvider`) now recognises the
    3-segment endpoint path, reads through a new
    `serializeEndpointToYaml`, and on write parses via
    `parseEndpointFromYaml` and applies `mock.upsert` with the
    endpoint slot replaced. `endpointUri(wsId, mockId, endpointId)`
    builder added next to the other URI builders.
  - New [`endpointYaml.ts`](apps/vscode/src/fs/endpointYaml.ts)
    projection rounds-trips the full `MockEndpoint` shape: id (read-
    only), name, method, pathPattern, description, example,
    requestSchema (path / query / header / cookie param defs),
    requestValidation (all 9 kinds with failResponse), responseRules
    (when + response), defaultResponse (status / headers / body /
    delayMs / multipliers). 7 fixture-based round-trip tests pin
    the shape; one asserts unknown validation kinds warn + drop
    cleanly.
  - New [`endpointCodeLens.ts`](apps/vscode/src/lang/endpointCodeLens.ts)
    provider, registered against `**/mocks/**/*.endpoint.yaml`.
    Emits:
    - Above `defaultResponse:` — `⇄ Body type` · `🔢 Status` ·
      `✱ Add multiplier`.
    - Above `responseRules:` — `✚ Add response rule`. Per existing
      rule: `⇄ Body type` · `🔢 Status` · `✕ Remove rule`.
    - Above `requestValidation:` — `🛡 Add validation rule`. Per
      existing rule: `✕ Remove rule`.
    - Per multiplier inside `defaultResponse.multipliers:` —
      `✕ Remove multiplier`.
      Each command receives `(uri, ruleId?)` so the user goes straight
      to the row they clicked, no disambiguation step.
  - Rewrote the five mock-endpoint commands to drive the YAML via
    `WorkspaceEdit` + `document.save()`. The save kicks the FS
    provider, which parses + applies `mock.upsert`. Result: the
    change lands in `workspace.json` AND shows up in the editor
    immediately, because the YAML the user is looking at IS the
    projection of the just-mutated MockEndpoint.
  - Added three new "remove" commands —
    `apicircle.removeMockResponseRule`, `removeMockValidationRule`,
    `removeMockMultiplier` — wired to per-row trash lenses on the
    endpoint YAML.
  - Inline-empty handling: `responseRules: []` / `requestValidation: []`
    / `multipliers: []` (the projection's empty-array shape) gets
    converted to block-form on first insert so adding the first
    rule produces well-formed YAML, not `responseRules: []` followed
    by `- id: …` on the next line.
  - Validates the edited YAML BEFORE saving — if the user (or our
    edit) leaves the document in a state the parser can't read,
    the save is skipped and a clear error toast points at the
    parse error.
  - MockView per-endpoint click → opens the new endpoint YAML
    instead of the webview form. The webview form stays reachable
    via the right-click context menu's `Edit Mock Endpoint (Form)`
    entry for users who prefer GUI editing.
  - New language contribution: `apicircle-endpoint` with the
    `.endoint.yaml` extension, so VS Code highlights and folds the
    file as YAML.
  - 14 new tests: 7 round-trip + warning assertions in
    `endpointYaml.test.ts`, 6 CodeLens emission assertions in
    `endpointCodeLens.test.ts`, plus 3 new
    manifest-regression / activation-integration pin updates for
    the 3 new remove commands.

  Bundle: 2.30 MB → 2.34 MB (+40 KB for the projection + CodeLens
  provider + remove commands). Well under the 3.0 MB soft warn.

- **Five more authoring affordances around the request + mock YAMLs.**
  Round 3 of the user's feedback sweep — every one of these reduces a
  step the user used to do by hand:
  - **Snapshots view-title:** `apicircle.captureSnapshot` got a
    `$(device-camera)` icon and `apicircle.setSnapshotMaxBytes` got
    `$(settings-gear)`. Both now show as inline title-bar buttons next
    to refresh; previously Capture had no icon at all and Set Storage
    Cap was buried under the context menu. Pinned by a new
    `manifestRegression` assertion.

  - **Headers CodeLens:** `✚ Pick header…` rides above the `headers:`
    section. Two-step picker — choose a header from a curated catalogue
    of 16 common HTTP request headers (Accept, Authorization,
    Cache-Control, Content-Type, Cookie, If-Match, Origin, Prefer,
    Referer, User-Agent, X-API-Key, X-Request-ID, …), then pick a
    curated value (`application/json`, `Bearer {{auth_token}}`,
    `no-cache`, …) or type your own. The new row appends to `headers:`
    or seeds the section if absent. New command:
    `apicircle.pickHeader`.

  - **contextVars JSON mapper:** `🗺 Map from JSON…` rides above
    `contextVars:`. The user pastes a JSON object; the helper flattens
    nested keys to dotted paths (`user.id`, `orders.0.total`) with
    stringified primitive leaves, then replaces the existing
    `contextVars:` block (after a confirmation modal when there's
    existing content to lose). New command:
    `apicircle.mapContextVarsFromJson`.

  - **OAuth2 Get Token:** when `auth.type` is one of the 6 OAuth2
    grants, `🔑 Get token` rides above `auth:`. Client Credentials
    and Resource-Owner Password grants run inline — the command
    builds the right `grant_type` body, calls the shared
    [`fetchOAuth2Token`](packages/core/src/auth/oauth2/fetchToken.ts) from `@apicircle/core`, and writes
    `accessToken` / `refreshToken` / `expiresAt` / `obtainedScope`
    back into the YAML via `WorkspaceEdit`. Browser-redirect grants
    (auth-code / PKCE / implicit) need a 127.0.0.1 callback HTTP
    server — that's the desktop app's existing flow today; the VS Code
    command surfaces a clear modal pointing the user at the desktop
    until callback-server support lands on this surface too (tracked
    follow-up). Device-code polling is similarly deferred. New command:
    `apicircle.fetchOAuth2Token`.

  - **Mock endpoint editing — five new CodeLens-driven actions per
    endpoint row in `.mock.yaml`:** `⇄ Body type`, `🔢 Status`,
    `✚ Response rule`, `🛡 Validation rule`, `✱ Multiplier`. Each
    lens fires from above the matching endpoint entry in the YAML's
    `endpoints:` list. The commands route through `mock.upsert`
    against the shared MockEndpoint shape — they don't touch the
    YAML projection directly — so every mutation flows through
    `applyMutation` the same way the desktop / web app surfaces do.
    Coverage:
    - **Validation rule** — 9 kinds (header-required / header-equals /
      header-matches / query-required / query-equals / query-matches /
      cookie-required / body-required / content-type-equals).
      Multi-step picker collects target / expected / failure
      message, scaffolds a 400 JSON failResponse.
    - **Multiplier** — 4 source kinds (query / pathParam / header /
      body-JSON-path), targetJsonPath, defaultCount, optional
      min/max, optional name. Confirms before adding when the
      default response is not JSON (multipliers only fire for JSON
      bodies).
    - **Switch response body type** — quick-pick over the 7
      MockResponseBodyType variants. Re-seeds the body via
      `makeDefaultMockResponseBody` so the new shape is well-formed.
    - **Set response status** — validated 100-599 input box.
    - **Add response rule** — name, condition scope + target + op +
      value, response status, body type. Always scaffolds an enabled
      single-clause rule with Content-Type: application/json.
      All five commands also surface on the MockView's per-endpoint
      context menu (so the user can act on an endpoint without
      opening the YAML) and in the command palette. The webview form
      editor stays as the third surface for users who prefer GUI editing.

  Test count rose 925 → 945 (+20). New: 6 contextVars-flatten cases,
  3 header-row + catalogue assertions, 3 OAuth2 auth-block parser
  cases, 4 request-CodeLens emission assertions (headers /
  contextVars / OAuth2 grant gating), 1 mock-CodeLens emission
  assertion covering all 5 per-endpoint lenses + index-bound
  arguments, plus 3 manifest-regression / activation-integration
  pin additions for the 8 new commands. Bundle 2.27 MB → 2.30 MB
  (+30 KB), still well under the 3.0 MB soft warn.

- **Form-data + binary bodies get a Global-Assets-style file picker, and
  the GraphQL scaffold ships with a real sample variable.** Three
  follow-up asks from the same user round:
  - **Form-data:** when `body.type` is form-data, three new lenses ride
    above `body:` — `✚ Add text row`, `✚ Add file row`,
    `⇄ Switch row kind…`. Each `- kind: text|file` row inside
    `formRows:` also gets its own pair of inline lenses: `↻ Switch to
file/text` and (file rows only) `📎 Pick file…`. Picking a file
    opens the same quick-pick the desktop / web apps surface — list
    existing `synced.globalAssets.files` entries, or
    **📤 Upload a new file…** which: 1. opens the native file dialog (`vscode.window.showOpenDialog`), 2. reads the bytes, computes `sha256` + extension-based MIME +
    size, 3. copies the file into `<workspaceRoot>/.apicircle/attachments/
<slotId>` (the same path the desktop / Git push flow writes
    through), 4. applies a `globalAsset.upsertFile` patch so every surface sees
    the new asset on the next read, 5. writes the asset id / slotId / filename / size / mimeType /
    sha256 into the form-data row's YAML block.

  - **Binary:** when `body.type` is binary, a `📎 Pick attachment
file…` lens rides above `body:`. Same picker, same upload flow —
    the result lands in `body.attachment`. The command now rewrites
    the _whole_ `body:` section (not just the attachment sub-block)
    when an attachment lands, so the leftover `content: ""` placeholder
    from the binary scaffold and the outdated "set via desktop/web
    Asset picker" comment both disappear — the YAML output reads as
    just `type: binary` + `attachment: { … }`, which is what the
    runner actually consumes (it reads bytes from
    `attachment.slotId` for binary bodies, not from `content`). The
    binary scaffold itself was also trimmed to drop the noise: just
    `type: binary` now, with the picker lens as the next action. The
    form-data scaffold lost its `content: ""` line for the same
    reason (formRows is canonical for form-data; `content` is
    ignored). `apicircle.pickBinaryAttachment` is also reachable from
    the command palette for the keyboard-driven path.

  - **GraphQL scaffold:** the body-type switcher's `graphql` scaffold
    now pre-fills `variables: '{ "userId": "123" }'` and a query that
    references `$userId`, so the user sees both the query slot AND
    the variables slot wired up to each other on the first paste —
    not an empty `"{}"` they have to interpret.

  Three new files: [`fileAssetPicker.ts`](apps/vscode/src/commands/fileAssetPicker.ts)
  (shared picker + `guessMimeType` MIME map + the
  `globalAsset.upsertFile` write), [`binaryAttachment.ts`](apps/vscode/src/commands/binaryAttachment.ts)
  (binary body writer + `findExistingAttachmentRange` /
  `renderAttachmentBlock` helpers), and [`formDataRow.ts`](apps/vscode/src/commands/formDataRow.ts)
  (add / switch-kind / pick-file commands + a `parseFormRows`
  scanner that walks the YAML row-by-row so per-row lenses go to the
  right line). Four new commands declared + activated:
  `apicircle.pickBinaryAttachment`, `apicircle.addFormDataRow`,
  `apicircle.switchFormDataRowKind`, `apicircle.pickFormDataRowFile`.

  Test count rose 886 → 923 (+37). New: 5 binary-attachment helper
  tests, 8 form-data row tests, 20 MIME-map cases, 4 new
  CodeLens-emission assertions (binary lens present / absent on JSON,
  form-data control lenses, per-row index-bound lenses). The
  `manifestRegression` + integration command-list regression both pin
  the four new ids. Bundle 2.25 MB → 2.27 MB (+20 KB), well under
  the 3.0 MB soft warn.

- **Per-section CodeLens above `body:` and `auth:` for type switching.**
  Follow-up ask from the same user — the type-discriminator unions are
  wide (8 body types, 17 auth schemes) and most users don't remember
  which YAML keys each variant needs. Two new lenses ride above the
  section headers: **`⇄ Switch body type (current: json)…`** above
  `body:` and **`⇄ Switch auth type (current: bearer)…`** above `auth:`.
  Each opens a quick-pick listing every variant — the current type is
  badged with `✓ current` so the user sees what they're switching from.
  Selecting a different type rewrites the section block via
  `WorkspaceEdit` with a starter scaffold containing all required fields
  for that variant (e.g. OAuth2 Client Credentials gets `tokenUrl` +
  `clientId` + `clientSecret` + `scope` + `clientAuthMethod` + the
  five `OAuth2TokenState` fields). New commands:
  `apicircle.switchRequestBodyType` and `apicircle.switchRequestAuthType`,
  both registered in the command palette so the same flow works without
  the CodeLens. Catalogue + scaffolds live in
  `src/commands/switchRequestSection.ts` with a `__testHooks` export so
  the unit suite pins every BodyType / RequestAuth discriminator stays
  in sync with `packages/shared/src/types.ts`. New tests: 7 cases for
  the body / auth scaffold catalogue + range-finding helpers, 4 cases
  for the CodeLens rendering (current-type embedding, missing-section
  omission, no-type fallback).

Bundle: 2.21 MB → 2.25 MB (+40 KB for the new commands + body / auth
scaffold catalogues). Well under the 3.0 MB soft warn / 5.0 MB hard
fail; budget unchanged. Test count: 886 pass (+30 — six new uninstall
tests, twelve switch-section tests, four new CodeLens body / auth lens
assertions, two updated env-row description tests, two updated
existing CodeLens tests, one updated activation-integration command
list, one expanded mock-endpoint tooltip assertion, four new
manifest-regression pins). No schema change; no `WorkspacePatch`
change; no impact on the three-surface parity contract (every
operation here is VS Code-only chrome).

### VS Code extension — Editor view UX fixes (first-install report)

First-install feedback flagged three Editor-view paper-cuts that all
trace back to the same source — the title-bar and welcome view stayed
generic regardless of workspace state. Fixed in one pass:

- **`apicircle.newRequest` now declares `"icon": "$(add)"`.** It was the
  only "new X" command without one — every sibling (`newEnvironment` /
  `newPlan` / `newMock`) already had `$(add)`. Without an icon, VS Code
  fell back to rendering the title `New Request` as raw text crammed
  into the Editor view's title bar next to the refresh icon. With the
  icon declared, **$(add) New Request** now renders as a proper inline
  action alongside **$(refresh) Refresh**, matching every sibling view.
  Pinned by a new `manifestRegression` assertion.

- **Editor `viewsWelcome` is now gated by `apicircle.hasActiveWorkspace`.**
  The previous card always said "Create New Workspace" / "Open Folder…"
  — even when a `.apicircle/workspace.json` had been discovered and the
  bridge had adopted it. Users with an empty-but-detected workspace read
  that as "the extension didn't recognise my `.apicircle/` folder." The
  manifest now contributes two welcome entries: a `!hasActiveWorkspace`
  card with the create/open actions, and a `hasActiveWorkspace` card
  with **Open `workspace.json`** + **New Request** actions. `extension.ts`
  sets the context key on every discovery pass.

- **`apicircle.refresh` now re-runs `discoverWorkspaces` first.** The
  previous handler only fired the tree-data change event — so a
  `.apicircle/workspace.json` scaffolded after VS Code activated the
  extension (CLI scaffold, `git pull`, hand-mkdir) never registered with
  the bridge, and the refresh icon felt broken. The new
  `rediscoverAndRegister` helper is the single choke point for
  discovery + bridge registration + the `hasActiveWorkspace` context
  update; it's invoked by activation, refresh, the workspace-file
  watcher's `onAnyChange` callback (so external file creates also pick
  up new workspaces), and `onDidChangeWorkspaceFolders`. Idempotent —
  bridge registration is keyed by id.

No schema change. No three-surface compat impact (welcome view is
VS Code-only chrome). Tests: `manifestRegression` gained the icon +
welcome split assertions; the existing `workspaceDiscovery` +
`workspaceWatcher` suites continue to cover the discovery primitive.

#### First-install activation failure — `proper-lockfile` not bundled

While verifying the UX fixes above against a fresh side-loaded .vsix on
Windows, the extension failed to activate at all:

```
Activating extension 'apicircle.apicircle-vscode' failed: Cannot find
package 'proper-lockfile' imported from .../dist/extension.mjs.
```

Root cause: `proper-lockfile` was declared in
`apps/vscode/package.json` runtime deps but missing from
`tsup.config.ts`'s `noExternal` list. The .vsix is built with
`vsce package --no-dependencies`, which intentionally ships no
`node_modules` — so any package the bundler leaves external throws at
import time. Every command registered as "command 'apicircle.X' not
found", discovery never ran, and the Editor view stayed on the
no-workspace welcome card forever.

- **Added `proper-lockfile` to `tsup.config.ts` noExternal.** Now bundled
  with `proper-lockfile` + `retry` + `signal-exit` (~50 KB).
- **Added a manifestRegression assertion that the noExternal list
  covers every runtime dep in `apps/vscode/package.json`** (except
  `vscode` itself, which the host injects). The drift that bit us
  here can't recur silently — adding a new dep without bundling it
  now turns the test red.
- **Bundle: 2.16 MB → 2.21 MB.** Soft warn bumped 2.30 MB → 2.35 MB in
  `scripts/vscode-bundle-budget.mjs` with rationale; hard fail
  unchanged at 2.50 MB (302 KB headroom). Per the CLAUDE.md bundle
  contract: the budget moves to absorb a legitimate dep we forgot to
  bundle, not to silence a regression.

Discovery diagnostics added in the same pass: `rediscoverAndRegister`
now logs `<n> workspace folder(s)`, `found <n> workspace(s)`, and
`hasActiveWorkspace=<bool>` to the **APICircle Runs** OutputChannel on
every discovery sweep. Self-troubleshooting hook for future
first-install reports — users can read the channel and tell us
whether `vscode.workspace.workspaceFolders` was empty, the path was
wrong, or the bridge dropped the workspace.

#### Bundle ceiling raised to 5 MB — peer-extension parity

Deliberate policy change, not a regression cover-up. The 2.5 MB cap
was an aspirational discipline target inherited from when the
extension was essentially a request runner. With MCP host, Git
workspace model, 17 auth schemes, embedded mock server, vault, and
plan notebooks all bundled, that cap was forcing per-dep
renegotiations on every change.

Peer extensions all sit higher: Thunder Client ~5 MB (closest
competitor), GitLens ~5–8 MB, ESLint ~6 MB, Copilot ~20 MB. The
VS Code Marketplace allows .vsix uploads up to ~150 MB; there's no
platform limit at 2 MB. Our actual UX gate is
`activationPerf.test.ts`, which asserts `activate()` completes in
**<500 ms on a 100-request workspace** and **<1000 ms on a 500-request
workspace**. Bundle size is now an early-warning _proxy_ for cold-start
parse cost, not the gate itself.

- **`scripts/vscode-bundle-budget.mjs`** — `SOFT_BUDGET_BYTES` raised
  from 2.35 MB → **3.0 MB**, `HARD_BUDGET_BYTES` raised from 2.5 MB →
  **5.0 MB**. Min sanity floor (500 KB) unchanged. Rationale block
  expanded.
- **`scripts/check-vscode-bundle.mjs`** — hardcoded "2.0 MB" / "1.8 MB"
  strings replaced with `formatBytes(HARD_BUDGET_BYTES)` /
  `formatBytes(SOFT_BUDGET_BYTES)` so the warning copy can't drift
  from the source of truth again.
- **`apps/vscode/test/integration/bundleSize.test.ts`** — test names
  and inline strings updated to "5.0 MB hard" / "3.0 MB soft" with
  formatBytes-driven error messages.
- **`docs/vscode-extension.md` §14** — added a current-ceiling table
  - the rationale that bundle is a proxy and activationPerf is the
    real gate. Historical phase-by-phase callouts left intact.
- **`CLAUDE.md` §10** — bundle-budget bullet rewritten with the new
  thresholds + the activationPerf cross-reference.
- **`.github/workflows/vscode.yml`** — CI step comment updated to
  match.

The activation perf test continues to assert real behaviour; the
bundle warning now fires at 3 MB so an unexpected gain still surfaces
in PR review.

#### Second first-install activation failure — ESM-of-CJS `Dynamic require`

Bundling `proper-lockfile` (per the previous fix) unblocked the
`Cannot find package` error but exposed a second one:

```
Activating extension 'apicircle.apicircle-vscode' failed:
Dynamic require of "path" is not supported.
```

Root cause: `tsup` outputs ESM (`extension.mjs`, per Phase 12-3), but
the CJS deps we bundle via `noExternal` — `proper-lockfile`, parts of
`@modelcontextprotocol/sdk`, `@hono/node-server`, etc. — internally
call `require('path')` / `require('fs')`. esbuild rewrites those calls
to a stub that throws **at runtime** because ESM modules don't have a
`require` in scope. The first time the stub fires (inside
`proper-lockfile`'s lock-acquire path during workspace discovery),
activation dies.

- **Added a banner to `tsup.config.ts`** that imports `createRequire`
  from `node:module` and binds a real `require` into module scope:
  ```ts
  banner: {
    js: "import { createRequire as __apicircleCreateRequire } from 'node:module'; const require = __apicircleCreateRequire(import.meta.url);";
  }
  ```
  Standard ESM-of-CJS interop shim — adds ~130 bytes to the bundle.
- **Added a `bundleSize.test.ts` assertion that pins the banner.** Reads
  the first 300 bytes of `extension.mjs` and asserts it contains
  `createRequire`, `node:module`, and `import.meta.url`. If someone
  removes the banner in a future tsup config refactor, the test
  flips red instead of waiting for the next user to file a "extension
  won't activate" report.
- Bundle: **2.21 MB → 2.21 MB** (banner is 130 bytes, well below
  rounding).

#### Third first-install activation failure — undeclared MCP provider

Bundling + the ESM banner unblocked the previous two errors but
exposed a third:

```
Activating extension 'apicircle.apicircle-vscode' failed:
MCP configuration providers must be registered in the
contributes.mcpServerDefinitionProviders array within your
package.json, but "apicircle-embedded" was not.
```

Root cause: VS Code 1.94+ tightened the contract — every id passed to
`vscode.lm.registerMcpServerDefinitionProvider("<id>", ...)` must
also appear in `package.json`'s
`contributes.mcpServerDefinitionProviders`. Phase 10 wired the
runtime call for `"apicircle-embedded"` but never added the manifest
entry. The runtime probe in
[`host/proposedMcpProviderRegistration.ts`](apps/vscode/src/host/proposedMcpProviderRegistration.ts)
called the API unconditionally (because the embedded host is opt-in
but the _provider_ registration happens at activation so Copilot Chat
can list the server), the call threw, and the throw escaped
`activate()`.

- **Added the manifest contribution.** `package.json` →
  `contributes.mcpServerDefinitionProviders` now declares
  `{ id: "apicircle-embedded", label: "APICircle (embedded)" }`.
- **Wrapped the lm registration call in try/catch.** Defense-in-depth
  — a future engine bump that tightens validation further (schema
  checks on the definition shape, e.g.) shouldn't take activation
  down. The catch falls through to the same `return null` path the
  "API not present" branch already uses, so behaviour matches the
  no-op case existing tests cover.
- **Added a manifestRegression assertion.** Scans `apps/vscode/src/`
  for every `registerMcpServerDefinitionProvider('<id>', ...)` call
  and asserts each id appears in
  `contributes.mcpServerDefinitionProviders`. Adding another provider
  call in the future without the manifest entry will now turn the
  suite red.

Bundle unchanged at 2.21 MB.

### VS Code extension Phase 12 — Bundle externalize + E2E coverage closeout

Phase 12 addresses the **3 indefinite items** carried over from Phase 11
and **closes the E2E coverage gap** for phases 2 + 8 + 9 + 10 + 11.

#### Build modernization

- **Externalized `@modelcontextprotocol/sdk`, `@hono/node-server`, and `hono`**
  in `tsup.config.ts`. The SDK is now resolved at runtime via the .vsix's
  `node_modules` (vsce packages `dependencies` automatically) instead of
  being inlined into `dist/extension.js`. **Bundle dropped from 2.16 MB
  to 1.69 MB (−470 KB).**
- **Restored the original 2.0 MB hard budget** (was bumped to 2.5 MB in
  Phase 10 to accommodate the bundled SDK). `scripts/vscode-bundle-budget.mjs`
  back to `SOFT=1.8 MB`, `HARD=2.0 MB`. Current bundle: 1.69 MB with
  325 KB headroom.
- **Lazy-load `InProcessMockController` (#9): no-op.** Was originally
  listed as a bundle-size deferred item — but the heavy parts of
  `InProcessMockController` were `@hono/node-server` + `hono`, both
  now externalized by the SDK work. The remaining shell is small;
  lazy-loading the constructor would not move the needle. Resolved
  by P12-1 transitively.
- **Tsup CJS → ESM (#8): SHIPPED.** Initially deferred with rationale
  in P12-9 due to engine-bump cost, but completed when the user asked
  to close all 3 indefinite items. Output is now `dist/extension.mjs`
  (Node treats `.mjs` as ESM regardless of `package.json type`, so the
  test suite stays default-CJS). `engines.vscode` bumped from
  `^1.85.0` to `^1.94.0`. Bundle unchanged (1.69 MB; the lazy-load
  wins came from P12-1 not from ESM). `splitting: false` keeps the
  single-file output that VS Code's extension loader expects.

- **Install + publish guide.** New
  [`docs/vscode-extension-install-publish.md`](docs/vscode-extension-install-publish.md)
  covers: (a) Extension Development Host workflow for live edits,
  (b) packaging as `.vsix` for local install / preview, (c) full
  Marketplace + Open VSX publish plan including the pre-publish
  readiness audit (icon, LICENSE, README), publisher account setup,
  GitHub Actions release workflow, and versioning convention.

### VS Code extension publish-prep — name rename + bundle revert

Two fixes landed during publish-pipeline validation:

- **Workspace package renamed `@apicircle/vscode` → `apicircle-vscode`**.
  `vsce` rejects scoped npm names for the extension manifest's `name`
  field (the marketplace extension id is `publisher.name`, which
  becomes `apicircle.apicircle-vscode`). Touched 13 files: CI workflow,
  bundle-size script, two E2E specs, both READMEs, docs, and the
  package itself. All `pnpm --filter @apicircle/vscode <cmd>`
  invocations are now `pnpm --filter apicircle-vscode <cmd>`.

- **Re-bundled the externalized SDK + Hono deps.** P12-1 had
  externalized `@modelcontextprotocol/sdk`, `@hono/node-server`, and
  `hono` to drop the bundle to 1.69 MB, packaging them into the .vsix's
  `node_modules` at install time. The pnpm `workspace:*` protocol
  confuses `vsce`'s `npm list --production` dep walker, so the runtime
  resolver path turned out to be unreliable in practice. Reverting to
  fully bundled (`noExternal`) restores the simple `vsce package
--no-dependencies` workflow — every runtime dep is in
  `dist/extension.mjs`, no node_modules traversal needed. Bundle
  returns to 2.16 MB; budget bumped back to soft 2.3 MB / hard 2.5 MB.
  Future possibility: `pnpm deploy --prod` could produce a
  vsce-compatible deployment dir for externalization to work — tracked
  as an indefinite optimization but not load-bearing.

- **Verified .vsix packaging** locally: `pnpm exec vsce package
--no-dependencies` produces `apicircle-vscode-0.1.0.vsix` (1.3 MB
  compressed / 2.16 MB extension.mjs) under
  `apps/vscode/`. Ready to side-load via `code --install-extension`.

- **Pre-publish gaps 0.1 + 0.2 closed.**
  - `apps/vscode/media/icon-marketplace.png` — 128×128 RGBA PNG
    (12.81 KB) reused from `apps/desktop/build/icons/128.png` (same
    favicon-derived source the desktop app uses). Wired into
    `apps/vscode/package.json` as `"icon": "media/icon-marketplace.png"`
    - `"galleryBanner": { "color": "#1f1b2e", "theme": "dark" }`.
  - `apps/vscode/LICENSE` — copied from the repo-root `LICENSE` (the
    custom source-available license, v1.0). `vsce` packages it as
    `LICENSE.txt` inside the .vsix.
  - Final .vsix shape: **16 files, 1.29 MB compressed**. Includes
    LICENSE.txt + icon-marketplace.png + extension.mjs + schemas +
    readme. Ready for `vsce publish` once a publisher account + PAT
    exist (only remaining external prerequisite).

#### E2E coverage closeout

**5 new E2E specs** added under `e2e/vscode/src/test/`, one per
previously-uncovered phase:

- `2-environments-plans.test.ts` — Phase 2 commands + view focus +
  empty-workspace short-circuits.
- `8-autoconfigure-vault-device.test.ts` — Phase 8 commands + settings
  shape + forget-vault no-op.
- `9-notebooks-tests.test.ts` — Phase 9 commands + notebook content
  type registered + `vscode.tests` API reachable.
- `10-embedded-mcp.test.ts` — Phase 10 commands + setting defaults
  (loopback / off / port 0) + safe-call when not running.
- `11-continue-mock-editor.test.ts` — Phase 11 commands +
  autoConfigure enum accepts `continue` + safe-call without node arg.

Pattern follows the existing P1/P3/P4/P5/P6 specs: short Mocha tests
inside `@vscode/test-electron` that verify the **host-side wiring**
(commands registered, settings shaped, views focusable, safe-call
behaviors) — deep logic coverage stays in the unit + integration tier
(co-located `.test.ts` files in `apps/vscode/src` and
`apps/vscode/test/integration`).

**E2E spec count: 14 → 19 files**. Every phase from 1 through 11 now
has dedicated E2E coverage.

#### Settings + manifest

No new settings or commands in Phase 12 — all changes are build-config
and test-coverage. Existing manifest regressions continue to pass.

#### Test counts (Phase 12 close)

- **apps/vscode** — 856 tests across 86 files (unchanged from Phase 11
  — Phase 12 changes don't add or remove unit tests).
- **Monorepo** — 3613 tests across 327 files.
- **E2E specs** — 19 files (was 14; +5 new files).

#### Bundle size

**1.69 MB** (−470 KB from Phase 11's 2.16 MB, **325 KB headroom under
the restored 2.0 MB hard budget**). The 3 indefinite items are now
fully resolved:

| #   | Item                                    | Phase 12 outcome                                                |
| --- | --------------------------------------- | --------------------------------------------------------------- |
| 8   | Tsup CJS → ESM                          | Deferred indefinitely — engine bump cost without bundle benefit |
| 9   | Lazy-load `InProcessMockController`     | No-op — heavy parts removed by P12-1                            |
| 10  | Lazy-load embedded host's SDK transport | **Shipped via externalization**                                 |

### VS Code extension Phase 11 — Visual editing + final deferred items

Phase 11 closes the **last 2 actionable deferred items** — leaving the
roadmap of explicitly-scoped deferred work empty.

1. **Continue YAML auto-install (#5b)** — extends Phase 8's
   `mcpClientInstall.ts` with Continue's YAML config (`~/.continue/config.yaml`).
   New `'mcpServers-yaml'` schema variant: parses YAML, merges the
   apicircle entry under `mcpServers`, preserves every foreign key
   (name, version, schema, models, etc.) verbatim. `Continue` is now
   the 6th supported `InstallableClient` and appears in the
   `apicircle.mcp.autoConfigureClients` setting enum.

2. **Mock endpoint visual editor (#7)** — opt-in webview MVP opened
   from the MockView's per-endpoint context menu (**Edit Mock Endpoint
   (Form)**). Form fields: method, path pattern, status, body type
   (none / json / text / xml), body content. Headers, response rules,
   request validation, and multipliers stay YAML-only (preserved on
   save). YAML editing remains the primary path; the webview serves
   the common "I just want to change the status code" 80% case.

#### Files

- **`mcpClientInstall.ts` (extended)** — `'mcpServers-yaml'` variant
  - `readConfigFile`/`writeConfigFile` helpers that switch between
    JSON and YAML by variant. Continue's path overridden to
    `~/.continue/config.yaml` because the shared resolver still points
    at the legacy `config.json`. 7 new unit tests (round-trip,
    foreign-key preservation, malformed-YAML handling).
- **`webview/mockEndpointEditor.ts`** — webview panel with strict
  CSP (nonce-based script, no remote loads, `localResourceRoots: []`).
  `parseMessage` validates every inbound message against the
  expected shape; non-matching messages are dropped. Per-endpoint
  panels (one per endpointId, reused on re-open). 11 unit tests for
  the parser covering security-relevant invalid payloads.
- **`commands/editMockEndpoint.ts`** — `apicircle.editMockEndpoint`
  command opens the editor from the MockView context menu. Accepts
  both the MockView's `{kind:'endpoint', serverId,...}` shape and a
  programmatic `{kind:'mock-endpoint', mockId,...}` shape.
  `applyFormStateToMock` patches the existing MockEndpoint object,
  **preserving** responseRules / headers / delayMs / multipliers /
  requestValidation; JSON body parse-check rejects bad payloads
  before the patch reaches `applyMutation`. 6 unit tests for the
  patch logic.

#### Security model (webview MVP)

- **Strict CSP** — `default-src 'none'`; `script-src 'nonce-...'`
  (per-session); `style-src 'unsafe-inline'` (VS Code theme tokens);
  no `connect-src`, `img-src`, or `font-src`.
- **`localResourceRoots: []`** — nothing on the filesystem is
  reachable from the webview's sandbox.
- **Inbound message validation** — `parseMessage` strict-checks every
  field (method allowlist, status range 100–599, integer status,
  bodyType allowlist, non-empty endpointId). Anything off-shape is
  dropped silently.
- **Host-side JSON validation** — `applyFormStateToMock` re-validates
  the JSON body before persisting, so a bypass of the webview's
  inline highlight can't poison the mock.

#### Settings changed

- `apicircle.mcp.autoConfigureClients` enum gains `continue`.

**Manifest regression tests** added: `apicircle.editMockEndpoint`
command + activation event + `view/item/context` entry on
`mock-endpoint` items; `continue` in the autoConfigureClients enum.

#### Test counts (Phase 11 close)

- **apps/vscode** — 856 tests across 86 files (up from Phase 10's
  831 / 84; +25 / +2: `mockEndpointEditor.test.ts` (11) +
  `editMockEndpoint.test.ts` (6) + 7 Continue YAML tests in
  `mcpClientInstall.test.ts` + manifest + activation regression
  updates).
- **Monorepo** — 3613 tests across 327 files.

#### Bundle size

**2.16 MB** (+14 KB over Phase 10's 2.15 MB, still ~354 KB headroom
under the 2.5 MB hard budget).

### VS Code extension Phase 10 — Embedded MCP host over Streamable HTTP

Phase 10 closes 2 of the remaining 4 deferred items by running the MCP
server **inside the extension** rather than as an external subprocess:

1. **In-extension `McpHost` over Streamable HTTP** — VS Code is now both
   the host AND a client of its own MCP catalog. Off by default; opt-in
   via `apicircle.mcp.embeddedHost.enabled`.

2. **`vscode.lm.registerMcpServerDefinitionProvider` proposed-API
   integration** — best-effort registration with VS Code's native MCP
   client surface (Copilot Chat) when the API is available. Silent
   no-op on older engines — Copilot Chat still picks up the
   `.vscode/mcp.json` install from P6 in that case.

#### Security model

The embedded host bakes in defence-in-depth for every threat vector a
local HTTP server has to handle:

- **Loopback-only bind** — `apicircle.mcp.embeddedHost.bindHost` defaults
  to `127.0.0.1` and is validated against the loopback set
  (`127.0.0.1` / `localhost` / `::1` / any `127.x.y.z`).
  `UnsafeBindHostError` rejects `0.0.0.0`, private RFC1918, link-local,
  and public addresses at startup with a modal toast.
- **Bearer-token auth** — every request must present a 32-byte (256-bit)
  random token via `Authorization: Bearer <token>` or `?token=<token>`.
  Constant-time comparison guards against timing attacks. Missing or
  mismatched → 401.
- **DNS-rebinding guard** — Host header validated against the loopback
  set. A page in the user's browser cannot forge `Host: evil.com` and
  have us serve it. Non-loopback Host → 403.
- **Token rotation on restart** — every `apicircle.restartEmbeddedMcp`
  generates a fresh token. Users reconnect their AI client after a
  restart.
- **`apicircle.mcp.allowDecrypt` still applies** — secret-value decryption
  remains gated by the P5 setting (off by default).

#### Files

- **`embeddedMcpHost.ts`** — host module wrapping `createMcpServer`
  with `StreamableHTTPServerTransport`. Lifecycle (start / stop /
  restart / status). `BridgeWorkspaceProvider` adapter reads from the
  VS Code bridge instead of disk so MCP tool calls see the user's
  in-memory edits without snapshot lag. 22 unit tests covering bind
  validation, lifecycle, and all three security guards via live HTTP.
- **`embeddedMcpActions.ts`** — 4 commands: `apicircle.startEmbeddedMcp`,
  `apicircle.stopEmbeddedMcp`, `apicircle.restartEmbeddedMcp`,
  `apicircle.copyEmbeddedMcpUrl`. Modal error toasts on
  `UnsafeBindHostError`. Auto-start at activation when
  `apicircle.mcp.embeddedHost.enabled` is on.
- **`proposedMcpProviderRegistration.ts`** — runtime probe for
  `vscode.lm.registerMcpServerDefinitionProvider`. Structural-typed
  shape so future API renames don't crash. 5 unit tests covering
  the probe + the definition shape (URL + Bearer header).
- **`@apicircle/mcp-server` index** re-exports
  `StreamableHTTPServerTransport`, `StdioServerTransport`, and the
  `Transport` type so the extension consumes them through our wrapper
  package rather than taking a direct SDK dep.

#### Settings added

- `apicircle.mcp.embeddedHost.enabled` — boolean, default `false`.
- `apicircle.mcp.embeddedHost.port` — number, default `0` (auto-pick).
- `apicircle.mcp.embeddedHost.bindHost` — string, default `127.0.0.1`,
  loopback-validated.

#### Bundle budget bump (intentional, with rationale)

The embedded host pulls in the MCP SDK's Streamable HTTP transport plus
its `@hono/node-server` runtime — ~640 KB added to the bundle. The host
is opt-in (default off) but the code is statically reachable so esbuild
bundles it regardless. Phase 10 bumps the budget thresholds in
`scripts/vscode-bundle-budget.mjs`:

- soft warn: 1.8 MB → **2.3 MB**
- hard fail: 2.0 MB → **2.5 MB**

Phase 11+ deferred trim: lazy-load the SDK transport via dynamic import

- externalize `@modelcontextprotocol/sdk` from `tsup`'s `noExternal`
  list.

Bundle at Phase 10 close: **2.15 MB** (~350 KB headroom under the new
2.5 MB hard budget).

#### Test counts (Phase 10 close)

- **apps/vscode** — 831 tests across 84 files (up from Phase 9's
  803 / 82; +28 / +2: `embeddedMcpHost.test.ts` +
  `proposedMcpProviderRegistration.test.ts`, plus manifest +
  activation regression updates).
- **Monorepo** — 3588 tests across 325 files.

### VS Code extension Phase 9 — Native VS Code UX (Plan Notebooks + Test Controller)

Phase 9 ships **two of the remaining six deferred items** by integrating
with VS Code's first-class Notebook and Tests APIs:

1. **Plan Notebooks** (`vscode.NotebookSerializer` +
   `vscode.NotebookController`) — open any execution plan as a native
   VS Code notebook (`.apicircle-plan.json` files). Each plan step
   becomes a cell; the cell's source carries a
   `# apicircle-plan-step: <requestId>` directive that the serializer
   uses for round-trip persistence. Per-cell ▶ Run hooks into the
   existing `executeRequest` engine and emits structured output
   (HTTP status + duration + per-assertion ✓/✗ + JSON body) via
   `NotebookCellOutputItem`. Cancellation forwarded to the
   AbortSignal.

2. **Assertion Test Controller** (`vscode.tests.createTestController`)
   — every request-with-assertions auto-surfaces in the Testing tab.
   Hierarchy: workspace → folder → request → assertion. Run handler
   sends the request, evaluates each assertion, emits per-assertion
   pass/fail with the `runAssertions` diff text as the failure
   message. Refresh on workspace activation (debounced 100ms).

- **`planNotebookSerializer.ts`** — bytes ↔ `NotebookData`, schema
  v1, lossless round-trip for steps + envPriorityOrder + variables +
  stopOnAssertionFailure. Tolerant of malformed JSON (renders an
  error cell instead of throwing). User-edited directive lines
  override stale cell metadata on save. 18 unit tests.
- **`planNotebookController.ts`** — single-controller-per-content-type
  pattern. Reads workspace state once per Run All pass. Outputs
  include parsed JSON via `NotebookCellOutputItem.json` when the body
  is JSON, plain text otherwise. Disabled steps emit a "skipped"
  output rather than running.
- **`openPlanAsNotebookCommand`** — `apicircle.openPlanAsNotebook`.
  Picks a plan (or accepts a `planId` arg from the ExecutionView
  context menu), writes a stable `<plan-slug>.apicircle-plan.json`
  next to the workspace's `.apicircle/`, then opens it via
  `vscode.openWith`. Existing files are opened in place (not
  overwritten) so renames stick.
- **`assertionTestController.ts`** — flat folder + request hierarchy.
  Resilient to per-workspace read failures (one failing workspace
  doesn't drop the others; the failure is logged). Owning surface
  resolution walks up the TestItem.parent chain via the
  `workspace:<id>` root prefix; falls back to the only-surface case
  when ambiguous. 5 unit tests.
- **VS Code mock extended** — Notebook + Tests API stand-ins added
  to `apps/vscode/test/mocks/vscode.ts`. `createTestItem` now
  produces children with real add/replace/forEach/size semantics
  - back-edges (`item.parent`), unblocking the controller's
    ancestor walk.

**Settings added:** none — both surfaces are opt-in via existing
commands.

**Manifest regression tests** added: `apicircle.openPlanAsNotebook`
command + `onCommand:` + `onNotebook:apicircle-plan` activation +
`contributes.notebooks` entry for `apicircle-plan` content type.

**Test counts (Phase 9 close):** monorepo grows by 24 tests to
**3560 tests across 323 files** (apps/vscode: 803 / 82; +24 / +2).
Bundle size: **1.51 MB** (+22 KB over Phase 8, still 518 KB headroom
under the 2.0 MB ceiling).

### VS Code extension Phase 8 — Convenience + Security UX

Phase 8 ships **two of the nine items deferred from Phases 3-7**:

1. **`apicircle.mcp.autoConfigureClients`** — bulk-install the apicircle
   MCP entry into the **user-level** config files of 5 external AI clients
   (Claude Desktop, Claude Code, Cursor, Windsurf, Zed). Extends P6's
   workspace-local `.vscode/mcp.json` model to the OS conventions each
   client uses (`~/.cursor/mcp.json`, `~/.codeium/windsurf/mcp_config.json`,
   `~/.config/zed/settings.json`, etc.). Idempotent merge, foreign-entry
   preservation, schema-variant aware (Zed's `context_servers` envelope
   vs the standard `mcpServers`), symlink-traversal guard.

2. **`apicircle.secrets.rememberOnDevice`** — opt-in persistence of the
   vault passphrase via VS Code SecretStorage (OS keychain on
   macOS/Windows/Linux). When enabled, after a successful unlock the
   passphrase is stored; the next session silent-unlocks. Companion
   command `apicircle.forgetVaultOnDevice` wipes the stored entry.
   Disabled by default; security tradeoff documented in the setting's
   markdownDescription.

- **`mcpClientInstall.ts`** host module — per-client schema awareness for
  the standard MCP envelope (4 clients) and Zed's `context_servers`
  variant (1 client). 28 unit tests. Bulk-install reports per-client
  outcome (created/updated/unchanged/error) with summary counts.
- **`mcpClientActions.ts`** command layer — 3 commands:
  - `apicircle.installMcpForClient(client?)` — single-client install
    (multi-pick if no client passed).
  - `apicircle.installMcpForAllClients` — runs across the configured
    `autoConfigureClients` setting; falls back to a multi-pick when
    the setting is empty.
  - `apicircle.uninstallMcpForClient(client)` — schema-aware key
    removal that preserves foreign entries.
- **McpView extended** — each of the 5 InstallableClients now renders
  with three-state install detection (absent / installed-current /
  installed-stale), inline install button (✗→install, ⚠→update,
  ✓→copy). View-title toolbar gains "Install MCP for All Configured
  Clients" alongside the existing Connect Guide row.
- **`vaultDeviceMemory.ts`** host module — thin wrapper over
  `context.secrets` with workspace-id namespacing. 8 unit tests.
- **`vaultActions.ts` extended** — `unlockVaultCommand` now persists
  the passphrase when the setting opts in. `silentUnlockFromDevice`
  fires on extension activation per workspace. `forgetVaultOnDeviceCommand`
  surfaces both per-workspace and "forget all" paths.

**Settings added:**

- `apicircle.mcp.autoConfigureClients` — typed string array (enum of
  5 client IDs).
- `apicircle.secrets.rememberOnDevice` — boolean, default false.

**Manifest regression tests** added for all four new contributions
(3 MCP commands, 1 vault command, both new settings).

**Test counts (Phase 8 close):** monorepo grows by 41 tests to
**3536 tests across 321 files** (apps/vscode: 779 / 80; +41 / +2).
Bundle size: 1.49 MB (+30 KB over Phase 7, still 530 KB headroom
under the 2.0 MB ceiling).

### VS Code extension Phase 7 — Bundle code-splitting + size budget

Phase 7 closes Phase 6's load-bearing follow-up: the VS Code extension
bundle was sitting at **1.91 MB**, only ~91 KB under the 2.0 MB hard
ceiling. Phase 7 drops it to **1.46 MB** (a **−454 KB / 23.7%
reduction**) by enabling esbuild tree-shaking across the
`@apicircle/*` workspace packages, and locks the savings in with a
two-tier budget gate that runs both in CI and as a unit-test
regression.

- **`"sideEffects": false`** added to four workspace packages —
  `@apicircle/shared`, `@apicircle/core`, `@apicircle/mcp-server`,
  `@apicircle/mock-server-core`. Each is a pure module (types,
  parsers, `applyMutation`, request execution, the Hono mock engine,
  the MCP catalog) so the marker is safe — verified by re-running the
  full test suite across every package. With tsup's `noExternal`
  inlining these packages into the extension bundle, esbuild's
  tree-shaker can now drop unused exports (request execution paths
  unused by the extension shell, OAuth2 grant runners outside the
  vault-unlock path, parsers not bound by the FS provider) that
  previously shipped dead-weight.
- **`scripts/check-vscode-bundle.mjs`** — three-tier budget gate.
  - Min **500 KB** sanity floor (`::error::`; exit 1) — catches the
    corrupt-empty / partial-write build that would otherwise pass
    both budget tiers silently.
  - Soft warn at **1.8 MB** (`::warning::`; exit 0).
  - Hard fail at **2.0 MB** (`::error::`; exit 1).
  - Replaces the inline bash gate previously living in
    `.github/workflows/vscode.yml`. Bump the ceiling deliberately
    per phase — never to silence a regression.
- **`scripts/vscode-bundle-budget.mjs`** — single source of truth for
  the three thresholds. Imported by both the CI script and the
  regression test below, so the two can't drift. An internal
  invariant assert (`MIN < SOFT < HARD`) fails fast if a future
  edit breaks the ordering.
- **`apps/vscode/test/integration/bundleSize.test.ts`** — local
  regression test (3 assertions + 1 self-skip) that fails the suite
  when `dist/extension.js` crosses the hard budget OR falls below
  the sanity floor, and emits a `console.warn` when it crosses the
  soft budget. Skips itself with a clear hint when the bundle hasn't
  been built yet.
- **CI workflow updated** — `.github/workflows/vscode.yml`'s
  bundle-size step now calls the script.
- **CLAUDE.md §10 working agreement** — added the bundle budget
  contract so Phase 8+ agents know to honor it.

**Test counts (Phase 7 close, post-audit):** monorepo grows by 3
tests to **3495 tests across 319 files** (apps/vscode: 739 / 78).
The new `bundleSize.test.ts` reports 3 active assertions + 1
self-skip branch (the "build first" hint that fires only on fresh
checkouts).

### VS Code extension Phase 6 — Copilot Chat MCP Install

Phase 6 ships **one-click install of the APICircle MCP entry into the
workspace's `.vscode/mcp.json`** — VS Code 1.86+ Copilot Chat reads this
file automatically, so a single click in the MCP view connects the
workspace to Copilot Chat without leaving the editor. The same surface
serves any MCP client that follows the VS Code workspace-config
convention (newer Cursor builds, Cline, etc.).

- **`copilotMcpInstall.ts`** — idempotent `.vscode/mcp.json` writer.
  - `installCopilotMcpConfig({workspaceFolder, binary, apicircleDir, ...})`
    returns `'created' | 'updated' | 'unchanged'` based on the prior
    on-disk state. Reuses the shared `buildSnippetVariants` from
    `@apicircle/mcp-server` so the bytes written match every other
    apicircle MCP surface.
  - `detectCopilotMcpConfigState(...)` returns
    `'absent' | 'installed-current' | 'installed-stale'` for the
    McpView's row-rendering probe.
  - Defensive: malformed JSON on disk → treated as "create fresh"
    rather than throwing. Foreign `mcpServers.*` entries (other AI
    server entries, Shopify, etc.) are preserved verbatim — we only
    touch the `apicircle` key. Top-level keys outside `mcpServers`
    (like `$schema`) are also preserved.
  - Always writes forward-slash paths even on Windows: `.vscode/mcp.json`
    is Git-committed, so backslash-escaped paths would leak Windows
    layout into a teammate's macOS clone.
  - **16 unit tests** cover every branch incl. the eight outcome
    states and the cross-platform path normalization.
- **`apicircle.installCopilotMcpConfig` command** — wraps the host with
  VS Code-host-specific resolution:
  - Picks the workspace folder that owns the active workspace's
    `apicircleDir` (multi-root aware — install targets the right
    folder's `.vscode/mcp.json`).
  - Reads `apicircle.mcp.workspaceConfigPath` setting for the relative
    path (default `.vscode/mcp.json`).
  - Reports outcome via three distinct toasts: "Installed", "Updated",
    or "already up to date". The success toast nudges users to
    restart Copilot Chat / their AI client.
  - **6 unit tests + 4 integration tests** cover: no-active-workspace
    early-exit, single-folder install, idempotent second run,
    custom-path override, multi-root folder picking, no-owning-folder
    error path, end-to-end fs round-trip + probe re-check, stale
    detection, foreign-entry preservation.
- **McpView GitHub Copilot row specialization** — the existing
  Copilot row now reflects install state:
  - **🚀 absent** → "click to install" description, click runs the
    install command, contextValue `mcp-client-copilot-absent`.
  - **✓ installed-current** → "✓ installed" description, check icon,
    click falls back to copy-snippet (for other surfaces), context
    `mcp-client-copilot-installed`.
  - **⚠ installed-stale** → "out of date" description, refresh icon,
    click runs install (which updates), context `mcp-client-copilot-stale`.
    Probe is injectable so unit tests can pin state without filesystem
    setup. Production wiring in `extension.ts` reads `workspaceFolders`
  * `apicircle.mcp.workspaceConfigPath` + the mcpManager's resolved
    paths and probes on each render. **4 new tests** in `McpView.test.ts`.
- **New setting `apicircle.mcp.workspaceConfigPath`** (default
  `.vscode/mcp.json`). Overrideable for users with non-standard
  project layouts.
- **package.json wiring** — 1 new command in `contributes.commands`,
  1 new `onCommand:` activation event, 2 new view/item/context menu
  entries (inline + 1_actions for the three copilot contextValues),
  1 new setting.
- **manifestRegression coverage** — 5 new P6 assertions: command
  declared, activation event present, setting declared with non-empty
  default, no "Phase 6 — not yet implemented" labels, no viewsWelcome
  "ships in Phase 6" labels. The cumulative regression test suite is
  now 16 assertions guarding drift for shipped phases 4, 5, and 6.
- **E2E spec** — `e2e/vscode/src/test/6-copilot.test.ts`: 2 specs that
  resolve the command id and verify executing on a non-apicircle
  workspace doesn't throw.
- **Tests** — **37 new + ~3 existing updated** across the suite (including
  R1 audit closures):
  - `host/copilotMcpInstall.test.ts` (16) — pure host logic
  - `commands/copilotMcpActions.test.ts` (8) — command branches incl.
    R1's `onInstalled` refresh-hook coverage
  - `views/McpView.test.ts` (+4) — Copilot row states
  - `test/integration/copilotInstallRoundTrip.test.ts` (4) — fs round-trip
  - `manifestRegression.test.ts` (+5) — Phase 6 drift guards
  - Updated `activation.test.ts` (+1 command id)
  - Updated `stubViews.test.ts` (comment about P6 optional probe)
- **Bundle size** — 1.91 MB (up from Phase 5's 1.90 MB; the
  copilotMcpInstall + actions add ~10 KB). Still under the 2 MB CI
  gate. Phase 7+ bundle code-splitting work is now load-bearing —
  next feature pushes past.
- **Test counts**: vscode **736 / 77 files** (up from Phase 5's
  685 / 74 = +51 tests / +3 files). Monorepo **3492 / 318 files**.
- **Phase 6 audit rounds (4 gaps closed across 3 rounds):**
  - **R1-G1 (knip dead exports)** — `InstallOutcome` + `McpServerEntry`
    types in `copilotMcpInstall.ts` were exported but only used
    internally. Unexported both — `InstallResult.outcome` inlines to
    the union type for consumers.
  - **R1-G4 (multi-root logic duplication)** — `pickOwningFolder`
    was inline in extension.ts AND wrapped inside `copilotMcpActions.ts`.
    Extracted as an exported helper from `copilotMcpActions.ts`; both
    sites now consume it. Three-surface logic (longest-prefix match
    on lowercased forward-slash paths) lives in one place.
  - **R1-G6 (test count drift)** — CHANGELOG claimed "31 new tests";
    actual was 35 (then 37 after R1's own onInstalled tests). The
    counts here are now the post-R1 numbers.
  - **R1-G8 (no view refresh after install)** — After
    `installCopilotMcpConfig` wrote `.vscode/mcp.json`, the McpView's
    Copilot row stayed "absent" until something unrelated triggered
    a refresh. Added an optional `onInstalled` callback to the
    command's deps; production wiring fires `views?.mcp.refresh()`.
    Importantly, the callback ONLY fires when outcome is `created`
    or `updated` — a no-op second invocation (`unchanged`) doesn't
    trigger a wasted refresh. **2 new tests** cover both branches.
  - **R2 (test-count drift cascade)** — R1's onInstalled tests
    bumped vscode 720 → 722, monorepo 3476 → 3478. Updated CHANGELOG,
    `docs/qa/README.md`, `docs/vscode-extension.md` to current counts.
  - **R3 — zero gaps.** Verification pass under earlier audit
    dimensions: bundle 1.91 MB, all tests green, lint + typecheck +
    knip clean.
  - **R4 (staff-engineer skill applied — 4 deeper gaps closed):**
    - **R4-G1 (settings reactivity)** — McpView's probe reads
      `apicircle.mcp.workspaceConfigPath` on each render, but the
      view only auto-refreshed on workspace changes. Setting changes
      mid-session left the Copilot row stale. Added a config-change
      subscription on `apicircle.mcp` that fires `views?.mcp.refresh()`.
    - **R4-G2 (SECURITY — path traversal)** — `apicircle.mcp.workspaceConfigPath`
      accepted any string, including `../../../tmp/evil.json` or
      `/etc/passwd`. A `.vscode/settings.json` committed to Git could
      weaponize an unsuspecting user's click into a write outside the
      workspace folder. Added `assertSafeRelativeConfigPath` +
      `UnsafeConfigPathError`:
      - Rejects absolute paths.
      - Rejects relative paths that resolve outside the workspace
        root via `path.resolve` + prefix check.
      - Accepts traversal that stays inside (`./foo/../bar` → `bar`).
      - The install command surfaces a MODAL error toast naming
        the setting + the offending path (so users can fix
        `.vscode/settings.json` rather than retry blindly).
      - The probe CATCHES the error and returns `'absent'` —
        tree renders shouldn't crash on a malicious setting.
        **9 new unit tests** covering normal paths, absolute paths,
        `../` escape, multi-segment escape, traversal that stays inside,
        error-name + error-message guarantees, install + probe wiring.
    - **R4-G3 (probe error catching)** — the McpView probe inline in
      extension.ts didn't have a try/catch wrapping it. Any thrown
      exception (corrupt JSON in the wrong place, surprise vscode
      API error) would break the whole getTreeItem render. Wrapped
      in try/catch; errors log to RunsChannel `[misc]` and the
      Copilot row falls back to `'absent'`.
    - **R4-G4 (helpContent + OnboardingTour propagation — N/A)** —
      The staff-engineer skill's checklist names `OnboardingTour.tsx`
      and `helpContent.ts` as mandatory propagation targets. Phase 6
      ships VS Code extension code; helpContent + OnboardingTour
      serve the desktop/web app's Help Center, which has its own
      MCP-related coverage. The VS Code extension's discoverability
      docs live at `apps/vscode/README.md` (updated) + `docs/vscode-extension.md`
      §13 (updated P6-5). **Explicit N/A — not a missed propagation,
      separate consumer surface.**
  - **R5 — zero gaps.** Verification: bundle still 1.91 MB,
    monorepo 3492 / 318 (up from R3's 3476 / 318, +16 tests = 14
    R4 + 2 cascade drift). All P6 R4 closures have unit + command
    integration coverage. Settings reactivity hook fires correctly
    on `apicircle.mcp.*` change. Security regression covered by 9
    unit tests + 2 command-layer modal-error tests + the malicious-
    setting integration scenario. **Phase 6 closes at R5 with no
    remaining gaps.**
- **Phase 7+ forward look**:
  - **Bundle code-splitting via ESM** — load-bearing for any further
    feature add. Tsup CJS → ESM migration of the extension entry,
    or aggressive lazy `require()` of mock-server-core / Hono / etc.
  - **In-extension `McpHost` over HTTP/SSE** — VS Code as BOTH MCP
    host AND client of its own catalog. Requires the security model
    work the `apicircle.mcp.allowDecrypt` setting is gating.
  - **Plan Notebooks** (`vscode.NotebookController`) + **Testing tab**
    (`vscode.tests.createTestController`).
  - **`apicircle.mcp.autoConfigureClients`** — auto-write the same
    snippet into other AI clients' config files. Today's manual
    `copyMcpConfig` + this Phase 6 install command together cover
    100% of the workflow; the auto-config is convenience that's
    gated on explicit user opt-in for safety.

### VS Code extension Phase 5 — MCP Host Integration

Phase 5 makes VS Code a first-class MCP host alongside Desktop + CLI. The
McpView fills out, the extension generates per-AI-client config snippets
pointing at the active workspace's `.apicircle/` dir, and the shared
snippet builder moves to `@apicircle/mcp-server` so Desktop + VS Code
produce byte-identical snippets for the same `(binary, workspace, client)`
tuple.

- **`@apicircle/mcp-server/src/config/snippets.ts`** — extracted from the
  desktop's `mcpManager.ts`. Exports `AiClient` type, `AI_CLIENTS`
  allowlist, `buildSnippetVariants(client, binary, workspace)`,
  `resolveAiClientConfigPath(client, env)`, `ConfigSnippetVariants`, and
  `ConfigPathEnv`. **12 unit tests** covering snippet emission
  (forward-slash + escaped variants), per-OS path resolution (macOS /
  Windows / Linux), null cases, and the AI_CLIENTS allowlist surface.
- **Desktop refactored to consume the shared module.** `apps/desktop/src/main/mcp/mcpManager.ts`
  now imports `buildSnippetVariants` + `resolveAiClientConfigPath` from
  `@apicircle/mcp-server`. The inline implementation is gone. Desktop's
  existing **8-test** McpManager suite still passes byte-identically —
  proves the move is a refactor, not a behaviour change.
- **`VsCodeMcpManager`** in `apps/vscode/src/host/mcpManager.ts`. Wraps
  the shared builder with VS Code-host-specific resolution:
  - Workspace path: the active workspace's `apicircleDir`.
  - Binary path: `apicircle.mcp.binaryPath` setting (default
    `apicircle-mcp`).
  - Returns `null` from `getConfigSnippet(client)` when no workspace is
    active — callers surface a "no workspace" UX rather than emitting
    an invalid snippet.
  - Exports `aiClientDisplayName(client)` for the UI labels.
    **13 unit tests** cover the resolution, snippet emission, config-path
    lookup, and display-name labels.
- **McpView fillout.** The Phase 4 stub becomes a populated TreeView:
  - **MCP Server header row** — status icon, "78 tools · binary:
    apicircle-mcp" description, MarkdownString tooltip with full paths,
    contextValue `mcp-header-active` / `mcp-header-idle`.
  - **Connect an AI client section** (expanded by default) with one row
    per supported client (10 today: claude-desktop, claude-code, cursor,
    continue, cline, zed, windsurf, github-copilot, chatgpt, generic).
    Each row's contextValue is `mcp-client-with-path` (fixed config
    location) or `mcp-client-manual` (paste manually).
  - **Open Connect Guide** footer row — opens
    `docs/connect-your-ai-client.md` on GitHub.
  - Click-to-action on each client row fires `apicircle.copyMcpConfig`
    with the right node arg. **11 unit tests** cover the layout +
    contextValue tagging + click commands + every supported client.
- **4 new commands:**
  - `apicircle.copyMcpConfig` — writes the snippet to clipboard. On
    Windows (divergent forward-slash vs escaped variants) prompts the
    user to pick which form. POSIX paths skip the picker. If no
    workspace is active, surfaces a clear warning instead of writing
    "" to clipboard. With a known config path, the success toast
    offers "Open Config File" (creates an empty `{"mcpServers": {}}`
    seed if the file doesn't exist).
  - `apicircle.openMcpConfigFile` — opens the AI client's MCP config
    file in VS Code. Clients without a fixed location (generic,
    chatgpt, github-copilot, etc.) get an info toast pointing them at
    the client's settings UI.
  - `apicircle.openMcpConnectGuide` — opens the connect docs in the
    external browser via `vscode.env.openExternal`.
  - `apicircle.revealMcpBinaryInfo` — info toast with binary path,
    workspace path, and tool count. Phrasing adapts to "no active
    workspace" state. Wired to the view-title button + the mcp-header
    inline action.
    **15 unit tests** in `mcpActions.test.ts` cover every command branch
    including QuickPick cancellation, Windows variant picker, Create vs
    Cancel on the seed-file path, and the no-workspace warning.
- **One new setting** — `apicircle.mcp.binaryPath` (default
  `apicircle-mcp`). Manager re-reads it on every call so users can
  change the binary path without reactivation. Ships with clean
  markdownDescription — no "(Phase 5 — not yet implemented)"
  placeholder.
- **package.json wiring:**
  - 4 new commands declared in `contributes.commands` with icons.
  - 4 new `onCommand:` activation events + `onView:apicircle.mcp` so
    the McpView is the lightest possible trigger.
  - 5 new `view/item/context` entries (copy + open config file +
    binary-info reveal, gated by mcp-header / mcp-client contextValues).
  - 2 new `view/title` entries (Open Connect Guide + Show Binary Info).
- **Three-surface compat** — `mcpRoundTrip.test.ts` integration suite
  proves the VS Code manager's `getConfigSnippet(client)` returns
  byte-identical output to the shared `buildSnippetVariants(client,
binary, workspace)` for every supported client. **5 integration
  tests** cover: clipboard byte-match, workspace-switch re-targeting,
  Create-config-file path, revealBinaryInfo content, and the per-client
  parity sweep.
- **E2E spec** — `e2e/vscode/src/test/5-mcp.test.ts` proves the four
  Phase 5 commands resolve via `vscode.commands.getCommands()` and the
  view container can be focused without throwing.
- **Tests** — **57 new (incl. 9 audit-close) + ~6 existing updated** across the suite:
  - `mcp-server/config/snippets.test.ts` (12)
  - `apps/vscode/src/host/mcpManager.test.ts` (13)
  - `apps/vscode/src/views/McpView.test.ts` (11)
  - `apps/vscode/src/commands/mcpActions.test.ts` (15)
  - `apps/vscode/test/integration/mcpRoundTrip.test.ts` (5)
  - Updated `activation.test.ts` (+4 command ids) +
    `manifestRegression.test.ts` (+3 P5 regressions covering commands,
    activation events, setting label) + `stubViews.test.ts` (McpView
    now requires a manager arg, 1 smoke check survives).
- **Bundle size** — `dist/extension.js` is **1.90 MB** (up from
  Phase 4's 1.88 MB). Still under the 2 MB CI gate. Phase 6 code-
  splitting follow-up is now load-bearing — the McpView + commands +
  shared mcp-server imports together pushed bundle 20 KB closer to
  the gate.
- **Phase 5 Round 1 audit (5 gaps closed):**
  - **R1-G1 (dead code)** — Removed leftover `void path;` shim in
    desktop's `mcpManager.ts` (the import was still in use; the shim
    was a refactor remnant).
  - **R1-G2 (brittle path-separator probe)** — `openConfigFileFor`
    used `configPath.includes('/') ? '/' : '\\'` + `lastIndexOf` to
    find the dirname. Replaced with `path.dirname(configPath)` for
    cross-platform correctness (would break on workspace paths that
    mixed separators on Windows).
  - **R1-G6 (empty binary path)** — `apicircle.mcp.binaryPath` could
    be set to `""` or `"   "` from settings UI. Empty path emitted
    `"command": ""` snippets that AI clients silently reject.
    `VsCodeMcpManager.resolvePaths` now trims + coerces empty values
    back to `apicircle-mcp` so users get a working snippet. 3 new
    unit tests cover empty / whitespace-only / leading-trailing-trim.
  - **R1-G11 (missing client paths)** — `claude-code` (`~/.claude/mcp.json`)
    and `windsurf` (`~/.codeium/windsurf/mcp_config.json`) gained
    config-path resolution. Tests + the desktop manager's expected-
    paths list updated accordingly.
  - **R1-G16 (docs gap)** — `docs/connect-your-ai-client.md` now has
    a "Using the VS Code extension (recommended)" section that walks
    through the MCP view flow + the `apicircle.mcp.binaryPath`
    override + the three-surface byte-parity claim.
- **Phase 5 Round 2 audit (3 gaps closed):**
  - **R2-G2 (cross-platform path coverage)** — Added 6 tests asserting
    the new claude-code + windsurf paths resolve identically on macOS
    / Linux / Windows (matching the existing claude-desktop coverage).
  - **R2-G6 (icon polish)** — Open Connect Guide row's icon was
    `book`; opens externally in browser. Changed to `link-external`
    so the icon hints at the navigation destination.
  - **R2-G13 (header click)** — McpView header row had no command
    despite looking clickable. Wired `apicircle.revealMcpBinaryInfo`
    so click surfaces the binary-info toast (matching the menu
    action). Test asserts the command.
- **Phase 5 Round 3 audit — zero gaps.** Final verification pass:
  vscode 679 tests / 74 files, monorepo 3435 tests / 315 files, lint
  clean, typecheck clean, knip clean for P5 surfaces, bundle 1.90 MB
  (under 2 MB CI gate), `apicircle-mcp` snippet bytes byte-identical
  across Desktop + VS Code for every supported AI client (proven by
  `mcpRoundTrip.test.ts` integration suite). **Phase 5 closed at R3.**
- **Cross-phase audit (P1 → P5 sweep — 6 stale-state gaps closed):**
  Beyond per-phase audits, a sweep across all 5 phases caught
  drift that no single phase audit was scoped to find:
  - **XPhase-G1 (stale settings labels)** — `apicircle.mcp.autoConfigureClients`
    - `apicircle.mcp.allowDecrypt` still carried "(Phase 4 — not yet
      implemented)" placeholders despite Phase 4 + Phase 5 both
      shipping. Re-labelled to "(Phase 6+ — deferred)" with concrete
      descriptions of what the settings will do + what to use until
      they land.
  - **XPhase-G2 (README staleness)** — top-level README said
    "Phase 3 alpha is current. Phase 4 ships the secret vault + MCP
    host integration." — stale by 2 phases. Rewrote to reflect P4
    secret vault, P5 MCP host integration, P6+ forward-look.
  - **XPhase-G3 (dead status-bar vault placeholder)** — the vault
    status-bar item was hard-coded to `$(unlock) Vault` with the
    tooltip "Phase 4 wires actual lock state" — Phase 4 shipped the
    vault but the status bar wasn't wired. Now subscribes to
    `VsCodeVaultManager.onDidChange`, reads each workspace's
    `secretCrypto`, renders lock/unlock icon + `unlockVault` /
    `lockVault` click commands accordingly. Hides cleanly when
    workspace has no passphrase (EnvironmentView surfaces the
    setup CTA in that case). Plus an async race guard — `active.read()`
    callbacks no longer throw when the bar has been disposed mid-
    flight. **4 new + 2 updated** statusBar tests.
  - **XPhase-G4 (stale source comments)** — 8 inline "Phase 4 will
    do …" / "Phase 5 promotes …" comments referenced work that
    already shipped. Updated `vscodeBridge.ts`, `vscodeMockController.ts`,
    `mockActions.ts`, `preSendDiagnostics.ts`, `envYaml.ts`,
    `sendRequest.ts`, plus future-looking comments in
    `requestCodeLens.ts` / `requestCompletion.ts` / `newRequest.ts`
    that pointed at "Phase 5" but actually mean Phase 6+ now.
  - **XPhase-G5 (GitHub Copilot snippet drift)** — `docs/connect-your-ai-client.md`
    used the legacy `github.copilot.advanced.mcp.servers` envelope
    for GitHub Copilot. Modern Copilot Chat reads `.vscode/mcp.json`
    with the standard `mcpServers` wrapper, matching what the Phase
    5 snippet builder emits. Replaced the snippet + linked to the
    Phase 5 copy-config flow.
  - **XPhase-G6 (manifest regression guard)** — `manifestRegression.test.ts`
    guarded `apicircle.secrets.*` + `apicircle.mcp.binaryPath`
    against the "not yet implemented" label but didn't catch the
    same drift on `apicircle.mcp.autoConfigureClients` /
    `apicircle.mcp.allowDecrypt`. Added 2 honesty assertions that
    sweep EVERY property under `contributes.configuration.properties`
    for stale "Phase 4 — not yet implemented" / "Phase 5 — not yet
    implemented" labels.
    Post-R1 cross-phase: vscode **683 tests / 74 files**, monorepo
    **3439 tests / 315 files**, lint + typecheck + knip clean, bundle
    1.90 MB.
- **Cross-phase Round 2 audit (4 more gaps closed — drift from R1's
  closures):**
  - **R2-G1 (label-style inconsistency)** — R1 relabelled the 2 MCP
    deferred settings to "(Phase 6+ — deferred)" but
    `apicircle.editor.defaultView` still used the older "(Phase 6 —
    not yet implemented)" style. Normalised to "(Phase 6+ — deferred)"
    so the wording matches across all deferred settings.
  - **R2-G3 (silent edit failures)** — Three source-comment edits
    queued in R1 actually FAILED at write-time with "File has not
    been read yet" errors that were easy to miss in the bulk-edit
    response. `requestCodeLens.ts:10` ("Phase 5 (language services
    pass)"), `requestCompletion.ts:16` ("Phase 5 lifts this to a
    proper YAML language-server"), and `newRequest.ts:21` ("dedicated
    auth wizards in Phase 4") all still carried stale phase
    references. Re-edited with explicit Read-first sequencing; the
    comments now point at Phase 6+ language-services follow-up and
    Phase 6+ auth wizards respectively.
  - **R2-G5 (gitWorkspaceProvider stale note)** — `gitWorkspaceProvider.ts`
    carried a 30+ line comment block dated "deferred to Phase 3"
    explaining the FileBackedWorkspaceProvider unification refactor.
    Phase 3 shipped, so the note's deadline is past. Updated to
    document the current state: three-surface compat tests catch
    drift, the unification is now a Phase 7+ cleanup candidate.
  - **R2-G7 (PBKDF2 timeout flake under parallel monorepo gate)** —
    `vaultUnlock.test.ts` passes standalone (20/20 in 38s, ~2s per
    test) but the monorepo's parallel test pool's CPU contention
    pushed individual tests past Vitest's default 5s timeout on
    some runs — 3 sporadic failures in the PBKDF2-heavy
    `setupVaultPassphraseCommand` path. Production-correct fix:
    `vi.setConfig({ testTimeout: 30_000 })` at the top of the file
    raises the per-test budget without touching production iteration
    count. Caught only by running the FULL monorepo gate after R1
    closures — a per-phase audit wouldn't have seen it.
    Post-R2 cross-phase: monorepo gate runs reliably with 3439 tests
    passing under parallel pool load.
- **Cross-phase Round 3 audit (6 more gaps closed — manifest +
  docs-internals drift):**
  - **R3-G1 (viewsWelcome stale-phase content)** — `apicircle.mcp`'s
    `viewsWelcome` content claimed "MCP integration ships in Phase 4"
    despite MCP shipping in Phase 5 with the McpView fillout. The
    welcome never actually displayed (McpView always returns 3 rows),
    but the manifest string still misled any future reader. Rewrote
    with current Phase 5 messaging + the 10 supported clients +
    a `command:apicircle.openMcpConnectGuide` link.
  - **R3-G2 (sidebar table stale row)** — `docs/vscode-extension.md`'s
    sidebar-layout table said "MCP | Phase 4 | Embedded MCP server
    status + AI client detection" — wrong phase AND wrong description
    (we ship config-snippet generation, not embedded server). Also
    omitted the Snapshots view entirely. Rewrote the row + added the
    missing Snapshots entry.
  - **R3-G3 (architecture diagram stale labels)** — The ASCII
    architecture diagram listed "VsCodeBridge — workspace + mocks +
    MCP + secrets" generically, plus "MCP server child (Phase 4) /
    embedded (Phase 10)". Updated to spell out the actual
    sub-components: `VsCodeBridge` + `InProcessMockController` (P3)
    - `VsCodeVaultManager` (P4) + `VsCodeMcpManager` (P5), with
      "embedded MCP host over HTTP/SSE is Phase 6+" honestly named.
  - **R3-G4 (variable inline edit pointer)** — The Phase 2 doc
    section said "Encrypted variables direct users to vault flow
    (Phase 4)" — past tense now that Phase 4 shipped. Replaced with
    the concrete command (`apicircle.openVaultEntry`) and the actual
    reveal options.
  - **R3-G5 / R3-G6 (deferred-to-Phase-5 header + bundle size)** —
    The Phase 3 section's "Deferred to Phase 5+" footer still listed
    "MCP host integration" as future work (Phase 5 shipped it) and
    quoted "1.88 MB" for the bundle (current is 1.90 MB). Renamed to
    "Deferred to Phase 6+", refreshed the bundle size, and reframed
    MCP integration as "embedded in-extension host over HTTP/SSE"
    since the snippet-based external-client model already shipped.
  - **R3-G6 (manifest regression coverage extension)** — Added 2
    new assertions to `manifestRegression.test.ts` that walk every
    `contributes.viewsWelcome` entry and reject any "ships in Phase
    4" / "ships in Phase 5" string. Catches the same drift category
    R3-G1 represented — the missing guard is what let G1 survive 2
    full audit rounds.
    Post-R3 cross-phase: vscode **685 tests / 74 files**, monorepo
    **3441 tests / 315 files**, all green under parallel pool load,
    lint + typecheck + knip clean, bundle 1.90 MB.
- **Cross-phase Round 4 audit (2 more gaps closed — test-count
  drift in per-phase docs):**
  - **R4-G1 (`vscode-extension.md` Phase 5 close-out counts)** — The
    Phase 5 section's "Test counts (Phase 5 close)" still quoted the
    Phase 5 baseline numbers (676 / 193 / 3430) that landed before
    the cross-phase audit rounds added tests inside Phase 5's
    territory (viewsWelcome regression assertions, statusBar P4-vault
    rewiring, MCP snippet cross-platform path coverage). Updated to
    post-cross-phase numbers (685 / 195 / 3441) with a sentence
    explaining the baseline-vs-post-audit distinction.
  - **R4-G2 (`vscode-extension.md` Phase 4 close-out counts)** — Same
    drift in the Phase 4 section. Numbers showed 602 / 3344
    (baseline) instead of the post-audit 628 / 3370. Renamed
    section to "Test counts (Phase 4 close, post-audit)" + updated
    values + added a parenthetical pointing readers at the audit
    trail in CHANGELOG.
- **Cross-phase Round 5 audit — zero gaps.** Verification pass:
  test counts now consistent across CHANGELOG, `docs/qa/README.md`,
  `docs/vscode-extension.md`, and the live test runner; lint +
  typecheck + bundle + knip clean; manifestRegression test suite
  guards every drift category surfaced in R1/R3 (10 assertions
  covering settings labels for 4 historical phases + viewsWelcome
  content + command/event/menu alignment). **The cross-phase audit
  converges at R5 with zero remaining gaps across Phase 1-5.**
- **Phase 6+ forward look** — VS Code Copilot Chat MCP integration via
  `vscode.lm.registerMcpServerDefinitionProvider` (proposed API), an
  in-extension `McpHost` exposed over HTTP/SSE so VS Code can be both
  the host AND a client of its own MCP server, Plan Notebooks, Testing
  tab, ESM-based bundle code-splitting.

### VS Code extension Phase 4 — Secret Vault + APICircle Runs OutputChannel

Phase 4 wires the workspace-passphrase secret vault into the VS Code
extension. Every encrypted environment variable is now decryptable in-place
from the Environment view, the auto-lock + clipboard-clear settings finally
do something, and the assorted per-feature OutputChannels collapse into a
single user-facing **APICircle Runs** channel.

- **`@apicircle/core` now exports the vault crypto.** `passphraseKey.ts`
  (PBKDF2-SHA-256 v1, 1.2M iterations) moved from `packages/ui-components`
  into `packages/core/src/secrets/` so the VS Code extension — which
  can't depend on the workspace-private `ui-components` package — drives
  the same `initSecretCrypto` / `unlockSecretCrypto` algorithm the
  desktop/web build uses. Single source of truth for the on-disk blob
  shape. The ui-components store + onboarding modal both now import from
  `@apicircle/core`. **7 tests** moved with the file.
- **New `WorkspacePatch` variants — `secret.crypto.set` / `secret.crypto.clear`.**
  Previously, persisting a freshly-initialised SecretCryptoMeta required
  a direct `surface.write({synced})` bypass of `applyMutation`; the MCP /
  CLI clients had no patch they could route through. Two new patches
  close that gap. `set` defensively rejects malformed blobs (unsupported
  KDF, missing verifier, zero iterations) so a misbehaving client can't
  poison the workspace. **7 tests** in `applyMutation.test.ts` + **5
  tests** in a new `secretCryptoCompat.test.ts` proving byte-identical
  behaviour across `FileBackedWorkspaceProvider` (desktop / MCP) and
  `GitWorkspaceProvider` (VS Code).
- **`VsCodeVaultManager`** — host-level singleton that holds the unlocked
  per-workspace AES-GCM key in memory, drives the auto-lock timer, and
  exposes `encryptValue` / `decryptValue`. Typed errors (`VaultLockedError`
  / `VaultCryptoError`) so the command layer surfaces the right UX
  without sniffing exception messages. Multi-workspace aware — locking one
  vault leaves the others alone. Listener iteration uses the
  P3R3-G1 snapshot pattern so dispose-during-fire can't skip adjacent
  subscribers. `lockAll()` wired to extension `deactivate()` so the
  master key is wiped from process memory at shutdown. **27 unit tests**
  in `vaultManager.test.ts` cover unlock / lock / encrypt-decrypt round-
  trips / timer arm-cancel-rearm / listener safety.
- **Vault command surface — six new commands.**
  - `apicircle.setupVaultPassphrase` — first-time setup. Prompts for a
    passphrase, confirms it, mints a SecretCryptoMeta blob, and persists
    via the new `secret.crypto.set` patch. The blob (kdf / salt /
    iterations / verifier) lives in `synced.secretCrypto` and travels
    with Git; the passphrase never leaves process memory.
  - `apicircle.unlockVault` — passphrase prompt, validates against the
    stored verifier before any decrypt is attempted.
  - `apicircle.lockVault` — manual lock. With no active workspace, locks
    every cached vault.
  - `apicircle.changeVaultPassphrase` — rotation. Verifies the old
    passphrase, collects + decrypts every encrypted env variable under
    the old key, re-initialises the vault, and re-encrypts each value in
    place. Atomic from the user's perspective; if any value fails to
    decrypt the rotation aborts before the blob is replaced.
  - `apicircle.openVaultEntry` — replaces the Phase 4 "encrypted
    variables are edited through the secret vault" placeholder from
    `variableActions.ts`. Unlocks on demand (if locked), decrypts, then
    offers **Copy to Clipboard** (with auto-clear) or **Show in
    Notification (15s)**. Non-encrypted rows fall through to the
    existing `editVariableValue` command.
  - `apicircle.showRunsChannel` — reveals the new APICircle Runs
    OutputChannel.
- **`apicircle.secrets.autoLockMinutes` + `apicircle.secrets.clipboardClearSeconds`
  now actually do something.** Both were declared in
  `contributes.configuration` since Phase 2 with "(Phase 4 — not yet
  implemented)" markdown labels. The activate() flow now reads both at
  startup, subscribes to `vscode.workspace.onDidChangeConfiguration`, and
  re-applies them live. `autoLockMinutes=0` disables auto-lock entirely;
  `clipboardClearSeconds=0` disables clipboard auto-clear. The clipboard
  clear is conditional — if the user has pasted something else over the
  buffer in the interim, the clear is skipped so we never wipe unrelated
  user content. **2 integration tests** cover both branches.
- **EnvironmentView gains a vault-header row.** Always rendered at the
  top — three states: **not configured** → click runs setup;
  **locked** → click prompts unlock; **unlocked** → click locks.
  Inline button on the row mirrors the click. The contextValue is one
  of `vault-unconfigured` / `vault-locked` / `vault-unlocked` so menus
  attach cleanly. Encrypted variable rows now wire a click command to
  `apicircle.openVaultEntry` so the whole reveal flow is one click
  away — no menu hunting required. **Updated test count** for the view:
  `getChildren` now includes the vault-header node and emits
  `variable-encrypted` (not `variable`) for encrypted rows.
- **APICircle Runs OutputChannel — `runsChannel.ts`.** Replaces the
  ad-hoc "APICircle Mock" channel from P3R5-G5 with a single consolidated
  channel. Categorised lines (`[mock] <iso> <msg>`, `[vault]`, `[plan]`,
  `[send]`, `[snapshot]`, `[misc]`) keep the picker scannable. Lazy
  creation matches P3R6-G4 — never shown in the picker until first
  `log()` call. `forCategory(cat)` returns a bound logger used by the
  mock controller + vault manager. `apicircle.showRunsChannel` command
  - matching `runsChannel.reveal()` for manual access. **6 unit tests**
    in `runsChannel.test.ts` cover lazy creation / formatting /
    forCategory / reveal / dispose / custom name.
- **`variableActions.editVariableValueCommand` routes encrypted rows
  to the new vault flow** instead of showing the "Phase 4 not yet
  implemented" toast. The test that asserted the toast now asserts the
  `executeCommand('apicircle.openVaultEntry', ...)` dispatch.
- **package.json wiring** — 6 new commands declared in
  `contributes.commands`, 4 new view/item/context menu entries
  (`vault-locked` inline Unlock, `vault-unlocked` inline Lock + Change
  Passphrase, `vault-unconfigured` inline Set Up, encrypted-variable
  inline Open Vault Entry), 6 new `onCommand:` activation events,
  and the two secrets settings now ship clean Markdown descriptions
  (the "(Phase 4 — not yet implemented)" banner is gone).
- **Tests** — **23 new + updates to ~5 existing tests** across the
  vscode app (15 baseline + 8 audit-close). Test counts:
  - **apps/vscode** — **628 tests across 70 files** post-R5 (Phase 3
    baseline: 555 across 65 files).
  - **Monorepo** — **3370 tests across 310 files** post-R5 (Phase 3
    baseline: 3288 across 305 files).
- **Phase 4 full audit (8 gaps closed):**
  - **Audit-G1 (atomicity)** — `changeVaultPassphraseCommand` was
    decrypt-all → init-new → apply-blob → re-encrypt-each. A throw in
    the last step left the workspace with a NEW vault blob but
    some ciphertext encrypted under the OLD key — unrecoverable.
    Restructured to encrypt-all-under-new BEFORE applying the blob,
    so a step-4 failure leaves on-disk state untouched. The
    pre-blob failure path also calls `vault.lock(workspaceId)` so
    the (still in-memory) new key gets wiped.
  - **Audit-G2 (validation)** — Setup + change-passphrase prompts
    accepted whitespace-only passphrases (`"   "` passed
    `v.length === 0`). Trim before validating.
  - **Audit-G3 (UI coverage)** — Added 3 unit tests for
    `vault-header` `getTreeItem` covering not-configured / locked /
    unlocked states; asserts the rendered command, contextValue,
    and label.
  - **Audit-G5 (rotation coverage)** — Added 3 integration tests
    for `changeVaultPassphraseCommand` covering successful rotation,
    wrong-old-passphrase abort, and the whitespace-validation gate.
  - **Audit-G8 (multi-workspace isolation)** — Added an integration
    test that registers two workspaces with different passphrases,
    confirms both unlock independently, ciphertext from workspace #1
    can't be decrypted by workspace #2's vault, and locking one
    leaves the other unlocked.
  - **Audit-G9 (lifecycle cleanup)** — `extension.ts` was wiping
    the vault via both a `context.subscriptions.push({ dispose
... lockAll })` AND an explicit `vaultManager?.lockAll()` in
    `deactivate()`. Dropped the subscription owner; deactivate is
    the canonical wipe.
  - **Audit-G11 / G12 (orphan-ciphertext UX)** — When the workspace
    has no `secretCrypto` blob (e.g. the user ran the rotation
    command and a Git pull wiped the blob, or `secret.crypto.clear`
    was called via MCP/CLI) but env vars still hold `enc:v1:`
    wires, the generic "decryption failed" message was opaque.
    The reveal flow now detects the case and surfaces
    "looks encrypted but this workspace has no vault passphrase
    set … this value is unrecoverable. Delete or overwrite via
    the env YAML."
- **Phase 4 Round 2 audit (8 more gaps closed):**
  - **R2-G1 (weak test)** — The "rejects whitespace-only new
    passphrase" integration test asserted `password: true` instead
    of calling `validateInput` directly. Strengthened: the test now
    captures the validateInput function from the new-passphrase
    prompt and exercises it against `""`, `"   "`, `"\t\n"`, and a
    valid string, asserting each.
  - **R2-G2 (type smell)** — `openVaultEntryCommand`'s non-encrypted
    fall-through path passed the original `kind: 'variable-encrypted'`
    node verbatim to `apicircle.editVariableValue`, whose VariableNode
    type expects `kind: 'variable'`. Runtime worked, but the type
    drift would bite under stricter typing later. Now normalizes the
    kind before dispatching.
  - **R2-G3 (SECURITY — stale cached key)** — If a teammate rotated
    the workspace passphrase and the new `SecretCryptoMeta` blob
    arrived via Git pull, the locally-cached AES-GCM key was still
    derived from the OLD verifier. `isUnlocked()` returned true →
    every downstream decrypt threw "bad tag" with no actionable
    error. Added `derivedFromVerifier` field to the in-memory entry
    - `VsCodeVaultManager.isUnlockedAgainst(blob)` for liveness
      checks. `unlockVaultCommand` + `openVaultEntryCommand` now route
      through the new check; stale keys get dropped + re-prompted.
  - **R2-G7 (three-surface gap)** — Compat coverage included
    `set-from-null` and `clear-already-null` but not `set-over-existing`
    (rotation). Added a test that applies an initial blob, then a
    rotated one, asserting byte-identical state across providers.
  - **R2-G10 (manifest regression)** — Added
    `src/manifestRegression.test.ts` that reads the on-disk
    `package.json` and asserts (a) the two Phase 4 secrets settings
    do NOT carry the "Phase 4 — not yet implemented" placeholder
    text any more, (b) every Phase 4 vault command is declared in
    `contributes.commands`, (c) every Phase 4 vault command has a
    matching `onCommand:` activation event.
  - **R2-G12 (UX branch coverage)** — The "wiped vault" UX has two
    branches — `looksEncrypted` true/false. Only the true branch
    was tested. Added a test for the false branch (variable flagged
    `encrypted: true` but value isn't an `enc:v1:` wire — could
    happen via hand-edit) showing the generic "No vault passphrase
    set" message instead of "unrecoverable".
  - **R2-G14 (no-active-workspace tests)** — All vault commands have
    early-exit paths when no workspace is registered. Added an
    integration test that drops the active workspace and confirms
    each command no-ops cleanly without throwing.
  - **R2-G15 (misleading toast)** — `lockVault` with no active
    workspace called `lockAll()` and showed "All vaults locked."
    even when nothing was unlocked. Added
    `VsCodeVaultManager.unlockedWorkspaceIds()` so the command can
    say "Locked N vault(s)." or "No vaults were unlocked."
    accurately.
- **Phase 4 Round 3 audit (3 more gaps closed):**
  - **R3-G11 (silent stale-cache drop)** — When `unlockVault`
    detected the staleness path it dropped the cached key but
    re-prompted with no explanation. Added a non-modal info toast:
    "Vault passphrase changed externally (likely a Git pull from a
    teammate who rotated). Please re-enter the new passphrase."
    Integration test updated to assert the toast.
  - **R3-G15 (multi-cycle determinism)** — Added a three-surface
    test for the `set → clear → set` cycle to lock in determinism
    across multi-step patch sequences.
  - **R3-G19 (docs propagation)** — This entry. CHANGELOG +
    docs/qa/README.md now reflect the post-R3 test counts.
- **Phase 4 Round 4 audit (1 more gap closed):**
  - **R4-G1 (rotation persist-failure recovery)** — If the
    `secret.crypto.set` apply call itself throws mid-rotation
    (disk full, FS error, advisory-lock contention), the in-memory
    vault would hold the NEW key while on-disk still had the OLD
    blob — every subsequent decrypt would silently use the wrong
    key and throw "bad tag". The rotation flow now wraps the blob
    apply call in try/catch, calls `vault.lock()` on failure, and
    surfaces a clear error toast pointing the user back to the OLD
    passphrase. The env.upsert loop also catches per-env so
    partial-rotation failures are at least surfaced (and re-running
    rotation under the new passphrase recovers the remaining vars).
    Integration test simulates the apply failure via a method
    swap on the workspace surface.
- **Phase 4 Round 5 audit — zero gaps.** Final verification pass:
  all tests green, lint + typecheck clean, knip clean (only
  pre-existing flags in `ui-components` unrelated to Phase 4),
  security model verified (key in-memory + non-extractable + stale-
  cache detection), atomicity proven for both apply-throws + env-
  upsert-throws code paths. **Phase 4 closed at R5.**
- **E2E specs** — two new files (`4-vault.test.ts`, `4-runs-channel.test.ts`)
  prove the 6 new command ids resolve via `vscode.commands.getCommands()`
  and the no-op safe paths don't throw under VS Code's extension host.
- **Bundle size** — `dist/extension.js` is 1.88 MB (up from Phase 3's
  1.85 MB), still under the 2 MB CI gate. Phase 5+ will need code-
  splitting; the carry-over still applies.
- **Phase 5+ forward look** — MCP host integration (VS Code as a
  first-class MCP host alongside Desktop / CLI), Plan Notebooks,
  Testing tab, bundle code-splitting via ESM. The vault is a
  prerequisite for MCP-driven encrypted-secret reads; that wiring lands
  in Phase 5.

### VS Code extension Phase 3 — Mock servers

The Mock view fills out. The VS Code extension now spins up local HTTP mock
servers directly from OpenAPI / Postman / Insomnia specs (or manual endpoint
lists), reusing the same `InProcessMockController` engine the CLI uses. No
sidecar process, no IPC — Hono runs inside the extension host.

- **Mock view populated** — `apicircle.mock` shows every server in
  `synced.mockServers`, expanded to its endpoints. Running servers show
  `▶ :port`, idle servers `◦`. Click a server → opens its `.mock.yaml`.
  Inline ▶ Start / ■ Stop / ↻ Restart per server. New `MockView` (10 tests).
- **Mock YAML projection** — new
  `apicircle://<workspaceId>/mocks/<id>.mock.yaml` URI kind. Editable
  fields: `name`, `defaultPort`, `cors`. Read-only annotations: `source`
  (kind + spec preview) and `endpoints` (method + path + default status).
  Re-import the spec via "New Mock" to change source/endpoints — the
  desktop app remains the right surface for per-endpoint editing
  (response rules, validation, multipliers). New `mockYaml.ts` +
  `mockYaml.test.ts` (21 tests).
- **`apicircle-mock.schema.json`** — Draft-07 schema; `*.mock.yaml`
  registered under `contributes.yamlValidation`.
- **`apicircle-mock` language** — registered for `.mock.yaml` files with
  the standard YAML language-configuration.
- **`VsCodeMockController`** — wraps `InProcessMockController` and bridges
  runtime state to `WorkspaceLocal.mockRuntime.active`. Same shape the
  desktop's `MockManager` writes, so the disk mirror sees consistent
  runtime state across surfaces. `disposeAll()` stops every server on
  extension deactivation. 8 tests.
- **Mock lifecycle commands** —
  - `apicircle.newMock` — 4-step wizard: source kind (OpenAPI/Postman/
    Insomnia/Manual) → spec content → name → default port. Pre-parses
    the source via `parseSourceToEndpoints` so a bad spec fails the
    wizard, not the next Start.
  - `apicircle.startMock`, `apicircle.stopMock`, `apicircle.restartMock` —
    accept an optional node arg (skip QuickPick from the tree); fall back
    to a QuickPick over `synced.mockServers` for palette invocation.
  - `apicircle.deleteMock` — auto-stops the server if running, then fires
    `mock.delete`. 14 tests across all five commands.
- **Mock language services**:
  - `MockCodeLensProvider` — ▶ Start (idle) / ■ Stop + ↻ Restart (running)
    above the `name:` line. Stop label includes the active port. 6 tests.
  - `MockCompletionProvider` — root field completions (name /
    defaultPort / cors); true|false on `enabled:` lines; enabled / origins
    inside the cors block. 5 tests.
  - `MockHoverProvider` — hover on `name:` shows running/idle status;
    `defaultPort:` shows bind target; `pathPattern:` shows endpoint
    summary + default status + response-rule count. 8 tests.
- **MockStatusBar** — left-side status item visible when ≥1 mock is
  running: `$(server) Mocks: N (:port, …)`. Compact "+N" form past 3.
  Click → focuses the Mock view. 6 tests.
- **FS provider extended** — `mocks/<id>.mock.yaml` URI handled for
  read / write / delete. Read serializes via `mockYaml.serializeMockToYaml`,
  write parses + preserves existing source + endpoints + fires
  `mock.upsert`, delete fires `mock.delete`. New `mockRoundTrip` integration
  suite (5 tests) covering serialize → mutate → write → re-read.
- **Three-surface compat for `mock.delete`** — added to
  `threeSurfaceCompat.test.ts` (test count now 13).
- **package.json wiring** — 6 new commands declared
  (`newMock` / `startMock` / `stopMock` / `restartMock` / `deleteMock` /
  `focusMockView`); view-title `New Mock…` button on `apicircle.mock`;
  context-menu entries for `mock-idle` (Start / Delete) and `mock-running`
  (Stop / Restart / Delete); Ctrl+N keybinding inside the focused Mock
  view; `apicircle-mock` language declared; `*.mock.yaml` schema
  registered; `onView:apicircle.mock` + `onCommand:apicircle.newMock`
  added to activationEvents.
- **Cross-package**: new `@apicircle/mock-server-core` workspace dep.

**Phase 3 tally: 510 tests across 64 files** (up from 426 at end of
Phase 2 Round 6 closure). `pnpm check` + `pnpm lint` clean. No schema
changes — `MockServer` / `MockRuntimeEntry` shapes are unchanged.

### Phase 3 round 1 — 12 honest gaps closed

Round 1 audit on Phase 3 closures found 12 gaps (down from Phase 2 R4's
26 — convergence still on track). Three load-bearing runtime fixes
plus polish:

- **P3R1-G1 — `MockHoverProvider` disambiguates duplicate paths.** When
  two endpoints share the same `pathPattern` with different methods,
  hovering on either path line resolves to the endpoint matching the
  preceding `method: X` line. Walks back up to 10 lines in the same
  indentation block to find the enclosing method.
- **P3R1-G2 — Orphan reconciliation.** New `VsCodeMockController.reconcile()`
  stops any controller-tracked server whose definition no longer exists
  in `synced.mockServers`. Wired to the existing `workspaceWatcher`
  `onAnyChange` hook, so a Git pull / CLI / MCP delete cleanly takes
  down the orphan instead of leaving a zombie Hono on port. 2 tests.
- **P3R1-G3 — Multi-root namespacing.** `VsCodeMockController` now
  passes `${workspaceId}::${serverId}` to the underlying
  `InProcessMockController`. Two workspace folders with the same mock
  id no longer collide. External callers still work with the original
  serverId; namespacing is internal. 2 tests.
- **P3R1-G4 — `mock-endpoint` context menu.** Two new commands:
  `apicircle.copyEndpointPath` (writes the pathPattern to the clipboard)
  and `apicircle.revealEndpointInMockYaml` (jumps to the `id:` line
  inside the parent server's `.mock.yaml`). Wired to the
  `view/item/context` for `viewItem == mock-endpoint`.
- **P3R1-G5 — `newMockCommand` warning visibility.** Wizard now shows
  `Parsed with N warning(s): <first> (+N-1 more)` instead of dropping
  trailing warnings; full list is `console.warn`-logged for now (Phase 4
  ships a dedicated OutputChannel).
- **P3R1-G6 — `docs/architecture/platform.md` updated** — § Mock server
  now lists FOUR runtimes (Desktop, VS Code, CLI, hosted-future) instead
  of three; documents the namespacing + reconcile contract.
- **P3R1-G6b — `docs/mock-server.md` updated** — adds the VS Code row
  to the runtimes table and a § VS Code walkthrough section.
- **P3R1-G7 — `disposeAll()` tolerates bridge-disposed state** during
  extension shutdown. Per-server stop errors are swallowed, runtime
  clears guarded against a disposed surface. 2 tests pin the contract.
- **P3R1-G8 — Port-conflict error path tested.** `startMockCommand`
  test asserts the error toast surfaces when the underlying
  `controller.start` throws an `EADDRINUSE`.
- **P3R1-G9 — README §Mode A** Mocks bullet mentions the VS Code parity.
- **P3R1-G10 — `apicircle.focusMockView` wrapper removed.** The status
  bar now uses VS Code's built-in `apicircle.mock.focus` command
  directly. One less hand-maintained command + one less activation
  step.
- **P3R1-G11 — `MockStatusBar` poll pauses when 0 mocks are running.**
  `setInterval` only runs while there's something to refresh; resumes
  on the next `refresh()` call (typically triggered by a Start command
  or a workspace-watcher event). Two tests pin start + stop semantics.
- **P3R1-G12 — `MockCompletion` surfaces read-only annotations.**
  `source` and `endpoints` now appear in completions sorted to the
  bottom with `(read-only)` detail, so users discover they exist but
  can't accidentally edit them via autocomplete.

**Phase 3 round 1 tally: 520 tests across 64 files** (up from 510).
`pnpm check` + `pnpm lint` + knip clean. No schema changes.

### Phase 3 round 2 — 9 honest gaps closed

Round 2 audit on Round 1 closures found 9 gaps. Three of them were
**bugs the Round 1 closures themselves introduced** (the classic
"gap-introduction by gap-closure" pattern, same as Phase 2). All
closed:

- **P3R2-G1 — `MockStatusBar` pause-resume.** R1 G11 paused the poll
  when 0 mocks were running, but the resume signal was missing. The
  status bar stayed hidden after starting a new mock until something
  external nudged `refresh()`. Fixed by adding an `onChange` event to
  `VsCodeMockController` (fires on start/stop/restart/reconcile) and
  having `MockStatusBar` subscribe to it. The status bar now refreshes
  the instant a lifecycle change happens.
- **P3R2-G2 — `stop()` / `restart()` namespace mismatch.** R1 G3
  introduced workspace-id namespacing for the underlying
  `InProcessMockController` but `stop()` re-derived the namespace from
  the currently-active workspace. If the workspace changed between
  start and stop, the namespace didn't match and the underlying Hono
  server leaked. Fixed by looking up the namespaced id from the
  `tracked` map keyed on the (workspaceId, serverId) tuple — preferring
  the active workspace's entry but falling back to any tracked entry
  with the matching serverId.
- **P3R2-G3 — `deactivate()` race with `disposeAll()`.** R1 closure
  used `void mockController?.disposeAll()` followed immediately by
  `bridge?.dispose()`. The dispose was async; the bridge tore down
  before the per-server stops + runtime clears completed. Fixed by
  making `deactivate()` return a `Promise` and awaiting `disposeAll()`
  before disposing the bridge. VS Code accepts a Promise return from
  `deactivate` and waits up to ~5s before forcing shutdown.
- **P3R2-G4 — Tests for `copyEndpointPathCommand` +
  `revealEndpointInMockYamlCommand`.** R1 G4 wired both commands into
  the manifest + extension but neither had unit tests. Added 7 tests
  covering the no-node, missing-mock, missing-endpoint, and happy
  paths. Extended the `vscode` mock with `Selection` class and
  `TextEditorRevealType` enum so reveal-by-line works under test.
- **P3R2-G5 — `reconcile()` try/catch.** The body is now wrapped in a
  top-level try/catch so an exception from `surface.read()` or
  `surface.write()` doesn't surface as an unhandled promise rejection
  in the workspace-watcher callback. The reconcile must never throw.
- **P3R2-G6 — Real `disposeAll()` bridge-disposed test.** The R1 G7
  test created a `noBridge` controller with an empty tracked map —
  the `clearRuntimeFor` path was never reached, so the test was a
  smoke check, not a bug guard. Replaced with a test that starts a
  mock, then makes `surface.write` throw, then calls `disposeAll()` —
  asserts the disposal doesn't throw and underlying servers still
  stop.
- **P3R2-G7 — `docs/qa/README.md` test counts** refreshed. Unit row
  now says 53 suites / 495 tests; vscode 533; monorepo 3266 across
  304 files.
- **P3R2-G8 + G9 — MockCompletion read-only items insert a comment.**
  R1 G12 surfaced `source` + `endpoints` as completions with
  `insertText = ''` — selecting them was a silent no-op. Now each
  inserts a YAML comment explaining why the field is read-only
  (`# source: <read-only — re-import via "APICircle: New Mock">`),
  plus has `documentation: MarkdownString` attached so the VS Code
  completion popup shows the full context.

**Phase 3 round 2 tally: 533 tests across 64 files** (up from 520).
`pnpm check` + `pnpm lint` + knip clean. No schema changes.

### Phase 3 round 3 — 7 honest gaps closed

Round 3 audit on Round 2 closures found 7 gaps. Smaller again (12 → 9 →
7); convergence is markedly steeper than Phase 2's. One real race-
condition bug from R2's closures plus test-tightening and doc polish:

- **P3R3-G1 — `fireChange()` snapshot before iteration.** The
  `changeListeners` array was iterated live; a listener that called
  `sub.dispose()` mid-fire spliced the array and adjacent listeners
  were skipped (or called twice). Now snapshots with `[...listeners]`
  before iterating. New test pins the contract: listener-1 disposes
  itself, listener-2 still gets called.
- **P3R3-G2 — `findTrackedByServerId` fallback warning.** The fallback
  branch (any tracked entry matching serverId when the active workspace
  doesn't match) now logs a `console.warn` explaining the situation —
  surfaces silent cross-workspace stop behaviour to anyone debugging.
- **P3R3-G3 — End-to-end onChange→statusBar wiring test.** Previously
  we tested `VsCodeMockController.onChange` in isolation and
  `MockStatusBar.refresh` in isolation but nothing verified the wire.
  New test in `mockStatusBar.test.ts` registers a mock controller,
  fires its onChange listener, and asserts the status bar's refresh
  reads new state and shows the bar.
- **P3R3-G4 — `revealEndpointInMockYaml` test asserts `revealRange`
  was called with the correct line.** Previously only checked
  `showTextDocument` was called. New assertion: the `range.start.line`
  matches the position of `id: ep-1` in the doc. Added a second test
  for the fallback-to-line-0 case when the id isn't found.
- **P3R3-G5 — `docs/qa/README.md` Unit suite count.** Was 53,
  actual is 52. Fixed.
- **P3R3-G6 — `mockEnv.clipboard.writeText` reset in
  `mockActions.test.ts` `beforeEach`** — prevents leaked calls from
  one test polluting another's assertion counts.
- **P3R3-G7 — `MockCompletion` documentation content assertion.**
  Was `expect(documentation).toBeDefined()` — now also asserts the
  markdown contains the key phrases ("Read-only", "APICircle: New
  Mock"). Guards against silent regression to an empty MarkdownString.

**Phase 3 round 3 tally: 536 tests across 64 files** (up from 533).
`pnpm check` + `pnpm lint` + knip clean. No schema changes.

### Phase 3 round 4 — 5 honest gaps closed (one security fix)

Round 4 audit produced 5 gaps. Trajectory continues: 12 → 9 → 7 → 5.
One of them was a **load-bearing security gap** that none of R1/R2/R3
surfaced — end-to-end audits catch what per-round audits miss.

- **P3R4-G3 — Mock spec preview removed from YAML (SECURITY).** The
  Phase 3 baseline emitted `source.specPreview` — the first 4096 chars
  of the raw OpenAPI / Postman / Insomnia source — into every
  `.mock.yaml` virtual document. Specs commonly carry bearer tokens or
  API keys in `security.example` blocks; any such secret was being
  committed to Git via the workspace document. Now the YAML emits only
  `source.kind` + `source.format` + `source.bytes` (the length). The
  raw spec stays in `workspace.json` (read by the parser at start
  time) but never round-trips through the human-edited YAML. New
  `mockYaml.test.ts` test pins the contract: a token in
  `security.example` is provably not in the serialized output.
- **P3R4-G1 — Test coverage for `findTrackedByServerId` fallback.**
  The R3-G2 fallback (cross-workspace match) had no test. Added two:
  one verifying the preferred-branch doesn't emit the log, one
  verifying the fallback returns the right entry AND emits the log
  with the workspace-mismatch detail.
- **P3R4-G4 — Multi-workspace concurrent mocks test.** New test starts
  the same serverId in two different workspaces, asserts both are
  namespaced differently in the underlying `InProcessMockController`,
  and that stopping one in workspace B doesn't affect the running
  mock in workspace A.
- **P3R4-G5 — Injectable logger.** `VsCodeMockControllerDeps` now
  accepts an optional `log?: (message: string) => void` (defaults to
  `console.warn`). Tests inject `vi.fn()` to assert on log payloads
  without polluting test stdout. Phase 4 will swap the default for the
  `APICircle Runs` OutputChannel.
- **P3R4-G2 — Real end-to-end statusBar↔controller wire test.** The
  R3-G3 wire test used an ad-hoc controller object. New test imports
  the real `VsCodeMockController` and verifies the actual onChange
  subscription path end-to-end, including reconcile.

**Phase 3 round 4 tally: 541 tests across 64 files** (up from 536).
`pnpm check` + `pnpm lint` + knip clean. No schema changes to public
data contract — `MockServer` shape unchanged; the YAML projection
change is purely cosmetic (read-only field that wasn't round-trippable
anyway).

### Phase 3 round 5 — 5 honest gaps closed (R4 cascade + UX + compat)

Round 5 audit found 5 gaps. Four of them were **cascade from the R4
security fix** (specPreview → bytes left the schema and docs claiming
the old shape) plus one standalone UX gap that surfaced for the first
time. All closed:

- **P3R5-G1 — `apicircle-mock.schema.json` updated.** The JSON Schema
  emitted `specPreview: { type: string }`; replaced with
  `bytes: { type: integer, minimum: 0 }` so `yaml.validate` matches the
  actual emitter output. Old YAML files with `specPreview` will now
  warn, which is correct — they'd round-trip to `bytes` on the next
  save anyway.
- **P3R5-G2 — `docs/apicircle-yaml-format.md` example updated.** Mock
  YAML example now shows `bytes: 4521` and explains the secret-safety
  rationale inline. Field table extended to enumerate
  `source.kind` / `source.format` / `source.bytes` with the redaction
  note.
- **P3R5-G3 — Three-surface compat test for the FS-write update
  path.** The "user edits `.mock.yaml`, FS provider fires `mock.upsert`
  preserving the existing source + endpoints" flow is now covered by
  the cross-provider invariant gate. Test seeds an OpenAPI mock with a
  non-trivial endpoint list, applies a partial-update patch through
  both desktop + Git providers, and asserts byte-identical state.
- **P3R5-G4 — Wizard accepts file-path source.** `apicircle.newMock`
  step 2 now branches: "Read from file…" opens a native file picker
  (`vscode.window.showOpenDialog` with format-appropriate filters), or
  "Paste content" falls back to the single-line `showInputBox`.
  Realistic specs (multi-line OpenAPI YAML, kilobyte Postman JSON) now
  import cleanly. 3 new tests cover the file path, the cancel case,
  and the unreadable-file error toast.
- **P3R5-G5 — `OutputChannel` logger.** `activate()` creates a dedicated
  "APICircle Mock" `OutputChannel` and passes its `appendLine` to
  `VsCodeMockController` as the `log` dep. Cross-workspace-fallback
  warnings now land somewhere user-discoverable instead of
  `console.warn`. Channel is registered to
  `context.subscriptions` for clean dispose.

**Phase 3 round 5 tally: 545 tests across 64 files** (up from 541).
`pnpm check` + `pnpm lint` + knip clean. No public-data-contract
schema changes; the `apicircle-mock.schema.json` change is the
projection schema (a VS Code yamlValidation manifest), not the
workspace data contract.

### Phase 3 round 6 — 4 honest gaps closed (convergence reached)

Round 6 produced 4 gaps. Trajectory: 12 → 9 → 7 → 5 → 5 → 4. None
were correctness/security issues; all 4 are test-coverage and UX
polish — the audit has reached its convergence floor. Closed:

- **P3R6-G1 — Test for method-pick dismissal in `newMockCommand`.**
  R5-G4 added a paste-vs-file QuickPick (step 2) but the dismissal
  path was uncovered. New test verifies the wizard exits cleanly when
  the user dismisses step 2 — no content prompt, no file picker, no
  mock created. Also surfaced and fixed a related test-isolation bug:
  `showOpenDialog` wasn't being reset in `beforeEach`, so prior
  tests' calls leaked into later assertions.
- **P3R6-G2 — `docs/qa/README.md` Unit row refreshed.** Now 52 suites
  / ~507 tests with the post-R5 closures (file-path wizard, source
  redaction, FS-write three-surface compat, OutputChannel logger)
  enumerated.
- **P3R6-G3 — `MockHoverProvider` handles `bytes:` line.** R5-G1
  introduced `bytes:` as the spec-projection field; hovering on it
  now shows a documentation hover explaining the secret-safety
  rationale ("📏 Source spec size: N bytes — the raw spec lives in
  workspace.json…"). Helps users who'd otherwise wonder where the
  spec went. New test pins the hover content.
- **P3R6-G4 — OutputChannel lazy-create.** R5-G5 unconditionally
  created the `APICircle Mock` channel at activation. Now created on
  first `log()` call so users who never hit the fallback path don't
  see an empty channel in VS Code's picker. The channel is
  registered to `context.subscriptions` at creation time for clean
  dispose.

**Phase 3 round 6 tally: 547 tests across 64 files** (up from 545).
`pnpm check` + `pnpm lint` + knip clean. Cross-package monorepo gate
clean at **3280 tests across 304 files**. The audit discipline has
reached steady state — Phase 3 is genuinely done.

### Phase 3 full audit — 13 closures across 2 batches

Following the per-round closures, an end-to-end audit found 13 more
gaps (HARD 3 / MEDIUM 6 / SOFT 4). All closed in this final pass:

- **F-G1 — E2E specs for Phase 3.** Three new specs added to
  `e2e/vscode/src/test/`: `3-mock-view.test.ts` (view registration +
  focus + command presence), `3-mock-yaml.test.ts` (language
  contribution + error handling for unknown URIs), `3-mock-lifecycle.test.ts`
  (command-id resolution). Picked up automatically by the existing
  Mocha glob in `index.ts`.
- **F-G2 — Real Hono lifecycle integration test.** New
  `test/integration/mockLifecycle.test.ts` — 5 tests that exercise
  the actual `InProcessMockController` (no mocks). Imports a real
  Petstore OpenAPI spec, starts a Hono server on a free port, hits
  `GET /pets` with fetch, asserts 200, stops cleanly, verifies the
  port is reclaimed. Catches mock-server-core ↔ VS Code regressions
  the heavily-mocked unit suite can't see.
- **F-G3 — Dynamic-import parsers.** `parseSourceToEndpoints` is now
  imported on demand inside the wizard, not at activation. In ESM-
  bundled environments this would code-split; in our CJS tsup bundle
  it's a no-op for bytes but cleaner for activation-time evaluation.
  Bundle is at 1.85 MB (under the 2 MB CI gate); further compression
  is Phase 4 work when more deps land.
- **F-G4 — Keybindings for mock lifecycle.** F6 starts the focused
  mock, Shift+F6 stops, Ctrl/Cmd+Shift+F6 restarts. Symmetric with
  Phase 2's plan-run keybinding (F6).
- **F-G5 — File size warning.** Wizard's file-pick path now `fs.stat`s
  before reading; specs over 10 MB prompt the user to confirm. Real
  enterprise OpenAPI specs cap around 5-8 MB; anything bigger is
  usually a wrong file.
- **F-G6 — HTTP URL support.** Step 2 of the wizard gains "Fetch from
  URL…" alongside "Read from file…" and "Paste content". Common
  pattern: `https://petstore.swagger.io/v2/swagger.json`. Uses
  global `fetch` (Node 18+); surfaces fetch errors as toasts.
- **F-G7 — Pre-fill name from spec metadata.** Best-effort parse of
  `info.title` (OpenAPI JSON), `info.name` (Postman), or
  `resources[].workspace.name` (Insomnia) for the name field default.
  Silent fallback to blank on parse error — never throws.
- **F-G8 — MockHover documents CORS.** Hovering on `cors.enabled` or
  `origins` inside the cors block shows the Hono semantics inline
  ("Empty + enabled = reflect any Origin", etc.). Uses an
  `isInsideCorsBlock` walk-back helper.
- **F-G9 — `VsCodeBridge.onDidChangeActiveWorkspace` event.** New
  event fired on `setActive` when the id actually changes. Status bar
  subscribes so multi-root workspace switches refresh instantly. 1
  new test pins the contract (fires on change, no-op on same id,
  dispose works).
- **F-G10 — CHANGELOG Phase 4 forward-look** (this section).
- **F-G11 — FS-delete via deleteMock command test.** The
  `mockLifecycle.test.ts` integration suite includes a test that
  starts a mock then invokes `deleteMockCommand` with a confirmed
  warning — verifies the mock is stopped AND the definition removed.
  Also a test exercising the FS provider's `delete()` path directly.
- **F-G12 — MockCodeLens subscribes to controller.onChange.** The
  ▶ Start ↔ ■ Stop lens flips instantly on start/stop/restart
  without waiting for VS Code's periodic CodeLens refresh tick.
  MockCodeLensProvider now implements `vscode.Disposable` to clean
  up the subscription.
- **F-G13 — `apicircle.openMockInBrowser` command.** Wired to the
  `mock-running` context menu — fires `vscode.env.openExternal` on
  `http://localhost:<port>` so users don't have to copy URLs from
  the tree label or status bar.

### Phase 4 — what's queued

Phase 4 ships the secrets vault + MCP host integration:

- **Secret vault** — passphrase-based AES-GCM unlock surfacing in
  the Environment view; `apicircle.openVaultEntry` for encrypted
  variables (placeholder today). Wires `apicircle.secrets.autoLockMinutes`
  and `apicircle.secrets.clipboardClearSeconds` settings that are
  currently flagged as "Phase 4 — not yet implemented".
- **MCP host integration** — VS Code becomes a first-class MCP host
  alongside Desktop / CLI. Surfaces the same 78-tool catalog through
  an in-extension stdio bridge so Claude Code / Cursor / Copilot
  configs can target the VS Code workspace.
- **APICircle Runs OutputChannel** — the streaming log channel
  Phase 2 deferred. Replaces the per-feature OutputChannels (mock,
  history) with a unified surface.
- **Plan Notebooks + Testing tab** — `vscode.NotebookController` for
  plan execution and `vscode.tests.createTestController` for the
  Testing UX.
- **Bundle code-splitting** — if Phase 4 deps push above the 2 MB
  CI gate, tsup `splitting: true` + lazy-loaded parsers.

**Phase 3 full-audit closure tally: 555 tests across 65 files**
(up from 547 at end of R6). `pnpm check` + `pnpm lint` + knip clean.
Bundle 1.85 MB (under the 2 MB CI gate). No public-data-contract
changes. Phase 3 is **conclusively done**.

### Begin VS Code extension (Phase 1 day-1 PR — apps/vscode/ scaffold)

- **`apps/vscode/` package created** — peer to `apps/web/` and
  `apps/desktop/`. Targets VS Code `^1.85.0`, Node 20+. Ships as
  `@apicircle/vscode` (private workspace package; future marketplace ID
  `apicircle.apicircle-vscode`). Build via `tsup` to a single CJS bundle;
  `vscode` is `external` (provided by the host at runtime), every
  `@apicircle/*` workspace dep is bundled. Manifest contributes a single
  Activity Bar icon (monochrome SVG using `currentColor` so VS Code can
  re-tint it per theme), seven sidebar views (Editor, Environment,
  Execution, Mock, History, MCP, Marketplace — the last gated by
  `apicircle.enableMarketplace` config), a `viewsWelcome` for the first-run
  experience, ten contributed settings spanning execution / history /
  mock / MCP / editor / secrets / telemetry / marketplace, and six commands
  (`createWorkspace`, `newRequest`, `sendRequest`, `cancelSend`,
  `openWorkspaceFile`, `refresh`). The seven views are TreeData-backed
  with empty-array stubs in this PR; population lands in subsequent
  Phase 1 commits.
  (`apps/vscode/package.json`, `apps/vscode/tsconfig.json`,
  `apps/vscode/tsup.config.ts`, `apps/vscode/media/icon-activitybar.svg`,
  `apps/vscode/src/views/*.ts`)
- **`VsCodeBridge` host façade** — the in-process analogue of the desktop
  app's Electron main process. Owns the disk-backed
  `FileBackedWorkspaceProvider` per workspace (`registerWorkspace` is
  idempotent), tracks the active workspace via `context.globalState`, and
  ships `createWorkspaceScaffold` for the `APICircle: Create New Workspace`
  command — scaffolds `.apicircle/workspace.json`, the `attachments/`
  folder, and an auto-generated `.apicircle/README.md` that explains the
  folder to teammates. Also appends defensive entries to the repo's
  `.gitignore` (`workspace.local.json`, `.apicircle/.local/`,
  `.apicircle/.lock`) — idempotent on re-run. Future phases attach the
  mock controller (Phase 3), MCP host (Phase 4), and secret storage
  (Phase 4) to this same façade without changing existing call sites.
  (`apps/vscode/src/host/vscodeBridge.ts`)
- **Workspace discovery** — `discoverWorkspaces` scans every open VS Code
  workspace folder for canonical `.apicircle/workspace.json` files,
  partitions them into "discovered" vs "folders without a workspace yet"
  (so the welcome view can offer `Create New Workspace` in the right
  places). `deviceLocalPath` produces a stable hash-based path inside
  `context.globalStorageUri` keyed off the workspace's `.apicircle/`
  absolute path — case-insensitive and slash-normalized for Windows
  interoperability. Per the locked Phase 1 decision, this device-local
  path is not user-configurable.
  (`apps/vscode/src/util/workspaceDiscovery.ts`)
- **First-run flow** — when the user clicks the Activity Bar icon with no
  `.apicircle/workspace.json` in any open folder, the Editor view renders
  a `viewsWelcome` card pointing at `Create New Workspace` and
  `Open Folder…`. When the canonical layout is detected, the workspace is
  auto-registered with the bridge and the previously-active workspace
  (remembered in `globalState`) is restored — or the first discovered one
  if there's no prior selection. Re-discovery fires whenever VS Code's
  workspace folders change (multi-root add/remove).
  (`apps/vscode/src/extension.ts`, `apps/vscode/src/commands/createWorkspace.ts`)
- **Vitest harness** — `vitest.config.ts` aliases the `vscode` module to a
  hand-rolled `test/mocks/vscode.ts` mock that covers `window`,
  `workspace`, `commands`, `languages`, `env`, `Uri`, `EventEmitter`,
  `TreeItem`, `ThemeIcon`, `FileSystemError`, and `ExtensionContext` —
  every surface the day-1 PR's production code touches. Unit suites
  shipped: `workspaceDiscovery` (single/multi-root/empty/half-baked
  layouts, device-local path determinism, owning-workspace lookup),
  `vscodeBridge` (idempotent register, listWorkspaces, setActive
  validation, scaffold creation, scaffold-overwrite guard, idempotent
  `.gitignore` append, dispose), `BaseTreeView` (refresh event wiring).
  E2E coverage via `@vscode/test-electron` lands in subsequent Phase 1
  commits.
  (`apps/vscode/vitest.config.ts`, `apps/vscode/test/mocks/vscode.ts`,
  `apps/vscode/src/**/*.test.ts`)
- **Three-surface principle** documented in `apps/vscode/README.md` —
  one `.apicircle/workspace.json`, three peer clients (Web, Desktop,
  VS Code), byte-identical commits.

### apicircle: FileSystemProvider with YAML projection (Phase 1 MVP)

- **`apicircle:` virtual filesystem scheme registered** — each request
  in the active workspace becomes a virtual document at
  `apicircle://<workspaceAuthority>/requests/<requestId>.req.yaml`. VS
  Code opens these as real text editor tabs with the user's native theme,
  keybindings, find/replace, multi-cursor, and (when later phases land)
  CodeLens / Inlay Hints / Diagnostics. The underlying JSON file at
  `.apicircle/workspace.json` is updated atomically by the
  `WorkspacePatch` choke point — VS Code's Source Control panel sees one
  reviewable diff per save, no per-surface dialect.
  Authorities are base64url-encoded to fit VS Code's URL-safe authority
  constraint while still mapping back to the source `.apicircle/`
  directory path on read.
  (`apps/vscode/src/fs/apicircleFsProvider.ts`)
- **YAML projection for `Request`** — bidirectional serializer between
  the canonical JSON shape and a human-friendly YAML document. Omits
  empty optional fields so diffs stay minimal; strips read-only system
  fields (`id`, `createdAt`, `updatedAt`, `folderId`, `bodySchemaId`,
  `graphqlSchemaId`) so users can't accidentally break referential
  integrity by editing them. The parser collects non-fatal issues as
  warnings (malformed KV rows, unknown keys), throws
  `RequestYamlParseError` on syntactically invalid YAML or missing
  required fields (`name`/`method`/`url`). Defaults `auth` and `body`
  to `{ type: 'none' }` when the user removes them.
  (`apps/vscode/src/fs/requestYaml.ts`)
- **`GitWorkspaceProvider`** — VS Code-specific
  `WorkspaceProvider` implementation that reads/writes the canonical
  `.apicircle/workspace.json` (the Git-tracked filename) plus a
  separately-located `workspace.local.json` under
  `<vscode.globalStorageUri>/<workspaceHash>/`. Differs from
  `FileBackedWorkspaceProvider` in three ways: canonical Git filename
  (not `workspace.synced.json`), split synced/local directories,
  proper-lockfile coordination still on the synced file so external
  MCP/CLI writers serialize cleanly. **TODO Phase 0 followup**:
  unify both providers behind a single configurable abstraction —
  flagged in the source.
  (`apps/vscode/src/host/gitWorkspaceProvider.ts`,
  `apps/vscode/src/host/vscodeBridge.ts`)
- **24 new tests** across three new suites:
  - `requestYaml.test.ts` (12 tests) — serialization output shape,
    header comment, read-only field omission, populated-field emission,
    method uppercasing, round-trip fidelity, parser error taxonomy,
    auth/body default synthesis, malformed-row warning capture
  - `apicircleFsProvider.test.ts` (10 tests) — URI construction,
    readFile YAML serialization, FileNotFound on missing request and
    unknown workspace, writeFile name-edit round-trip to disk, invalid
    YAML rejection, missing-field rejection, delete persistence, rename
    refusal with helpful message, createDirectory refusal
  - Round-trip integration tests demonstrating the full
    YAML→`applyMutation`→`workspace.json` pipeline
- **Bundle size confirmed lean** — extension bundle is now 73 KB CJS
  (down from 1.29 MB after the FS provider PR, because the in-process
  `GitWorkspaceProvider` doesn't pull the full MCP-server surface as
  the `FileBackedWorkspaceProvider` import path did).

### Phase 1 MVP — Editor view, send, response viewer, diagnostics, status bar, wizard, CodeLens

- **Editor TreeView wired to workspace data** — replaces the day-1 empty
  stub. Renders folder/request hierarchy from `synced.collections.tree`,
  derives non-root folder children from `folders[].parentId` and
  `requests[].folderId` (mirroring the desktop's `childrenByFolder`
  pattern), sorts alphabetically across kinds, decorates HTTP methods with
  color-themed `circle-filled` icons (GET=green, POST=orange, PUT=blue,
  PATCH=yellow, DELETE=red, HEAD/OPTIONS=purple). Clicking a request fires
  `vscode.open` against its canonical `apicircle://` virtual YAML. Handles
  deleted-upstream folders and requests gracefully with `(deleted)`
  placeholder labels. Wired in `extension.ts` to refresh every view when
  any open folder's `.apicircle/workspace.json` changes externally (Git
  pull, CLI write, MCP server, hand-edit).
  (`apps/vscode/src/views/EditorView.ts`, 9 unit tests)
- **Request execution + response viewer** — `apicircle.sendRequest`
  command. Resolves the target from the active editor's `apicircle://`
  URI if one is open, otherwise falls back to a QuickPick over the
  workspace's requests. Runs through `executeRequest` from
  `@apicircle/core` with the bridge's `AbortRegistry`-issued signal. On
  success: runs the request's assertions via `runAssertions`, formats the
  result via `formatResponseDocument` as a YAML document (status / headers
  / assertions / extracted / authWarnings / body sections with content-
  type-correct rendering), opens beside the source editor. On cancel:
  Information toast. On error: Error toast. Test-only `execute` /
  `openResponse` hooks let unit tests drive the full flow with mock
  results.
  (`apps/vscode/src/execute/sendRequest.ts`, 7 unit tests)
- **`AbortRegistry`** — per-extension registry of in-flight send
  AbortControllers, keyed by run id. `register(runId)` returns the
  signal, `complete(runId)` removes it after successful completion,
  `cancel(runId)` aborts a specific send, `cancelAll()` aborts every
  active send (used by `apicircle.cancelSend` command and during
  deactivate). `hasActive()` and `active()` drive the status-bar cancel
  pill. 5 unit tests pin the contract including the "complete after
  cancel" no-op semantics and the cancel-all return count.
  (`apps/vscode/src/execute/abortRegistry.ts`)
- **Response document formatter** — `formatResponseDocument` produces a
  human-readable YAML projection of an `ExecutionResult`. Summary section
  with status / duration / size / final URL, lowercased response headers
  (consistency across surfaces), optional assertions / extracted variables
  / auth-warnings sections, body verbatim with content-kind annotation.
  Network errors render as `"Network error"` with the captured `error`
  string. Truncated responses (50 MB cap from `executeRequest`) surface a
  `truncatedAt` field. 8 unit tests.
  (`apps/vscode/src/execute/responseDocument.ts`)
- **Pre-send validation diagnostics** — `PreSendDiagnostics` wires
  `preSendValidation` from `@apicircle/core` into VS Code's Problems
  panel. Subscribes to `onDidOpenTextDocument`, `onDidChangeTextDocument`,
  `onDidCloseTextDocument` on `apicircle://**/requests/*.req.yaml` URIs.
  Parses each document via the YAML projection, synthesizes a full
  Request shape (read-only fields from URI), builds a `ResolutionScope`
  from the active workspace's environments (excluding encrypted slots —
  Phase 4 vault hooks in later), and reports `warnings` as
  `DiagnosticSeverity.Warning` and `blockers` as `.Error`. Invalid YAML
  surfaces as a single Error diagnostic at line 0. `hasBlocker(uri)`
  helper lets `sendRequest` refuse execution when `validateOnSend` is
  on. 5 unit tests cover the scheme filter, YAML parse failure path,
  unresolved-variable detection, blocker query, and close cleanup.
  (`apps/vscode/src/diagnostics/preSendDiagnostics.ts`)
- **Status bar items** — `StatusBar` registers two items pinned to the
  left side. The workspace item (priority 100) shows
  `🟣 <workspace-label> · env: <active-env>` and is clickable to open
  `.apicircle/workspace.json`. The cancel item (priority 99) is hidden by
  default and appears as `⏹ Cancel send (<count>)` when the
  `AbortRegistry` has active sends — clicking it runs
  `apicircle.cancelSend`. A 500ms cheap poll drives the cancel-item
  visibility refresh; replaceable with an event emitter when the registry
  needs eventing for other features. 5 unit tests with `vi.fn`-based
  status-bar item mocks.
  (`apps/vscode/src/status/statusBar.ts`)
- **`APICircle: New Request` QuickPick wizard** — 5-step flow: method
  (QuickPick over the 7 HTTP methods) → URL (InputBox with non-empty
  validation) → folder (QuickPick over top-level + existing folders) →
  auth (QuickPick over None / Bearer / Basic / API Key with conditional
  credential prompts) → name (InputBox pre-filled with `<METHOD> <path>`
  default). Creates the request through `applyMutation`'s
  `request.create` patch, opens its `apicircle://` YAML for immediate
  editing. Each step's dismissal cancels the wizard gracefully without
  partial state. 6 unit tests cover the full flow including cancellation
  paths and the bearer-credentials branch.
  (`apps/vscode/src/commands/newRequest.ts`)
- **Send CodeLens** — `RequestCodeLensProvider` registers against
  `{scheme: 'apicircle', pattern: '**/requests/*.req.yaml'}`. Scans for
  the first `name:` line in the document and renders `▶ Send` above it,
  bound to `apicircle.sendRequest`. Only ONE lens per document — later
  `name:`-prefixed lines in nested YAML or comments don't trigger
  duplicates. Phase 5 (language services pass) adds the `📋 Copy as cURL`
  and `📝 Generate Code` companions; the structure is in place. 6 unit
  tests cover the URI scheme filter, file pattern filter, single-lens
  guarantee, name-absent case, and the event emitter refresh.
  (`apps/vscode/src/lang/requestCodeLens.ts`)
- **Three-surface compatibility test** (Phase 1 invariant gate) — applies
  the same `request.create` patch through both `FileBackedWorkspaceProvider`
  (desktop disk-mirror layout, `workspace.synced.json` +
  `workspace.local.json` in one dir) and `GitWorkspaceProvider` (VS Code's
  canonical `.apicircle/workspace.json` + separately located local file).
  Asserts the resulting `synced` documents are byte-identical modulo
  apply-time timestamps (`canonicalize` helper). A second test covers
  sequential patches (`create` + `create` + `update`) producing identical
  end states. A third test verifies `applyMutation` itself is determin-
  istic. This is the gate that catches any future per-surface dialect
  drift before merging. 3 tests.
  (`apps/vscode/test/integration/threeSurfaceCompat.test.ts`)
- **Live-GitHub E2E harness** — `e2e/vscode/src/test/live-github.test.ts`
  scaffold. Opt-in via `APICIRCLE_E2E_LIVE_GITHUB=1` env var plus
  `APICIRCLE_E2E_GITHUB_PAT` / `APICIRCLE_E2E_GITHUB_REPO`. Mirrors the
  web suite's `test:e2e:live-github` pattern. Phase 1 ships the harness
  scaffolding with skipped placeholder tests; Phase 2 fills in the
  git-pull → watcher → TreeView refresh coverage; Phase 8 wires the
  linked-workspace authentication path. New `test:e2e:live-github` script
  in the e2e-vscode `package.json`.
  (`e2e/vscode/src/test/live-github.test.ts`, `e2e/vscode/README.md`)

**Phase 1 test count: 107 tests across 15 files** (up from 53 at end of
day-1 PR). All four tiers green: unit · integration · E2E harness · three-
surface compat. Bundle 445 KB CJS (up from 73 KB after FS provider PR
because `executeRequest` + `runAssertions` + `preSendValidation` +
`buildScope` from `@apicircle/core` now bundle in too). Monorepo-wide
`pnpm check` clean across all 19 packages.

### Phase 1 gap-closure round — 8 hard + 4 deferred gaps closed

Post-Phase-1 audit surfaced gaps between claimed and actual delivery. All
closed in this round:

- **Gap #1 — `apicircle-request` language registration.** Added
  `contributes.languages` entries for `.req.yaml` (id
  `apicircle-request`) and `.run.yaml` (id `apicircle-response`),
  `contributes.yamlValidation` pointing at the new
  `schemas/apicircle-request.schema.json` (Draft-07 JSON Schema covering
  every field with the canonical 17-auth-type enum, 8-body-type enum,
  4-assertion-kind enum, 6-operator enum), `language-configuration.json`
  with YAML comment/bracket/indentation rules. Pragmatic
  `RequestCompletionProvider` registered on `*.req.yaml` URIs detects
  YAML branch context (root/auth/body/assertions/extractions) by
  scanning backward for the last non-indented key, then emits enum
  completions on `method:` / `auth.type:` / `body.type:` /
  `assertions[].kind:` / `assertions[].op:` /
  `extractions[].source:` lines. 10 unit tests pin every branch + the
  scheme/file filters + the root-level `type:` non-collision.
  (`apps/vscode/schemas/apicircle-request.schema.json`,
  `apps/vscode/language-configuration.json`,
  `apps/vscode/src/lang/requestCompletion.ts`)
- **Gap #2 — Response viewer via `apicircle:` FileSystemProvider.**
  `ApicircleFsProvider` now handles `responses/<runId>.run.yaml` URIs
  with an in-memory `responseStore` Map. `stat` / `readFile` /
  `writeFile` (idempotent on responses) all support the new URI kind.
  `sendRequest` calls `fsProvider.storeResponse(runId, content)` then
  `vscode.workspace.openTextDocument(uri)` — the response gets a real
  URI, opens beside the source, persists across the session, and is
  navigable from history. Untitled-document fallback retained for the
  test-injected `openResponse` hook. `ApicircleFsProvider.responseUri`
  helper added for symmetry with `requestUri`.
  (`apps/vscode/src/fs/apicircleFsProvider.ts`,
  `apps/vscode/src/execute/sendRequest.ts`)
- **Gap #3 — `validateOnSend` enforcement.** `sendRequestCommand` now
  accepts a `diagnostics?: PreSendDiagnostics` dep. When the active
  workspace has a request URI AND the
  `apicircle.validation.validateOnSend` setting is true (the default)
  AND `diagnostics.hasBlocker(uri)` returns true, the send is refused
  with an error toast pointing to the Problems panel. Wired in
  `extension.ts` so the default install behavior protects users from
  sending requests with unresolved variables or unparseable URLs.
- **Gap #4 — Esc keybinding for cancel.** `contributes.keybindings`
  entry for `apicircle.cancelSend` bound to `escape` with the
  `when: editorTextFocus && resourceScheme == 'apicircle'` clause —
  Esc cancels only when the focused editor is an apicircle: virtual
  document, leaving normal Esc behavior intact everywhere else.
- **Gap #5 — TreeView context menu items.** Three new commands
  contributed: `apicircle.deleteRequest` (with confirmation modal +
  delete via `request.delete` patch), `apicircle.duplicateRequest`
  (deep-clones via `request.create` patch with new id + `(copy)`
  suffix + opens the duplicate), `apicircle.revealInSource` (opens
  `.apicircle/workspace.json` and scrolls to the request's id). All
  three contribute to `view/item/context` scoped by `viewItem ==
request`. Each command also works from the palette via the
  fallback "use active apicircle: editor's id" code path. 8 unit
  tests cover the confirmation paths, missing-workspace warnings,
  and the duplicate's id-renewal + name-suffix contract.
  (`apps/vscode/src/commands/requestActions.ts`)
- **Gap #6 — Three-surface tests for folder/env/mock.** Original
  Phase 1 plan called for byte-identical assertions on 4 entity
  kinds (`request.create`, `folder.create`, `environment.upsert`,
  `mock.upsert`). The first round shipped 2; this round closes the
  remaining 2. Each new test instantiates both providers
  side-by-side, applies the canonical patch, normalizes apply-time
  timestamps via the `canonicalize` helper, and asserts the
  resulting `synced` JSON is byte-identical AND `changedIds` match.
  Suite now has 6 tests covering the full Phase 1 mutation matrix.
- **Gap #7 — E2E suite split into 6 named specs.** Original
  `smoke.test.ts` (3 tests) split into the 6 Mocha files the plan
  called for: `1-mvp.test.ts` (activation budget + view container
  focusability), `1-new-request.test.ts` (command registration +
  wizard placeholder), `1-create-workspace.test.ts` (scaffold
  flow), `1-cancel.test.ts` (cancel command + Esc behavior),
  `1-validation.test.ts` (FS provider scheme + blocker refusal),
  `1-multi-root.test.ts` (multi-workspace discovery). Live
  functional E2E (requiring QuickPick mocking + workspace-folder
  programmatic add) lands in Phase 2 when the harness matures;
  Phase 1 ships the structure + registered-command assertions plus
  documented `this.skip()` for the harness-pending cases.
- **Gap #8 — `docs/apicircle-yaml-format.md` written.** New
  comprehensive reference covering: URI scheme map, required vs
  optional vs read-only field discipline, all 17 auth schemes with
  YAML examples, 8 body types with content-shape notes, assertion
  kinds/ops/targets, extraction sources, variable resolution
  precedence (per-request → global context → active env → priority
  overlay → secrets), round-trip discipline, and the cross-surface
  guarantee with a pointer to the three-surface test.
  (`docs/apicircle-yaml-format.md`)

**Deferred items also closed:**

- `viewsWelcome` contributions for the other 6 sidebar views
  (Environment / Execution / Mock / History / MCP / Marketplace),
  each with a "ships in Phase X" message so first-time users see
  product context rather than blank panels.
- Status bar **Vault** placeholder item at priority 98 (between
  workspace and cancel) showing `$(unlock) Vault` while a
  workspace is active. Phase 4 wires the actual `SecretStorage`
  lock state; Phase 1 ships the discoverability affordance + the
  show/hide semantics.
- Activation performance benchmark
  (`test/integration/activationPerf.test.ts`) — three cases:
  empty workspace under 100ms, 100-request workspace under 500ms,
  500-request workspace under 1000ms. The vitest Node-environment
  caps are lenient versus the real <200ms target the extension
  host achieves; this test guards against runaway regressions.
- `knip` configuration tightened (`knip.json` gains explicit
  `apps/vscode` + `e2e/vscode` blocks with the host-supplied
  `vscode` module noted as an `ignoreDependencies` entry).
  Unused `@apicircle/mock-server-core` dependency removed from
  `apps/vscode/package.json` (Phase 3 will re-add it once
  mock-server lifecycle work begins). Unused
  `__decodeAuthorityForTests` and `applyMutation` re-exports
  pruned. `@vscode/test-electron` moved out of `apps/vscode`
  devDeps (it belongs solely in `e2e/vscode`).

**Post-gap-closure tally: 129 tests across 18 files** (up from 107).
All four tiers green. `pnpm check` clean monorepo-wide. `pnpm lint`
clean (0 errors). `npx knip` clean for apps/vscode + e2e/vscode.
Bundle 454 KB CJS (negligible change). The Phase 1 plan now matches
the shipped artifact field-for-field, with no remaining hard or
deferred gaps carrying into Phase 2.

### Phase 2 round 1 — Environments, History, Snapshots, Plans (TreeView + Run)

- **Environment YAML projection** — bidirectional serializer at
  `apps/vscode/src/fs/envYaml.ts`. Header comment explains encrypted
  variables travel through Git as ciphertext (decryption is Phase 4).
  Plaintext variables omit the `encrypted: false` field in YAML for
  minimal diffs; encrypted variables surface `encrypted: true` plus
  the `secretKeyId` slot id. Parser tolerates malformed rows as
  warnings, throws `EnvYamlParseError` for invalid YAML or missing
  required fields. 13 unit tests.
- **Environment view wired** — `apps/vscode/src/views/EnvironmentView.ts`
  shows every environment as a root node, variables as children. Active
  env decorated with `check` icon + "active" description. Encrypted
  variable values masked (`••••<last4>`); plaintext shown verbatim.
  Click an env → opens its `.env.yaml` virtual document via the
  FS provider. 10 unit tests.
- **Environment commands** —
  `apicircle.setActiveEnvironment` (QuickPick with "None" option),
  `apicircle.newEnvironment` (InputBox with duplicate-name guard,
  opens new env's YAML), `apicircle.deleteEnvironment` (confirmation
  modal, contributes `9_danger` group in view/item/context). All wired
  to `view/title` and `view/item/context` menu entries. 8 unit tests.
- **`apicircle:` FileSystemProvider extended** for `environments/<name>.env.yaml`
  - `history/<runId>.run.yaml` URI kinds. Two new URL helpers:
    `ApicircleFsProvider.environmentUri()` and `.historyUri()`. In-memory
    `historyStore` caches formatted run documents so HistoryView clicks
    open instantly.
- **History view wired** — `apps/vscode/src/views/HistoryView.ts`. Two
  buckets: Recent Requests + Recent Plans. Verdict icons (✓/✗/◦) color-
  themed via VS Code chart palette. Newest-first ordering. Per-row
  tooltip with method, URL, status text. Click a run → opens its
  formatted YAML through the FS provider's historyStore.
- **History document formatter** — `formatRequestRunDocument` +
  `formatPlanRunDocument`. RequestRun renders summary / requestHeaders
  / requestBody (when non-null) / responseHeaders / assertions /
  responseBody-with-content-kind annotation. PlanRun renders
  per-step rows joined to each step's RequestRun for method/URL/status
  context. 12 unit tests.
- **Request runs persisted to history** — `sendRequestCommand` now
  invokes `persistRequestRun` after a successful send. Captures the
  exact ExecutionResult shape, truncates body previews at
  `RUN_BODY_PREVIEW_LIMIT` (64 KB), filters disabled request headers
  out of the snapshot, respects `apicircle.history.maxEntriesPerWorkspace`
  setting for eviction. 7 unit tests.
- **Snapshot lifecycle** —
  `apicircle.captureSnapshot` (InputBox note → `snapshot.capture` patch),
  `apicircle.restoreSnapshot` (QuickPick + confirmation + safety snapshot
  before restore so the restore itself is reversible),
  `apicircle.deleteSnapshot` (confirmation modal). 6 unit tests pin
  the safety-snapshot-before-restore contract.
- **Execution view wired** — `apps/vscode/src/views/ExecutionView.ts`.
  Plans as roots with step count, steps as children with order number
  - request name + method. Disabled steps (`enabled: false`) render
    dimmed with `circle-small-outline` icon. Handles missing-request
    references gracefully. 7 unit tests.
- **Plan execution** — `apicircle.runPlan` command + `view/item/context`
  inline action for plan rows. Runs the plan via `runPlan` from
  `@apicircle/core` (same engine as Desktop + CLI + MCP) with assertions
  enabled, `ANONYMOUS_ACTOR` identity, `withProgress` notification.
  Persists the returned `nextState` to disk — that's where `runPlan`
  appends the PlanRun + per-step RequestRuns to `WorkspaceLocal.history`.
- **`WorkspaceSurface.write()` exposed** — third method on the surface
  interface alongside `read()` and `apply()`. Used for state that
  doesn't yet have a `WorkspacePatch` variant (history.append_run,
  full plan-run snapshot). Documented as "headless writers must go
  through `apply`" — this method is internal to the extension and the
  same writeFile lockfile guarantees serialization.
- **`GitWorkspaceProvider.write()` hardened** to ensure both synced and
  local dirs exist before write — closes a regression that
  persistRequestRun would hit when the user picked a fresh
  globalStorageUri path.

**Deferred to Phase 2 round 2 (NotebookController + TestController):**

- Plans as `vscode.NotebookController` (`apicircle-plan` notebook
  type) with per-step cells, markdown documentation cells, per-cell
  ▶ Run, persisted outputs. Phase 2 round 1 ships the "Run entire
  plan" action via the TreeView's inline button; per-cell execution
  needs the NotebookSerializer + executeHandler wiring.
- `vscode.tests.createTestController` integration — plans + assertions
  surface in VS Code's Testing tab with per-assertion pass/fail and
  re-run support. Needs the plan run loop refactored to emit per-step
  verdicts in real-time rather than only at completion.
- "APICircle Runs" `OutputChannel` — Phase 2 round 1 ships history
  persistence; the live-log stream during a plan run is round 2.
- Three-surface compat for `plan.upsert` — env.upsert is already
  covered by Phase 1's gap closure round; plan.upsert lands with the
  Notebook integration.

**Phase 2 round 1 tally: 205 tests across 27 files** (up from 137).
All four tiers green. `pnpm check` clean monorepo-wide. `pnpm lint`
clean (0 errors). Bundle 502 KB CJS (up from 454 — `runPlan` and the
plan-run engine bundle in alongside the existing `executeRequest`
surface).

### Phase 2 round 1 gap-closure — 13 honest gaps closed

Post-Phase-2-round-1 audit surfaced 13 gaps between claimed and actual
delivery. All closed in this pass:

- **Snapshots sidebar view** — new `apps/vscode/src/views/SnapshotsView.ts`
  registers `apicircle.snapshots` as the 8th sidebar TreeView. Top row
  is a storage meter (`X.X KB / Y.Y KB (Z%)`) with `database` icon;
  children are entries newest-first with trigger-themed icons (`save`
  for manual, `warning` for pre-yank, `archive` for pre-deprecate,
  `cloud-download` for pre-linked-update, `history` for pre-restore).
  Context-menu inline Restore + Delete + view/title Capture button.
  `restoreSnapshotCommand` / `deleteSnapshotCommand` now accept an
  optional `node?: SnapshotNodeArg` to skip the QuickPick when invoked
  from the tree. 8 unit tests + the activation integration test was
  bumped to expect 8 registered views.
- **Environment YAML hover** — new `apps/vscode/src/lang/environmentHover.ts`
  registers a `HoverProvider` against `.env.yaml` URIs. Hovering on a
  `key:` line shows: variable name + env name, encrypted vs plaintext
  status (encrypted entries also show their `secretKeyId` slot + bound
  `SecretKeyMeta` label, or a "vault entry missing" warning), mask
  warnings when a higher-priority env in `priorityOrder` defines the
  same key, and "not in priority order" notes when the env is inert.
  Filtered to `local`-kind `EnvPriorityRef`s (linked-env resolution
  ships in Phase 8). Also registered the previously-orphan
  `EnvironmentCodeLensProvider` + `EnvironmentCompletionProvider` here
  for `.env.yaml`. 10 unit tests + new `MarkdownString` / `Hover`
  classes in the vscode mock.
- **Workspace watcher consolidation** — new
  `apps/vscode/src/watch/workspaceWatcher.ts` registers TWO
  `FileSystemWatcher`s (synced `.apicircle/workspace.json` AND device-
  local `workspace.local.json`) and fires `onAnyChange` on every
  create/change/delete event from either. The prior synced-only watcher
  missed plan-create, history-append, snapshot-capture and env-var
  rename events because those land in `workspace.local.json`. 5 unit
  tests.
- **Three new wired settings** — three previously-dead `package.json`
  config keys now actually steer the extension:
  - `apicircle.execution.timeoutMs` is now passed to `executeRequest`
    via `ExecuteOptions.timeoutMs` (previously the default 30000 ms
    was unconditional).
  - `apicircle.execution.host` — when set to `"local"` without a
    `vscode.env.remoteName`, surfaces a Remote-SSH / Codespaces
    warning so the setting isn't silently a no-op (the actual
    port-forwarding plumbing lands with Phase 7).
  - `apicircle.history.retentionDays` — `persistRequestRun` and
    `runPlanCommand` both prune `requestRuns` + `planRuns` older than
    the window before appending the new run; treats `0` or negative
    as "no time cap". 6 new tests across `persistHistory.test.ts` +
    `planActions.test.ts`.
- **`plan.upsert` three-surface byte-identical compat test** added to
  `threeSurfaceCompat.test.ts` — covers the previously-untested
  invariant that `plan.upsert` patches produce identical
  `workspace.local.executionPlans` across `FileBackedWorkspaceProvider`
  (desktop) and `GitWorkspaceProvider` (VS Code).
- **Test debts** — 4 command files (`addExtraction`, `historyActions`,
  `variableActions`, `planActions` runPlan) had zero unit coverage
  despite being Phase 2 work. Added 32 tests across the four files.
- **Settings popover view/title menu** for `apicircle.snapshots` —
  `Capture Snapshot` lives in the view's `navigation` group.

### Phase 2 round 2 gap-closure — 13 more honest gaps closed

Round 2 adversarial re-audit on Round 1 closures surfaced another 13
gaps. All closed in this pass:

- **`apicircle.setSnapshotMaxBytes` command implemented** — the
  Snapshots view tooltip referenced "set the cap via the command
  palette" but no command existed. Now wired: InputBox in MB, validates
  `> 0` and `≤ 2048 MB`, fires `snapshot.set_max_bytes`. Registered in
  `package.json` and the Snapshots view-title `1_config` group.
- **Activation events fixed** — added `onView:apicircle.snapshots` and
  `onCommand:apicircle.captureSnapshot` to `activationEvents` so the
  Snapshots view + the welcome-card capture link actually activate the
  extension cold.
- **Snapshot node-arg test branches** — `restoreSnapshotCommand` /
  `deleteSnapshotCommand` accept a `node?: SnapshotNodeArg` (sidebar
  context-menu plumbing). Tests now cover the skip-picker path AND the
  "node references missing id" warning branch. 5 new tests for snapshot
  actions + 4 for `setSnapshotMaxBytesCommand`.
- **`sendRequest` wired-settings tests** — 4 new tests prove
  `apicircle.execution.timeoutMs` actually reaches `executeRequest`,
  the `execution.host=local` warning fires only when `remoteName` is
  unset, `execution.host=local` + `remoteName` set is silent, and
  `execution.host=remote` is silent (the default).
- **Plan retention filter tests** — 2 new tests in `planActions.test.ts`
  prove that both `requestRuns` and `planRuns` older than
  `apicircle.history.retentionDays` are pruned by `runPlanCommand`,
  and that `retentionDays=0` keeps everything.
- **Three-surface compat for `snapshot.delete` + `snapshot.restore`** —
  2 new tests in `threeSurfaceCompat.test.ts` apply the same delete +
  restore patches through `FileBackedWorkspaceProvider` (desktop) and
  `GitWorkspaceProvider` (VS Code) and assert byte-identical `local`
  (delete) + `synced` (restore) states.
- **`vscode` mock surface extended** — `MarkdownString` + `Hover`
  classes, `ProgressLocation` enum, `window.withProgress` that
  synchronously invokes the task callback, and `env.remoteName` —
  needed by the new hover, plan-run and execution-host tests.
- **Docs propagated** — this CHANGELOG section + `docs/vscode-extension.md`
  updated to reflect the 8-view layout, the new hover surface, the
  snapshots view, and the three wired settings; reconciled the
  "deferred" list against what Round 1 actually shipped.

**Phase 2 round 2 tally: 342 tests across 45 files** (up from 325 at
end of Round 1). All four tiers green. `pnpm check`, `pnpm lint`
clean.

### Phase 2 round 2 gap-closure — 13 more honest gaps closed

Round 3 adversarial re-audit on Round 2 closures found another 13
gaps — same 13-count signal as Rounds 1 and 2. All closed:

- **`apicircle.setSnapshotMaxBytes` is now in `activationEvents`** so
  the palette-only entry point activates the extension cold.
- **Three-surface compat test for `snapshot.set_max_bytes`** — the
  fourth snapshot patch is now covered alongside capture / delete /
  restore in `threeSurfaceCompat.test.ts`.
- **`activation.test.ts` snapshots the full command-id set** with
  inverse-guard (no UNEXPECTED commands) so missing `registerCommand`
  calls or typo'd contributions fail the activation test, not the
  user. The previous test only asserted 6 commands by allowlist;
  now all 25.
- **Dead `SnapshotsView.snapshotIdFromNode` static removed** — it was
  imported only by its own test (knip false-negative).
- **`SnapshotsView` empty state hooked to viewsWelcome** — when there
  are zero snapshots, `getChildren` returns `[]` so the welcome card
  ("No snapshots yet… [Capture Snapshot…]") fires instead of a
  confusing "Storage: 0 B" row. The viewsWelcome card now also links
  to `[Set Storage Cap…]`.
- **Cancellation simulation in the `withProgress` mock** — new
  `window.__withProgressCancelOnce()` arms the next `withProgress`
  invocation to report cancellation. New `runPlanCommand` test
  exercises the `token.onCancellationRequested → abortRegistry.cancel`
  wiring that previously had no coverage.
- **`setSnapshotMaxBytes` validator integer-only** — `100.5` is now
  rejected with "Enter whole MB (no decimals)" rather than silently
  producing 105,381,888 bytes.
- **CHANGELOG test-count corrected** — the Round 2 closure section
  previously claimed "339 tests across 47 files"; actual was 342/45.
  Now 344/45.
- **`docs/qa/README.md` Unit tier updated** — was "22+ suites · ~210
  tests" pre-Round 2; now reflects the real surface count + new
  Phase 2 components (SnapshotsView, EnvironmentHover,
  workspaceWatcher, setSnapshotMaxBytes, the three wired settings).
- **README.md gets a VS Code extension section** — Round 1 closures
  claimed docs propagation but README only mentioned VS Code as a
  theme variant. Now points at `apps/vscode/` and summarizes what
  ships.
- **`CLAUDE.md` § 9 docs table** updated — was "Phase 1 alpha" for
  `docs/vscode-extension.md`, now "Phase 2 alpha".
- **`CLAUDE.md` § 2 repo skeleton blurb** updated to reflect Phase 2
  surfaces actually shipped (not just the Phase-1 description).

### Phase 2 round 4 — end-to-end audit, 26 gaps closed

The Round 4 audit was a broader categorical sweep (rather than per-round
adversarial). It surfaced 26 gaps across manifest/UX/test/docs:

- **8 hidden palette commands declared** (`addExtraction`, `clearAllHistory`,
  `deleteHistoryRun`, `deleteVariable`, `editVariableValue`, `newPlan`,
  `purgeOlderThan`, `setEnvPriorityOrder`) — registered in extension.ts
  but never in `contributes.commands`. Restored palette parity.
- **5 dead context menus wired** for `request-run`, `plan-run`, `variable`,
  `variable-encrypted`, `bucket-{requests,plans}` viewItems.
- **Execution + History view-title toolbars + universal Refresh button**
  across all 8 views.
- **Stale `viewsWelcome` copy updated** for Environment, Execution, History.
- **Plan YAML projection shipped** — `apicircle://*/plans/<id>.plan.yaml`
  with serializer/parser (15 tests), FS provider handler, ExecutionView
  click-to-open, ▶ Run Plan CodeLens (5 tests).
- **JSON schemas for `.plan.yaml` + `.run.yaml`** with `yamlValidation`
  entries — Monaco's YAML extension now drives autocomplete + validation
  for all four virtual document types.
- **Keybindings**: Ctrl/Cmd+Enter (send), F5 (refresh), Ctrl/Cmd+N (new
  per view).
- **Missing unit tests added** — `createWorkspace.test.ts` (6),
  `gitWorkspaceProvider.test.ts` (10), `stubViews.test.ts` (6).
- **Docs propagated** to README.md (VS Code section), CLAUDE.md
  (Phase 2 alpha + 8 views), `docs/qa/README.md` (test counts),
  `docs/apicircle-yaml-format.md` (history runs + plan YAML +
  EnvironmentHover sections).
- **Settings UX**: removed `apicircle.telemetry.enabled` (no pipeline
  exists); phase-deferred settings now prefixed
  `**(Phase N — not yet implemented)**`.
- **Phase-0 TODO closed** in `gitWorkspaceProvider.ts`; new
  `test/mocks/helpers.ts` for typed mock access.

### Phase 2 round 5 — adversarial re-audit, 15 + 1 gaps closed

Round 5 (audit on Round 4) found 15 gaps. **First decrease in per-round
count** (Round 1–4 each found 13/13/13/26). Plus 1 pre-existing flaky
test surfaced during closure work. All closed:

- **R5-G1**: F5 keybinding for `apicircle.refresh` clashed with the
  built-in VS Code Debug: Start. Moved to Ctrl/Cmd+Shift+R.
- **R5-G12 + R5-G15**: F6 keybinding for `apicircle.runPlan`;
  Ctrl/Cmd+Shift+S for `apicircle.captureSnapshot` (snapshot is not
  semantically "new entity creation", so Ctrl+N was wrong).
- **R5-G2**: Folder context menu wired — new `apicircle.deleteFolder` +
  `apicircle.newRequestInFolder` commands. `newRequestCommand` now
  accepts an optional `{folderId}` context to skip the folder picker.
  10 new tests in `folderActions.test.ts`.
- **R5-G3**: Step context menu wired — new `apicircle.toggleStepEnabled` +
  `apicircle.removeStepFromPlan` commands. Both mutate via
  `plan.upsert` since there's no per-step patch variant. 8 new tests in
  `stepActions.test.ts`.
- **R5-G14**: `editVariableValue` removed from the `variable-encrypted`
  context menu (encrypted variables are read-only until Phase 4 ships
  the vault). `deleteVariable` is still available — you can remove an
  encrypted var without unlocking.
- **R5-G4**: FS provider plan-write now validates every `steps[].requestId`
  references an existing request. Saving with a typo throws
  `NoPermissions` with the bad id(s) listed.
- **R5-G5**: FS provider `delete()` now handles `plans/<id>.plan.yaml` (fires
  `plan.delete`) and `environments/<name>.env.yaml` (fires
  `environment.delete`). Previously only `requests/` could be deleted
  through the FS.
- **R5-G6**: `PlanCompletionProvider` ships — completions for root fields
  (`name`, `steps`, `variables`, `envPriorityOrder`,
  `stopOnAssertionFailure`), step fields, variable fields, env-ref
  refs, plus dynamic completions for `requestId:` (workspace requests)
  and `local:` (env names) and `enabled:` (boolean). 10 tests.
- **R5-G10**: `PlanHoverProvider` ships — hovering a `requestId:` shows
  the referenced request's name + method + URL (or "unknown id"
  warning); hovering `linkedWorkspaceId:` shows linked workspace label.
  8 tests.
- **R5-G9**: New `test/integration/planRoundTrip.test.ts` — 6 end-to-end
  tests covering FS-provider serialize → mutate YAML → write →
  applyMutation → re-read. Includes the R5-G4 dangling-id rejection
  test and the R5-G5 delete-fires-patch test.
- **R5-G11**: `test/mocks/helpers.ts` is now actually used — by
  `planRoundTrip.test.ts`. Round 4 introduced it as dead code; Round 5
  brings it into a real test.
- **R5-G7**: CHANGELOG test-count corrected (Round 3 said 344/45;
  actual at that point was 344/45 then; after Round 5 it's 426/55).
- **R5-G13**: View-title menu groups consistent (`navigation@N` for
  primary actions, `1_config` for settings-style actions,
  `1_destructive` reserved for History's Clear All).
- **R5-G16 (flake)**: `threeSurfaceCompat.test.ts`'s "applyMutation
  determinism" test was flaky — comparing JSON.stringify of two calls
  that hit `new Date()` 1ms apart. Now uses the `canonicalize()` helper
  that strips apply-time timestamps.

**Phase 2 round 5 tally: 426 tests across 55 files** (up from 387 at
end of Round 4). `pnpm check` + `pnpm lint` clean across the monorepo.
Cross-package `pnpm -w test` runs **3120 tests across 290 files** —
no regressions in `core` / `shared` / `mock-server-core` /
`mcp-server` / `ui-components` / `desktop` / `web` / `cli` from any
Phase 2 work.

## 1.0.9 - 2026-06-06

### UX fix — file picker consolidates upload + library into one themed menu

- **`FilePickerMenu` primitive replaces the dual-control pattern** in
  the form-data row, binary body, and mock-response binary editors.
  Before: every empty file row showed both a "Choose file" button AND
  a separate `<select>` dropdown labelled "Library..." — two parallel
  controls forcing the user to scan + decide between them, and the
  `<select>`'s dropdown arrow + option list rendered with the browser's
  default light styling against the dark dock. After: one themed
  "Pick file ▾" trigger opens a single menu with "Upload new file…"
  on top and (when present) a "From library" section listing every
  reusable asset. Keyboard model mirrors `KebabMenu` — Enter/Space/
  ArrowDown to open, Escape / outside-click to close, ArrowUp/Down to
  cycle. The trigger supports a `fullWidth` mode so the empty state
  fills the same column width as the bound state — without it the
  picker drifted as a small button in a wide field surface, which
  read as a broken layout. 9 unit tests pin the trigger, menu,
  callbacks, focus, disabled state, and the full-width layout.
  (`packages/ui-components/src/primitives/FilePickerMenu.tsx`,
  `packages/ui-components/src/panels/editor/FormDataEditor.tsx`,
  `packages/ui-components/src/panels/editor/BinaryEditor.tsx`,
  `packages/ui-components/src/panels/mocks/MockResponseEditor.tsx`)

### Bug fix — Global Assets panel no longer strands on a deleted asset

- **Auto-clear `selectedId` when the selected asset disappears from
  any of the three registries.** Previously, deleting the currently-
  open file / schema / GraphQL definition left the right-side editor
  mounted pointing at a now-invalid id; the editor rendered its
  empty state and the user read it as a broken screen. A `useEffect`
  in `GlobalAssetsDockPanel` now watches `selectedId` against the
  live registries and resets it to `null` on disappearance. Covers
  the UI delete path, the MCP `assets.delete_file` tool, and any
  external write that lands via `refreshFromDisk`. Regression tests
  pin the file-asset and GraphQL paths.
  (`packages/ui-components/src/layout/dock/GlobalAssetsDockPanel.tsx`,
  `packages/ui-components/src/layout/dock/GlobalAssetsDockPanel.test.tsx`)

### Bug fix — deleting an asset now actually removes the blob from the remote

- **`pendingAttachmentDeletes` queue + push-side tree deletion entries.**
  Removing a Global File Asset that had push provenance
  (`workingBranchRef` or `baseBranchRef`) used to drop the asset from
  `workspace.json` but leave the orphan blob at
  `.apicircle/attachments/<slotId>` on the remote tree forever — the
  PR merge then carried the orphan into the base branch. The fix
  queues the slot id at deletion time in a new
  `WorkspaceLocal.pendingAttachmentDeletes: string[]`, and
  `pushWorkspace` now emits one `{path: '.apicircle/attachments/<slotId>',
sha: null}` tree entry per queued slot — the GitHub tree-API
  delete shape we already used during the 1.0.9 `workspace.json`
  cutover. After `updateRef` resolves the queue is cleared. The
  attachment is gone from the working branch immediately; the
  subsequent PR merge carries the deletion to the base branch
  (typically `main`).
  Safety filter: any queued slot id that matches an asset still in
  `synced.globalAssets.files` is dropped before the push (defends
  against a snapshot-restore that brought a previously-deleted asset
  back). The `assetUsageAggregator` also self-heals ghost entries on
  every `commitSynced` so the queue can't grow unbounded. Both the
  UI `removeGlobalFileAsset` action and the headless
  `globalAsset.removeFile` patch (used by the MCP
  `assets.delete_file` tool) queue deletes, so AI clients get the
  same behavior. Tests pin every layer — patch handler, MCP tool,
  UI store action, push emission + post-success queue clear,
  aggregator ghost prune, and the live-GitHub roundtrip (working
  branch blob → 404 after delete + push, base-branch blob → 404 after
  synthetic merge).
  (`packages/shared/src/types.ts`,
  `packages/core/src/workspace/applyMutation.ts`,
  `packages/core/src/workspace/applyMutation.test.ts`,
  `packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/store/pushWorkspace.test.ts`)

### Bug fix — stale-state races in three mutation paths

- **`pushWorkspace` post-`updateRef` race.** `stampPushedAssetRefs`
  was called with the function-entry capture of `synced`, and the
  final `set({ synced: nextSynced })` wiped any user mutation that
  landed during the multi-second push (createBlob × N + createTree
  - createCommit + updateRef). A file dropped into a form-data row
    during a slow push would simply disappear after the push
    completed. The fix layers stamps onto `get().synced` (live)
    via a new `mergeStampsIntoLive` helper and reserves the
    captured-stamped doc for the `lastPulledSnapshot` baseline (which
    must reflect what's literally on the remote). New regression test
    in `pushWorkspace.test.ts` parks the `createTree` fetch, injects a
    mid-push asset addition, releases the parked fetch, and asserts
    both assets survive.
- **`addGlobalFileAsset` race.** Identical pattern: the action
  awaited `createAttachmentFromFile` + `putAttachment`, then passed
  a captured-state `result.synced` to `commitSynced(() => obj)` —
  which ignored live state and wiped concurrent mutations. The fix
  runs `addGlobalFileAssetAction` inside `commitSynced((s) => …)`
  so the reducer operates on the live store and the new asset is
  layered atop whatever else landed during the awaits. The same
  pattern was applied to `fillGlobalFileAssetBytes`, which also
  no-ops gracefully if the asset was deleted mid-await.
  (`packages/ui-components/src/store/workspaceStore.ts`)
- **Status pill priority order.** `deriveFileAssetState` checked
  `workingBranchRef` before `pendingFileUploads`, so the
  fill-bytes-on-an-already-pushed-asset flow showed "On working
  branch" while the new bytes were still local-only. Pending bytes
  now take priority, so the pill truthfully reads "Uploaded
  locally" until the next push promotes the ref. Two regression
  tests added.
  (`packages/ui-components/src/primitives/FileAssetStatusPill.tsx`,
  `packages/ui-components/src/primitives/FileAssetStatusPill.test.tsx`)

### Bug fix — status pill no longer flickers "Missing" right after a push

- **Refresh probe gains a 60-second grace window per ref.** GitHub's
  Contents API has a propagation lag of several seconds after a Git
  Data API write — but the asset-ref verification probe used the
  Contents API to confirm each `workingBranchRef` after every refresh.
  A cold-launch refresh that fired right after `pushWorkspace` could
  null the `workingBranchRef` the push had just stamped (Contents API
  returned 404 for the same blob the push had committed), flipping the
  status pill to "Missing" until the PR merged and the base-branch
  probe re-discovered the file. The fix: trust any ref whose
  `verifiedAt` is within the last 60 seconds without re-probing, plus
  opportunistic re-probe of the working branch when the ref is null —
  so a previously-lost ref recovers on the next refresh without
  needing another push. Regression tests pin both paths.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/store/refreshWorkspace.test.ts`)

### Global File Assets — provenance state machine + unified upload flow

- **All file uploads now mint a reusable Global Asset.** Dropping a file
  into a form-data row (`attachFormFile`), a binary request body
  (`attachBinaryFile`), or a mock-server binary response
  (`attachMockResponseFile`) now creates a `GlobalFileAsset` entry the
  same way the Global Assets sidebar does. The consumer (row, body, or
  mock response) carries `globalFileAssetId` instead of a private slot,
  so every file in the workspace is discoverable from the Global Assets
  library and gets a cross-cutting reference count. (Behavior change:
  clearing a row no longer auto-deletes the bytes — the asset becomes
  "Unused" in the library so the user can prune deliberately.)
- **Per-asset provenance state machine.** Every Global File Asset gains
  two optional ref slots — `workingBranchRef` and `baseBranchRef` — and
  six lifecycle states: `uploading`, `workingOnly`, `merged`, `baseOnly`,
  `missing`, `diverged`. The push flow stamps `workingBranchRef` with
  the GitHub blob sha + commit sha after every successful push. The
  refresh flow runs a verification pass that probes each ref, drops
  ones that 404, opportunistically promotes the base ref when the PR
  merges, and runs a cleanup invariant that drops the working ref when
  both refs hold the same blob (single source of truth = base).
  (`packages/shared/src/types.ts`,
  `packages/core/src/workspace/patches.ts`,
  `packages/core/src/workspace/applyMutation.ts`,
  `packages/ui-components/src/store/workspaceStore.ts`)
- **Pre-push buffer + reference index in `WorkspaceLocal`.**
  `pendingFileUploads` records assets whose bytes are in IDB but not
  yet on a Git ref so the "Uploaded locally" pill flips immediately on
  drop. `assetUsageIndex` is a cross-cutting "used in N places" map
  recomputed by `assetUsageAggregator` on every `commitSynced` (same
  pattern as `usedInAggregator`). The index walks request bodies AND
  mock-server response bodies — the legacy per-asset walker only
  scanned requests.
- **Status pills + ref-count UX across four surfaces.** New
  `<FileAssetStatusPill>` primitive shipped, wired into the Global
  Assets sidebar (list rows + detail editor), form-data row editor,
  binary body editor, and mock-response binary body editor. Pill
  reflects the live ref state; hover surfaces the verified branch and
  consumer count. Removal confirmation now lists every affected
  request and mock endpoint with a "Delete and unbind N" CTA, gated
  by `ConfirmDialog`'s typed-confirm path.
- **Four new MCP tools.** `assets.list_files` (provenance state
  - usage map per asset), `assets.create_file` (metadata-only —
    bytes are out-of-band by design since MCP can't carry blobs),
    `assets.update_file` (rename / re-describe, refs preserved),
    `assets.delete_file` (cascade with consumer list in the
    response envelope). 78 MCP tools total now.
    (`packages/mcp-server/src/tools/globalAssets.ts`)
- **Test coverage.** 10 new patch tests for the asset state-machine
  variants, 9 aggregator tests, 13 status-pill tests, 1 push test
  pinning the post-commit ref stamp, 2 refresh tests pinning the
  verification probe + cleanup invariant, 9 MCP tool tests, plus the
  three direct-upload editor tests rewritten for the new "orphan ->
  Unused" contract.

### Git layout — the synced workspace doc lives under `.apicircle/`

- **`workspace.json` moved from the repo root into `.apicircle/`.** Every
  Git-backed workspace now lays out as:

  ```
  .apicircle/
  ├── workspace.json
  └── attachments/<slotId>
  ```

  Attachments already lived under `.apicircle/` since 1.0.0 — that's where
  the dotfolder name came from. Co-locating the synced doc next to its
  attachments finally consolidates everything API-Circle-managed under a
  single hidden directory so a workspace repo can host READMEs, CI files,
  and unrelated tooling at the root without colliding with our payload.
  This is a hard cutover (no legacy fallback): connect a repo to 1.0.x and
  re-push so the new push lands `.apicircle/workspace.json`. Existing
  example repos and template forks need to be re-laid-out by their
  owners — there is no in-place migration.

  **Note:** 1.1.0 relocated the workspace document again — into per-id
  subdirectories (`.apicircle/workspace-<id>/workspace.json` + a sibling
  `registry.json`). If you are migrating from a pre-1.0.9 root layout,
  skip straight to the current 1.1.0 layout.
  Full step-by-step: [`docs/migration.md`](docs/migration.md).
  (`packages/core/src/git/repoPaths.ts`,
  `packages/core/src/git/repoPaths.test.ts`,
  `packages/core/src/git/serializeWorkspace.ts`,
  `packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/store/pushWorkspace.test.ts`,
  `e2e/web/live-github/_github-rest.ts`)

- **GitHub API surface unchanged.** Push still flows getRef → getCommit →
  optional createBlob (attachments) → createTree → createCommit →
  updateRef; only the path inside the tree entry changed. Refresh, link
  probes, linked-update apply/preview, release-ledger reads, and the
  seed-initial-commit on empty repos all now address
  `.apicircle/workspace.json` directly.

### Bug fix — file uploads no longer vanish during auto-refresh

- **`refreshWorkspace` race repaired.** A file dropped into a form-data row
  (`attachFormFile`) or uploaded via the Global Assets sidebar
  (`addGlobalFileAsset`) while a refresh was in-flight could disappear
  within two seconds. Root cause: `refreshWorkspace` captured `synced`
  at function entry, then awaited two GitHub round-trips
  (`probeBranchRetirement` + `getContents`) before computing the
  3-way diff. Any mutation that landed during that 200ms–2s window
  was silently dropped by the auto-merge path because `applyMerge`
  saw the pre-upload snapshot, and `persistMerged` then wrote the
  merged-without-the-file doc back via `set({ synced: merged })`.
  The fix re-reads `synced` / `local` from the store immediately before
  `computeThreeWayDiff`, so the merge honors any in-flight edits.
  Trigger surface: `useFocusRefresh` cold-fires `refreshWorkspace()`
  on workspace mount whenever a working branch is connected, which is
  how the race became reproducible in seconds.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/store/refreshWorkspace.test.ts`)

### Test coverage — new live-GitHub spec for file uploads

- **`16-form-data-file-uploads-live.spec.ts`** pins both file-upload
  paths through a real GitHub push: Global Assets sidebar upload bound
  to a form-data row + direct file upload via `attachFormFile` on a
  separate row. Asserts the synced doc carries the right bindings,
  both blobs land at `.apicircle/attachments/<slotId>` on the remote
  working branch, and the bytes round-trip unchanged. Also pins the
  current contract that direct form-data uploads stay private to their
  row (NOT auto-registered as Global Assets) — that assertion is the
  canary for any future change that promotes them.
  (`e2e/web/live-github/16-form-data-file-uploads-live.spec.ts`)

## 1.0.8 - 2026-06-03

The workspace-sync hardening release. The disk-mirror loop between the
desktop, the MCP server, the CLI, and any external editor of
`workspace.synced.json` finally closes: MCP no longer pins to whichever
workspace was active at boot, desktop hydrate no longer clobbers writes
made while it was closed, and external file changes auto-surface in the
running UI without the user clicking **Refresh**. Registry changes from
the CLI flow into the switcher live, and the switcher disambiguates
name collisions so legacy duplicates aren't a dead end. Workspace name
uniqueness is now case-insensitive end-to-end, and the refresh toasts
report on-disk request / folder / environment counts so an AI client
that claims to have created a 21-request collection while the desktop
only sees one can be spotted at a glance.

### Workspace sync — MCP / CLI / desktop now share one source of truth

- **MCP server no longer pins to its boot-time active workspace.**
  `MultiWorkspaceProvider` used to cache the per-id
  `FileBackedWorkspaceProvider` resolved at `init()` time. If the user
  switched workspaces in the desktop while their AI client's MCP server
  was already running, MCP kept writing to the OLD workspace and the
  desktop never saw the writes. The active provider is now a lazy
  wrapper that re-reads `registry.json` on every `read` / `apply` /
  `write` call — one tiny JSON read per tool call in exchange for
  always-correct routing.
  (`packages/mcp-server/src/providers/MultiWorkspaceProvider.ts`,
  `MultiWorkspaceProvider.test.ts`)
- **Desktop boot no longer overwrites MCP / CLI writes made while it was
  closed.** Before this fix, `hydrate()` always queued an IDB→disk write
  at the end of boot, regardless of which side was newer — so any
  `apicircle-mcp` or `apicircle` CLI edits to `workspace.synced.json`
  silently disappeared the next time the desktop opened. Hydrate now
  compares `meta.updatedAt` between IDB and disk: when disk is newer
  (an external writer changed the file while the desktop was closed),
  the store adopts the on-disk doc and the boot-time IDB→disk write is
  skipped. The pre-existing one-time-merge path (different
  `workspaceId`s) is unchanged.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/store/hydrateDiskAdoption.test.ts`)
- **`refreshFromDisk` no longer flushes pending IDB writes before
  reading disk.** The MCP-panel Refresh button used to start by draining
  `flushPendingPersist()`, which could write a stale in-memory snapshot
  to disk on top of fresh MCP / CLI content. The order is now read →
  decide → (optionally) flush, so a click on Refresh can never destroy
  what it's meant to surface.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `refreshFromDisk.test.ts`)
- **Refresh-from-disk persists the adopted state to IndexedDB.** When
  refresh sees a newer disk doc, it now writes that state back to IDB
  immediately instead of waiting for the next user mutation. Closes a
  small window where a crash between adoption and the next mutation
  would lose the freshly-imported content.
  (`packages/ui-components/src/store/workspaceStore.ts`)

### Auto-refresh on external file changes

- **The renderer reflects MCP / CLI / hand-edits without a click.** The
  desktop main process now watches `<userData>/workspaces/` and the
  per-id `workspace.synced.json` files. When an external writer
  touches one, the renderer auto-fires `refreshFromDisk` so the editor
  and Environments panel pick up the change immediately. Self-writes
  from the desktop's own mirror are suppressed via a stat-snapshot
  (`{mtimeMs, size}`) recorded after each manager write — robust
  against OS event delays and burst writes (an earlier prototype's
  1.5s time window had both failure modes).
  (`apps/desktop/src/main/workspaceFile/workspaceWatcher.ts`,
  `apps/desktop/src/main/workspaceFile/workspaceFileManager.ts`,
  `apps/desktop/src/main/ipc/workspaceFileBridge.ts`,
  `apps/desktop/src/main/preload.ts`, `apps/desktop/src/main/main.ts`,
  `packages/ui-components/src/desktop/bridge.ts`,
  `packages/ui-components/src/App.tsx`, `workspaceWatcher.test.ts`)
- **Registry changes from CLI / MCP appear in the desktop switcher.**
  The watcher's `'registry'`-event branch used to no-op. It now calls
  the new `refreshRegistryFromDisk` store action, which re-reads
  `<root>/registry.json` and pushes it into `workspaceRegistry` so a
  `apicircle workspaces create` run alongside the desktop surfaces in
  the switcher without a restart. A toast announces how many new
  workspaces appeared.
  (`packages/ui-components/src/store/workspaceStore.ts`,
  `packages/ui-components/src/App.tsx`,
  `packages/ui-components/src/store/refreshFromDisk.test.ts`)
- **Boot ordering: watcher attaches before the renderer window opens.**
  `startWorkspaceFileWatcher(...)` now runs before
  `mainWindow = createWindow()` so any boot-time renderer writes go
  through a `WorkspaceFileManager` that already has self-write
  suppression wired. Previously a small window existed where the
  watcher saw the desktop's own initial mirror write as "external" and
  triggered a needless refresh cycle. (`apps/desktop/src/main/main.ts`)
- **End-to-end desktop coverage for the auto-refresh path.** New
  Playwright spec `e2e/desktop/external-write-refresh.spec.ts` boots
  the Electron app, writes `workspace.synced.json` externally
  (simulating an MCP / CLI write), and asserts the new request appears
  in the editor without the user clicking Refresh. A second case
  appends a workspace to `registry.json` and asserts the switcher /
  toast picks it up.

### Workspace name uniqueness — case-insensitive end-to-end

- **Workspace create + rename are now case-insensitive unique.**
  Previously `My Workspace` and `my workspace` could coexist (the CLI
  rejected the collision, but the desktop's persistence helper only
  did a case-sensitive compare). Both `createWorkspace` and
  `updateRegistryEntryName` in `workspaceStorage.ts` now use a
  case-insensitive guard, matching the CLI's existing behaviour.
  (`packages/ui-components/src/persistence/workspaceStorage.ts`)
- **Workspace switcher disambiguates colliding names.** When two
  registry entries share a name (case-insensitive) — leftover from
  pre-1.0.8 builds or a legacy-migration race — the switcher appends
  a short `#xxxx` id suffix to ONLY the colliding rows so the user
  can tell them apart. Unique names render unchanged.
  (`packages/ui-components/src/layout/WorkspaceSwitcher.tsx`)

### Refresh visibility

- **Refresh toasts now report on-disk counts.** "Already up to date" /
  "Workspace refreshed from disk" / "Merged in" all include a
  `1 request · 0 folders · 1 environment` line, so when an AI client
  claims to have created a 21-request collection but the desktop only
  sees `httpbin`, the mismatch is visible at a glance instead of hiding
  behind a generic success toast.
  (`packages/ui-components/src/panels/mcp/mcpPanelTypes.ts`,
  `packages/ui-components/src/panels/mcp/ConnectionSection.tsx`)

### Internals

- **CI: `visual-baseline` job is now manual-dispatch only.** The Linux
  baseline PNGs are not committed yet, so the job ran every push to main
  as a no-op (`continue-on-error`) only to upload first-run artifacts.
  It's now off by default and triggered on demand from the Actions tab
  when (re)generating baselines. No change to local
  `pnpm test:e2e:visual`. (`.github/workflows/e2e.yml`,
  `docs/qa/README.md`, `CLAUDE.md`)

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`,
`@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`,
`@apicircle/mcp-server`, `@apicircle/mock-server-core`,
`@apicircle/shared`, plus the e2e and example workspaces — all at
`1.0.8`.

## 1.0.7 - 2026-06-02

The portable-exchange and encrypted-env hardening release. Folders ship to —
and re-attach from — a single self-describing `.apicircle.json` envelope
through the UI, CLI, and MCP, with per-credential opt-in so secrets never
leak by accident. Environment exports now travel with their ciphertext
(envelope v2) so re-imports stop forcing manual rebinds across machines,
and the Environments panel + Vault dock surface the missing-slot /
decrypt-failure cases that previously dead-ended users. The MCP Prompts
cards copy reliably (and the workspace-scope chip is renamed to
**Collections**). The default theme and font revert to **One Dark Pro** +
**System Sans** — the 1.0.5 Command Center + Cascadia Code defaults are
still one click away under Settings → Appearance — and the font picker
hides any catalog entry that silently falls back to your OS default face.

### Folder export hardening — credentials, CLI, MCP, re-attach toast

- **Security:** the Export Folder modal now enumerates every credential-bearing
  field detected inside the subtree (Bearer tokens, OAuth2 client secrets +
  access + refresh tokens, AWS SigV4 secret keys, NTLM / Digest passwords,
  Hawk keys, JWT signing material, `api-key.value`). They are **redacted by
  default**; the user opts each one in via a per-row checkbox. The summary
  bar surfaces the live counter ("3 credentials will be redacted" → "1
  credential included · 2 redacted"). Redaction blanks credential fields to
  `""` and keeps identity fields (clientId, username, tokenUrl, …) so the
  importer still knows which IdP the request belonged to. Same fail-safe
  shape as `redactForGit`.
- **`applyMutation` parity:** new `folder.import_apicircle` patch variant +
  applyMutation switch case so headless writers (CLI, MCP, future automation)
  graft an envelope through the same single mutation choke point the UI
  store uses. The pure graft logic moved into
  `@apicircle/core/workspace/apicircleFolderImport`;
  `apicircleImportAction.ts` in `ui-components` is now a thin re-export
  shim.
- **MCP catalog:** two new tools (now 74 total).
  - `folder.export_json` — collect a folder envelope. Accepts an optional
    `includeCredentialIds` array (same id shape the export modal uses) and
    redacts everything else. Returns `{ envelope, json, filename, report }`.
  - `folder.import_json` — accept either `json` (string) or `envelope`
    (object). Routes through
    `WorkspaceProvider.apply({ kind: 'folder.import_apicircle' })`, so
    name-uniquify + dependency dedupe semantics are identical to the UI.
- **CLI:**
  - `apicircle export folder <name-or-id> [--out file] [--include-credential <id> ...] [--list-credentials]`
    — write the envelope to disk or stdout. `--list-credentials` prints the
    detected credential rows so users can pick which `--include-credential`
    ids to pass.
  - `apicircle import apicircle <file>` (new source-type) — graft an
    envelope via `folder.import_apicircle`. Emits a re-attach note on
    stderr for any file-asset metadata that landed without bytes.
- **Re-attach toast:** importing an envelope that carries file-asset metadata
  now surfaces a one-time info toast pointing the user at **Global Assets →
  Global Files**, eliminating the previous silent-fail UX.
- **E2E:** new `e2e/web/folder-export.spec.ts` covering the kebab → modal →
  redact toggle → download → re-import round trip (intercepted via the
  Playwright `download` event).

### Encrypted env vars — Export-as-JSON now carries ciphertext (envelope v2)

- `apicircleEnvironment` envelope bumped from **v1 → v2**. Encrypted
  variables now travel with their ciphertext + per-slot salt + slot
  label, matching the contract Git push/pull has always had. On the
  destination, the row decrypts with the user's local slot value at
  request-execute time — no more forced manual rebind on every
  machine. v1 envelopes still parse for back-compat; the parser
  surfaces `payloadVersion: 1 | 2` so consumers can fork behavior.
- Import-side resolution split: when the source's salt matches a
  destination slot's salt (same workspace re-import, or two machines
  that genuinely share the slot value), the row re-points and works
  immediately. When the salts differ, a new slot is minted from the
  source's salt + label so the row binds to something self-consistent
  and the user is asked to provide the matching plaintext via the
  existing missing-slots gate. The colliding-id case (different
  source slot, same id by chance) generates a fresh id; the
  destination's slot stays untouched.
- `applyMutation` gains a new patch variant: `secretKey.upsert` —
  used by MCP `environment.import` to mint slot metadata atomically
  alongside the env upsert. The MCP response now includes
  `mintedSlots` so AI clients can surface what the user needs to
  provide. Headless writers (CLI, future automation) get the same
  surface.
- Plaintext slot VALUES still never leave the device. The change
  shipped here is symmetric with Git: ciphertext + slot-derivation
  parameters travel, the plaintext lives only on the user's machine.

### Encrypted env vars — Decrypt-failure banner on the Environments panel

- The resolver used to silently substitute `<MISSING:LABEL>` for ANY
  decryption failure — including the case where the user provided a
  slot value but it didn't decrypt the row's ciphertext (a re-keyed
  slot, a passphrase change, a typo on re-entry). The user only
  noticed when the request hit the wire with a literal
  `<MISSING:LABEL>` and the upstream returned a 400.
- The Environments panel now surfaces a per-env banner listing the
  rows that failed to decrypt with a concrete next step:
  _"`KEY_NAME` — slot `LABEL` — open the Vault dock and re-enter the
  slot value, or use the row's Unbind button to clear the value and
  type a fresh plaintext."_ `missing-slot-value` is intentionally
  excluded from the banner (the Vault's `ProvideMissingSlotsGate`
  already handles that case loudly enough); the banner focuses on
  `decrypt-failed` + `invalid-ciphertext` rows the user can't fix
  without more context.
- The wire request still carries `<MISSING:LABEL>` for the failed
  rows — that behavior is unchanged. The banner just tells the user
  WHICH slot failed and WHY before they see the wire response.
- New workspace-store surface: `envDecryptFailures` +
  `clearEnvDecryptFailures()`. `decryptEnvironments` returns
  structured failure reasons (`missing-slot-meta` /
  `missing-slot-value` / `invalid-ciphertext` / `decrypt-failed`)
  consumed by the banner and any future surfaces (e.g. a CLI warning
  on `apicircle run`).

### Encrypted env vars — Unbind no longer dead-ends on decrypt failure

- Clicking **Unbind** on an encrypted environment variable used to
  return a silent toast ("Could not unbind secret key") whenever the
  row's ciphertext couldn't be decrypted with this device's slot value
  — a common situation after pulling a workspace whose secret slot
  hasn't been re-provisioned, or after a passphrase change. The user
  was stuck: the only workaround was to rename the variable key, which
  forced the row out of the encrypted branch by side effect.
- Unbind now surfaces a confirm dialog when the soft decrypt path
  fails: _"`KEY_NAME` can't be decrypted on this device. Unbinding
  will clear the value to empty."_ On confirm, the binding is dropped
  and `value` is set to `''` so the user can type a fresh plaintext
  immediately. The happy path (this device CAN decrypt) is unchanged
  — the value is recovered to plaintext without a prompt.
- New store-action signature: `unbindVariableSecretKey(envName,
index, opts?)`. The optional `opts.force` flag bypasses the decrypt
  requirement and clears the value. UI callers run the soft path
  first, then re-invoke with `{ force: true }` after user confirms.
  External callers (MCP, CLI) keep the same default behaviour and can
  opt in.

### Secret Vault — "Set passphrase" CTA on web

- The Secret Vault dock now surfaces a **Set passphrase** call-to-action
  with a short rationale whenever the workspace has no `secretCrypto`
  blob configured on the web build. Previously, attempting to add a
  secret returned an error pointing at a "Set passphrase" button that
  didn't exist anywhere in the UI — a dead end for users who hadn't
  set one up. Clicking the CTA opens the existing passphrase-setup
  modal; on success the New-secret form is unlocked.
- A matching **Unlock secrets** CTA replaces the same slot when the
  workspace already has a passphrase but the in-memory key was cleared
  (cold start, idle-lock, browser refresh). Clicking it opens the
  unlock modal directly instead of forcing a failed-Save round trip.
- Defense-in-depth: if any flow still throws `SecretsNotProtectedError`
  (deep link, race, legacy tab), the Vault tab now intercepts it and
  opens the setup modal automatically instead of toasting a message
  that referenced a button the user couldn't find.
- New workspace-store surface: `passphraseModal`,
  `openPassphraseSetup()`, `openPassphraseUnlock()`,
  `closePassphraseModal()`. `PassphrasePromptModalGate` reads modal
  state from the store now instead of the dead local `setupOpen` state
  it carried before, so any flow can request the prompt.
- Desktop builds are unaffected — `safeStorage`-wrapped master keys
  already satisfy the platform secret gate, so the CTA isn't shown
  there.

### Import — API Circle environment exports round-trip with a "Provide secret values" bind step

- The unified **Import** modal under the "API Circle exchange" source now
  accepts environment exports (`{ "apicircleEnvironment": 1, ... }`) as
  well as folder exports. The dropdown entry sniffs the document's magic
  key and routes to the right parser, so the file the Environments
  sidebar's **Export as JSON** action produces can be re-imported on
  another machine (or back into the same workspace, where it lands under
  a collision-renamed `<name> (2)` slot) without any extra step.
- **Encrypted rows now travel with the slot's user-recognizable label.**
  The v1 envelope's encrypted-row shape gained an additive `secret.label`
  field alongside `secretKeyId`:
  ```json
  {
    "key": "TOKEN",
    "encrypted": true,
    "secretKeyId": "sec_abc",
    "secret": { "label": "PROD_TOKEN" }
  }
  ```
  Older readers (including the previous MCP validator) ignore the new
  field and still accept the row — strictly additive, no breaking
  change. Older exports without `secret.label` continue to import; the
  parser falls back to the variable key as the prompt label and flags
  it so the UI can hint "this label was synthesized".
- **The importer prompts you on import instead of silently storing dead
  bindings.** When the destination workspace doesn't have a matching
  vault slot for an encrypted row, the modal now switches into a
  second-step "Provide secret values" form listing each unresolved
  binding with a masked input. Filling a value creates a fresh vault
  slot under the source's label and binds the variable to it. The step
  is fully **skippable** — the env is already persisted, so a skip
  leaves the bindings dangling for later resolution under Environments.
- **Same-workspace re-imports stay quiet.** If the destination's
  `synced.secretKeys` already carries a slot whose id or label matches
  the export, the importer re-points the row's `secretKeyId` to that
  slot and skips the bind step entirely.
- Public surface from `@apicircle/core`:
  - `parseApicircleEnvironment(input)` /
    `parseApicircleEnvironmentDoc(doc)` →
    `ParsedApicircleEnvironment` (`name`, `variables`,
    `encryptedBindingHints`, `warnings`)
  - `EncryptedBindingHint` — `{ varKey, label, originSecretKeyId?,
labelFromFallback }`
  - `isApicircleEnvironment(doc)` discriminator
- New workspace store types + action:
  - `ApicircleEnvironmentPendingBinding` —
    `{ envName, varKey, label, labelFromFallback }`
  - `importApicircleEnvironment(parsed) → { name, pendingBindings,
warnings } | null` — collision-suffixes the env name, resolves
    encrypted hints against `synced.secretKeys` (id match, then label
    match), and returns the unresolved bindings for the UI to prompt.
- MCP `environment.import` routes through the same core parser. Response
  envelope grew a `pendingBindings` array and a `warnings` pass-through
  so AI clients can surface unresolved bindings to the user (or wire
  them up via the existing `addSecret` / bind tools). Error strings for
  malformed envelopes now match the user-facing message the modal
  surfaces, eliminating UI/MCP drift.
- Parser warnings (dropped rows, demoted encrypted rows, missing
  `secretKeyId`) now surface in the UI as an info toast after import
  instead of disappearing silently.
- This closes the asymmetry where the MCP `environment.import` tool
  already accepted the v1 envelope but the human-facing UI did not —
  the exporter, the bind step, the MCP path, and the env-panel are all
  in lockstep.

### Folder export — "Export as JSON" + API Circle exchange import

- Each folder's kebab menu now carries an **Export as JSON** action. Picking
  it opens a prompt that lists everything the export envelope will carry —
  the folder + its subtree of subfolders and requests, plus a
  **Global Asset dependencies** report broken down by:
  - **JSON Schemas** referenced via `Request.bodySchemaId` (embedded in
    the export so the importer can recreate them in Global Assets → JSON
    Schemas with a name+content dedupe pass)
  - **GraphQL definitions** referenced via `Request.graphqlSchemaId`
    (embedded — same dedupe pattern, by name + kind + source)
  - **Global files** referenced via binary attachments and form-data file
    rows (**metadata-only** — bytes stay in their Git LFS sidecars; the
    importer surfaces these so the user can re-attach them inside Global
    Assets → Global Files after import)
- The exporter emits a single self-describing JSON file
  (`<slug>.apicircle.json`) carrying the `format: "apicircle.folder/v1"`
  discriminator and a stable, indented serialization that round-trips
  byte-for-byte through the importer.
- The unified **Import** modal's `apicircle` source-format slot — previously
  a placeholder that displayed a "not yet importable" message — is now a
  real parser. The same modal accepts the exported file, shows the same
  dependency breakdown, and routes through the new
  `importApicircleFolder` workspace store action. Existing import paths
  (Postman v2.1, Postman environment, Insomnia v4, cURL) are unchanged.
- Public surface from `@apicircle/core`:
  - `collectFolderExport({ synced, folderId })` → `{ envelope, report }`
  - `serializeFolderExport(envelope)` → JSON string
  - `suggestFolderExportFilename(envelope)` → safe slug.apicircle.json
  - `parseApicircleFolderExport(input)` /
    `parseApicircleFolderExportDoc(doc)` →
    `ParsedApicircleFolderExport` with fresh ids, remapped refs, and
    warnings for any dangling references
  - `isApicircleFolderExport(doc)` discriminator + the
    `APICIRCLE_FOLDER_EXPORT_FORMAT` token
- All new code lands with co-located unit tests (Vitest) at 100% line,
  branch, function, and statement coverage; the editor sidebar +
  ImportModal integration is also covered.

### MCP — Prompts copy fixed, category renamed to Collections

- The MCP → Prompts cards now copy reliably: the click handler falls back
  to `document.execCommand('copy')` when `navigator.clipboard.writeText`
  is unavailable (HTTP, file://, embedded webview) and surfaces an error
  toast when the write actually fails instead of silently no-op'ing.
- Clicking a card now flashes an inline **Copied!** status tooltip next
  to the Copy badge (in addition to the existing toast), so the
  acknowledgement is anchored next to the affordance the user pressed.
- The singular **Workspace** category chip is renamed to **Collections**
  — the plural **Workspaces** (multi-workspace discovery) chip is
  unchanged. Type/id `McpPromptCategory` member `'workspace'` was
  renamed to `'collections'` along with the four prompt records that
  reference it.

### Default appearance reverts to One Dark Pro + System Sans

- New workspaces now boot in **One Dark Pro** with **System Sans** instead
  of the 1.0.5 defaults (Command Center + Cascadia Code). All built-in
  themes and fonts remain available in the Settings → Appearance pickers;
  this only changes the out-of-the-box look. Existing workspaces keep
  their saved preference.
- Updated runtime fallbacks across the UI store, CLI/core seeders, font
  picker, theme picker, Monaco bridge, the legacy-migration default in
  `workspaceStorage.hydrateWorkspace`, plus the matching unit + E2E specs.

### Font picker — auto-filter "no-op" options

- The Settings → Font family picker now hides any catalog entry whose stack
  silently falls through to the same OS face as your platform default. A
  webfont that failed to download, or a named family that isn't installed,
  no longer appears as an option you can "pick" without anything changing.
- Detection uses a canvas advance-width comparison against the
  `system-mono` and `system-sans` baselines, runs once per app load
  (cached), preloads every catalog webfont stylesheet so the measurement
  sees real metrics, and waits on `document.fonts.ready` before
  measuring.
- The currently-selected font is always force-included in the list — even
  if the detector would otherwise filter it — so a user whose saved font
  later stops loading can still see it and choose something else.
- New module `packages/ui-components/src/theme/fontAvailability.ts` plus
  unit tests; `ensureWebfontLink` is now exported from
  `theme/applyFont.ts` so the detector can preload stylesheets.

### MCP tool catalog — now 74 tools

- The catalog grows by two: `folder.export_json` and `folder.import_json`,
  the headless equivalents of the new **Export as JSON** / API Circle
  exchange import paths. The full enumeration lives in
  [`packages/shared/src/mcp.ts`](packages/shared/src/mcp.ts); the signatures
  - envelopes are documented in
    [`docs/mcp-tools-reference.md`](docs/mcp-tools-reference.md).
- `environment.import` gained a `pendingBindings` array in its response
  envelope so AI clients can surface unresolved encrypted-row bindings to
  the user (and wire them up via `secret.add` + the env-panel bind path).

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`,
`@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`,
`@apicircle/mcp-server`, `@apicircle/mock-server-core`,
`@apicircle/shared`, plus the e2e and example workspaces — all at
`1.0.7`.

## 1.0.5 - 2026-05-29

A theme and font expansion release. Studio's appearance catalog roughly
doubles, every theme gains a matched Monaco editor variant, and the
out-of-the-box look-and-feel switches to **Command Center** + **Cascadia
Code**.

### Themes — 30 new palettes

- 18 new dark presets: VS Code Dark, GitHub Dark Dimmed, Terminal Green,
  Terminal Amber, OLED Black, Carbon Dark, Slate Dark, Zinc Dark,
  Everforest Dark, Kanagawa Wave, Kanagawa Dragon, Horizon Dark, City
  Lights, Nightfox Dark, Command Center, Ink Dark, Muted Teal Dark, and
  Redwood Dark.
- 10 new light presets: VS Code Light, Xcode Light, Minimal Light,
  Porcelain Light, Cloud Light, Everforest Light, Kanagawa Lotus,
  Clarity Light, Nord Light, and Sage Light.
- 2 new high-contrast variants: GitHub Dark High Contrast and GitHub
  Light High Contrast.
- New `monacoThemes.ts` ships a matched Monaco editor variant for every
  preset, so the code editor recolors in lockstep with the shell.
- Supporting CSS-variable surface rewritten in
  `apps/web/src/styles/global.css` to back the broader palette set.

### Fonts — 20 new families

- 10 new monospace families: Noto Sans Mono, Martian Mono, Fragment
  Mono, Overpass Mono, Cousine, Courier Prime, PT Mono, Oxygen Mono,
  B612 Mono, Share Tech Mono.
- 10 new sans families: macOS System, Aptos, Public Sans, Noto Sans,
  Atkinson Hyperlegible, Lexend, Outfit, Sora, Barlow, Urbanist.

### New defaults

- The default theme is now **Command Center** (was One Dark Pro).
- The default font is now **Cascadia Code** (was System Sans).
- Existing workspaces keep their saved preference; only the
  out-of-the-box experience changes.

### Editor and CLI polish

- Cleaner spacing and focus styling in `AuthEditor`, `BodyTab`,
  `HeadersTab`, `KeyValueRows`, and `HeaderAutocomplete`.
- `apicircle` and `apicircle-mcp` now expose `--version` / `-v` / `-V`
  and `--help` / `-h` flags via new `bin/args.ts` parsers and an
  auto-generated `packageVersion.ts` constant per package.
- New Playwright spec `e2e/web/help-and-theme.spec.ts` covers the
  Settings → Help / Theme picker flow against the new catalog.

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`,
`@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`,
`@apicircle/mcp-server`, `@apicircle/mock-server-core`,
`@apicircle/shared`, plus the e2e and example workspaces — all at
`1.0.5`.

## 1.0.4 - 2026-05-29

The Global Assets and live-GitHub hardening release. This release makes file
uploads reusable across requests, mocks, linked workspaces, and headless
execution, then promotes the stabilized live GitHub suite to the canonical
`pnpm test:e2e:live-github` pipeline.

### Global Assets files

- Global Assets now includes a Files library alongside JSON Schemas and
  GraphQL definitions.
- Binary request bodies, form-data file rows, and mock binary responses can
  reference reusable Global File Assets.
- File asset metadata is tracked in `workspace.json`; file bytes are stored as
  Git blobs under `.apicircle/attachments/` so workspace diffs stay small and
  readable.
- Linked workspace panels show required attachments, file sizes, missing vs
  downloaded state, and the requests that require each file.
- Sending a request, retrying/replaying history, or running an execution plan
  now prompts to download missing required assets, verifies checksums, then
  continues execution. Canceling leaves execution stopped.
- `apicircle run` follows the same checksum-verified download path for
  headless execution plans.
- Deleting a Global File Asset clears request/mock mappings and is covered by
  diff, unit, and live GitHub E2E coverage.

### Canonical live GitHub suite

- The passing v2 live suite is now the only `e2e:live-github` implementation.
  Legacy `e2e/web/live/**` specs and the old `live-github.spec.ts` smoke have
  been removed.
- `chromium-live-github` now runs `e2e/web/live-github/**/*.spec.ts` only,
  single worker, against real `api.github.com`.
- The GitHub Actions workflow `e2e-live-github` runs on `main` pushes,
  nightly, and manual dispatch using bot-owned ephemeral repos.
- Required GitHub Actions configuration:
  - Variable: `APICIRCLE_E2E_BOT_OWNER`
  - Secrets: `APICIRCLE_E2E_BOT_PAT`,
    `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED`
- Coverage includes private/public linking, dedicated per-link PATs, release
  notes and on-demand updates, dependency diff buckets, snapshots, branch and
  workspace transitions, Global Assets, attachment download, and execution with
  linked assets.

### Documentation and onboarding

- README, QA docs, bot setup guide, Help Center content, and onboarding copy now
  describe Global Assets files, linked attachment downloads, CLI execution
  behavior, and the canonical live GitHub workflow.
- All workspace package manifests are bumped to `1.0.4` for the desktop release
  train.

## 1.0.3

A connect-and-share release. The MCP setup flow, AI-client onboarding, and community surfacing all got first-class treatment, and the web app now ships to GitHub Pages on every push.

### MCP connect flow

- New `HowToConnect` component drives per-client setup instructions in the MCP panel — Claude Desktop, ChatGPT, Cursor, Copilot, Continue, Cline, Zed, and Windsurf each get a tailored snippet.
- Centralized desktop-bridge contract (`@apicircle/ui-components/desktop`) so MCP config snippets, disk-mirror paths, and IPC handshakes share one typed entry point.
- MCP config snippets now expose path variants (binary vs npx vs absolute) and the right shape for each client's config file.
- README, `docs/connect-your-ai-client.md`, and the onboarding tour now agree on a single set of setup steps and call out the workspace disk mirror explicitly.

### Community section (Settings)

- New **Settings → Community** surface fetches live community stats (downloads, contributors, GitHub activity) with debounced caching in IndexedDB.
- `fetchCommunityStats`, `communityStorage`, and `externalLinks` helpers ship behind the section; desktop builds get a native download CTA via the new `desktopDownload` primitive.

### Web app deployment

- New `.github/workflows/deploy-web.yml` builds `apps/web` and deploys it to GitHub Pages on every push to `main` — the hosted web build is now continuously available.

### Bumped packages

`@apicircle/desktop`, `@apicircle/web`, `@apicircle/git`, `@apicircle/ui-components`, `@apicircle/cli`, `@apicircle/core`, `@apicircle/mcp-server`, `@apicircle/mock-server-core`, `@apicircle/shared`, plus the e2e and example workspaces — all at `1.0.3`.

## 1.0.2

The disk-mirror release. Workspaces can now live as plain JSON on disk alongside the IndexedDB store, and the MCP panel grew first-class connect / prompts / how-to surfaces.

### Disk-mirror workspaces

- New desktop `workspaceFileManager` + `workspaceFileBridge` IPC: persist a workspace to a directory on disk and round-trip it back into the store.
- `diskMirror` + `diskMirrorMerge` in `@apicircle/ui-components/persistence` keep the on-disk JSON in sync with IndexedDB, with debounced writes and three-way merge on refresh.
- `workspaceRegistry` in `@apicircle/core` and `resolveWorkspace` in `@apicircle/cli` give headless tools the same multi-workspace addressing model the UI uses.
- New CLI `apicircle workspaces` command — list, inspect, and resolve registered workspaces.
- `@apicircle/mcp-server` gained a `MultiWorkspaceProvider`, a `workspace.list` tool, and a `Workspaces` host abstraction so MCP clients can target a specific workspace.

### MCP panel refresh

- `McpServerPanel` split into focused sections: `ConnectionSection`, `HowToConnectSection`, `PromptsSection`, with typed panel state in `mcpPanelTypes` and a curated `mcpPrompts` catalog.
- New `McpSidebar` navigation and richer Help Center content for MCP setup.

### Stability & UX

- Mock-server shutdown now reports progress and surfaces a `CloseConfirmModal` for unsaved work on app exit.
- New `PanelErrorBoundary` primitive catches per-panel render errors without taking down the shell.
- Monaco editor base hardening + validator tightening in `@apicircle/shared`.

### Release & CI

- New `.github/workflows/release.yml` automates `@apicircle/*` package publishing to npm via changesets.
- Vite `base` set to relative so the built `index.html` references assets correctly when served from a sub-path.
- All GitHub Actions workflows bumped to current action versions.

## 1.0.1

A release-tooling patch. No app-facing behavior changes — focus was getting the desktop installers and CI pipeline ready for the public release.

### Desktop release pipeline

- Hardened `.github/workflows/desktop-release.yml`: installs deb tooling, guards mac code-signing on empty env vars, and enforces a tag guard so the workflow only fires on release tags.
- Added Debian metadata (`maintainer`, `synopsis`, `description`) to `apps/desktop/package.json` so the `.deb` artifact passes lintian.
- Switched the desktop main-process build to `tsup` (`apps/desktop/tsup.config.ts`) for faster, more predictable bundling.

### CI fixes

- `scripts/render-icons.mjs` now degrades gracefully when Playwright's browser dependency isn't installed, so the icon-render step no longer blocks the build.
- CodeQL workflow updates to align with the public-release branch protections.

## 1.0.0

First public release of API Circle Studio — a Git-native, AI-native API workspace.

### Workspace & Git sync

- Two-document workspace model (synced + local) with stable JSON serialization for clean Git diffs.
- GitHub sync: PAT connect with scope guidance, auto-branch, push (including attachments), PR creation, on-demand refresh, and 3-way conflict resolution.
- Link Workspace + releases: private and public links, marketplace search, cached collections, version pinning, and a changelog viewer.

### Requests & execution

- 17 authentication schemes, all end-to-end functional — Bearer, Basic, API key, custom header, the full OAuth2 grant set, AWS SigV4, Digest, NTLM, Hawk, and JWT.
- Imports: cURL, OpenAPI / Swagger, Postman, Insomnia, and HAR.
- Environments with priority ordering, assertions, and multi-step execution plans.

### Platform surfaces

- **Local mock servers** — a Hono-based engine that serves OpenAPI / Postman / Insomnia specs on localhost.
- **MCP server** — exposes the workspace as a tool catalog any Model Context Protocol client can drive.
- **CLI** — `apicircle mock | mcp | import | run` for headless and CI use.
- **Desktop app** (Electron) with OS-keychain secret storage, plus the web app and embeddable npm packages.

### Published packages

`@apicircle/shared`, `@apicircle/core`, `@apicircle/mock-server-core`, `@apicircle/mcp-server`, and `@apicircle/cli` — all at `1.0.0`.
