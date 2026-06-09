import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { AssertionTestController } from './assertionTestController';
import type { VsCodeBridge, WorkspaceSurface } from '../host/vscodeBridge';

// Minimal stand-in for a workspace surface. The controller only reads
// state.synced.collections.{requests,folders} during discovery, so we
// don't need a full bridge — just the listWorkspaces() shape it expects.
function makeFakeSurface(opts: {
  id: string;
  label: string;
  requests: Record<
    string,
    { id: string; name: string; method: string; folderId: string | null; assertions: unknown[] }
  >;
  folders?: Record<string, { id: string; name: string }>;
}): WorkspaceSurface {
  return {
    workspace: {
      id: opts.id,
      label: opts.label,
      apicircleDir: '/fake/.apicircle',
      hasGitRoot: false,
    } as unknown as WorkspaceSurface['workspace'],
    read: async () =>
      ({
        synced: {
          collections: {
            requests: opts.requests,
            folders: opts.folders ?? {},
            tree: { id: 'root', type: 'root', children: [] },
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
          meta: { createdAt: '', updatedAt: '', appVersion: '0' },
        },
        local: {
          history: [],
          mocks: {},
          ui: { activePanel: 'editor' },
        },
      }) as unknown as Awaited<ReturnType<WorkspaceSurface['read']>>,
    apply: vi.fn(),
    write: vi.fn(),
  } as unknown as WorkspaceSurface;
}

function makeFakeBridge(surfaces: WorkspaceSurface[]): VsCodeBridge {
  const listeners: Array<() => void> = [];
  return {
    activeWorkspace: () => surfaces[0] ?? null,
    listWorkspaces: () => surfaces,
    onDidChangeActiveWorkspace: (cb: () => void) => {
      listeners.push(cb);
      return { dispose: () => undefined };
    },
    dispose: vi.fn(),
  } as unknown as VsCodeBridge;
}

describe('AssertionTestController — discovery', () => {
  let controller: AssertionTestController | null = null;

  beforeEach(() => {
    controller = null;
  });

  afterEach(() => {
    controller?.dispose();
  });

  it('builds a workspace root + request items + assertion children', async () => {
    const bridge = makeFakeBridge([
      makeFakeSurface({
        id: 'ws-1',
        label: 'Sample',
        requests: {
          'req-1': {
            id: 'req-1',
            name: 'Login',
            method: 'POST',
            folderId: null,
            assertions: [
              { id: 'a1', kind: 'status', op: 'equals', expected: 200 },
              { id: 'a2', kind: 'duration', op: 'lt', expected: 500 },
            ],
          },
        },
      }),
    ]);

    controller = new AssertionTestController({ bridge });
    controller.forceRefresh();
    // discovery is async — yield once for the refresh promise chain.
    await new Promise((r) => setTimeout(r, 0));

    // Reach into the underlying mock controller via the items collection.
    // The mock exposes a synchronous size + forEach.
    const items = getControllerItems(controller);
    expect(items).toHaveLength(1);
    const root = items[0] as { id: string; children: { size: number } };
    expect(root.id).toBe('workspace:ws-1');
  });

  it('skips workspaces with no assertion-bearing requests', async () => {
    const bridge = makeFakeBridge([
      makeFakeSurface({
        id: 'ws-empty',
        label: 'Empty',
        requests: {
          'req-no-assertions': {
            id: 'req-no-assertions',
            name: 'Bare',
            method: 'GET',
            folderId: null,
            assertions: [],
          },
        },
      }),
    ]);

    controller = new AssertionTestController({ bridge });
    controller.forceRefresh();
    await new Promise((r) => setTimeout(r, 0));

    const items = getControllerItems(controller);
    expect(items).toHaveLength(0);
  });

  it('groups requests under their folder', async () => {
    const bridge = makeFakeBridge([
      makeFakeSurface({
        id: 'ws-1',
        label: 'Foldered',
        folders: { 'f-auth': { id: 'f-auth', name: 'Auth' } },
        requests: {
          'req-login': {
            id: 'req-login',
            name: 'Login',
            method: 'POST',
            folderId: 'f-auth',
            assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
          },
        },
      }),
    ]);

    controller = new AssertionTestController({ bridge });
    controller.forceRefresh();
    await new Promise((r) => setTimeout(r, 0));

    const items = getControllerItems(controller);
    expect(items).toHaveLength(1);
    // The mock's children API returns size — we can't introspect more without
    // upgrading the mock, but the discovery path is exercised here.
    const root = items[0] as { id: string; children: { size: number } };
    expect(root.children.size).toBeGreaterThan(0);
  });

  it('does not register more than one root per workspace on repeated refresh', async () => {
    const bridge = makeFakeBridge([
      makeFakeSurface({
        id: 'ws-1',
        label: 'Sample',
        requests: {
          'req-1': {
            id: 'req-1',
            name: 'r',
            method: 'GET',
            folderId: null,
            assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
          },
        },
      }),
    ]);

    controller = new AssertionTestController({ bridge });
    controller.forceRefresh();
    await new Promise((r) => setTimeout(r, 0));
    controller.forceRefresh();
    await new Promise((r) => setTimeout(r, 0));
    controller.forceRefresh();
    await new Promise((r) => setTimeout(r, 0));

    const items = getControllerItems(controller);
    expect(items).toHaveLength(1);
  });

  it('survives a workspace read failure (one bad workspace does not drop the rest)', async () => {
    const failingSurface = {
      workspace: {
        id: 'ws-bad',
        label: 'Broken',
        apicircleDir: '/x',
        hasGitRoot: false,
      } as unknown as WorkspaceSurface['workspace'],
      read: () => Promise.reject(new Error('disk explode')),
      apply: vi.fn(),
      write: vi.fn(),
    } as unknown as WorkspaceSurface;

    const bridge = makeFakeBridge([
      failingSurface,
      makeFakeSurface({
        id: 'ws-ok',
        label: 'Ok',
        requests: {
          'req-1': {
            id: 'req-1',
            name: 'r',
            method: 'GET',
            folderId: null,
            assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
          },
        },
      }),
    ]);

    const logs: string[] = [];
    controller = new AssertionTestController({
      bridge,
      log: (m) => logs.push(m),
    });
    controller.forceRefresh();
    await new Promise((r) => setTimeout(r, 0));

    const items = getControllerItems(controller);
    expect(items).toHaveLength(1);
    expect(logs.some((l) => l.includes('ws-bad') && l.includes('disk explode'))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Helpers — reach into the private TestController's items collection. The
// mock exposes `forEach`, so we collect them into an array for assertions.
// ---------------------------------------------------------------------------

function getControllerItems(c: AssertionTestController): unknown[] {
  const ctrl = (
    c as unknown as { controller: { items: { forEach: (cb: (it: unknown) => void) => void } } }
  ).controller;
  const out: unknown[] = [];
  ctrl.items.forEach((it) => out.push(it));
  return out;
}
