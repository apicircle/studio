import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { setEnvPriorityOrderCommand } from './environmentPriority';

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

function seedWorkspace(
  apicircleDir: string,
  envNames: string[],
  existingOrder: string[] = [],
): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'test-ws',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: {
        items: Object.fromEntries(envNames.map((n) => [n, { name: n, variables: [] }])),
        activeName: null,
        priorityOrder: existingOrder.map((n) => ({ kind: 'local', name: n })),
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

describe('setEnvPriorityOrderCommand', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'envprio-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    (window.showQuickPick as Mock).mockReset();
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
    });
    bridge.setActive(apicircleDir);
  }

  it('warns when no workspace is active', async () => {
    await setEnvPriorityOrderCommand({ bridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
  });

  it('shows info when no envs exist', async () => {
    seedWorkspace(apicircleDir, []);
    activate();
    await setEnvPriorityOrderCommand({ bridge });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No environments'),
    );
  });

  it('clears the priority order when user picks zero envs', async () => {
    seedWorkspace(apicircleDir, ['a', 'b'], ['a']);
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce([]); // multi-select empty
    await setEnvPriorityOrderCommand({ bridge });
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    expect(synced.environments.priorityOrder).toEqual([]);
  });

  it('cancels gracefully when multi-select is dismissed', async () => {
    seedWorkspace(apicircleDir, ['a', 'b'], ['a']);
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setEnvPriorityOrderCommand({ bridge });
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    expect(synced.environments.priorityOrder).toEqual([{ kind: 'local', name: 'a' }]); // unchanged
  });

  it('sets order with a single env directly without asking again', async () => {
    seedWorkspace(apicircleDir, ['a', 'b']);
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce([{ label: 'a' }]);
    await setEnvPriorityOrderCommand({ bridge });
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    expect(synced.environments.priorityOrder).toEqual([{ kind: 'local', name: 'a' }]);
  });

  it('orders multiple envs in the sequence the user picks them', async () => {
    seedWorkspace(apicircleDir, ['a', 'b', 'c']);
    activate();
    const qp = window.showQuickPick as Mock;
    // Step 1: include a, b, c
    qp.mockResolvedValueOnce([{ label: 'a' }, { label: 'b' }, { label: 'c' }]);
    // Step 2: pick c first, then a (b is the last remaining and auto-completes)
    qp.mockResolvedValueOnce({ label: 'c' });
    qp.mockResolvedValueOnce({ label: 'a' });
    await setEnvPriorityOrderCommand({ bridge });
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    expect(synced.environments.priorityOrder).toEqual([
      { kind: 'local', name: 'c' },
      { kind: 'local', name: 'a' },
      { kind: 'local', name: 'b' },
    ]);
  });

  it('aborts mid-flow when user dismisses the second QuickPick', async () => {
    seedWorkspace(apicircleDir, ['a', 'b', 'c']);
    activate();
    const qp = window.showQuickPick as Mock;
    qp.mockResolvedValueOnce([{ label: 'a' }, { label: 'b' }, { label: 'c' }]);
    qp.mockResolvedValueOnce(undefined); // dismiss
    await setEnvPriorityOrderCommand({ bridge });
    const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8'));
    expect(synced.environments.priorityOrder).toEqual([]); // unchanged from initial
  });
});
