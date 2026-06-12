# API Circle Studio for VS Code

> **Alpha — early development.** Not yet published to the Marketplace.

Edit your API Circle workspace **inside VS Code**. The same `.apicircle/workspace.json` you commit to Git, edit in the [API Circle Desktop App](https://github.com/apicircle/studio), or open in the [API Circle Web App](https://studio.apicircle.dev) — one repo, three surfaces, byte-identical commits.

## Why

VS Code is where the same engineers who use APICircle already live with Git. Editing your API workspace inline removes the context switch from editor → API client → back. And because the canonical workspace lives in your repo's `.apicircle/` folder, VS Code's native Git extension tracks every change — no separate sync, no separate auth, no separate review surface.

## What ships in v0.1 alpha

- **Activity Bar icon** that opens an API Circle sidebar with Editor / Environment / Execution / Mock / History / Snapshots / MCP views.
- **Request templates** — six starter shapes (Simple GET, JSON POST, Bearer-protected GET, Paginated GET, GraphQL query, REST CRUD scaffold) via `APICircle: New Request from Template…`.
- **CodeLens helpers** above each request YAML — `▶ Send`, `✚ Add section…` (insert any optional section via quick-pick), `⤵ New from template…`. While a send is in flight the row swaps to `⏳ Sending… (1.2s) · ✖ Cancel` so you can see the click landed and abort without leaving the editor.
- **Workspace discovery** — auto-detects `.apicircle/workspace.json` in your open folders.
- **`apicircle:` virtual filesystem** projecting requests as YAML documents you edit in a real VS Code text editor. Tab titles are the request name (e.g. `Login.req.yaml`), folder path lives in the tab tooltip, and the identifier is hidden in the URI query so renames update the tab automatically.
- **HTTP request execution** for `none` / `bearer` / `basic` / `api-key` auth plus JSON / text bodies.
- **Response viewer** as a virtual `.run.yaml` document opened side-by-side. The tab appears the instant you click ▶ Send with a "Sending…" placeholder, then swaps in the real response (or a "Cancelled" / "Failed" notice) in place when the executor resolves — no flicker, focus stays on the request editor.
- **Cancel in-flight requests** via status bar, `Esc`, or the new `✖ Cancel` CodeLens (per-tab cancel).
- **Pre-send validation** surfacing as diagnostics in the Problems panel.
- **Mock endpoint authoring in YAML** — `🛡 Add validation rule` drops a prefilled request-validation gate into the `*.endpoint.yaml`, then kind-aware `◆ Kind · ◆ Target · ◆ Value` CodeLenses reshape the rule and let you pick the header / query / cookie name and expected value from the endpoint's declared params plus the curated header catalogue — no dialog chains.
- **Field-level CodeLens editors everywhere** in the endpoint YAML — a `◆` lens on each method / status / header key+value / body type, on every response-rule `when`-clause scope/op/target (plus `✚ Add condition`), and on each response multiplier's source kind/key and target path (which discovers the array paths in your default-response body). Each picker is kind-aware. The `*.mock.yaml` summary gives every endpoint an `↗ Open endpoint` lens.

More features land each phase. See the [project roadmap](https://github.com/apicircle/studio) for what's next.

## The three-surface principle

API Circle Studio's Web App, Desktop App, and VS Code extension are **peer clients of the same canonical format**. The Git-tracked file is always at:

```
<your-repo>/.apicircle/workspace.json
```

Edit on any surface → commit → push → pull elsewhere → continue. No translation, no dialect, no per-surface fork. Device-local data (history, secrets, sessions) stays per-machine in each surface's managed storage.

## Installation

Once 1.1.0 is published to the Marketplace, install the normal way:
**Extensions** view → search **API Circle Studio** → **Install**. Until
then, build the .vsix locally:

1. Clone this repo.
2. `pnpm install && pnpm --filter apicircle-vscode build`
3. `cd apps/vscode && pnpm exec vsce package --no-dependencies` produces `apicircle-vscode-1.1.0.vsix`.
4. Install via `Extensions: Install from VSIX…` in VS Code's command palette.

For the full guide (Marketplace publish, Open VSX, GitHub Actions
release workflow), see
[`docs/vscode-extension-install-publish.md`](../../docs/vscode-extension-install-publish.md).

## License

See repo-root [LICENSE](../../LICENSE).
