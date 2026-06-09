import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { AbortRegistry } from '../execute/abortRegistry';
import { StatusBar } from './statusBar';

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

interface MockItem {
  text: string;
  tooltip: string | undefined;
  command: string | undefined;
  show: ReturnType<typeof vi.fn>;
  hide: ReturnType<typeof vi.fn>;
  dispose: ReturnType<typeof vi.fn>;
}

function makeMockItem(): MockItem {
  return {
    text: '',
    tooltip: undefined,
    command: undefined,
    show: vi.fn(),
    hide: vi.fn(),
    dispose: vi.fn(),
  };
}

function seedWorkspace(apicircleDir: string, activeEnv: string | null): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'test-ws',
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: {},
        folders: {},
      },
      environments: { items: {}, activeName: activeEnv, priorityOrder: [] },
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

describe('StatusBar', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let registry: AbortRegistry;
  let workspaceItem: MockItem;
  let cancelItem: MockItem;
  let vaultItem: MockItem;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'statusbar-'));
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    registry = new AbortRegistry();
    workspaceItem = makeMockItem();
    cancelItem = makeMockItem();
    vaultItem = makeMockItem();
    (window.createStatusBarItem as ReturnType<typeof vi.fn>).mockReset();
    (window.createStatusBarItem as ReturnType<typeof vi.fn>)
      .mockReturnValueOnce(workspaceItem)
      .mockReturnValueOnce(cancelItem)
      .mockReturnValueOnce(vaultItem);
  });

  afterEach(() => {
    bridge.dispose();
    registry.cancelAll();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('shows a "no workspace" placeholder when nothing is active', () => {
    const bar = new StatusBar(bridge, registry);
    expect(workspaceItem.text).toContain('APICircle');
    expect(workspaceItem.show).toHaveBeenCalled();
    bar.dispose();
  });

  it('refreshes to show workspace label + active env when registered', async () => {
    const dir = path.join(tmp, '.apicircle');
    seedWorkspace(dir, 'production');
    bridge.registerWorkspace({
      id: dir,
      apicircleDir: dir,
      workspaceJsonPath: path.join(dir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 'test', index: 0 } as never,
      label: 'test',
    });
    bridge.setActive(dir);

    const bar = new StatusBar(bridge, registry);
    bar.refresh();
    // Wait for the async read inside refresh
    await new Promise((r) => setTimeout(r, 50));
    expect(workspaceItem.text).toContain('test');
    expect(workspaceItem.text).toContain('production');
    bar.dispose();
  });

  it('cancel item is hidden when no sends are in flight', () => {
    const bar = new StatusBar(bridge, registry);
    bar.refreshCancelItem();
    expect(cancelItem.hide).toHaveBeenCalled();
    bar.dispose();
  });

  it('cancel item is shown with count when sends are in flight', () => {
    registry.register('r1');
    registry.register('r2');
    const bar = new StatusBar(bridge, registry);
    bar.refreshCancelItem();
    expect(cancelItem.show).toHaveBeenCalled();
    expect(cancelItem.text).toContain('(2)');
    bar.dispose();
  });

  it('dispose clears the polling interval and disposes items', () => {
    const bar = new StatusBar(bridge, registry);
    bar.dispose();
    expect(workspaceItem.dispose).toHaveBeenCalled();
    expect(cancelItem.dispose).toHaveBeenCalled();
    expect(vaultItem.dispose).toHaveBeenCalled();
  });

  it('vault item is HIDDEN when active workspace has no secretCrypto (P4 wired)', async () => {
    // Phase 4 wiring update: the vault status-bar item only shows when
    // the workspace actually has a passphrase set. A workspace with
    // `secretCrypto: null` is in "Set Up Vault Passphrase" state —
    // EnvironmentView surfaces the CTA, the status bar stays quiet.
    const dir = path.join(tmp, '.apicircle');
    seedWorkspace(dir, null);
    bridge.registerWorkspace({
      id: dir,
      apicircleDir: dir,
      workspaceJsonPath: path.join(dir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 'test', index: 0 } as never,
      label: 'test',
    });
    bridge.setActive(dir);
    const bar = new StatusBar(bridge, registry);
    bar.refresh();
    await new Promise((r) => setTimeout(r, 50));
    expect(vaultItem.hide).toHaveBeenCalled();
    bar.dispose();
  });

  it('vault item is hidden when no workspace is active', () => {
    const bar = new StatusBar(bridge, registry);
    expect(vaultItem.hide).toHaveBeenCalled();
    bar.dispose();
  });

  // ----- XPhase-G3: vault item wired to real VaultManager state -----

  it('vault item shows LOCK icon + unlockVault command when secretCrypto exists but key not cached', async () => {
    const dir = path.join(tmp, '.apicircle');
    // Seed with a populated secretCrypto blob.
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'workspace.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: 'sb-vault',
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
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
        secretCrypto: {
          kdf: 'pbkdf2-sha256-v1',
          salt: 'AAAA',
          iterations: 100,
          verifier: 'verifier-stub',
        },
        meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
      }),
    );
    bridge.registerWorkspace({
      id: dir,
      apicircleDir: dir,
      workspaceJsonPath: path.join(dir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(dir);
    const fakeVault = {
      isUnlockedAgainst: () => false,
      onDidChange: () => ({ dispose: () => undefined }),
    } as unknown as ConstructorParameters<typeof StatusBar>[2];
    const bar = new StatusBar(bridge, registry, fakeVault);
    bar.refresh();
    await new Promise((r) => setTimeout(r, 50));
    expect(vaultItem.show).toHaveBeenCalled();
    expect(vaultItem.text).toContain('lock');
    expect(vaultItem.command).toBe('apicircle.unlockVault');
    bar.dispose();
  });

  it('vault item shows UNLOCK icon + lockVault command when key is cached + verifier matches', async () => {
    const dir = path.join(tmp, '.apicircle');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(
      path.join(dir, 'workspace.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: 'sb-vault',
        collections: {
          tree: { id: 'root', type: 'root', children: [] },
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
        secretCrypto: {
          kdf: 'pbkdf2-sha256-v1',
          salt: 'AAAA',
          iterations: 100,
          verifier: 'verifier-stub',
        },
        meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
      }),
    );
    bridge.registerWorkspace({
      id: dir,
      apicircleDir: dir,
      workspaceJsonPath: path.join(dir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(dir);
    const fakeVault = {
      isUnlockedAgainst: () => true,
      onDidChange: () => ({ dispose: () => undefined }),
    } as unknown as ConstructorParameters<typeof StatusBar>[2];
    const bar = new StatusBar(bridge, registry, fakeVault);
    bar.refresh();
    await new Promise((r) => setTimeout(r, 50));
    expect(vaultItem.show).toHaveBeenCalled();
    expect(vaultItem.text).toContain('unlock');
    expect(vaultItem.command).toBe('apicircle.lockVault');
    bar.dispose();
  });
});
