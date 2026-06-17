import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../mocks/vscode';
import { asMock } from '../mocks/helpers';
import { VsCodeBridge } from '../../src/host/vscodeBridge';
import { ApicircleFsProvider } from '../../src/fs/apicircleFsProvider';
import { deviceLocalPath } from '../../src/util/workspaceDiscovery';

// =============================================================================
// Plan YAML round-trip integration test.
//
// Verifies the full FS provider → applyMutation → on-disk path:
//   1. Seed a workspace with a plan + two requests.
//   2. Read plans/<id>.plan.yaml through the FS provider (serialize).
//   3. Mutate the YAML body (add a step, toggle enabled, etc.).
//   4. Write back through the FS provider (parse + applyMutation + write).
//   5. Read again and assert the canonical plan in workspace.local.json
//      reflects every change.
//
// Also exercises the R5-G4 dangling-requestId guard.
// =============================================================================

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

function seed(apicircleDir: string, globalStorageRoot: string): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'planrt',
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: {
          'req-a': {
            id: 'req-a',
            name: 'Login',
            folderId: null,
            method: 'POST',
            url: 'https://x/login',
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
          'req-b': {
            id: 'req-b',
            name: 'Get profile',
            folderId: null,
            method: 'GET',
            url: 'https://x/me',
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
        },
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
      workspaceId: 'planrt',
      executionPlans: {
        'plan-1': {
          id: 'plan-1',
          name: 'Login flow',
          steps: [{ requestId: 'req-a', enabled: true }],
          envPriorityOrder: [],
          createdAt: '2026-01-01T00:00:00Z',
          updatedAt: '2026-01-01T00:00:00Z',
        },
      },
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

describe('plan YAML round-trip (FS provider integration)', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let fsProvider: ApicircleFsProvider;
  let apicircleDir: string;

  // Helper: look up the current plan entity and produce its canonical URI.
  // Used in place of the old planUri(workspaceId, planId) shape — that
  // signature was replaced by planUri(workspaceId, plan) so the basename
  // can carry the slugified name for the tab label.
  async function planUriFor(id: string) {
    const state = await bridge.activeWorkspace()!.read();
    const plan = state.local.executionPlans[id];
    if (!plan) throw new Error(`Plan ${id} not seeded`);
    return ApicircleFsProvider.planUri(apicircleDir, plan);
  }

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'plan-rt-'));
    apicircleDir = path.join(tmp, '.apicircle');
    seed(apicircleDir, path.join(tmp, 'globalStorage'));
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
    fsProvider = new ApicircleFsProvider(bridge);
  });

  afterEach(() => {
    bridge.dispose();
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('serializes a plan to YAML through the FS provider', async () => {
    const uri = await planUriFor('plan-1');
    const buf = await fsProvider.readFile(uri);
    const yaml = Buffer.from(buf).toString('utf8');
    expect(yaml).toContain('name: Login flow');
    expect(yaml).toContain('requestId: req-a');
  });

  it('round-trips: serialize → mutate → write → re-read produces matching shape', async () => {
    const uri = await planUriFor('plan-1');
    const original = Buffer.from(await fsProvider.readFile(uri)).toString('utf8');
    // Append step req-b to the steps array.
    const mutated = original.replace(
      'steps:\n  - requestId: req-a',
      'steps:\n  - requestId: req-a\n  - requestId: req-b',
    );
    await fsProvider.writeFile(uri, Buffer.from(mutated, 'utf8'), {
      create: false,
      overwrite: true,
    });
    const state = await bridge.activeWorkspace()!.read();
    expect(state.local.executionPlans['plan-1'].steps).toEqual([
      { requestId: 'req-a', enabled: true },
      { requestId: 'req-b', enabled: true },
    ]);
  });

  it('preserves createdAt on update', async () => {
    const uri = await planUriFor('plan-1');
    const original = Buffer.from(await fsProvider.readFile(uri)).toString('utf8');
    const mutated = original.replace('name: Login flow', 'name: Login flow (updated)');
    await fsProvider.writeFile(uri, Buffer.from(mutated, 'utf8'), {
      create: false,
      overwrite: true,
    });
    const state = await bridge.activeWorkspace()!.read();
    expect(state.local.executionPlans['plan-1'].createdAt).toBe('2026-01-01T00:00:00Z');
    expect(state.local.executionPlans['plan-1'].name).toBe('Login flow (updated)');
  });

  it('R5-G4: rejects a plan referencing an unknown requestId', async () => {
    const uri = await planUriFor('plan-1');
    const yaml = 'name: bad\nsteps:\n  - requestId: req-ghost\n';
    await expect(
      fsProvider.writeFile(uri, Buffer.from(yaml, 'utf8'), { create: false, overwrite: true }),
    ).rejects.toThrow(/req-ghost/);
  });

  it('R5-G5: delete on plans/<id>.plan.yaml fires plan.delete', async () => {
    const uri = await planUriFor('plan-1');
    await fsProvider.delete(uri, { recursive: false });
    const state = await bridge.activeWorkspace()!.read();
    expect(state.local.executionPlans['plan-1']).toBeUndefined();
  });

  it('R5-G11: typed mock helpers (asMock) round-trip cleanly', () => {
    // Smoke check that `asMock` from test/mocks/helpers is actually wired —
    // this is the first production-test use of the helper, per R5-G11.
    const fn = (): number => 1;
    expect(typeof asMock(fn)).toBe('function');
  });
});
