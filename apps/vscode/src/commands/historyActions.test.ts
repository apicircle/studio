import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import type { RequestRun, PlanRun } from '@apicircle/shared';
import { Uri, window } from '../../test/mocks/vscode';
import { deviceLocalPath } from '../util/workspaceDiscovery';
import { VsCodeBridge } from '../host/vscodeBridge';
import {
  clearAllHistoryCommand,
  purgeOlderThanCommand,
  deleteHistoryRunCommand,
} from './historyActions';

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

function seedRuns(
  apicircleDir: string,
  globalStorageRoot: string,
  requestRuns: RequestRun[] = [],
  planRuns: PlanRun[] = [],
): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'hist',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: { items: {}, activeName: null, priorityOrder: [] },
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
  const localDir = deviceLocalPath(Uri.file(globalStorageRoot), { apicircleDir });
  fs.mkdirSync(localDir, { recursive: true });
  fs.writeFileSync(
    path.join(localDir, 'workspace.local.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'hist',
      executionPlans: {},
      history: { requestRuns, planRuns },
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

function makeRun(over: Partial<RequestRun> = {}): RequestRun {
  return {
    id: 'r-1',
    requestId: 'req-a',
    startedAt: '2026-01-01T00:00:00Z',
    durationMs: 100,
    status: 200,
    statusText: 'OK',
    ok: true,
    url: 'https://x.com',
    method: 'GET',
    requestHeaders: {},
    requestBodyPreview: null,
    responseHeaders: {},
    responseBodyPreview: '',
    responseBodyKind: 'text',
    responseTruncated: false,
    assertions: [],
    ...over,
  };
}

describe('historyActions', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'hist-'));
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

  function activate(requestRuns: RequestRun[] = [], planRuns: PlanRun[] = []): void {
    seedRuns(apicircleDir, path.join(tmp, 'globalStorage'), requestRuns, planRuns);
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(apicircleDir);
  }

  describe('clearAllHistoryCommand', () => {
    it('warns when no workspace is active', async () => {
      await clearAllHistoryCommand({ bridge });
      expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
    });

    it('shows info when history is already empty', async () => {
      activate();
      await clearAllHistoryCommand({ bridge });
      expect(window.showInformationMessage).toHaveBeenCalledWith(
        expect.stringContaining('No history'),
      );
    });

    it('clears all runs on confirmation', async () => {
      activate([makeRun(), makeRun({ id: 'r-2' })]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Clear');
      await clearAllHistoryCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.history.requestRuns).toEqual([]);
    });

    it('preserves history when user declines', async () => {
      activate([makeRun()]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await clearAllHistoryCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.history.requestRuns).toHaveLength(1);
    });
  });

  describe('purgeOlderThanCommand', () => {
    it('cancels gracefully when user dismisses the window picker', async () => {
      activate([makeRun()]);
      (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
      await purgeOlderThanCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.history.requestRuns).toHaveLength(1);
    });

    it('purges runs older than the chosen window via history.purge patch', async () => {
      const now = Date.now();
      const old = makeRun({ id: 'old', startedAt: new Date(now - 10 * 86_400_000).toISOString() });
      const recent = makeRun({ id: 'recent', startedAt: new Date(now - 1000).toISOString() });
      activate([old, recent]);
      // 1 week
      (window.showQuickPick as Mock).mockResolvedValueOnce({ label: '1 week', ms: 7 * 86_400_000 });
      await purgeOlderThanCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      const ids = state.local.history.requestRuns.map((r) => r.id);
      expect(ids).toContain('recent');
      expect(ids).not.toContain('old');
    });
  });

  describe('deleteHistoryRunCommand', () => {
    it('no-ops when node is not provided', async () => {
      activate([makeRun()]);
      await deleteHistoryRunCommand({ bridge });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.history.requestRuns).toHaveLength(1);
    });

    it('deletes a request run on confirmation', async () => {
      activate([makeRun({ id: 'kill-me' })]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteHistoryRunCommand({ bridge }, { kind: 'request-run', runId: 'kill-me' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.history.requestRuns).toEqual([]);
    });

    it('deletes a plan run via different patch kind', async () => {
      const pr: PlanRun = {
        id: 'pr-x',
        planId: 'pl',
        startedAt: '2026-01-01',
        durationMs: 100,
        withAssertions: true,
        steps: [],
      };
      activate([], [pr]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce('Delete');
      await deleteHistoryRunCommand({ bridge }, { kind: 'plan-run', runId: 'pr-x' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.history.planRuns).toEqual([]);
    });

    it('preserves history when user declines confirmation', async () => {
      activate([makeRun({ id: 'r-a' })]);
      (window.showWarningMessage as Mock).mockResolvedValueOnce(undefined);
      await deleteHistoryRunCommand({ bridge }, { kind: 'request-run', runId: 'r-a' });
      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.history.requestRuns).toHaveLength(1);
    });
  });
});
