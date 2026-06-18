import * as vscode from 'vscode';
import type { Folder } from '@apicircle/shared';
import { generateId } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';

// =============================================================================
// Per-folder TreeView context-menu actions:
//   • New Folder (palette / view title button / context menu on an existing
//                  folder — dispatches `folder.create`)
//   • Delete Folder (with confirmation)
//   • New Request in Folder (delegates to apicircle.newRequest with folder hint)
//   • Open Folder YAML (opens apicircle://<ws>/folders/<slug>.yaml
//                        in an editor tab — name + folder-level auth)
//   • Edit Folder Auth (opens the same YAML; the Auth field is the focus)
//
// Folder rename + auth edits happen through the YAML editor (saving the
// YAML dispatches a `folder.update` WorkspacePatch).
// =============================================================================

export interface FolderActionsDeps {
  bridge: VsCodeBridge;
}

export async function newFolderCommand(
  deps: FolderActionsDeps,
  node?: { kind: 'folder'; id: string },
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const state = await active.read();
  const folders = state.synced.collections.folders;

  // Parent: when a folder node is passed (context-menu invocation), nest the
  // new folder under it directly. Otherwise prompt the user with a quick-pick
  // ("Top level" + every existing folder).
  let parentId: string | null;
  if (node?.kind === 'folder') {
    parentId = node.id;
  } else {
    const choices = [
      { label: '— Top level —', id: null as string | null },
      ...Object.values(folders)
        .map((f): { label: string; description: string; id: string | null } => ({
          label: f.name,
          description: pathOf(f.id, folders),
          id: f.id,
        }))
        .sort((a, b) => a.label.localeCompare(b.label)),
    ];
    const picked = await vscode.window.showQuickPick(choices, {
      placeHolder: 'Pick a parent folder (or top level)',
    });
    if (!picked) return;
    parentId = picked.id;
  }

  const name = await vscode.window.showInputBox({
    prompt: 'Folder name',
    value: 'New folder',
    validateInput: (v) => {
      const trimmed = v.trim();
      if (!trimmed) return 'Name cannot be empty.';
      const collision = Object.values(folders).some(
        (f) =>
          (f.parentId ?? null) === parentId &&
          f.name.trim().toLowerCase() === trimmed.toLowerCase(),
      );
      return collision ? 'A folder with this name already exists under the same parent.' : null;
    },
  });
  if (!name) return;

  const folder: Folder = {
    id: generateId(),
    name: name.trim(),
    parentId,
  };
  const result = await active.apply({ kind: 'folder.create', folder });
  if ((result?.changedIds?.length ?? 0) === 0) {
    // applyMutation only no-ops on a duplicate id — shouldn't happen with a
    // freshly generated id, but surface it rather than failing silently.
    await vscode.window.showErrorMessage('Failed to create folder.');
    return;
  }

  // Open the new folder's YAML so the user can immediately set folder-level
  // auth if they want. Matches the request-create flow that opens the
  // scaffolded request.
  const folderAfter = (await active.read()).synced.collections.folders[folder.id];
  if (folderAfter) {
    const uri = ApicircleFsProvider.folderUri(
      active.workspace.id,
      folderAfter,
      (await active.read()).synced.collections.folders,
    );
    const doc = await vscode.workspace.openTextDocument(uri);
    await vscode.window.showTextDocument(doc, { preview: false });
  }
}

export async function deleteFolderCommand(
  deps: FolderActionsDeps,
  node?: { kind: 'folder'; id: string },
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  if (!node || node.kind !== 'folder') {
    await vscode.window.showWarningMessage('Right-click a folder in the Editor view to delete it.');
    return;
  }
  const state = await active.read();
  const folder = state.synced.collections.folders[node.id];
  if (!folder) {
    await vscode.window.showWarningMessage('Folder no longer exists.');
    return;
  }
  const confirm = await vscode.window.showWarningMessage(
    `Delete folder "${folder.name}"? Requests inside are also removed.\n\nThis is reflected in workspace.json and can be reverted via Git.`,
    { modal: true },
    'Delete',
  );
  if (confirm !== 'Delete') return;
  await active.apply({ kind: 'folder.delete', id: node.id });
}

