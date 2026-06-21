import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { newPlanCommand } from './newPlan';

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
  requestIds: string[],
  existingPlans: string[] = [],
): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  const requests = Object.fromEntries(
    requestIds.map((id) => [
      id,
      {
        id,
        name: id.toUpperCase(),
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
    ]),
  );
  const executionPlans = Object.fromEntries(
    existingPlans.map((name) => [
      `p_${name}`,
      {
        id: `p_${name}`,
        name,
        steps: [],
        envPriorityOrder: [],
        createdAt: '2026-01-01',
        updatedAt: '2026-01-01',
      },
    ]),
  );
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'test-ws',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans,
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

describe('newPlanCommand', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'newplan-'));
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

  it('warns when no workspace is active', async () => {
    await newPlanCommand({ bridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
  });

  it('shows info when no requests exist', async () => {
    seedWorkspace(apicircleDir, []);
    activate();
    await newPlanCommand({ bridge });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No requests'),
    );
  });

  it('cancels gracefully when name InputBox is dismissed', async () => {
    seedWorkspace(apicircleDir, ['r1']);
    activate();
    (window.showInputBox as Mock).mockResolvedValueOnce(undefined);
    await newPlanCommand({ bridge });
    const state = await bridge.activeWorkspace()!.read();
    expect(Object.keys(state.synced.executionPlans ?? {})).toEqual([]);
  });

  it('rejects duplicate plan names via validateInput', async () => {
    seedWorkspace(apicircleDir, ['r1'], ['Smoke']);
    activate();
    let validate: ((s: string) => string | null) | undefined;
    (window.showInputBox as Mock).mockImplementationOnce(
      async (opts: { validateInput?: (s: string) => string | null }) => {
        validate = opts.validateInput;
        return undefined;
      },
    );
    await newPlanCommand({ bridge });
    expect(validate?.('Smoke')).toBe('Plan "Smoke" already exists');
    expect(validate?.('Other')).toBeNull();
  });

  it('creates a single-step plan when only one request is picked', async () => {
    seedWorkspace(apicircleDir, ['r1']);
    activate();
    const qp = window.showQuickPick as Mock;
    const ib = window.showInputBox as Mock;
    ib.mockResolvedValueOnce('Smoke');
    qp.mockResolvedValueOnce([{ label: 'R1', requestId: 'r1' }]);
    qp.mockResolvedValueOnce({ label: 'No — run all steps even if assertions fail', value: false });

    await newPlanCommand({ bridge });
    const state = await bridge.activeWorkspace()!.read();
    const plans = Object.values(state.synced.executionPlans ?? {}) as Array<{
      name: string;
      steps: Array<{ requestId: string }>;
    }>;
    expect(plans).toHaveLength(1);
    expect(plans[0].name).toBe('Smoke');
    expect(plans[0].steps).toEqual([{ requestId: 'r1', enabled: true }]);
  });

  it('orders multi-step plan according to user picks', async () => {
    seedWorkspace(apicircleDir, ['r1', 'r2', 'r3']);
    activate();
    const qp = window.showQuickPick as Mock;
    const ib = window.showInputBox as Mock;
    ib.mockResolvedValueOnce('Multi');
    qp.mockResolvedValueOnce([
      { label: 'R1', requestId: 'r1' },
      { label: 'R2', requestId: 'r2' },
      { label: 'R3', requestId: 'r3' },
    ]);
    // Pick r3 first, then r1; r2 is the last remaining and auto-fills
    qp.mockResolvedValueOnce({ requestId: 'r3' });
    qp.mockResolvedValueOnce({ requestId: 'r1' });
    qp.mockResolvedValueOnce({ label: 'No — run all steps even if assertions fail', value: false });

    await newPlanCommand({ bridge });
    const state = await bridge.activeWorkspace()!.read();
    const plan = Object.values(state.synced.executionPlans ?? {})[0] as {
      steps: Array<{ requestId: string }>;
    };
    expect(plan.steps.map((s) => s.requestId)).toEqual(['r3', 'r1', 'r2']);
  });

  it('honors stopOnAssertionFailure choice', async () => {
    seedWorkspace(apicircleDir, ['r1']);
    activate();
    const qp = window.showQuickPick as Mock;
    const ib = window.showInputBox as Mock;
    ib.mockResolvedValueOnce('Strict');
    qp.mockResolvedValueOnce([{ label: 'R1', requestId: 'r1' }]);
    qp.mockResolvedValueOnce({ value: true });

    await newPlanCommand({ bridge });
    const state = await bridge.activeWorkspace()!.read();
    const plan = Object.values(state.synced.executionPlans ?? {})[0] as {
      stopOnAssertionFailure: boolean;
    };
    expect(plan.stopOnAssertionFailure).toBe(true);
  });
});
