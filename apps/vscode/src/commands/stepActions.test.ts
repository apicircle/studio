import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window } from '../../test/mocks/vscode';
import { deviceLocalPath } from '../util/workspaceDiscovery';
import { VsCodeBridge } from '../host/vscodeBridge';
import { toggleStepEnabledCommand, removeStepFromPlanCommand } from './stepActions';

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

function seedPlan(apicircleDir: string, globalStorageRoot: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'sa',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
      linkedWorkspaces: {},
      linkedOverrides: { requests: {}, environmentVars: {} },
      releases: { self: null, perLink: {} },
      globalAssets: { schemas: {}, graphql: {}, files: {} },
      mockServers: {},
      executionPlans: {
        p1: {
          id: 'p1',
          name: 'Smoke',
          steps: [
            { requestId: 'r1', enabled: true },
            { requestId: 'r2', enabled: true },
            { requestId: 'r3', enabled: false },
          ],
          envPriorityOrder: [],
          createdAt: '2026-01-01',
          updatedAt: '2026-01-01',
        },
      },
      secretKeys: {},
      secretCrypto: null,
      meta: { createdAt: '2026-01-01', updatedAt: '2026-01-01', appVersion: '0.1.0' },
    }),
  );
  const localDir = deviceLocalPath(Uri.file(globalStorageRoot), { apicircleDir });
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'workspace.local.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'sa',
      executionPlans: {},
      history: { requestRuns: [], planRuns: [] },
      secretIndex: { entries: {} },
      sessions: { github: { workspace: null, links: {} } },
      connectedRepo: null,
      workingBranch: null,
      seededWorkspaceSha: null,
      retiredBranch: null,
      sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
      linkedCollections: {},
      attachmentCache: {},
      globalContext: {},
      mockRuntime: { active: {} },
      ui: {
        activeRequestId: null,
        sidebarExpandedSections: [],
        themeId: 'one-dark-pro',
        fontId: 'system-mono',
        fontSizePercent: 100,
      },
      settings: { validateOnSend: true, monacoConsumesWheel: false },
      snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
    }),
  );
}

describe('stepActions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sa-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seedPlan(apicircleDir, path.join(tmp, 'globalStorage'));
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
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('toggleStepEnabledCommand', () => {
    it('warns when no node is provided (palette path)', async () => {
      await toggleStepEnabledCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Right-click'),
      );
    });

    it('warns when plan no longer exists', async () => {
      await toggleStepEnabledCommand({ bridge }, { kind: 'step', planId: 'ghost', stepIndex: 0 });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Plan no longer'),
      );
    });

    it('warns when step index is out of bounds', async () => {
      await toggleStepEnabledCommand({ bridge }, { kind: 'step', planId: 'p1', stepIndex: 99 });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Step no longer'),
      );
    });

    it('flips an enabled step to disabled', async () => {
      await toggleStepEnabledCommand({ bridge }, { kind: 'step', planId: 'p1', stepIndex: 0 });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps[0].enabled).toBe(false);
    });

    it('flips a disabled step to enabled', async () => {
      await toggleStepEnabledCommand(
        { bridge },
        { kind: 'step-disabled', planId: 'p1', stepIndex: 2 },
      );
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps[2].enabled).toBe(true);
    });
  });

  describe('removeStepFromPlanCommand', () => {
    it('warns when no node provided', async () => {
      await removeStepFromPlanCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Right-click'),
      );
    });

    it('cancels when user declines', async () => {
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await removeStepFromPlanCommand({ bridge }, { kind: 'step', planId: 'p1', stepIndex: 0 });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps).toHaveLength(3);
    });

    it('drops the step on confirmation', async () => {
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Remove');
      await removeStepFromPlanCommand({ bridge }, { kind: 'step', planId: 'p1', stepIndex: 1 });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps).toHaveLength(2);
      expect(state.synced.executionPlans?.p1.steps.map((s) => s.requestId)).toEqual(['r1', 'r3']);
    });
  });
});
