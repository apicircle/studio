# Changelog

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
