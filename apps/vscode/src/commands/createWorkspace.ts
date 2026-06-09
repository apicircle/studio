import * as vscode from 'vscode';
import { generateId } from '@apicircle/shared';
import type { WorkspaceSynced, WorkspaceLocal } from '@apicircle/shared';
import type { VsCodeBridge } from '../host/vscodeBridge';

// =============================================================================
// `APICircle: Create New Workspace` command.
//
// Flow:
//   1. If only one folder is open, scaffold inside it.
//   2. Otherwise, QuickPick over open folders.
//   3. Generate fresh WorkspaceSynced + WorkspaceLocal seeds.
//   4. Write `.apicircle/workspace.json` + `attachments/` + README.md via the
//      bridge's createWorkspaceScaffold helper.
//   5. Register the new workspace with the bridge, set it active.
//   6. Toast + reveal the new file in the editor.
// =============================================================================

export async function createWorkspaceCommand(bridge: VsCodeBridge): Promise<void> {
  const folders = vscode.workspace.workspaceFolders;
  if (!folders || folders.length === 0) {
    const choice = await vscode.window.showWarningMessage(
      'Open a folder first to create an APICircle workspace.',
      'Open Folder…',
    );
    if (choice === 'Open Folder…') {
      await vscode.commands.executeCommand('workbench.action.files.openFolder');
    }
    return;
  }

  let target: vscode.WorkspaceFolder | undefined;
  if (folders.length === 1) {
    target = folders[0];
  } else {
    const picked = await vscode.window.showQuickPick(
      folders.map((f) => ({ label: f.name, description: f.uri.fsPath, folder: f })),
      { placeHolder: 'Choose a folder to create the APICircle workspace inside' },
    );
    target = picked?.folder;
  }
  if (!target) return;

  const synced = makeEmptyWorkspaceSynced();
  const local = makeEmptyWorkspaceLocal(synced.workspaceId);

  try {
    const out = await bridge.createWorkspaceScaffold(target, synced, local);
    await vscode.window.showInformationMessage(
      `Created APICircle workspace at ${vscode.workspace.asRelativePath(out.workspaceJsonPath)}`,
      'Open Workspace File',
    );
    const uri = vscode.Uri.file(out.workspaceJsonPath);
    await vscode.commands.executeCommand('vscode.open', uri);
  } catch (e) {
    await vscode.window.showErrorMessage(
      `Failed to create workspace: ${e instanceof Error ? e.message : String(e)}`,
    );
  }
}

function makeEmptyWorkspaceSynced(): WorkspaceSynced {
  const now = new Date().toISOString();
  const rootId = generateId();
  return {
    schemaVersion: 1,
    workspaceId: generateId(),
    collections: {
      tree: { id: rootId, type: 'root', children: [] },
      requests: {},
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {}, files: {} },
    mockServers: {},
    executionPlans: {},
    secretKeys: {},
    secretCrypto: null,
    meta: { createdAt: now, updatedAt: now, appVersion: '0.1.0' },
  };
}

function makeEmptyWorkspaceLocal(workspaceId: string): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId,
    executionPlans: {},
    history: { requestRuns: [], planRuns: [] },
    secretIndex: { entries: {} },
    sessions: { github: { workspace: null, links: {} } },
    connectedRepo: null,
    workingBranch: null,
    seededWorkspaceSha: null,
    retiredBranch: null,
    sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
    linkedCollections: {},
    attachmentCache: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'one-dark-pro',
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}
