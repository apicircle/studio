import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { ReleaseHistory } from '@apicircle/shared';
import { Uri, window, commands } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import {
  publishReleaseCommand,
  deprecateReleaseCommand,
  withdrawReleaseCommand,
  openReleaseHistoryCommand,
} from './releaseActions';

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

function seed(apicircleDir: string, releases: ReleaseHistory | null): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'rel',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: releases, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans: {},
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

function ledgerWith(...versions: string[]): ReleaseHistory {
  return {
    currentVersion: versions[versions.length - 1] ?? null,
    versions: versions.map((v) => ({
      version: v,
      publishedAt: '2026-01-01T00:00:00.000Z',
      notes: '',
      workspaceSnapshot: 'a'.repeat(64),
      deprecated: false,
      yanked: false,
    })),
  };
}

describe('releaseActions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let fsProvider: ApicircleFsProvider;
  let apicircleDir: string;

  function deps() {
    return { bridge, fsProvider };
  }

  function setup(releases: ReleaseHistory | null): void {
    apicircleDir = path.join(tmp, '.apicircle');
    seed(apicircleDir, releases);
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
    fsProvider = new ApicircleFsProvider(bridge);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relact-'));
    (window.showQuickPick as Mock).mockReset();
    (window.showInputBox as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
    (commands.executeCommand as Mock).mockReset();
  });

  afterEach(() => {
    bridge?.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('publishReleaseCommand', () => {
    it('warns when no workspace is active', async () => {
      tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'relact-empty-'));
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await publishReleaseCommand(deps());
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('publishes the first version via the custom input path', async () => {
      setup(null);
      // No current version → straight to custom input box for the version.
      (window.showInputBox as Mock)
        .mockResolvedValueOnce('0.1.0') // version
        .mockResolvedValueOnce('first cut'); // notes
      (window.showInformationMessage as Mock)
        .mockResolvedValueOnce('Publish') // confirm modal
        .mockResolvedValueOnce(undefined); // success toast

      await publishReleaseCommand(deps());

      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions.map((v) => v.version)).toEqual(['0.1.0']);
      expect(state.synced.releases.self!.currentVersion).toBe('0.1.0');
      expect(state.synced.releases.self!.versions[0].notes).toBe('first cut');
      expect(state.synced.releases.self!.versions[0].workspaceSnapshot).toMatch(/^[0-9a-f]{64}$/);
    });

    it('publishes a patch bump off the current version', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '1.0.1' });
      (window.showInputBox as Mock).mockResolvedValueOnce(''); // notes (empty)
      (window.showInformationMessage as Mock)
        .mockResolvedValueOnce('Publish')
        .mockResolvedValueOnce(undefined);

      await publishReleaseCommand(deps());

      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions.map((v) => v.version)).toEqual([
        '1.0.0',
        '1.0.1',
      ]);
      expect(state.synced.releases.self!.currentVersion).toBe('1.0.1');
    });

    it('does not publish when the confirm modal is dismissed', async () => {
      setup(null);
      (window.showInputBox as Mock).mockResolvedValueOnce('0.1.0').mockResolvedValueOnce('');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined); // dismissed

      await publishReleaseCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self).toBeNull();
    });

    it('cancels cleanly when the version input is dismissed', async () => {
      setup(null);
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined); // version esc
      await publishReleaseCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self).toBeNull();
    });
  });

  describe('deprecateReleaseCommand', () => {
    it('flips the deprecated flag after confirmation', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Deprecate');
      await deprecateReleaseCommand(deps(), { version: '1.0.0' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions[0].deprecated).toBe(true);
    });

    it('does nothing when confirmation is dismissed', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deprecateReleaseCommand(deps(), { version: '1.0.0' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions[0].deprecated).toBe(false);
    });
  });

  describe('withdrawReleaseCommand', () => {
    it('yanks the version when the typed confirmation matches', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showInputBox as Mock).mockResolvedValueOnce('WITHDRAW v1.0.0');
      await withdrawReleaseCommand(deps(), { version: '1.0.0' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions[0].yanked).toBe(true);
    });

    it('does not yank when the typed confirmation is wrong', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showInputBox as Mock).mockResolvedValueOnce('nope');
      await withdrawReleaseCommand(deps(), { version: '1.0.0' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions[0].yanked).toBe(false);
    });
  });

  describe('openReleaseHistoryCommand', () => {
    it('warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await openReleaseHistoryCommand(deps());
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No active API Circle workspace'),
      );
    });

    it('opens the releases.yaml document for the active workspace', async () => {
      setup(ledgerWith('1.0.0'));
      await openReleaseHistoryCommand(deps());
      expect(commands.executeCommand).toHaveBeenCalledWith('vscode.open', expect.any(Object));
    });
  });

  describe('publishReleaseCommand additional coverage', () => {
    it('warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await publishReleaseCommand(deps());
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('exits silently when version picker is cancelled', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await publishReleaseCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions.length).toBe(1);
    });

    it('exits silently when notes prompt is cancelled', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '1.0.1' });
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await publishReleaseCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions.length).toBe(1);
    });

    it('exits silently when publish confirmation modal is dismissed', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showQuickPick as Mock).mockResolvedValueOnce({ value: '1.0.1' });
      (window.showInputBox as Mock).mockResolvedValueOnce('release notes');
      (window.showInformationMessage as Mock).mockResolvedValueOnce(undefined);
      await publishReleaseCommand(deps());
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions.length).toBe(1);
    });
  });

  describe('deprecateReleaseCommand additional coverage', () => {
    it('warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await deprecateReleaseCommand(deps(), { version: '1.0.0' });
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('exits silently when confirmation modal is dismissed', async () => {
      setup(ledgerWith('1.0.0'));
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deprecateReleaseCommand(deps(), { version: '1.0.0' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.releases.self!.versions[0].deprecated).toBe(false);
    });
  });

  describe('withdrawReleaseCommand additional coverage', () => {
    it('warns when no active workspace', async () => {
      bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
      fsProvider = new ApicircleFsProvider(bridge);
      await withdrawReleaseCommand(deps(), { version: '1.0.0' });
      expect(window.showWarningMessage).toHaveBeenCalled();
    });

    it('exposes a validator on the typed-confirmation input', async () => {
      setup(ledgerWith('1.0.0'));
      let captured: ((v: string) => string | null) | undefined;
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (v: string) => string | null }) => {
          captured = opts.validateInput;
          return undefined;
        },
      );
      await withdrawReleaseCommand(deps(), { version: '1.0.0' });
      expect(captured).toBeDefined();
      expect(captured?.('wrong')).toMatch(/Type exactly/);
      expect(captured?.('WITHDRAW v1.0.0')).toBeNull();
    });
  });
});
