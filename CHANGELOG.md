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
