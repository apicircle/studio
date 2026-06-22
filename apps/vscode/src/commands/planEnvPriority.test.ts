import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { setPlanEnvPriorityCommand } from './planEnvPriority';

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

interface SeedPlan {
  id: string;
  name: string;
  envPriorityOrder?: Array<{ kind: 'local'; name: string }>;
}

function seedWorkspace(apicircleDir: string, envNames: string[], plans: SeedPlan[] = []): void {
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
        priorityOrder: [],
      },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans: Object.fromEntries(
        plans.map((p) => [
          p.id,
          {
            id: p.id,
            name: p.name,
            steps: [],
            envPriorityOrder: p.envPriorityOrder ?? [],
            createdAt: '2026-01-01',
            updatedAt: '2026-01-01',
          },
        ]),
      ),
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
}

function readPlanOrder(apicircleDir: string, planId: string): unknown {
  const synced = JSON.parse(fs.readFileSync(path.join(apicircleDir, 'workspace.json'), 'utf8')) as {
    executionPlans: Record<string, { envPriorityOrder: unknown }>;
  };
  return synced.executionPlans[planId].envPriorityOrder;
}

describe('setPlanEnvPriorityCommand', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'planenv-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    (window.showQuickPick as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (workspace as { textDocuments: unknown }).textDocuments = [];
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
    await setPlanEnvPriorityCommand({ bridge });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
  });

  it('shows info when no plans exist and no node is given', async () => {
    seedWorkspace(apicircleDir, ['prod']);
    activate();
    await setPlanEnvPriorityCommand({ bridge });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No execution plans'),
    );
  });

  it('errors when the targeted plan no longer exists', async () => {
    seedWorkspace(apicircleDir, ['prod'], [{ id: 'p1', name: 'Smoke' }]);
    activate();
    await setPlanEnvPriorityCommand({ bridge }, { kind: 'plan', id: 'ghost' });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
    );
  });

  it('shows info when the workspace has no environments', async () => {
    seedWorkspace(apicircleDir, [], [{ id: 'p1', name: 'Smoke' }]);
    activate();
    await setPlanEnvPriorityCommand({ bridge }, { kind: 'plan', id: 'p1' });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No environments'),
    );
  });

  it('clears the plan overlay (inherit) when user picks zero envs', async () => {
    seedWorkspace(
      apicircleDir,
      ['prod', 'stage'],
      [{ id: 'p1', name: 'Smoke', envPriorityOrder: [{ kind: 'local', name: 'prod' }] }],
    );
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce([]); // multi-select empty
    await setPlanEnvPriorityCommand({ bridge }, { kind: 'plan', id: 'p1' });
    expect(readPlanOrder(apicircleDir, 'p1')).toEqual([]);
    expect(window.showInformationMessage).toHaveBeenCalledWith(expect.stringContaining('inherits'));
  });

  it('cancels gracefully when the inclusion picker is dismissed', async () => {
    seedWorkspace(
      apicircleDir,
      ['prod', 'stage'],
      [{ id: 'p1', name: 'Smoke', envPriorityOrder: [{ kind: 'local', name: 'prod' }] }],
    );
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await setPlanEnvPriorityCommand({ bridge }, { kind: 'plan', id: 'p1' });
    // unchanged
    expect(readPlanOrder(apicircleDir, 'p1')).toEqual([{ kind: 'local', name: 'prod' }]);
  });

  it('sets a single-env overlay directly without asking to order', async () => {
    seedWorkspace(apicircleDir, ['prod', 'stage'], [{ id: 'p1', name: 'Smoke' }]);
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce([{ label: 'prod' }]);
    await setPlanEnvPriorityCommand({ bridge }, { kind: 'plan', id: 'p1' });
    expect(readPlanOrder(apicircleDir, 'p1')).toEqual([{ kind: 'local', name: 'prod' }]);
  });

  it('refreshes the open plan editor after setting the overlay', async () => {
    seedWorkspace(apicircleDir, ['prod', 'stage'], [{ id: 'p1', name: 'Smoke' }]);
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce([{ label: 'prod' }]);
    let refreshed = 0;
    const fsProvider = {
      fireChangedExternal: () => {
        refreshed += 1;
      },
    };
    await setPlanEnvPriorityCommand({ bridge, fsProvider }, { kind: 'plan', id: 'p1' });
    expect(readPlanOrder(apicircleDir, 'p1')).toEqual([{ kind: 'local', name: 'prod' }]);
    expect(refreshed).toBe(1);
  });

  it('refreshes the open plan editor when clearing the overlay', async () => {
    seedWorkspace(
      apicircleDir,
      ['prod', 'stage'],
      [{ id: 'p1', name: 'Smoke', envPriorityOrder: [{ kind: 'local', name: 'prod' }] }],
    );
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce([]); // multi-select empty → inherit
    let refreshed = 0;
    const fsProvider = {
      fireChangedExternal: () => {
        refreshed += 1;
      },
    };
    await setPlanEnvPriorityCommand({ bridge, fsProvider }, { kind: 'plan', id: 'p1' });
    expect(readPlanOrder(apicircleDir, 'p1')).toEqual([]);
    expect(refreshed).toBe(1);
  });

  it('orders multiple envs in the sequence the user picks them', async () => {
    seedWorkspace(apicircleDir, ['a', 'b', 'c'], [{ id: 'p1', name: 'Smoke' }]);
    activate();
    const qp = window.showQuickPick as Mock;
    qp.mockResolvedValueOnce([{ label: 'a' }, { label: 'b' }, { label: 'c' }]);
    qp.mockResolvedValueOnce({ label: 'c' });
    qp.mockResolvedValueOnce({ label: 'a' });
    await setPlanEnvPriorityCommand({ bridge }, { kind: 'plan', id: 'p1' });
    expect(readPlanOrder(apicircleDir, 'p1')).toEqual([
      { kind: 'local', name: 'c' },
      { kind: 'local', name: 'a' },
      { kind: 'local', name: 'b' },
    ]);
  });

  it('resolves the plan via QuickPick when no node is provided', async () => {
    seedWorkspace(apicircleDir, ['prod'], [{ id: 'p1', name: 'Smoke' }]);
    activate();
    const qp = window.showQuickPick as Mock;
    qp.mockResolvedValueOnce({ label: 'Smoke', id: 'p1' }); // plan picker
    qp.mockResolvedValueOnce([{ label: 'prod' }]); // env inclusion
    await setPlanEnvPriorityCommand({ bridge });
    expect(readPlanOrder(apicircleDir, 'p1')).toEqual([{ kind: 'local', name: 'prod' }]);
  });

  it('refuses to set environments while the plan editor has unsaved changes', async () => {
    seedWorkspace(apicircleDir, ['prod', 'stage'], [{ id: 'p1', name: 'Smoke' }]);
    activate();
    (workspace as { textDocuments: unknown }).textDocuments = [
      { uri: Uri.parse('apicircle://ws/plans/Smoke.yaml?id=p1'), isDirty: true },
    ];
    await setPlanEnvPriorityCommand({ bridge }, { kind: 'plan', id: 'p1' });
    expect(window.showWarningMessage).toHaveBeenCalledWith(
      expect.stringContaining('unsaved changes'),
    );
    // Never reached the env inclusion picker, and the overlay is unchanged.
    expect(window.showQuickPick).not.toHaveBeenCalled();
    expect(readPlanOrder(apicircleDir, 'p1')).toEqual([]);
  });
});
