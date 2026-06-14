import * as vscode from 'vscode';
import type { VsCodeBridge } from '../host/vscodeBridge';

export function switchWorkspaceCommand(bridge: VsCodeBridge): vscode.Disposable {
  return vscode.commands.registerCommand('apicircle.switchWorkspace', async () => {
    const all = bridge.listWorkspaces();
    if (all.length === 0) {
      void vscode.window.showInformationMessage(
        'No workspaces discovered. Open a folder with .apicircle/workspace.json or create one.',
      );
      return;
    }
    if (all.length === 1) {
      void vscode.window.showInformationMessage(
        'Only one workspace available. Open another folder or create a new workspace to switch.',
      );
      return;
    }

    const active = bridge.activeWorkspace();
    const items = all.map((ws) => ({
      label: ws.workspace.label,
      description: ws.workspace.source === 'registry' ? 'registry' : 'git-folder',
      detail: ws.workspace.apicircleDir,
      id: ws.workspace.id,
      picked: ws.workspace.id === active?.workspace.id,
    }));

    const picked = await vscode.window.showQuickPick(items, {
      placeHolder: 'Select a workspace to switch to',
      title: 'Switch Workspace',
    });

    if (!picked) return;
    if (picked.id === active?.workspace.id) return;

    bridge.setActive(picked.id);
    void vscode.commands.executeCommand('setContext', 'apicircle.hasActiveWorkspace', true);
  });
}
