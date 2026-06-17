import * as vscode from 'vscode';
import { uriEntityKind } from '../fs/uriKind';

// =============================================================================
// CodeLens provider for linked-workspace YAML documents (`.yaml`).
//
//   Above `name:`                 ⟳ Refresh ledger · 📓 Changelog · ⊗ Unlink
//                                 ◆ Name
//   Above `description:`          ◆ Description
//   Above `pinnedVersion:`        ◆ Pinned version   (pick from cached ledger)
//   Above `scope:`                ◆ Scope            (collections / environments)
//   Above `sessionMode:`          ◆ Session mode     (workspace / dedicated)
//   Above `requiredSecretKeyIds:` ✚ Add required key
//   On each required-key row      ⊘ Remove
//
// Field commands re-derive everything from the document URI (`?id=`), so the
// lens just passes the URI (and, for per-key removal, the key value).
// =============================================================================

const NAME_RE = /^name:/;
const DESCRIPTION_RE = /^description:/;
const PINNED_RE = /^pinnedVersion:/;
const SCOPE_RE = /^scope:/;
const SESSION_RE = /^sessionMode:/;
const REQKEYS_RE = /^requiredSecretKeyIds:/;
const LIST_ITEM_RE = /^\s+-\s+(.+?)\s*$/;
const TOP_LEVEL_RE = /^[A-Za-z]/;

export class LinkCodeLensProvider implements vscode.CodeLensProvider, vscode.Disposable {
  private readonly _onDidChange = new vscode.EventEmitter<void>();
  readonly onDidChangeCodeLenses: vscode.Event<void> = this._onDidChange.event;

  dispose(): void {
    this._onDidChange.dispose();
  }

  refresh(): void {
    this._onDidChange.fire();
  }

  provideCodeLenses(
    document: vscode.TextDocument,
    _token: vscode.CancellationToken,
  ): vscode.CodeLens[] {
    if (document.uri.scheme !== 'apicircle') return [];
    if (uriEntityKind(document.uri) !== 'link') return [];
    const uri = document.uri;
    const lenses: vscode.CodeLens[] = [];

    for (let line = 0; line < document.lineCount; line++) {
      const text = document.lineAt(line).text;
      const range = new vscode.Range(line, 0, line, text.length);

      if (NAME_RE.test(text)) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '⤓ Review update',
            tooltip: 'Three-way review + apply of a newer source version.',
            command: 'apicircle.reviewLinkedUpdate',
            arguments: [uri],
          }),
          new vscode.CodeLens(range, {
            title: '⟳ Refresh ledger',
            tooltip:
              'Pull the latest release history (and bootstrap snapshot) from the source repo.',
            command: 'apicircle.refreshLinkedWorkspace',
            arguments: [uri],
          }),
          new vscode.CodeLens(range, {
            title: '📓 Changelog',
            tooltip: 'Show the cached release history for this linked workspace.',
            command: 'apicircle.showLinkedChangelog',
            arguments: [uri],
          }),
          new vscode.CodeLens(range, {
            title: '⊗ Unlink',
            tooltip: 'Remove this link (the source repo is untouched).',
            command: 'apicircle.unlinkWorkspace',
            arguments: [uri],
          }),
          new vscode.CodeLens(range, {
            title: '◆ Name',
            command: 'apicircle.setLinkNameField',
            arguments: [uri],
          }),
        );
        continue;
      }
      if (DESCRIPTION_RE.test(text)) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '◆ Description',
            command: 'apicircle.setLinkDescriptionField',
            arguments: [uri],
          }),
        );
        continue;
      }
      if (PINNED_RE.test(text)) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '◆ Pinned version',
            tooltip: 'Pin to a version from the cached ledger, or track the source branch HEAD.',
            command: 'apicircle.setLinkPinnedVersionField',
            arguments: [uri],
          }),
        );
        continue;
      }
      if (SCOPE_RE.test(text)) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '◆ Scope',
            command: 'apicircle.setLinkScopeField',
            arguments: [uri],
          }),
        );
        continue;
      }
      if (SESSION_RE.test(text)) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '◆ Session mode',
            command: 'apicircle.setLinkSessionModeField',
            arguments: [uri],
          }),
        );
        // Dedicated sessions store a per-link PAT in SecretStorage.
        const mode = text.split(':')[1]?.trim().replace(/['"]/g, '');
        if (mode === 'dedicated') {
          lenses.push(
            new vscode.CodeLens(range, {
              title: '🔑 Set token',
              tooltip: 'Store the dedicated GitHub token for this link.',
              command: 'apicircle.setLinkSessionToken',
              arguments: [uri],
            }),
            new vscode.CodeLens(range, {
              title: '🔑 Clear token',
              command: 'apicircle.clearLinkSessionToken',
              arguments: [uri],
            }),
          );
        }
        continue;
      }
      if (REQKEYS_RE.test(text)) {
        lenses.push(
          new vscode.CodeLens(range, {
            title: '✚ Add required key',
            command: 'apicircle.addLinkRequiredKey',
            arguments: [uri],
          }),
        );
        // Per-key remove lenses until the next top-level key.
        for (let i = line + 1; i < document.lineCount; i++) {
          const rowText = document.lineAt(i).text;
          if (TOP_LEVEL_RE.test(rowText)) break;
          const m = LIST_ITEM_RE.exec(rowText);
          if (!m) continue;
          const key = stripQuotes(m[1]);
          lenses.push(
            new vscode.CodeLens(new vscode.Range(i, 0, i, rowText.length), {
              title: '🔑 Provide value',
              tooltip: 'Store a value for this required secret (encrypted in SecretStorage).',
              command: 'apicircle.provisionLinkedSecret',
              arguments: [uri, key],
            }),
            new vscode.CodeLens(new vscode.Range(i, 0, i, rowText.length), {
              title: '⊘ Remove',
              command: 'apicircle.removeLinkRequiredKey',
              arguments: [uri, key],
            }),
          );
        }
        continue;
      }
    }

    return lenses;
  }
}

function stripQuotes(s: string): string {
  const t = s.trim();
  if ((t.startsWith('"') && t.endsWith('"')) || (t.startsWith("'") && t.endsWith("'"))) {
    return t.slice(1, -1);
  }
  return t;
}
