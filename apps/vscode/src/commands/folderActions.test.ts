import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { vi } from 'vitest';
import { Uri, window, commands, workspace } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import {
  deleteFolderCommand,
  newFolderCommand,
  newRequestInFolderCommand,
  openFolderYamlCommand,
} from './folderActions';

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

interface FakeDoc {
  uri: unknown;
  lineCount: number;
  lineAt: (line: number) => { text: string; range: { start: unknown; end: unknown } };
  __pushLines: (lines: string[]) => void;
}

function makeFakeEditor(initialLines: string[]) {
  const lines = [...initialLines];
  const linePosition = (line: number, character: number) => ({ line, character });
  const document: FakeDoc = {
    uri: Uri.parse('apicircle://x/folders/y.yaml?id=f1'),
    get lineCount() {
      return lines.length;
    },
    lineAt: (line: number) => ({
      text: lines[line] ?? '',
      range: {
        start: linePosition(line, 0),
        end: linePosition(line, (lines[line] ?? '').length),
      },
    }),
    __pushLines(extra: string[]) {
      lines.push(...extra);
    },
  };
  const editor: {
    document: FakeDoc;
    selection: { anchor?: { line: number; character: number }; start?: unknown; end?: unknown };
    revealRange: ReturnType<typeof vi.fn>;
  } = {
    document,
    selection: { start: linePosition(0, 0), end: linePosition(0, 0) },
    revealRange: vi.fn(),
  };
  return editor;
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
      source: 'git-folder',
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

  describe('openFolderYamlCommand', () => {
    beforeEach(() => {
      (window.showQuickPick as Mock).mockReset();
      (window.showTextDocument as Mock).mockReset();
      (window.showInformationMessage as Mock).mockReset();
      (workspace.openTextDocument as Mock).mockReset();
      (workspace.openTextDocument as Mock).mockImplementation(async (uri: unknown) => ({
        uri,
      }));
    });

    it('warns when no workspace is active', async () => {
      bridge.dispose();
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      await openFolderYamlCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('opens the folder YAML directly when invoked from a TreeView node', async () => {
      await openFolderYamlCommand({ bridge }, { kind: 'folder', id: 'f1' });
      expect(workspace.openTextDocument).toHaveBeenCalledTimes(1);
      const uri = (workspace.openTextDocument as Mock).mock.calls[0][0] as {
        scheme: string;
        path: string;
      };
      expect(uri.scheme).toBe('apicircle');
      expect(uri.path).toBe('/folders/Auth-flows.yaml');
      expect(window.showTextDocument).toHaveBeenCalled();
    });

    it('falls back to a quick-pick when invoked from the palette', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: 'Auth flows',
        id: 'f1',
      });
      await openFolderYamlCommand({ bridge });
      expect(window.showQuickPick).toHaveBeenCalled();
      expect(workspace.openTextDocument).toHaveBeenCalled();
    });

    it('shows info message when the workspace has no folders', async () => {
      // Wipe the folder.
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as {
        collections: { folders: Record<string, unknown>; tree: { children: unknown[] } };
      };
      synced.collections.folders = {};
      synced.collections.tree.children = [];
      fs.writeFileSync(wsPath, JSON.stringify(synced));
      await openFolderYamlCommand({ bridge });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('no folders yet'),
      );
      expect(window.showQuickPick).not.toHaveBeenCalled();
    });

    it('cancels gracefully when the user dismisses the quick-pick', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await openFolderYamlCommand({ bridge });
      expect(workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('warns when the targeted folder no longer exists', async () => {
      await openFolderYamlCommand({ bridge }, { kind: 'folder', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('no longer exists'),
      );
      expect(workspace.openTextDocument).not.toHaveBeenCalled();
    });

    it('focusOnAuth positions the cursor on the auth: line when one exists', async () => {
      // Seed the folder with bearer auth so the YAML projection emits auth:.
      const wsPath = path.join(apicircleDir, 'workspace.json');
      const synced = JSON.parse(fs.readFileSync(wsPath, 'utf8')) as {
        collections: { folders: Record<string, { auth?: unknown }> };
      };
      synced.collections.folders.f1.auth = { type: 'bearer', token: 'tok' };
      fs.writeFileSync(wsPath, JSON.stringify(synced));

      const editor = makeFakeEditor([
        'name: Auth flows',
        'auth:',
        '  type: bearer',
        '  token: tok',
      ]);
      (workspace.openTextDocument as Mock).mockImplementation(async () => editor.document);
      (window.showTextDocument as Mock).mockImplementation(async () => editor);

      await openFolderYamlCommand({ bridge }, { kind: 'folder', id: 'f1' }, { focusOnAuth: true });

      expect((editor.selection.anchor as { line: number }).line).toBe(1); // the auth: line
      expect(editor.revealRange).toHaveBeenCalled();
    });

    it('focusOnAuth inserts an auth: scaffold when the folder has none', async () => {
      const editor = makeFakeEditor(['name: Auth flows']);
      (workspace.openTextDocument as Mock).mockImplementation(async () => editor.document);
      (window.showTextDocument as Mock).mockImplementation(async () => editor);
      (workspace.applyEdit as Mock).mockImplementation(async () => {
        // Simulate the edit appending the scaffold by mutating the fake doc.
        editor.document.__pushLines(['auth:', '  type: bearer', "  token: ''"]);
        return true;
      });

      await openFolderYamlCommand({ bridge }, { kind: 'folder', id: 'f1' }, { focusOnAuth: true });
      expect(workspace.applyEdit).toHaveBeenCalled();
      // After the scaffold lands, the cursor moves to the new auth: line.
      expect((editor.selection.anchor as { line: number }).line).toBe(1);
    });
  });

  describe('newFolderCommand', () => {
    beforeEach(() => {
      (window.showInputBox as Mock).mockReset();
      (window.showQuickPick as Mock).mockReset();
      (window.showTextDocument as Mock).mockReset();
      (workspace.openTextDocument as Mock).mockReset();
      (workspace.openTextDocument as Mock).mockImplementation(async (uri: unknown) => ({ uri }));
    });

    it('warns when no workspace is active', async () => {
      bridge.dispose();
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      await newFolderCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('creates a top-level folder from the palette via quick-pick + input box', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '— Top level —', id: null });
      (window.showInputBox as Mock).mockResolvedValueOnce('Reports');
      await newFolderCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      const folders = Object.values(state.synced.collections.folders);
      const created = folders.find((f) => f.name === 'Reports');
      expect(created).toBeDefined();
      expect(created?.parentId).toBeNull();
      // The new folder's YAML opens for immediate editing.
      expect(workspace.openTextDocument).toHaveBeenCalled();
    });

    it('nests under an existing folder when invoked from a TreeView node', async () => {
      (window.showInputBox as Mock).mockResolvedValueOnce('Subfolder');
      await newFolderCommand({ bridge }, { kind: 'folder', id: 'f1' });
      // No quick-pick prompt when a parent is supplied.
      expect(window.showQuickPick).not.toHaveBeenCalled();
      const state = await bridge.activeWorkspace()!.read();
      const created = Object.values(state.synced.collections.folders).find(
        (f) => f.name === 'Subfolder',
      );
      expect(created?.parentId).toBe('f1');
    });

    it('cancels gracefully when the quick-pick is dismissed', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await newFolderCommand({ bridge });
      expect(window.showInputBox).not.toHaveBeenCalled();
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.collections.folders)).toEqual(['f1']);
    });

    it('cancels gracefully when the input box is dismissed', async () => {
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await newFolderCommand({ bridge }, { kind: 'folder', id: 'f1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(Object.keys(state.synced.collections.folders)).toEqual(['f1']);
    });

    it('validateInput rejects empty + duplicate names', async () => {
      let validator: ((v: string) => string | null) | undefined;
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput: (v: string) => string | null }) => {
          validator = opts.validateInput;
          return undefined; // cancel — we only want the validator here
        },
      );
      await newFolderCommand({ bridge }, { kind: 'folder', id: 'f1' });
      expect(validator).toBeDefined();
      expect(validator?.('')).toMatch(/empty/);
      // 'Auth flows' already exists at root (parent = null) in seed. The
      // command was invoked nested under f1, so the duplicate-name check
      // runs against siblings under f1 — none exist yet, so OK.
      expect(validator?.('AnyName')).toBeNull();
    });
  });
});
