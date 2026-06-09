# APICircle Studio for VS Code

> **Alpha — early development.** Not yet published to the Marketplace.

Edit your APICircle workspace **inside VS Code**. The same `.apicircle/workspace.json` you commit to Git, edit in the [APICircle Desktop App](https://github.com/apicircle/studio), or open in the [APICircle Web App](https://studio.apicircle.dev) — one repo, three surfaces, byte-identical commits.

## Why

VS Code is where the same engineers who use APICircle already live with Git. Editing your API workspace inline removes the context switch from editor → API client → back. And because the canonical workspace lives in your repo's `.apicircle/` folder, VS Code's native Git extension tracks every change — no separate sync, no separate auth, no separate review surface.

## What ships in v0.1 alpha

- **Activity Bar icon** that opens an APICircle sidebar with Editor / Environment / Execution / Mock / History / MCP views.
- **Workspace discovery** — auto-detects `.apicircle/workspace.json` in your open folders.
- **`apicircle:` virtual filesystem** projecting requests as YAML documents you edit in a real VS Code text editor.
- **HTTP request execution** for `none` / `bearer` / `basic` / `api-key` auth plus JSON / text bodies.
- **Response viewer** as a virtual `.run.yaml` document opened side-by-side.
- **Cancel in-flight requests** via status bar or `Esc`.
- **Pre-send validation** surfacing as diagnostics in the Problems panel.

More features land each phase. See the [project roadmap](https://github.com/apicircle/studio) for what's next.

## The three-surface principle

APICircle Studio's Web App, Desktop App, and VS Code extension are **peer clients of the same canonical format**. The Git-tracked file is always at:

```
<your-repo>/.apicircle/workspace.json
```

Edit on any surface → commit → push → pull elsewhere → continue. No translation, no dialect, no per-surface fork. Device-local data (history, secrets, sessions) stays per-machine in each surface's managed storage.

## Installation (alpha sideload)

1. Clone this repo.
2. `pnpm install && pnpm --filter @apicircle/vscode build`
3. `pnpm --filter @apicircle/vscode package` produces `apicircle-vscode-0.1.0.vsix`.
4. Install via `Extensions: Install from VSIX…` in VS Code's command palette.

## License

See repo-root [LICENSE](../../LICENSE).
