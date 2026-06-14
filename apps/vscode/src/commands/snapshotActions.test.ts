import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import {
  captureSnapshotCommand,
  restoreSnapshotCommand,
  deleteSnapshotCommand,
  setSnapshotMaxBytesCommand,
} from './snapshotActions';

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

function seedWorkspace(apicircleDir: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'snap-test',
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: {
          r1: {
            id: 'r1',
            name: 'Orig',
            folderId: null,
            method: 'GET',
            url: 'https://x.com',
            headers: [],
            query: [],
            body: { type: 'none', content: '' },
            auth: { type: 'none' },
            contextVars: [],
            extractions: [],
            assertions: [],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        },
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
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('snapshot commands', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'snapact-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seedWorkspace(apicircleDir);
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
    (window.showQuickPick as Mock).mockReset();
    (window.showInputBox as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('captureSnapshot creates a manual snapshot with note', async () => {
    (window.showInputBox as Mock).mockResolvedValueOnce('before refactor');
    await captureSnapshotCommand({ bridge });
    const surface = bridge.activeWorkspace()!;
    const state = await surface.read();
    expect(state.local.snapshots.entries).toHaveLength(1);
    expect(state.local.snapshots.entries[0].note).toBe('before refactor');
    expect(state.local.snapshots.entries[0].triggeredBy).toBe('manual');
  });

  it('captureSnapshot cancels gracefully on dismiss', async () => {
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await captureSnapshotCommand({ bridge });
    const state = await bridge.activeWorkspace()!.read();
    expect(state.local.snapshots.entries).toHaveLength(0);
  });

  it('restoreSnapshot warns when no snapshots exist', async () => {
    await restoreSnapshotCommand({ bridge });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No snapshots'),
    );
  });

  it('restoreSnapshot captures a safety snapshot before restoring', async () => {
    const surface = bridge.activeWorkspace()!;

    // Capture an initial snapshot
    (window.showInputBox as Mock).mockResolvedValueOnce('original');
    await captureSnapshotCommand({ bridge });
    const initial = (await surface.read()).local.snapshots.entries[0];

    // Mutate the workspace
    await surface.apply({ kind: 'request.delete', id: 'r1' });

    // Restore
    (window.showQuickPick as Mock).mockResolvedValueOnce({
      id: initial.id,
      label: 'manual · just now',
    });
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Restore');
    await restoreSnapshotCommand({ bridge });

    const state = await surface.read();
    // The original request is back
    expect(state.synced.collections.requests.r1).toBeDefined();
    // A safety snapshot was captured before the restore
    expect(state.local.snapshots.entries.length).toBeGreaterThanOrEqual(2);
  });

  it('restoreSnapshot keeps current state when user declines', async () => {
    const surface = bridge.activeWorkspace()!;
    (window.showInputBox as Mock).mockResolvedValueOnce('first');
    await captureSnapshotCommand({ bridge });
    const initial = (await surface.read()).local.snapshots.entries[0];

    await surface.apply({ kind: 'request.delete', id: 'r1' });

    (window.showQuickPick as Mock).mockResolvedValueOnce({
      id: initial.id,
      label: 'manual · just now',
    });
    (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
    await restoreSnapshotCommand({ bridge });

    // Request is still deleted (no restore happened)
    const state = await surface.read();
    expect(state.synced.collections.requests.r1).toBeUndefined();
  });

  it('deleteSnapshot removes a snapshot on confirmation', async () => {
    const surface = bridge.activeWorkspace()!;
    (window.showInputBox as Mock).mockResolvedValueOnce('to delete');
    await captureSnapshotCommand({ bridge });
    const created = (await surface.read()).local.snapshots.entries[0];

    (window.showQuickPick as Mock).mockResolvedValueOnce({ id: created.id, label: 'x' });
    (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
    await deleteSnapshotCommand({ bridge });

    const after = await surface.read();
    expect(after.local.snapshots.entries).toHaveLength(0);
  });

  describe('node-arg branches (tree context menu)', () => {
    it('restoreSnapshot with node arg skips the picker and restores directly', async () => {
      const surface = bridge.activeWorkspace()!;
      (window.showInputBox as Mock).mockResolvedValueOnce('via-tree');
      await captureSnapshotCommand({ bridge });
      const created = (await surface.read()).local.snapshots.entries[0];

      await surface.apply({ kind: 'request.delete', id: 'r1' });
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Restore');
      await restoreSnapshotCommand({ bridge }, { kind: 'entry', id: created.id });

      expect(window.showQuickPick).not.toHaveBeenCalled();
      const state = await surface.read();
      expect(state.synced.collections.requests.r1).toBeDefined();
    });

    it('restoreSnapshot with node arg referencing missing id warns and exits', async () => {
      await restoreSnapshotCommand({ bridge }, { kind: 'entry', id: 'does-not-exist' });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No snapshots'),
      );
      expect(window.showQuickPick).not.toHaveBeenCalled();
    });

    it('restoreSnapshot warns when node arg id is unknown but other snapshots exist', async () => {
      (window.showInputBox as Mock).mockResolvedValueOnce('keep-me');
      await captureSnapshotCommand({ bridge });
      await restoreSnapshotCommand({ bridge }, { kind: 'entry', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('no longer exists'),
      );
      expect(window.showQuickPick).not.toHaveBeenCalled();
    });

    it('deleteSnapshot with node arg skips picker and deletes directly', async () => {
      const surface = bridge.activeWorkspace()!;
      (window.showInputBox as Mock).mockResolvedValueOnce('tree-delete');
      await captureSnapshotCommand({ bridge });
      const created = (await surface.read()).local.snapshots.entries[0];

      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteSnapshotCommand({ bridge }, { kind: 'entry', id: created.id });

      expect(window.showQuickPick).not.toHaveBeenCalled();
      const state = await surface.read();
      expect(state.local.snapshots.entries).toHaveLength(0);
    });

    it('deleteSnapshot with node arg id that does not exist warns and exits', async () => {
      (window.showInputBox as Mock).mockResolvedValueOnce('keep');
      await captureSnapshotCommand({ bridge });
      await deleteSnapshotCommand({ bridge }, { kind: 'entry', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('no longer exists'),
      );
    });
  });

  describe('setSnapshotMaxBytesCommand', () => {
    it('warns when no workspace is active', async () => {
      bridge.dispose();
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      await setSnapshotMaxBytesCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('cancels when user dismisses the input box', async () => {
      const surface = bridge.activeWorkspace()!;
      const before = (await surface.read()).local.snapshots.maxBytes;
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await setSnapshotMaxBytesCommand({ bridge });
      const after = (await surface.read()).local.snapshots.maxBytes;
      expect(after).toBe(before);
    });

    it('writes the new cap via snapshot.set_max_bytes patch', async () => {
      (window.showInputBox as Mock).mockResolvedValueOnce('128');
      await setSnapshotMaxBytesCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.snapshots.maxBytes).toBe(128 * 1024 * 1024);
    });

    it('rejects non-numeric input via validateInput', async () => {
      let validator: ((s: string) => string | null) | undefined;
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (s: string) => string | null }) => {
          validator = opts.validateInput;
          return undefined;
        },
      );
      await setSnapshotMaxBytesCommand({ bridge });
      expect(validator?.('abc')).toBe('Enter a number');
      expect(validator?.('100.5')).toBe('Enter whole MB (no decimals)');
      expect(validator?.('-5')).toBe('Must be > 0');
      expect(validator?.('5000')).toBe('Cap must be ≤ 2048 MB (2 GB)');
      expect(validator?.('100')).toBeNull();
    });
  });
});
