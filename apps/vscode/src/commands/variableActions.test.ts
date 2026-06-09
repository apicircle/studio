import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { editVariableValueCommand, deleteVariableCommand } from './variableActions';

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

function seed(
  apicircleDir: string,
  envName: string,
  vars: Array<{ key: string; value: string; encrypted?: boolean; secretKeyId?: string }>,
): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'var-act',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: {
        items: {
          [envName]: {
            name: envName,
            variables: vars.map((v) => ({ ...v, encrypted: v.encrypted ?? false })),
          },
        },
        activeName: null,
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

describe('variableActions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'var-act-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    (window.showInputBox as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activate(
    envName: string,
    vars: Array<{ key: string; value: string; encrypted?: boolean; secretKeyId?: string }> = [],
  ): void {
    seed(apicircleDir, envName, vars);
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(apicircleDir);
  }

  describe('editVariableValueCommand', () => {
    it('no-ops when node is not provided', async () => {
      activate('prod', [{ key: 'k', value: 'v' }]);
      await editVariableValueCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.environments.items.prod.variables[0].value).toBe('v');
    });

    it('redirects encrypted vars to apicircle.openVaultEntry (P4)', async () => {
      const vscodeMock = await import('../../test/mocks/vscode');
      (vscodeMock.commands.executeCommand as Mock).mockReset();
      activate('prod', [
        { key: 'k', value: 'enc:v1:abc:xyz', encrypted: true, secretKeyId: 'ck_a' },
      ]);
      await editVariableValueCommand({ bridge }, { kind: 'variable', envName: 'prod', key: 'k' });
      // The Phase 4 routing fires apicircle.openVaultEntry instead of
      // showing a "not implemented" warning, and leaves the wire-encrypted
      // value untouched on disk.
      expect(vscodeMock.commands.executeCommand).toHaveBeenCalledWith('apicircle.openVaultEntry', {
        kind: 'variable',
        envName: 'prod',
        key: 'k',
      });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.environments.items.prod.variables[0].value).toBe('enc:v1:abc:xyz');
    });

    it('updates plaintext variable value when InputBox returns a new value', async () => {
      activate('prod', [{ key: 'base_url', value: 'https://old.com' }]);
      (window.showInputBox as Mock).mockResolvedValueOnce('https://new.com');
      await editVariableValueCommand(
        { bridge },
        { kind: 'variable', envName: 'prod', key: 'base_url' },
      );
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.environments.items.prod.variables[0].value).toBe('https://new.com');
    });

    it('cancels gracefully when InputBox is dismissed', async () => {
      activate('prod', [{ key: 'k', value: 'v' }]);
      (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
      await editVariableValueCommand({ bridge }, { kind: 'variable', envName: 'prod', key: 'k' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.environments.items.prod.variables[0].value).toBe('v');
    });

    it('handles missing env / variable gracefully', async () => {
      activate('prod', []);
      await editVariableValueCommand({ bridge }, { kind: 'variable', envName: 'gone', key: 'k' });
      // No throw, no toast
    });
  });

  describe('deleteVariableCommand', () => {
    it('no-ops when node is not provided', async () => {
      activate('prod', [{ key: 'k', value: 'v' }]);
      await deleteVariableCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.environments.items.prod.variables).toHaveLength(1);
    });

    it('removes the variable on confirmation', async () => {
      activate('prod', [
        { key: 'k', value: 'v' },
        { key: 'k2', value: 'v2' },
      ]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteVariableCommand({ bridge }, { kind: 'variable', envName: 'prod', key: 'k' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.environments.items.prod.variables.map((v) => v.key)).toEqual(['k2']);
    });

    it('preserves variable when user declines', async () => {
      activate('prod', [{ key: 'k', value: 'v' }]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deleteVariableCommand({ bridge }, { kind: 'variable', envName: 'prod', key: 'k' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.environments.items.prod.variables).toHaveLength(1);
    });
  });
});
