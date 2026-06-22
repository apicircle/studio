import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import { deviceLocalPath } from '../util/workspaceDiscovery';
import { VsCodeBridge } from '../host/vscodeBridge';
import {
  toggleStepEnabledCommand,
  removeStepFromPlanCommand,
  addStepToPlanCommand,
  changeStepRequestCommand,
} from './stepActions';

function req(id: string, name: string, method = 'GET') {
  return {
    id,
    name,
    folderId: null,
    method,
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
  };
}

function fsStub() {
  return { fireChangedExternal: vi.fn() };
}

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
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: {
          r1: req('r1', 'Sign up', 'POST'),
          r2: req('r2', 'Log in', 'POST'),
          r3: req('r3', 'Get profile'),
          r4: req('r4', 'Refresh token', 'POST'),
        },
        folders: {},
      },
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
    (window.showQuickPick as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    // Default: no open editors. Individual tests opt into a dirty plan doc.
    (workspace as { textDocuments: unknown }).textDocuments = [];
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

    it('refreshes the open plan editor after the mutation', async () => {
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Remove');
      const fsProvider = fsStub();
      await removeStepFromPlanCommand(
        { bridge, fsProvider },
        { kind: 'step', planId: 'p1', stepIndex: 1 },
      );
      expect(fsProvider.fireChangedExternal).toHaveBeenCalledTimes(1);
    });
  });

  describe('addStepToPlanCommand', () => {
    const SELECT_ALL = '__apicircle_select_all__';

    it('appends the picked requests (multi-select returns an array)', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce([{ requestId: 'r4' }]);
      const fsProvider = fsStub();
      await addStepToPlanCommand({ bridge, fsProvider }, { kind: 'plan', id: 'p1' });
      const state = await bridge.activeWorkspace()!.read();
      const steps = state.synced.executionPlans?.p1.steps ?? [];
      expect(steps).toHaveLength(4);
      expect(steps[3]).toEqual({ requestId: 'r4', enabled: true });
      expect(fsProvider.fireChangedExternal).toHaveBeenCalledTimes(1);
    });

    it('hides already-added requests from the picker (offers only addable ones)', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await addStepToPlanCommand({ bridge }, { kind: 'plan', id: 'p1' });
      const items = (window.showQuickPick as Mock).mock.calls[0][0] as Array<{
        requestId: string;
      }>;
      const ids = items.map((i) => i.requestId);
      expect(ids).toContain('r4'); // not yet in the plan
      expect(ids).toContain(SELECT_ALL); // the "Select all" option
      expect(ids).not.toContain('r1'); // already steps → hidden
      expect(ids).not.toContain('r2');
      expect(ids).not.toContain('r3');
    });

    it('adds every remaining request when "Select all" is chosen', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce([{ requestId: SELECT_ALL }]);
      await addStepToPlanCommand({ bridge }, { kind: 'plan', id: 'p1' });
      const state = await bridge.activeWorkspace()!.read();
      const steps = state.synced.executionPlans?.p1.steps ?? [];
      // r4 was the only request not already in the plan.
      expect(steps.map((s) => s.requestId)).toEqual(['r1', 'r2', 'r3', 'r4']);
    });

    it('reports when every request is already a step (nothing addable)', async () => {
      // First add r4 so the plan contains all four requests.
      (window.showQuickPick as Mock).mockResolvedValueOnce([{ requestId: 'r4' }]);
      await addStepToPlanCommand({ bridge }, { kind: 'plan', id: 'p1' });
      (window.showQuickPick as Mock).mockClear();
      (window.showInformationMessage as Mock).mockClear();
      // Now nothing is addable — the picker must not open.
      await addStepToPlanCommand({ bridge }, { kind: 'plan', id: 'p1' });
      expect(window.showQuickPick).not.toHaveBeenCalled();
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('already a step'),
      );
    });

    it('does nothing when the request picker is dismissed', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await addStepToPlanCommand({ bridge }, { kind: 'plan', id: 'p1' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps).toHaveLength(3);
    });

    it('warns when the plan no longer exists', async () => {
      await addStepToPlanCommand({ bridge }, { kind: 'plan', id: 'ghost' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('Plan no longer'),
      );
    });
  });

  describe('changeStepRequestCommand', () => {
    it('repoints the step at the picked request, preserving enabled', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce({ requestId: 'r4' });
      const fsProvider = fsStub();
      await changeStepRequestCommand({ bridge, fsProvider }, { planId: 'p1', stepIndex: 2 });
      const state = await bridge.activeWorkspace()!.read();
      // step 2 was { requestId: 'r3', enabled: false } in the seed.
      expect(state.synced.executionPlans?.p1.steps[2]).toEqual({
        requestId: 'r4',
        enabled: false,
      });
      expect(fsProvider.fireChangedExternal).toHaveBeenCalledTimes(1);
    });

    it('warns when no node is provided', async () => {
      await changeStepRequestCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('No plan step'),
      );
    });

    it('does nothing when the request picker is dismissed', async () => {
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await changeStepRequestCommand({ bridge }, { planId: 'p1', stepIndex: 0 });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps[0].requestId).toBe('r1');
    });
  });

  // The plan CodeLens derives stepIndex from the editor buffer's row position,
  // which can drift from the saved plan when the YAML has unsaved structural
  // edits. The lens passes the row's requestId so the command refuses to act on
  // a mismatched index instead of silently mutating the wrong step.
  describe('step identity guard (editor-buffer drift)', () => {
    it('refuses to toggle when expectedRequestId no longer matches the saved step', async () => {
      await toggleStepEnabledCommand(
        { bridge },
        { kind: 'step', planId: 'p1', stepIndex: 0, expectedRequestId: 'STALE' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('unsaved edits'),
      );
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps[0].enabled).toBe(true); // unchanged
    });

    it('toggles when expectedRequestId matches the saved step', async () => {
      await toggleStepEnabledCommand(
        { bridge },
        { kind: 'step', planId: 'p1', stepIndex: 0, expectedRequestId: 'r1' },
      );
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps[0].enabled).toBe(false);
    });

    it('refuses to remove a drifted step (skips the confirm + the mutation)', async () => {
      await removeStepFromPlanCommand(
        { bridge },
        { kind: 'step', planId: 'p1', stepIndex: 1, expectedRequestId: 'STALE' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('unsaved edits'),
      );
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps).toHaveLength(3);
    });

    it('refuses to change a drifted step (never opens the request picker)', async () => {
      await changeStepRequestCommand(
        { bridge },
        { planId: 'p1', stepIndex: 2, expectedRequestId: 'STALE' },
      );
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('unsaved edits'),
      );
      expect(window.showQuickPick).not.toHaveBeenCalled();
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps[2].requestId).toBe('r3'); // unchanged
    });
  });

  // A structured mutation while the plan YAML has unsaved edits would race the
  // buffer (the workspace write vanishes on the user's next save), so the
  // commands refuse up front when an open plan editor for the id is dirty.
  describe('dirty plan editor guard', () => {
    function openDirtyPlanDoc(planId: string): void {
      (workspace as { textDocuments: unknown }).textDocuments = [
        { uri: Uri.parse(`apicircle://ws/plans/Smoke.yaml?id=${planId}`), isDirty: true },
      ];
    }

    it('refuses to toggle a step while the plan editor is dirty', async () => {
      openDirtyPlanDoc('p1');
      await toggleStepEnabledCommand({ bridge }, { kind: 'step', planId: 'p1', stepIndex: 0 });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('unsaved changes'),
      );
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps[0].enabled).toBe(true); // unchanged
    });

    it('refuses to add a step while the plan editor is dirty (no request picker)', async () => {
      openDirtyPlanDoc('p1');
      await addStepToPlanCommand({ bridge }, { kind: 'plan', id: 'p1' });
      expect(window.showWarningMessage).toHaveBeenCalledWith(
        expect.stringContaining('unsaved changes'),
      );
      expect(window.showQuickPick).not.toHaveBeenCalled();
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps).toHaveLength(3); // unchanged
    });

    it('a dirty editor for a DIFFERENT plan does not block this plan', async () => {
      openDirtyPlanDoc('other-plan');
      await toggleStepEnabledCommand({ bridge }, { kind: 'step', planId: 'p1', stepIndex: 0 });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.synced.executionPlans?.p1.steps[0].enabled).toBe(false); // toggled
    });
  });
});
