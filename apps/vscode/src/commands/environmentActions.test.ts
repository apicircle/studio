import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import {
  setActiveEnvironmentCommand,
  newEnvironmentCommand,
  deleteEnvironmentCommand,
} from './environmentActions';

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

interface SeedEnv {
  name: string;
  variables?: Array<{ key: string; value: string; encrypted?: boolean }>;
}

function seedWorkspace(
  apicircleDir: string,
  envs: SeedEnv[],
  activeName: string | null = null,
): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'test-ws',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: {
        items: Object.fromEntries(
          envs.map((e) => [
            e.name,
            {
              name: e.name,
              variables: (e.variables ?? []).map((v) => ({
                ...v,
                encrypted: v.encrypted ?? false,
              })),
            },
          ]),
        ),
        activeName,
        priorityOrder: [],
      },
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

describe('environment commands', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envact-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    (window.showQuickPick as Mock).mockReset();
    (window.showInputBox as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activate(): void {
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
      source: 'git-folder',
    });
    bridge.setActive(apicircleDir);
  }

  describe('setActiveEnvironmentCommand', () => {
    it('warns when no workspace is active', async () => {
      await setActiveEnvironmentCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('shows info when no envs exist', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      await setActiveEnvironmentCommand({ bridge });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No environments'),
      );
    });

    it('sets the picked env as active', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p' }, { name: 's' }]);
      activate();
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: 's', name: 's' });
      await setActiveEnvironmentCommand({ bridge });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      expect(synced.environments.activeName).toBe('s');
    });

    it('unsets active when "None" is picked', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p' }], 'p');
      activate();
      (window.showQuickPick as Mock).mockResolvedValueOnce({
        label: '$(circle-slash) None',
        name: null,
      });
      await setActiveEnvironmentCommand({ bridge });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      expect(synced.environments.activeName).toBeNull();
    });

    it('cancels gracefully on QuickPick dismissal', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p' }]);
      activate();
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await setActiveEnvironmentCommand({ bridge });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      expect(synced.environments.activeName).toBeNull();
    });
  });

  describe('newEnvironmentCommand', () => {
    it('creates a new empty env and opens its YAML', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      (window.showInputBox as Mock).mockResolvedValueOnce('production');
      await newEnvironmentCommand({ bridge });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      expect(synced.environments.items.production).toBeDefined();
      expect(synced.environments.items.production.variables).toEqual([]);
    });

    it('rejects duplicate names via validateInput', async () => {
      seedWorkspace(apicircleDir, [{ name: 'production' }]);
      activate();
      let capturedValidate: ((s: string) => string | null) | undefined;
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (s: string) => string | null }) => {
          capturedValidate = opts.validateInput;
          return undefined;
        },
      );
      await newEnvironmentCommand({ bridge });
      expect(capturedValidate?.('production')).toBe('Environment "production" already exists');
      expect(capturedValidate?.('staging')).toBeNull();
    });

    it('rejects empty names', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      let capturedValidate: ((s: string) => string | null) | undefined;
      (window.showInputBox as Mock).mockImplementationOnce(
        async (opts: { validateInput?: (s: string) => string | null }) => {
          capturedValidate = opts.validateInput;
          return undefined;
        },
      );
      await newEnvironmentCommand({ bridge });
      expect(capturedValidate?.('')).toBe('Name is required');
    });
  });

  describe('deleteEnvironmentCommand', () => {
    it('removes the env on confirmation', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p' }, { name: 's' }]);
      activate();
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteEnvironmentCommand({ bridge }, { kind: 'env', name: 'p' });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      expect(synced.environments.items.p).toBeUndefined();
      expect(synced.environments.items.s).toBeDefined();
    });

    it('keeps the env when user does not confirm', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p' }]);
      activate();
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deleteEnvironmentCommand({ bridge }, { kind: 'env', name: 'p' });
      const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
      expect(synced.environments.items.p).toBeDefined();
    });
  });
});
