import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { EnvironmentView, type EnvironmentNode } from './EnvironmentView';

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
  variables: Array<{ key: string; value: string; encrypted?: boolean; secretKeyId?: string }>;
}

function seedWorkspace(
  apicircleDir: string,
  envs: SeedEnv[],
  activeName: string | null = null,
  secretCrypto: unknown = null,
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
              variables: e.variables.map((v) => ({ ...v, encrypted: v.encrypted ?? false })),
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
      secretCrypto,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('EnvironmentView', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let view: EnvironmentView;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envview-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    view = new EnvironmentView(bridge);
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

  describe('getChildren', () => {
    it('returns [] when no workspace is active', async () => {
      const result = await view.getChildren();
      expect(result).toEqual([]);
    });

    it('returns one env node per environment, active first', async () => {
      seedWorkspace(
        apicircleDir,
        [
          { name: 'production', variables: [] },
          { name: 'staging', variables: [] },
          { name: 'local', variables: [] },
        ],
        'staging',
      );
      activate();

      const result = await view.getChildren();
      // P4: a vault-header root node is now prepended to the env list.
      expect(result).toEqual([
        { kind: 'vault-header' },
        { kind: 'env', name: 'staging' }, // active first
        { kind: 'env', name: 'local' },
        { kind: 'env', name: 'production' },
        { kind: 'context-globals' },
      ]);
    });

    it('appends Context Globals node at the end of root', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      const result = await view.getChildren();
      // P4: vault-header is always the first root node.
      expect(result).toEqual([{ kind: 'vault-header' }, { kind: 'context-globals' }]);
    });

    it('returns variable children for an env element (encrypted rows get variable-encrypted kind)', async () => {
      seedWorkspace(apicircleDir, [
        {
          name: 'production',
          variables: [
            { key: 'base_url', value: 'https://x.com' },
            { key: 'api_key', value: 'secret', encrypted: true, secretKeyId: 'ck_a' },
          ],
        },
      ]);
      activate();

      const children = await view.getChildren({ kind: 'env', name: 'production' });
      expect(children).toEqual([
        { kind: 'variable', envName: 'production', key: 'base_url' },
        { kind: 'variable-encrypted', envName: 'production', key: 'api_key' },
      ]);
    });

    it('returns [] for a variable element (leaves)', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p', variables: [{ key: 'k', value: 'v' }] }]);
      activate();
      const result = await view.getChildren({ kind: 'variable', envName: 'p', key: 'k' });
      expect(result).toEqual([]);
    });

    it('returns sorted global-var children for context-globals when globalContext has keys', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      const active = bridge.activeWorkspace()!;
      const state = await active.read();
      (state.local as { globalContext: Record<string, string> }).globalContext = {
        z_var: 'z',
        a_var: 'a',
      };
      await active.write({ local: state.local });
      const result = await view.getChildren({ kind: 'context-globals' });
      expect(result).toEqual([
        { kind: 'global-var', key: 'a_var' },
        { kind: 'global-var', key: 'z_var' },
      ]);
    });

    it('returns [] for a deleted env', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      const result = await view.getChildren({ kind: 'env', name: 'nonexistent' });
      expect(result).toEqual([]);
    });

    it('returns [] for vault-header (leaf node)', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      const result = await view.getChildren({ kind: 'vault-header' });
      expect(result).toEqual([]);
    });
  });

  describe('getTreeItem', () => {
    it('renders "No workspace" when nothing is active', async () => {
      const item = await view.getTreeItem({ kind: 'env', name: 'x' } as EnvironmentNode);
      expect(item.label).toBe('No workspace');
    });

    it('renders an env with active badge + var count', async () => {
      seedWorkspace(apicircleDir, [{ name: 'production', variables: [] }], 'production');
      activate();
      const item = await view.getTreeItem({ kind: 'env', name: 'production' });
      expect(item.label).toBe('production');
      // Description now embeds the active marker AND the variable count so
      // users see at a glance how populated each env is.
      expect(item.description).toContain('active');
      expect(item.description).toContain('0 vars');
      expect(item.contextValue).toBe('env-active');
    });

    it('renders an inactive env with var count (no active badge)', async () => {
      seedWorkspace(apicircleDir, [{ name: 'staging', variables: [] }], 'production');
      activate();
      const item = await view.getTreeItem({ kind: 'env', name: 'staging' });
      expect(item.description).toBe('0 vars');
      expect(item.description).not.toContain('active');
      expect(item.contextValue).toBe('env');
    });

    it('renders a plaintext variable with its value', async () => {
      seedWorkspace(apicircleDir, [
        { name: 'p', variables: [{ key: 'base_url', value: 'https://x.com' }] },
      ]);
      activate();
      const item = await view.getTreeItem({ kind: 'variable', envName: 'p', key: 'base_url' });
      expect(item.label).toContain('base_url');
      expect(item.label).toContain('https://x.com');
      expect(item.contextValue).toBe('variable');
    });

    it('masks encrypted variable values', async () => {
      seedWorkspace(apicircleDir, [
        {
          name: 'p',
          variables: [
            { key: 'k', value: 'enc:v1:abcdefghij:xyz', encrypted: true, secretKeyId: 'ck_a' },
          ],
        },
      ]);
      activate();
      const item = await view.getTreeItem({ kind: 'variable', envName: 'p', key: 'k' });
      expect(item.label).toContain('k = ');
      expect(item.label).not.toContain('abcdefghij');
      expect(item.label).toMatch(/••/);
      expect(item.contextValue).toBe('variable-encrypted');
    });

    it('handles a deleted env gracefully', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      const item = await view.getTreeItem({ kind: 'env', name: 'gone' });
      expect(item.label).toBe('(deleted env)');
    });

    it('handles a deleted variable gracefully', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p', variables: [] }]);
      activate();
      const item = await view.getTreeItem({ kind: 'variable', envName: 'p', key: 'gone' });
      expect(item.label).toBe('(deleted variable)');
    });

    it('renders context-globals header with count description', async () => {
      seedWorkspace(apicircleDir, []);
      activate();
      const item = await view.getTreeItem({ kind: 'context-globals' });
      expect(item.label).toBe('Context Globals');
      expect(item.description).toBe('empty');
      expect(item.contextValue).toBe('context-globals');
    });

    it('renders a global-var row with key=value', async () => {
      // Seed with globalContext in the local state
      seedWorkspace(apicircleDir, []);
      activate();
      // For this test, reach directly into the bridge's workspace to simulate
      const active = bridge.activeWorkspace()!;
      const state = await active.read();
      (state.local as { globalContext: Record<string, string> }).globalContext = {
        api_token: 'abc123',
      };
      await active.write({ local: state.local });
      const item = await view.getTreeItem({ kind: 'global-var', key: 'api_token' });
      expect(item.label).toContain('api_token');
      expect(item.label).toContain('abc123');
      expect(item.contextValue).toBe('global-var');
    });

    it('renders env with multiple variables and encrypted count in tooltip', async () => {
      seedWorkspace(apicircleDir, [
        {
          name: 'prod',
          variables: [
            { key: 'url', value: 'https://x' },
            { key: 'secret', value: 'enc:xxx', encrypted: true, secretKeyId: 'k1' },
          ],
        },
      ]);
      activate();
      const item = await view.getTreeItem({ kind: 'env', name: 'prod' });
      expect(item.description).toContain('2 vars');
    });

    it('masks short encrypted values with just dots', async () => {
      seedWorkspace(apicircleDir, [
        {
          name: 'p',
          variables: [{ key: 'short', value: 'abcd', encrypted: true, secretKeyId: 'k1' }],
        },
      ]);
      activate();
      const item = await view.getTreeItem({
        kind: 'variable-encrypted',
        envName: 'p',
        key: 'short',
      });
      // Short values (<=8 chars) get full mask
      expect(item.label).toContain('••••');
      expect(item.label).not.toContain('abcd');
    });

    it('encrypted variable row has openVaultEntry click command', async () => {
      seedWorkspace(apicircleDir, [
        {
          name: 'p',
          variables: [
            { key: 'api_key', value: 'enc:abcdefghij', encrypted: true, secretKeyId: 'k1' },
          ],
        },
      ]);
      activate();
      const item = await view.getTreeItem({
        kind: 'variable-encrypted',
        envName: 'p',
        key: 'api_key',
      });
      expect(item.command?.command).toBe('apicircle.openVaultEntry');
    });

    // ----- P4 audit-G3: vault-header rendering across the 3 states -----

    it('vault-header renders "not configured" when secretCrypto is null', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p', variables: [] }], 'p', null);
      activate();
      const item = await view.getTreeItem({ kind: 'vault-header' });
      expect(item.label).toMatch(/not configured/i);
      expect(item.contextValue).toBe('vault-unconfigured');
      expect(item.command?.command).toBe('apicircle.setupVaultPassphrase');
    });

    it('vault-header renders "locked" when secretCrypto is set but no key cached', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p', variables: [] }], 'p', {
        kdf: 'pbkdf2-sha256-v1',
        salt: 'AAAA',
        iterations: 100,
        verifier: 'V',
      });
      activate();
      const item = await view.getTreeItem({ kind: 'vault-header' });
      expect(item.label).toMatch(/locked/i);
      expect(item.contextValue).toBe('vault-locked');
      expect(item.command?.command).toBe('apicircle.unlockVault');
    });

    it('vault-header renders "unlocked" when a key is cached', async () => {
      seedWorkspace(apicircleDir, [{ name: 'p', variables: [] }], 'p', {
        kdf: 'pbkdf2-sha256-v1',
        salt: 'AAAA',
        iterations: 100,
        verifier: 'V',
      });
      activate();
      // Inject a fake vault manager that reports the workspace as unlocked.
      // The view subscribes to onDidChange, so the fake also needs that.
      const fakeVault = {
        isUnlocked: () => true,
        onDidChange: () => ({ dispose: () => undefined }),
      } as unknown as ConstructorParameters<typeof EnvironmentView>[1];
      const viewWithVault = new EnvironmentView(bridge, fakeVault);
      const item = await viewWithVault.getTreeItem({ kind: 'vault-header' });
      expect(item.label).toMatch(/unlocked/i);
      expect(item.contextValue).toBe('vault-unlocked');
      expect(item.command?.command).toBe('apicircle.lockVault');
    });
  });
});