export async function newRequestInFolderCommand(
  deps: FolderActionsDeps,
  node?: { kind: 'folder'; id: string },
): Promise<void> {
  if (!node || node.kind !== 'folder') {
    // Fall back to the normal new-request flow when invoked without a node
    // (e.g. from the command palette).
    await vscode.commands.executeCommand('apicircle.newRequest');
    return;
  }
  // Surface the folder hint through the command bus so the wizard can use it.
  await vscode.commands.executeCommand('apicircle.newRequest', { folderId: node.id });
}

export interface OpenFolderYamlOptions {
  /**
   * When true, the editor lands with its cursor on the `auth:` line. If the
   * folder doesn't yet have an `auth:` block, a fresh scaffold is inserted
   * via a WorkspaceEdit on the opened document before the cursor moves, so
   * the user lands inside something editable on the very first click.
   */
  focusOnAuth?: boolean;
}

/**
 * Resolves the target folder (from the TreeView node, falling back to a
 * quick-pick when invoked from the command palette without context) and
 * opens its YAML projection in an editor tab.
 */
export async function openFolderYamlCommand(
  deps: FolderActionsDeps,
  node?: { kind: 'folder'; id: string },
  options: OpenFolderYamlOptions = {},
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active API Circle workspace.');
    return;
  }
  const state = await active.read();
  const folders = state.synced.collections.folders;

  let folderId = node?.kind === 'folder' ? node.id : undefined;
  if (!folderId) {
    const entries = Object.values(folders);
    if (entries.length === 0) {
      await vscode.window.showInformationMessage(
        'This workspace has no folders yet — create one via "API Circle: New Folder" or right-click in the Editor view.',
      );
      return;
    }
    const picked = await vscode.window.showQuickPick(
      entries
        .map((f) => ({ label: f.name, description: pathOf(f.id, folders), id: f.id }))
        .sort((a, b) => a.label.localeCompare(b.label)),
      { placeHolder: 'Pick a folder to edit' },
    );
    if (!picked) return;
    folderId = picked.id;
  }
  const folder = folders[folderId];
  if (!folder) {
    await vscode.window.showWarningMessage('Folder no longer exists.');
    return;
  }
  const uri = ApicircleFsProvider.folderUri(active.workspace.id, folder, folders);
  const doc = await vscode.workspace.openTextDocument(uri);
  const editor = await vscode.window.showTextDocument(doc, { preview: false });
  if (options.focusOnAuth) await focusOnAuthLine(editor, doc);
}

/**
 * Position the cursor on the `auth:` line of an open folder YAML. When the
 * doc has no `auth:` block yet, insert a fresh scaffold first (so the user
 * is dropped directly inside something editable instead of having to type
 * `auth:` themselves before any of the field-editor lenses appear).
 */
async function focusOnAuthLine(editor: vscode.TextEditor, doc: vscode.TextDocument): Promise<void> {
  let authLine = findLine(doc, /^auth:\s*$/);
  if (authLine === -1) {
    // No auth: section yet — append a bearer scaffold to the end of the doc.
    const lastLine = doc.lineCount - 1;
    const endPosition = doc.lineAt(lastLine).range.end;
    const prefix = doc.lineAt(lastLine).text.trim().length > 0 ? '\n' : '';
    const scaffold = `${prefix}auth:\n  type: bearer\n  token: ''\n`;
    const edit = new vscode.WorkspaceEdit();
    edit.insert(doc.uri, endPosition, scaffold);
    if (await vscode.workspace.applyEdit(edit)) {
      authLine = findLine(doc, /^auth:\s*$/);
    }
  }
  if (authLine === -1) return;
  const range = doc.lineAt(authLine).range;
  editor.selection = new vscode.Selection(range.start, range.start);
  editor.revealRange(range, vscode.TextEditorRevealType.InCenter);
}

function findLine(doc: vscode.TextDocument, pattern: RegExp): number {
  for (let i = 0; i < doc.lineCount; i++) {
    if (pattern.test(doc.lineAt(i).text)) return i;
  }
  return -1;
}

function pathOf(
  folderId: string,
  folders: Record<string, { name: string; parentId: string | null }>,
): string {
  const chain: string[] = [];
  let current: { name: string; parentId: string | null } | undefined = folders[folderId];
  const visited = new Set<string>();
  while (current && !visited.has(folderId)) {
    visited.add(folderId);
    chain.unshift(current.name);
    if (current.parentId === null) break;
    folderId = current.parentId;
    current = folders[folderId];
  }
  return chain.slice(0, -1).join(' / ');
}
