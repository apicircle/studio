import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { Uri } from '../../test/mocks/vscode';
import { VsCodeBridge } from '../host/vscodeBridge';
import { ExecutionView, type ExecutionNode } from './ExecutionView';

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
  steps: Array<{ requestId: string; enabled?: boolean; linkedWorkspaceId?: string }>;
}

interface SeedReq {
  id: string;
  name: string;
  method?: string;
}

function seedWorkspace(apicircleDir: string, plans: SeedPlan[], requests: SeedReq[] = []): void {
  fs.mkdirSync(apicircleDir, { recursive: true });
  fs.writeFileSync(
    path.join(apicircleDir, 'workspace.json'),
    JSON.stringify({
      schemaVersion: 1,
      workspaceId: 'test-ws',
      collections: {
        tree: { id: 'root', type: 'root', children: [] },
        requests: Object.fromEntries(
          requests.map((r) => [
            r.id,
            {
              id: r.id,
              name: r.name,
              folderId: null,
              method: r.method ?? 'GET',
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
        ),
        folders: {},
      },
      environments: { items: {}, activeName: null, priorityOrder: [] },
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
            steps: p.steps,
            envPriorityOrder: [],
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

describe('ExecutionView', () => {
  let tmp: string;
  let bridge: VsCodeBridge;
  let view: ExecutionView;
  let apicircleDir: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'execview-'));
    apicircleDir = path.join(tmp, '.apicircle');
    bridge = new VsCodeBridge(makeMockContext(path.join(tmp, 'globalStorage')));
    view = new ExecutionView(bridge);
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

  it('returns [] when no workspace is active', async () => {
    expect(await view.getChildren()).toEqual([]);
  });

  it('returns one plan node per plan, sorted by name', async () => {
    const plans = [
      { id: 'p1', name: 'Zebra', steps: [] },
      { id: 'p2', name: 'Alpha', steps: [] },
    ];
    seedWorkspace(apicircleDir, plans);
    activate();
    const result = await view.getChildren();
    expect(result).toEqual([
      { kind: 'plan', id: 'p2' },
      { kind: 'plan', id: 'p1' },
    ]);
  });

  it('returns step children for a plan element', async () => {
    const plans = [{ id: 'p1', name: 'x', steps: [{ requestId: 'r1' }, { requestId: 'r2' }] }];
    seedWorkspace(apicircleDir, plans, [
      { id: 'r1', name: 'Step 1' },
      { id: 'r2', name: 'Step 2' },
    ]);
    activate();
    const result = await view.getChildren({ kind: 'plan', id: 'p1' });
    expect(result).toEqual([
      { kind: 'step', planId: 'p1', stepIndex: 0 },
      { kind: 'step', planId: 'p1', stepIndex: 1 },
    ]);
  });

  it('renders plan name + step count', async () => {
    const plans = [
      { id: 'p1', name: 'Smoke tests', steps: [{ requestId: 'r1' }, { requestId: 'r2' }] },
    ];
    seedWorkspace(apicircleDir, plans, [
      { id: 'r1', name: 'a' },
      { id: 'r2', name: 'b' },
    ]);
    activate();
    const item = await view.getTreeItem({ kind: 'plan', id: 'p1' });
    expect(item.label).toBe('Smoke tests');
    expect(item.description).toBe('2 steps');
  });

  it('renders step with order number + request name', async () => {
    const plans = [{ id: 'p1', name: 'x', steps: [{ requestId: 'r1' }] }];
    seedWorkspace(apicircleDir, plans, [{ id: 'r1', name: 'Sign up', method: 'POST' }]);
    activate();
    const item = await view.getTreeItem({ kind: 'step', planId: 'p1', stepIndex: 0 });
    expect(item.label).toBe('1. Sign up');
    expect(item.description).toBe('POST');
  });

  it('wires a step click to open its request editor', async () => {
    const plans = [{ id: 'p1', name: 'x', steps: [{ requestId: 'r1' }] }];
    seedWorkspace(apicircleDir, plans, [{ id: 'r1', name: 'Sign up', method: 'POST' }]);
    activate();
    const item = await view.getTreeItem({ kind: 'step', planId: 'p1', stepIndex: 0 });
    expect(item.command?.command).toBe('apicircle.openPlanStepRequest');
    expect(item.command?.arguments).toEqual([{ planId: 'p1', stepIndex: 0 }]);
  });

  it('marks disabled steps with the dimmed icon variant', async () => {
    const plans = [{ id: 'p1', name: 'x', steps: [{ requestId: 'r1', enabled: false }] }];
    seedWorkspace(apicircleDir, plans, [{ id: 'r1', name: 'Skipped step' }]);
    activate();
    const item = await view.getTreeItem({ kind: 'step', planId: 'p1', stepIndex: 0 });
    expect(item.contextValue).toBe('step-disabled');
  });

  it('renders an uncached linked step without claiming the request is missing', async () => {
    const plans = [
      { id: 'p1', name: 'x', steps: [{ requestId: 'lr1', linkedWorkspaceId: 'lw1' }] },
    ];
    seedWorkspace(apicircleDir, plans); // no linked snapshot cached
    activate();
    const item = await view.getTreeItem({ kind: 'step', planId: 'p1', stepIndex: 0 });
    expect(item.description).toBe('linked · not cached');
    // The misleading "no longer exists" copy must NOT appear for a linked step.
    expect(item.tooltip as string).toContain("isn't cached");
    expect(item.tooltip as string).not.toContain('no longer exists');
  });

  it('handles a missing request gracefully', async () => {
    const plans = [{ id: 'p1', name: 'x', steps: [{ requestId: 'gone' }] }];
    seedWorkspace(apicircleDir, plans);
    activate();
    const item = await view.getTreeItem({ kind: 'step', planId: 'p1', stepIndex: 0 });
    expect(item.label).toBe('1. (missing request)');
    expect(item.description).toBe('missing');
  });

  it('renders "No workspace" placeholder when nothing active', async () => {
    const item = await view.getTreeItem({ kind: 'plan', id: 'x' } as ExecutionNode);
    expect(item.label).toBe('No workspace');
  });
});
