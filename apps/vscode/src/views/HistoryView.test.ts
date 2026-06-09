import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import type { RequestRun, PlanRun } from '@apicircle/shared';
import { VsCodeBridge } from '../host/vscodeBridge';
import { ApicircleFsProvider } from '../fs/apicircleFsProvider';
import { deviceLocalPath } from '../util/workspaceDiscovery';
import { HistoryView, type HistoryNode } from './HistoryView';

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

function emptyLocal() {
  return {
    schemaVersion: 1,
    workspaceId: 'test-ws',
    executionPlans: {},
    history: { requestRuns: [] as RequestRun[], planRuns: [] as PlanRun[] },
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
  };
}

function seedWorkspace(
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
      workspaceId: 'test-ws',
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
      ...emptyLocal(),
      history: { requestRuns, planRuns },
    }),
  );
}

function makeRun(over: Partial<RequestRun> = {}): RequestRun {
  return {
    id: 'r-1',
    requestId: 'req-a',
    startedAt: new Date(Date.now() - 60_000).toISOString(),
    durationMs: 100,
    status: 200,
    statusText: 'OK',
    ok: true,
    url: 'https://api.example.com/x',
    method: 'GET',
    requestHeaders: {},
    requestBodyPreview: null,
    responseHeaders: { 'content-type': 'application/json' },
    responseBodyPreview: '{}',
    responseBodyKind: 'json',
    responseTruncated: false,
    assertions: [],
    ...over,
  };
}

function makePlanRun(over: Partial<PlanRun> = {}): PlanRun {
  return {
    id: 'pr-1',
    planId: 'plan-a',
    startedAt: new Date(Date.now() - 120_000).toISOString(),
    durationMs: 200,
    withAssertions: true,
    steps: [{ requestRunId: 'r-1', passed: true }],
    ...over,
  };
}

describe('HistoryView', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let fsProvider: ApicircleFsProvider;
  let view: HistoryView;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'historyview-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    fsProvider = new ApicircleFsProvider(bridge);
    view = new HistoryView(bridge, fsProvider);
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  function activate(requestRuns: RequestRun[] = [], planRuns: PlanRun[] = []): void {
    seedWorkspace(apicircleDir, path.join(tmp, 'globalStorage'), requestRuns, planRuns);
    bridge.registerWorkspace({
      id: apicircleDir,
      apicircleDir,
      workspaceJsonPath: path.join(apicircleDir, 'workspace.json'),
      workspaceFolder: { uri: Uri.file(tmp), name: 't', index: 0 } as never,
      label: 't',
    });
    bridge.setActive(apicircleDir);
  }

  it('returns [] when no workspace is active', async () => {
    expect(await view.getChildren()).toEqual([]);
  });

  it('returns two root buckets (requests + plans)', async () => {
    activate();
    const result = await view.getChildren();
    expect(result).toEqual([
      { kind: 'bucket', id: 'requests' },
      { kind: 'bucket', id: 'plans' },
    ]);
  });

  it('returns request-run children newest-first', async () => {
    const older = makeRun({ id: 'r-old', startedAt: '2026-01-01T00:00:00Z' });
    const newer = makeRun({ id: 'r-new', startedAt: '2026-02-01T00:00:00Z' });
    activate([older, newer]);
    const result = await view.getChildren({ kind: 'bucket', id: 'requests' });
    expect(result).toEqual([
      { kind: 'request-run', runId: 'r-new' },
      { kind: 'request-run', runId: 'r-old' },
    ]);
  });

  it('returns plan-run children newest-first', async () => {
    const older = makePlanRun({ id: 'p-old', startedAt: '2026-01-01T00:00:00Z' });
    const newer = makePlanRun({ id: 'p-new', startedAt: '2026-02-01T00:00:00Z' });
    activate([], [older, newer]);
    const result = await view.getChildren({ kind: 'bucket', id: 'plans' });
    expect(result).toEqual([
      { kind: 'plan-run', runId: 'p-new' },
      { kind: 'plan-run', runId: 'p-old' },
    ]);
  });

  it('caps each bucket at 100 entries', async () => {
    const runs = Array.from({ length: 150 }, (_, i) =>
      makeRun({ id: `r${i}`, startedAt: new Date(2026, 0, 1, 0, 0, i).toISOString() }),
    );
    activate(runs);
    const result = await view.getChildren({ kind: 'bucket', id: 'requests' });
    expect(result.length).toBe(100);
  });

  it('renders request-run with verdict glyph (passing)', async () => {
    activate([
      makeRun({
        assertions: [
          { assertionId: 'a1', kind: 'status', op: 'equals', expected: 200, passed: true },
        ],
      }),
    ]);
    const item = await view.getTreeItem({ kind: 'request-run', runId: 'r-1' });
    expect(item.description).toContain('✓');
  });

  it('renders request-run with verdict glyph (failing)', async () => {
    activate([
      makeRun({
        assertions: [
          { assertionId: 'a1', kind: 'status', op: 'equals', expected: 200, passed: false },
        ],
      }),
    ]);
    const item = await view.getTreeItem({ kind: 'request-run', runId: 'r-1' });
    expect(item.description).toContain('✗');
  });

  it('renders request-run with neutral glyph when no assertions', async () => {
    activate([makeRun({ assertions: [] })]);
    const item = await view.getTreeItem({ kind: 'request-run', runId: 'r-1' });
    expect(item.description).toContain('◦');
  });

  it('renders bucket label with count description', async () => {
    activate([makeRun(), makeRun({ id: 'r-2' })]);
    const item = await view.getTreeItem({ kind: 'bucket', id: 'requests' });
    expect(item.label).toBe('Recent Requests');
    expect(item.description).toBe('2');
  });

  it('handles a deleted run id gracefully', async () => {
    activate([]);
    const item = await view.getTreeItem({ kind: 'request-run', runId: 'gone' });
    expect(item.label).toBe('(deleted run)');
  });

  it('renders "No workspace" placeholder', async () => {
    const item = await view.getTreeItem({ kind: 'bucket', id: 'requests' } as HistoryNode);
    expect(item.label).toBe('No workspace');
  });

  describe('storeHistoryRun race fix (gap #16)', () => {
    it('apicircle: readFile lazily populates historyStore from workspace.local.json', async () => {
      const run = makeRun({ id: 'lazy-run' });
      activate([run]);
      const uri = ApicircleFsProvider.historyUri(apicircleDir, 'lazy-run');
      const bytes = await fsProvider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('APICircle Run lazy-run');
    });

    it('apicircle: readFile resolves plan-runs the same way', async () => {
      const planRun = makePlanRun({ id: 'lazy-plan' });
      activate([], [planRun]);
      const uri = ApicircleFsProvider.historyUri(apicircleDir, 'lazy-plan');
      const bytes = await fsProvider.readFile(uri as never);
      const text = Buffer.from(bytes).toString('utf8');
      expect(text).toContain('Plan Run lazy-plan');
    });

    it('throws FileNotFound for an unknown runId', async () => {
      activate([]);
      const uri = ApicircleFsProvider.historyUri(apicircleDir, 'ghost');
      await expect(fsProvider.readFile(uri as never)).rejects.toThrow(/File not found/);
    });
  });
});
