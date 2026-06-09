import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, commands } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { deleteFolderCommand, newRequestInFolderCommand } from './folderActions';

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

function seed(apicircleDir: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'fa',
      collections: {
        tree: {
          id: 'root',
          type: 'root',
          children: [{ kind: 'folder', id: 'f1', children: [] }],
        },
        requests: {},
        folders: { f1: { id: 'f1', name: 'Auth flows', parentId: null } },
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
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('folderActions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'fa-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seed(apicircleDir);
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(apicircleDir);
    (window.showWarningMessage as Mock).mockReset();
    (commands.executeCommand as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('deleteFolderCommand', () => {
    it('warns when no workspace is active', async () => {
      bridge.dispose();
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      await deleteFolderCommand({ bridge }, { kind: 'folder', id: 'f1' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('warns when called without a folder node (palette invocation)', async () => {
      await deleteFolderCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Right-click a folder'),
      );
    });

    it('warns when the folder no longer exists', async () => {
      await deleteFolderCommand({ bridge }, { kind: 'folder', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('no longer exists'),
      );
    });

    it('cancels gracefully when the user declines confirmation', async () => {
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deleteFolderCommand({ bridge }, { kind: 'folder', id: 'f1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.collections.folders.f1).toBeDefined();
    });

    it('fires folder.delete on confirmation', async () => {
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteFolderCommand({ bridge }, { kind: 'folder', id: 'f1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.collections.folders.f1).toBeUndefined();
    });
  });

  describe('newRequestInFolderCommand', () => {
    it('delegates to apicircle.newRequest with no args when no folder node provided', async () => {
      await newRequestInFolderCommand({ bridge });
      expect(commands.executeCommand).toHaveBeenCalledWith('apicircle.newRequest');
    });

    it('delegates to apicircle.newRequest with folderId arg when folder node provided', async () => {
      await newRequestInFolderCommand({ bridge }, { kind: 'folder', id: 'f1' });
      expect(commands.executeCommand).toHaveBeenCalledWith('apicircle.newRequest', {
        folderId: 'f1',
      });
    });
  });
});
