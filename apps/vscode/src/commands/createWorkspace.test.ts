import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, workspace, commands } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { createWorkspaceCommand } from './createWorkspace';

function makeMockContext(globalStoragePath: string) {
  const state = new Map<string, unknown>();
  return {
    subscriptions: [],
    globalState: {
      get: <T>(key: string, defaultValue?: T) =>
        state.has(key) ? (state.get(key) as T) : defaultValue,
      update: async (key: string, value: unknown) => {
        state.set(key, value);
      },
      keys: () => Array.from(state.keys()),
    },
    workspaceState: { get: () => undefined, update: async () => undefined, keys: () => [] },
    secrets: {
      get: async () => undefined,
      store: async () => undefined,
      delete: async () => undefined,
    },
    globalStorageUri: Uri.file(globalStoragePath),
    storageUri: undefined,
    extensionUri: Uri.file('/ext'),
    extensionPath: '/ext',
    asAbsolutePath: (rel: string) => path.join('/ext', rel),
    extensionMode: 3,
  } as never;
}

describe('createWorkspaceCommand', () => {
  let tmp: string;
  let bridge: VsCodeBridge;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'createws-'));
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    (workspace as { workspaceFolders: unknown }).workspaceFolders = undefined;
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
    (window.showQuickPick as Mock).mockReset();
    (commands.executeCommand as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('warns and offers Open Folder… when no folder is open', async () => {
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    await createWorkspaceCommand(bridge);
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('Open a folder'),
      'Open Folder…',
    );
  });

  it('runs the Open Folder action when user clicks it', async () => {
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Open Folder…');
    await createWorkspaceCommand(bridge);
    expect(commands.executeCommand).toHaveBeenCalledWith('workbench.action.files.openFolder');
  });

  it('scaffolds straight in the only open folder', async () => {
    const folder = path.join(tmp, 'repo');
    fs.mkdirSync(folder, { recursive: true });
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'repo', index: 0 },
    ];

    await createWorkspaceCommand(bridge);
    // QuickPick must NOT be shown for single-folder case
    expect(window.showQuickPick).not.toHaveBeenCalled();
    // workspace.json now exists under .apicircle/workspace-<id>/
    const apicircleDir = path.join(folder, '.apicircle');
    expect(fs.existsSync(path.join(apicircleDir, 'registry.json'))).toBe(true);
    const entries = fs.readdirSync(apicircleDir).filter((f) => f.startsWith('workspace-'));
    expect(entries).toHaveLength(1);
    expect(fs.existsSync(path.join(apicircleDir, entries[0], 'workspace.json'))).toBe(true);
  });

  it('asks the user to pick which folder when multiple are open', async () => {
    const folderA = path.join(tmp, 'a');
    const folderB = path.join(tmp, 'b');
    fs.mkdirSync(folderA, { recursive: true });
    fs.mkdirSync(folderB, { recursive: true });
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folderA), name: 'a', index: 0 },
      { uri: Uri.file(folderB), name: 'b', index: 1 },
    ];
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      label: 'b',
      folder: { uri: Uri.file(folderB), name: 'b', index: 1 },
    });

    await createWorkspaceCommand(bridge);
    expect(window.showQuickPick).toHaveBeenCalled();
    expect(fs.existsSync(path.join(folderB, '.apicircle', 'registry.json'))).toBe(true);
    expect(fs.existsSync(path.join(folderA, '.apicircle', 'registry.json'))).toBe(false);
  });

  it('cancels gracefully when user dismisses the folder picker', async () => {
    const folderA = path.join(tmp, 'a');
    const folderB = path.join(tmp, 'b');
    fs.mkdirSync(folderA, { recursive: true });
    fs.mkdirSync(folderB, { recursive: true });
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folderA), name: 'a', index: 0 },
      { uri: Uri.file(folderB), name: 'b', index: 1 },
    ];
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);

    await createWorkspaceCommand(bridge);
    expect(fs.existsSync(path.join(folderA, '.apicircle', 'registry.json'))).toBe(false);
    expect(fs.existsSync(path.join(folderB, '.apicircle', 'registry.json'))).toBe(false);
  });

  it('shows an info message + opens the workspace file on success', async () => {
    const folder = path.join(tmp, 'repo');
    fs.mkdirSync(folder, { recursive: true });
    (workspace as { workspaceFolders: unknown }).workspaceFolders = [
      { uri: Uri.file(folder), name: 'repo', index: 0 },
    ];
    await createWorkspaceCommand(bridge);
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('Created APICircle workspace'),
      'Open Workspace File',
    );
    expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.anything());
  });
});
