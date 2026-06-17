import * as vscode from 'vscode';
import { projectRequestYaml } from '../fs/requestYaml';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// onWillSaveTextDocument hook for apicircle:// request YAMLs.
//
// The FS provider's `writeFile` runs `parseRequestFromYaml` and stores the
// canonical Request shape — `?key=val` typed into `url:` is split into the
// `query:` block, `{name}` placeholders surface as `pathParams:` entries, etc.
// But VS Code's editor buffer keeps showing the literal text the user typed;
// the canonical projection only appears the next time the doc is opened.
//
// This hook closes that gap: before save proceeds, we run the buffer through
// the same parse → serialize round-trip and, if the canonical projection
// differs, return a TextEdit replacing the buffer with the projection. The
// user sees a single Ctrl+S that:
//   - moves the `?…` portion of `url:` into the `query:` block,
//   - fills `pathParams:` slots for new `{name}` placeholders,
//   - then saves the canonical YAML.
//
// Parser errors here are silent — the FS provider's `writeFile` will throw the
// `FileSystemError.NoPermissions` next, which is the right place to surface
// the message (the on-will-save hook can't show one without blocking the save
// flow). Non-apicircle URIs and non-request YAMLs are skipped so the hook
// doesn't fire on every keystroke-save across the workspace.
// =============================================================================

export function registerRequestSyncOnSave(): vscode.Disposable {
  return vscode.workspace.onWillSaveTextDocument((event) => {
    const uri = event.document.uri;
    if (uri.scheme !== 'apicircle') return;
    if (uriEntityKind(uri) !== 'request') return;
    const buffer = event.document.getText();
    const projected = projectRequestYaml(buffer);
    if (projected === null) return;
    const fullRange = new vscode.Range(
      event.document.positionAt(0),
      event.document.positionAt(buffer.length),
    );
    event.waitUntil(Promise.resolve([vscode.TextEdit.replace(fullRange, projected)]));
  });
}
