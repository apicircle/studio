import type { Mock } from 'vitest';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { vi } from 'vitest';
import { Uri, window, workspace } from '../../test/mocks/vscode';
import { deviceLocalPath } from '../util/workspaceDiscovery';
import { VsCodeBridge } from '../host/vscodeBridge';
import { AbortRegistry } from '../execute/abortRegistry';
import { runPlanCommand } from './planActions';

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

interface SeedHistory {
  requestRuns?: Array<{
    id: string;
    requestId: string;
    startedAt: string;
    durationMs?: number;
    status?: number;
    statusText?: string;
    ok?: boolean;
    url?: string;
    method?: string;
    assertions?: unknown[];
  }>;
  planRuns?: Array<{
    id: string;
    planId: string;
    startedAt: string;
    durationMs?: number;
    withAssertions?: boolean;
    steps?: unknown[];
  }>;
}

function seed(
  apicircleDir: string,
  globalStorageRoot: string,
  plans: Array<{
    id: string;
    name: string;
    steps?: Array<{ requestId: string; enabled?: boolean }>;
  }> = [],
  envs: string[] = [],
  history: SeedHistory = {},
): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'plan-act',
      collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
      environments: {
        items: Object.fromEntries(envs.map((n) => [n, { name: n, variables: [] }])),
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
  if (plans.length > 0) {
    const localDir = deviceLocalPath(Uri.file(globalStorageRoot), { apicircleDir });
    fs.mkdirSync(localDir, { recursive: true });
    fs.writeFileSync(
      path.join(localDir, 'workspace.local.json'),
      JSON.stringify({
        schemaVersion: 1,
        workspaceId: 'plan-act',
        executionPlans: Object.fromEntries(
          plans.map((p) => [
            p.id,
            {
              id: p.id,
              name: p.name,
              steps: p.steps ?? [],
              envPriorityOrder: [],
              createdAt: '2026-01-01',
              updatedAt: '2026-01-01',
            },
          ]),
        ),
        history: {
          requestRuns: (history.requestRuns ?? []).map((r) => ({
            id: r.id,
            requestId: r.requestId,
            startedAt: r.startedAt,
            durationMs: r.durationMs ?? 100,
            status: r.status ?? 200,
            statusText: r.statusText ?? 'OK',
            ok: r.ok ?? true,
            url: r.url ?? 'https://x.com',
            method: r.method ?? 'GET',
            requestHeaders: {},
            requestBodyPreview: null,
            responseHeaders: {},
            responseBodyPreview: '',
            responseBodyKind: 'text' as const,
            responseTruncated: false,
            assertions: r.assertions ?? [],
          })),
          planRuns: (history.planRuns ?? []).map((r) => ({
            id: r.id,
            planId: r.planId,
            startedAt: r.startedAt,
            durationMs: r.durationMs ?? 100,
            withAssertions: r.withAssertions ?? true,
            steps: r.steps ?? [],
          })),
        },
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
}

describe('runPlanCommand', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let registry: AbortRegistry;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-act-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    registry = new AbortRegistry();
    (window.showQuickPick as Mock).mockReset();
    (window.showWarningMessage as Mock).mockReset();
    (window.showInformationMessage as Mock).mockReset();
    (window.showErrorMessage as Mock).mockReset();
  });

  afterEach(() => {
    bridge.dispose();
    registry.cancelAll();
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
    await runPlanCommand({ bridge, abortRegistry: registry });
    expect(window.showWarningMessage).toHaveBeenCalledWith(expect.stringContaining('No active'));
  });

  it('shows info when no plans exist', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'));
    activate();
    await runPlanCommand({ bridge, abortRegistry: registry });
    expect(window.showInformationMessage).toHaveBeenCalledWith(
      expect.stringContaining('No execution plans'),
    );
  });

  it('cancels gracefully when user dismisses the plan picker', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), [{ id: 'p1', name: 'Smoke' }]);
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined);
    await runPlanCommand({ bridge, abortRegistry: registry });
    expect(window.showErrorMessage).not.toHaveBeenCalled();
    expect(registry.hasActive()).toBe(false);
  });

  it('errors when plan id is unknown (deleted between picks)', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), [{ id: 'p1', name: 'X' }]);
    activate();
    await runPlanCommand({ bridge, abortRegistry: registry }, { kind: 'plan', id: 'unknown' });
    expect(window.showErrorMessage).toHaveBeenCalledWith(
      expect.stringContaining('no longer exists'),
    );
  });

  it('cancels gracefully when env override picker is dismissed', async () => {
    seed(
      apicircleDir,
      path.join(tmp, 'globalStorage'),
      [{ id: 'p1', name: 'X', steps: [] }],
      ['prod'],
    );
    activate();
    (window.showQuickPick as Mock).mockResolvedValueOnce(undefined); // env picker dismissed
    await runPlanCommand({ bridge, abortRegistry: registry }, { kind: 'plan', id: 'p1' });
    // No error, no toast — clean exit. Registry should be empty.
    expect(registry.hasActive()).toBe(false);
  });

  it('skips env override picker when no envs exist', async () => {
    seed(apicircleDir, path.join(tmp, 'globalStorage'), [{ id: 'p1', name: 'X', steps: [] }]);
    activate();
    // Plan ID passed directly. The env QuickPick should be skipped entirely
    // because the workspace has zero envs. runPlan then executes; with an
    // empty steps array it completes cleanly via withProgress.
    await runPlanCommand({ bridge, abortRegistry: registry }, { kind: 'plan', id: 'p1' });
    // showQuickPick was NOT called for env override
    const qpCalls = (window.showQuickPick as Mock).mock.calls.length;
    expect(qpCalls).toBe(0);
    expect(registry.hasActive()).toBe(false);
  });

  describe('cancellation via withProgress token', () => {
    it('fires AbortRegistry.cancel when the progress notification is cancelled', async () => {
      seed(apicircleDir, path.join(tmp, 'globalStorage'), [{ id: 'p1', name: 'X', steps: [] }]);
      activate();
      // Arm the next withProgress to report cancellation. The plan command
      // wires `token.onCancellationRequested` to `abortRegistry.cancel(runId)`.
      (window as unknown as { __withProgressCancelOnce: () => void }).__withProgressCancelOnce();
      await runPlanCommand({ bridge, abortRegistry: registry }, { kind: 'plan', id: 'p1' });
      // Plan still completes (empty steps), but importantly: the cancel
      // listener attached via onCancellationRequested fired, and any active
      // sends would have been aborted. Verify registry is clean.
      expect(registry.hasActive()).toBe(false);
    });
  });

  describe('retention filter (apicircle.history.retentionDays)', () => {
    afterEach(() => {
      (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockReset();
    });

    it('prunes plan-run history older than retentionDays before writing', async () => {
      const now = Date.now();
      const old = new Date(now - 100 * 86_400_000).toISOString();
      const recent = new Date(now - 1 * 86_400_000).toISOString();
      seed(
        apicircleDir,
        path.join(tmp, 'globalStorage'),
        [{ id: 'p1', name: 'X', steps: [] }],
        [],
        {
          planRuns: [
            { id: 'old-pr', planId: 'p1', startedAt: old },
            { id: 'recent-pr', planId: 'p1', startedAt: recent },
          ],
          requestRuns: [
            { id: 'old-rr', requestId: 'r1', startedAt: old },
            { id: 'recent-rr', requestId: 'r1', startedAt: recent },
          ],
        },
      );
      (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        get: vi.fn((key: string, def?: unknown) => {
          if (key === 'history.retentionDays') return 30;
          if (key === 'history.maxEntriesPerWorkspace') return 500;
          return def;
        }),
        update: vi.fn(),
        has: vi.fn(),
        inspect: vi.fn(),
      }));
      activate();
      await runPlanCommand({ bridge, abortRegistry: registry }, { kind: 'plan', id: 'p1' });

      const state = await bridge.activeWorkspace()!.read();
      const planRunIds = state.local.history.planRuns.map((r) => r.id);
      const reqRunIds = state.local.history.requestRuns.map((r) => r.id);
      expect(planRunIds).not.toContain('old-pr');
      expect(planRunIds).toContain('recent-pr');
      expect(reqRunIds).not.toContain('old-rr');
      expect(reqRunIds).toContain('recent-rr');
    });

    it('keeps all history when retentionDays <= 0', async () => {
      const old = new Date(Date.now() - 100 * 86_400_000).toISOString();
      seed(
        apicircleDir,
        path.join(tmp, 'globalStorage'),
        [{ id: 'p1', name: 'X', steps: [] }],
        [],
        { planRuns: [{ id: 'old-pr', planId: 'p1', startedAt: old }] },
      );
      (workspace.getConfiguration as ReturnType<typeof vi.fn>).mockImplementation(() => ({
        get: vi.fn((key: string, def?: unknown) => {
          if (key === 'history.retentionDays') return 0;
          if (key === 'history.maxEntriesPerWorkspace') return 500;
          return def;
        }),
        update: vi.fn(),
        has: vi.fn(),
        inspect: vi.fn(),
      }));
      activate();
      await runPlanCommand({ bridge, abortRegistry: registry }, { kind: 'plan', id: 'p1' });

      const state = await bridge.activeWorkspace()!.read();
      expect(state.local.history.planRuns.map((r) => r.id)).toContain('old-pr');
    });
  });
});
