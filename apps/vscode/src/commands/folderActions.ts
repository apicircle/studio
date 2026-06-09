import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// Per-folder TreeView context-menu actions:
//   • Delete Folder (with confirmation)
//   • New Request in Folder (delegates to apicircle.newRequest with folder hint)
//
// Folder rename is intentionally NOT exposed yet — the WorkspacePatch union
// has no `folder.rename` / `folder.update` variant. Phase 2 closes the
// rename gap by removing it from the discoverable menu; it lands when the
// patch is added (Phase 3+).
// =============================================================================

export interface FolderActionsDeps {
  bridge: VsCodeBridge;
}

export async function deleteFolderCommand(
  deps: FolderActionsDeps,
  node?: { kind: 'folder'; id: string },
): Promise<void> {
  const active = deps.bridge.activeWorkspace();
  if (!active) {
    await vscode.window.showWarningMessage('No active APICircle workspace.');
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
