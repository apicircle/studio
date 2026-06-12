# API Circle Studio — VS Code Extension Install & Publish Guide

Status: Phase 12 alpha. The extension is feature-complete (79 MCP tools, 9
sidebar views, embedded MCP host, plan notebooks, test controller, mock
visual editor, secret vault, etc.). This document covers (1) installing
the unpublished extension locally for testing and (2) publishing it to
the VS Code Marketplace + Open VSX Registry.

---

## Part 1 — Local install

There are **three** ways to run the extension on your machine.

### Option A — Extension Development Host (recommended for development)

The fastest dev loop. VS Code launches a second window with the
unpublished extension loaded; edits to source rebuild on save.

1. Clone the repo and install workspace deps:

   ```bash
   git clone https://github.com/apicircle/studio.git
   cd studio
   pnpm install
   ```

2. Build the extension once so `dist/extension.mjs` exists:

   ```bash
   pnpm --filter @apicircle/vscode build
   ```

3. Open `apps/vscode/` in VS Code:

   ```bash
   code apps/vscode
   ```

4. Press **F5** (or **Run → Start Debugging**). VS Code spawns a new
   window titled `[Extension Development Host]` with the extension
   loaded. The first window is the debugger.

5. Iterate: edit `apps/vscode/src/**/*.ts`, run
   `pnpm --filter @apicircle/vscode build` (or run tsup in watch:
   `pnpm --filter @apicircle/vscode build --watch`), then reload the
   Extension Development Host window with **Ctrl/Cmd+R**.

**Engine requirement:** VS Code **1.94 or newer** (the extension uses
ESM module loading, which stable VS Code added in 1.94). Verify via
**Help → About**.

### Option B — Install from packaged .vsix (preview the published shape)

This packages the extension as a `.vsix` file — exactly what the
Marketplace serves to end users — and side-loads it.

1. Build + package:

   ```bash
   pnpm --filter apicircle-vscode build
   cd apps/vscode
   pnpm exec vsce package --no-dependencies
   ```

   Produces `apicircle-vscode-0.1.0.vsix` (~1.3 MB compressed) in
   `apps/vscode/`.

   > **Why `--no-dependencies` is required.** The workspace lives under
   > pnpm with `workspace:*` deps. `vsce`'s default code path runs
   > `npm list --production` to enumerate runtime deps for the .vsix —
   > npm doesn't understand the `workspace:*` protocol and aborts. The
   > `--no-dependencies` flag skips that walk. Our extension's runtime
   > deps are all bundled into `dist/extension.mjs` by tsup (every
   > `@apicircle/*` package + the MCP SDK + Hono runtime are
   > `noExternal`), so the .vsix doesn't need any of them in
   > `node_modules` — the bundle is fully self-contained.

   > **If you see** `ERROR Invalid extension "name": "@apicircle/vscode"`:
   > you're on an older checkout. The workspace package was renamed to
   > the unscoped `apicircle-vscode` in P13 because vsce rejects
   > scoped names. Pull latest + re-run `pnpm install`.

2. Install in your everyday VS Code (not the development host):

   ```bash
   code --install-extension apicircle-vscode-0.1.0.vsix
   ```

   Or via the VS Code UI: **Extensions** view → `...` menu (top right of
   the panel) → **Install from VSIX...** → pick the file.

3. Reload VS Code. Open the APICircle Activity Bar icon (square with the
   API/MCP logo). The 9 sidebar views activate.

**Uninstall:**

```bash
code --uninstall-extension apicircle.apicircle-vscode
```

### Option C — Direct copy into your VS Code extensions directory (one-shot try)

