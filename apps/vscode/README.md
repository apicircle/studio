# API Circle Studio

Git-backed API workspace with mocks, plans, and MCP — natively in VS Code.

Edit your API Circle workspace **inside VS Code**. The same `.apicircle/` workspace directory you commit to Git, edit in the [API Circle Desktop App](https://github.com/apicircle/studio), or open in the [API Circle Web App](https://studio.apicircle.dev) — one repo, three surfaces, byte-identical commits.

## Why

VS Code is where the same engineers who use API Circle already live with Git. Editing your API workspace inline removes the context switch from editor → API client → back. Because the canonical workspace lives in your repo's `.apicircle/` folder, VS Code's native Git extension tracks every change — no separate sync, no separate auth, no separate review surface.

## Features

### Workspace & navigation

- **Activity Bar icon** opens the API Circle sidebar with 9 views: Workspace, Editor, Environment, Execution, Mock, History, Snapshots, MCP, and Link Workspaces.
- **Workspace discovery** auto-detects `.apicircle/registry.json` in your open folders and Git-backed `.apicircle/` directories.
- **Workspace switcher** — switch between discovered workspaces via the sidebar or `APICircle: Switch Workspace`.
- **`apicircle:` virtual filesystem** — requests, environments, plans, mocks, folders, and responses project as YAML documents in real VS Code text editors. Human-readable tab titles, folder paths in tooltips, identity preserved across renames and moves.

### Request authoring & execution

- **Request templates** — six starter shapes via `APICircle: New Request from Template…` (Simple GET, JSON POST, Bearer-protected GET, Paginated GET, GraphQL query, REST CRUD scaffold).
- **CodeLens helpers** — `▶ Send`, `✚ Add section…`, `⤵ New from template…` above each request YAML. In-flight requests swap to `⏳ Sending… · ✖ Cancel`.
- **All 17 auth types** — none, bearer, basic, api-key, digest, NTLM, Hawk, AWS Signature v4, JWT bearer, and all OAuth 2.0 grants (Authorization Code, PKCE, Client Credentials, Password, Implicit, Device Code, private_key_jwt, token refresh).
- **Folder-wise auth** — set auth on a folder; child requests inherit via `◆ Inherits from <Folder>` CodeLens.
- **URL-as-source-of-truth** — query parameters and path placeholders sync from the URL into structured sections on save.
- **Response viewer** as a virtual `.run.yaml` opened side-by-side — appears instantly on ▶ Send, resolves in place.
- **Cancel in-flight requests** via status bar, `Esc`, or the `✖ Cancel` CodeLens.
- **Pre-send diagnostics** surfacing in the Problems panel.

### Mock servers

- **Mock endpoint authoring in YAML** — `*.endpoint.yaml` with field-level `◆` CodeLens editors on method, status, headers, body type, response rules, and multipliers.
- **Validation rules** — `🛡 Add validation rule` with kind-aware pickers for headers, query params, cookies, and path params.
- **Request schema editing** on all surfaces (VS Code YAML, Web/Desktop editor, and MCP).
- **In-process mock server lifecycle** — start, stop, and manage mocks from the sidebar.

### MCP integration

- **94-tool MCP catalog** for AI clients — Claude Desktop, Claude Code, Codex, Cursor, Copilot, Windsurf, Zed, Continue, Cline.
- **One-click Copilot Chat install** — writes `.vscode/mcp.json` idempotently.
- **Per-client config snippets** — copy or direct-install MCP configuration.
- **Curated prompts** — 19 starter prompts across 7 categories in the MCP sidebar.

### Secret vault

- Passphrase-protected AES-GCM encrypted secret storage.
- Auto-lock by inactivity, clipboard auto-clear.
- Encrypted environment variable reveal via `apicircle.openVaultEntry`.

### Link Workspaces

- **Publish releases** — tag, deprecate, and withdraw versions via `releases.yaml` CodeLens.
- **Consume linked workspaces** — link private repos or marketplace results, pin versions, manage scopes and required secrets.
- **Three-way update review** — preview incoming changes, accept source or keep yours per-field.

## The three-surface principle

API Circle Studio's Web App, Desktop App, and VS Code extension are **peer clients of the same canonical format**:

```
<your-repo>/.apicircle/registry.json                     # workspace index
<your-repo>/.apicircle/workspace-<id>/workspace.json      # per-workspace doc
```

Edit on any surface → commit → push → pull elsewhere → continue. No translation, no dialect, no per-surface fork. Device-local data (history, secrets, sessions) stays per-machine in each surface's managed storage.

## Installation

Install from the [Visual Studio Marketplace](https://marketplace.visualstudio.com/items?itemName=apicircle.apicircle-vscode) or the [Open VSX Registry](https://open-vsx.org/extension/apicircle/apicircle-vscode):

> **Extensions** view → search **API Circle Studio** → **Install**

Or build the `.vsix` locally:

1. Clone [the repo](https://github.com/apicircle/studio).
2. `pnpm install && pnpm --filter apicircle-vscode build`
3. `cd apps/vscode && pnpm exec vsce package --no-dependencies`
4. Install via **Extensions: Install from VSIX…** in the command palette.

See [`docs/vscode-extension-install-publish.md`](../../docs/vscode-extension-install-publish.md) for the full guide.

## License

See repo-root [LICENSE](../../LICENSE).