Skips the .vsix packaging step but isn't recommended for daily use
(future VS Code updates won't manage the install).

1. Build the extension (as above).
2. Copy `apps/vscode/` (excluding `node_modules/.cache`, `test/`, and
   source) to:
   - **Windows:** `%USERPROFILE%\.vscode\extensions\apicircle.apicircle-vscode-0.1.0\`
   - **macOS:** `~/.vscode/extensions/apicircle.apicircle-vscode-0.1.0/`
   - **Linux:** `~/.vscode/extensions/apicircle.apicircle-vscode-0.1.0/`
3. Restart VS Code.

For most users, **Option B (.vsix install)** is the right choice — it
matches what marketplace users get and survives VS Code updates.

### First-run checklist after install

Whichever method you pick, after the extension activates:

- [ ] APICircle Activity Bar icon appears
- [ ] 9 sidebar views render: Editor, Environment, Execution, Mock,
      History, Snapshots, MCP, Marketplace, Help
- [ ] Run `APICircle: Create New Workspace` from the command palette
      (Ctrl/Cmd+Shift+P). Pick a folder. The extension scaffolds
      `.apicircle/workspace.json` + opens the views.
- [ ] Send a request from the Editor view to validate end-to-end.

---

## Part 2 — Publish plan

Publishing to the marketplace involves two stores:

| Store                         | URL                                         | Audience                                       |
| ----------------------------- | ------------------------------------------- | ---------------------------------------------- |
| **Visual Studio Marketplace** | https://marketplace.visualstudio.com/vscode | Microsoft VS Code (stable + Insiders)          |
| **Open VSX Registry**         | https://open-vsx.org/                       | VS Code forks (Cursor, VSCodium, Gitpod, etc.) |

**Recommendation: publish to BOTH** so users on Cursor / VSCodium can
install the extension via their built-in marketplace UI.

### Step 0 — Pre-publish readiness audit

The following gaps MUST be closed before the first publish. Some are
required by `vsce` and will block packaging; others are marketplace
quality signals.

| #       | Gap                                         | Required for publish? | Action                                                                                                                                                                                                                                |
| ------- | ------------------------------------------- | --------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **0.1** | ~~PNG icon~~ — ✅ **DONE**                  | Required              | `apps/vscode/media/icon-marketplace.png` (128×128 RGBA, 12.81 KB) reuses the desktop app's pre-rendered icon. `"icon": "media/icon-marketplace.png"` + `galleryBanner.color: "#1f1b2e"` (dark) wired into `apps/vscode/package.json`. |
| **0.2** | ~~LICENSE file~~ — ✅ **DONE**              | Required              | `apps/vscode/LICENSE` copied from root. `vsce` automatically packages it as `LICENSE.txt` inside the .vsix (4.76 KB) — appears on the Marketplace listing page.                                                                       |
| **0.3** | **Marketplace README**                      | **Required**          | `apps/vscode/README.md` exists. Verify it has install-by-marketplace instructions, screenshots, and a feature list — it's the listing page.                                                                                           |
| **0.4** | **CHANGELOG.md**                            | Recommended           | Marketplace shows this on the listing page. Today `apps/vscode/` doesn't have one — root `CHANGELOG.md` covers it. Add `apps/vscode/CHANGELOG.md` (can symlink or be a curated subset).                                               |
| **0.5** | **Gallery banner color**                    | Optional              | `package.json → galleryBanner.color` sets the listing-page header background. Pick a brand color (e.g. the `var(--purple)` accent).                                                                                                   |
| **0.6** | **Verified publisher** badge                | Optional              | Marketplace tags verified publishers with a check mark. Requires linking a Microsoft account to a custom domain or proof of ownership.                                                                                                |
| **0.7** | **Code signing / supply chain**             | Optional              | The marketplace can sign extensions; not required for publish.                                                                                                                                                                        |
| **0.8** | **`repository`, `bugs`, `homepage` fields** | Recommended           | Already set in `apps/vscode/package.json`. Verify URLs work.                                                                                                                                                                          |

### Step 1 — Publisher account

1. **Microsoft account** — sign in to https://aka.ms/vscode-create-publisher
2. **Create a publisher** with id `apicircle` (already declared in
   `package.json → publisher`).
3. **Generate a Personal Access Token (PAT)** with the
   **Marketplace → Manage** scope at https://dev.azure.com/[org]/_usersSettings/tokens
4. Login locally:
   ```bash
   pnpm exec vsce login apicircle
   # Paste the PAT when prompted
   ```
   Credentials are saved to `~/.vsce` (gitignored).

For Open VSX:

1. Create an account at https://open-vsx.org/ via GitHub OAuth.
2. Generate an access token under your profile.
3. Login: `pnpm exec ovsx login` (or set `OVSX_PAT` env var).

### Step 2 — Manual first publish (dry run)

Before automating, do one publish by hand to catch surprises.

```bash
cd apps/vscode

# 1. Bump version. First publish: keep at 0.1.0. Future: vsce auto-bumps via --patch / --minor / --major.
pnpm exec vsce package --no-dependencies
#    → produces apicircle-vscode-0.1.0.vsix (~1.3 MB compressed)
#    Verify with: ls -lh *.vsix
#    Inspect contents with: unzip -l apicircle-vscode-0.1.0.vsix | head -50

# 2. Publish to Marketplace
pnpm exec vsce publish --no-dependencies
#    Output should end with: "Published apicircle.apicircle-vscode v0.1.0"
#    Listing live at: https://marketplace.visualstudio.com/items?itemName=apicircle.apicircle-vscode

# 3. Publish to Open VSX
pnpm exec ovsx publish apicircle-vscode-0.1.0.vsix
#    Listing live at: https://open-vsx.org/extension/apicircle/apicircle-vscode
```

### Step 3 — Automated release via GitHub Actions

The repo already has `.github/workflows/release.yml` for the
`@apicircle/*` npm packages. Mirror that pattern for the extension.

**Create `.github/workflows/vscode-marketplace.yml`:**

```yaml
name: Publish VS Code extension

on:
  push:
    tags:
      - 'vscode-v*' # Triggers on tags like vscode-v0.1.0

jobs:
  publish:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v6
        with:
          fetch-depth: 0

      - uses: pnpm/action-setup@v6
        with:
          version: 9.15.0

      - uses: actions/setup-node@v6
        with:
          node-version: 20
          cache: pnpm

      - run: pnpm install --frozen-lockfile
      - run: pnpm --filter @apicircle/vscode check
      - run: pnpm --filter @apicircle/vscode lint
      - run: pnpm --filter @apicircle/vscode test
      - run: pnpm --filter @apicircle/vscode build
      - run: node scripts/check-vscode-bundle.mjs

      - name: Package extension
        working-directory: apps/vscode
        run: pnpm exec vsce package --no-dependencies

      - name: Publish to VS Code Marketplace
        working-directory: apps/vscode
        env:
          VSCE_PAT: ${{ secrets.VSCE_PAT }}
        run: pnpm exec vsce publish --no-dependencies --pat "$VSCE_PAT"

      - name: Publish to Open VSX
        working-directory: apps/vscode
        env:
          OVSX_PAT: ${{ secrets.OVSX_PAT }}
        run: pnpm exec ovsx publish *.vsix --pat "$OVSX_PAT"
```

**Required GitHub Secrets:**

- `VSCE_PAT` — the Marketplace PAT from Step 1
- `OVSX_PAT` — the Open VSX token from Step 1

**Release flow once wired:**

```bash
# Bump version + commit
cd apps/vscode
pnpm exec vsce package --pre-release   # OR --patch / --minor / --major
git add package.json apicircle-vscode-*.vsix
git commit -m "release: vscode-v0.1.1"
git tag vscode-v0.1.1
git push origin main --tags

# GitHub Actions takes over → publishes to both marketplaces
```

### Step 4 — Post-publish checklist

After the first publish:

- [ ] Install from Marketplace in a clean VS Code: confirm activation + commands resolve.
- [ ] Install from Open VSX in Cursor: confirm same.
- [ ] Verify listing page rendering (icon, banner, README, screenshots).
- [ ] Watch the first 24h for crash reports via the Marketplace's
      review/issue surface + the repo's issue tracker.
- [ ] Update `docs/installing.md` to mention the Marketplace as a
      primary install path (today it only covers desktop installers).

### Pre-release vs. stable

The Marketplace supports `--pre-release` flag — extensions installed
this way auto-update only when the user opts in. Recommend the first
3-4 versions ship as pre-release while you collect feedback, then
flip the toggle.

```bash
pnpm exec vsce publish --pre-release
```

### Versioning convention

| Version | Phase                        | When                                           |
| ------- | ---------------------------- | ---------------------------------------------- |
| `0.1.0` | Phase 12 close (current)     | First publish — alpha, pre-release             |
| `0.2.0` | Stable feature-set milestone | After ~3 months of pre-release feedback        |
| `1.0.0` | Production-ready             | After two stable releases without showstoppers |

Keep the extension's version independent from `@apicircle/*` npm
package versions (which are currently `1.0.9`) — extension users care
about the Marketplace version line, not the underlying packages.

---

## Quick reference

| Task                | Command                                                 |
| ------------------- | ------------------------------------------------------- |
| Build for dev       | `pnpm --filter @apicircle/vscode build`                 |
| Run in dev host     | Open `apps/vscode/` in VS Code → **F5**                 |
| Package .vsix       | `cd apps/vscode && pnpm exec vsce package`              |
| Install local .vsix | `code --install-extension apicircle-vscode-0.1.0.vsix`  |
| Uninstall           | `code --uninstall-extension apicircle.apicircle-vscode` |
| Publish Marketplace | `pnpm exec vsce publish` (after `vsce login apicircle`) |
| Publish Open VSX    | `pnpm exec ovsx publish *.vsix` (after `ovsx login`)    |
| Tag + push for CI   | `git tag vscode-v0.1.0 && git push origin --tags`       |

See also:

- [`docs/vscode-extension.md`](vscode-extension.md) — 12-phase developer guide
- [`docs/installing.md`](installing.md) — desktop app install (separate surface)
- [`docs/connect-your-ai-client.md`](connect-your-ai-client.md) — MCP client wiring
