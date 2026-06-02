import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import { registerWorkspace, saveRegistry } from '@apicircle/core/workspace/registry';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { MultiWorkspaceProvider } from './MultiWorkspaceProvider';
import { WorkspaceNotFoundError } from './Workspaces';

const T0 = '2026-05-22T00:00:00.000Z';

function makeSynced(workspaceId: string, opts: { requests?: number } = {}): WorkspaceSynced {
  const requests: Record<string, unknown> = {};
  for (let i = 0; i < (opts.requests ?? 0); i++) {
    requests[`r-${i}`] = { id: `r-${i}` };
  }
  return {
    schemaVersion: 1,
    workspaceId,
    collections: {
      tree: { id: 'r', type: 'root', children: [] },
      requests: requests as never,
      folders: {},
    },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.0.0' },
  };
}

function makeLocal(workspaceId: string): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId,
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
    globalContext: {},
    mockRuntime: { active: {} },
    ui: {
      activeRequestId: null,
      sidebarExpandedSections: [],
      themeId: 'studio-dark',
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}

let root: string;

beforeEach(async () => {
  root = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-mwp-'));
});

afterEach(async () => {
  await fs.rm(root, { recursive: true, force: true });
});

async function seedRegistry(
  entries: Array<{ id: string; name: string; requests?: number }>,
  activeId: string | null = entries[0]?.id ?? null,
): Promise<void> {
  for (const e of entries) {
    await saveToFile(path.join(root, e.id), {
      synced: makeSynced(e.id, { requests: e.requests ?? 0 }),
      local: makeLocal(e.id),
    });
    await registerWorkspace(root, {
      id: e.id,
      name: e.name,
      createdAt: T0,
      lastOpenedAt: T0,
    });
  }
  if (activeId) {
    const { loadRegistry } = await import('@apicircle/core/workspace/registry');
    const reg = await loadRegistry(root);
    if (reg) await saveRegistry(root, { ...reg, activeWorkspaceId: activeId });
  }
}

describe('MultiWorkspaceProvider.init', () => {
  it('returns an empty registry when no registry.json exists yet', async () => {
    const mwp = new MultiWorkspaceProvider(root);
    const registry = await mwp.init();
    expect(registry.workspaces).toEqual([]);
    expect(registry.activeWorkspaceId).toBeNull();
    expect(mwp.activeId()).toBeNull();
  });

  it('hydrates the active provider when a registry is present', async () => {
    await seedRegistry([{ id: 'ws-a', name: 'Alpha' }]);
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    expect(mwp.activeId()).toBe('ws-a');
    const state = await mwp.activeProvider().read();
    expect(state.synced.workspaceId).toBe('ws-a');
  });
});

describe('MultiWorkspaceProvider.activeProvider', () => {
  it('throws a helpful error when no active workspace is set', async () => {
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    // The provider itself constructs fine — the error surfaces on the
    // first operation when the lazy resolver discovers there's no
    // active workspace in registry.json to route to.
    await expect(mwp.activeProvider().read()).rejects.toThrow(/No active workspace/);
  });

  it('picks up registry-side active-id changes between calls (no MCP restart needed)', async () => {
    // Regression test for the "MCP cached active workspace at boot"
    // bug. The desktop owns `registry.json` and the user can switch
    // active workspaces from the UI at any time. The MCP server must
    // route each subsequent operation to whichever workspace is
    // active NOW, not whichever was active when `init()` ran.
    await seedRegistry([
      { id: 'ws-a', name: 'Alpha', requests: 1 },
      { id: 'ws-b', name: 'Beta', requests: 2 },
    ]);
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    const provider = mwp.activeProvider();

    // First call routes to ws-a (active at init time).
    const first = await provider.read();
    expect(first.synced.workspaceId).toBe('ws-a');

    // Simulate the desktop switching to ws-b WITHOUT touching this
    // MCP process — write `registry.json` directly (the desktop's
    // `WorkspaceFileManager.setActiveWorkspace` does the same thing).
    const { setActiveWorkspace: setActiveWorkspaceOnDisk } =
      await import('@apicircle/core/workspace/registry');
    await setActiveWorkspaceOnDisk(root, 'ws-b');

    // The next call MUST route to ws-b — that's the regression.
    const second = await provider.read();
    expect(second.synced.workspaceId).toBe('ws-b');
    // And `activeId()` reflects what the lazy resolve saw.
    expect(mwp.activeId()).toBe('ws-b');
  });
});

describe('MultiWorkspaceProvider.list', () => {
  it('returns one entry per registered workspace with per-workspace counts', async () => {
    await seedRegistry([
      { id: 'ws-a', name: 'Alpha', requests: 3 },
      { id: 'ws-b', name: 'Beta', requests: 0 },
    ]);
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    const summaries = await mwp.list();
    expect(summaries).toHaveLength(2);
    const alpha = summaries.find((s) => s.id === 'ws-a');
    expect(alpha?.counts?.requests).toBe(3);
    expect(alpha?.isActive).toBe(true);
    const beta = summaries.find((s) => s.id === 'ws-b');
    expect(beta?.counts?.requests).toBe(0);
    expect(beta?.isActive).toBe(false);
  });

  it('returns null counts for a registered workspace whose dir was deleted out of band', async () => {
    await seedRegistry([{ id: 'ws-a', name: 'Alpha' }]);
    // Remove the per-workspace dir directly, leaving the registry entry.
    await fs.rm(path.join(root, 'ws-a'), { recursive: true, force: true });
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    const summaries = await mwp.list();
    expect(summaries).toHaveLength(1);
    expect(summaries[0].counts).toBeNull();
  });

  it('returns an empty list when nothing has been registered', async () => {
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    expect(await mwp.list()).toEqual([]);
  });
});

describe('MultiWorkspaceProvider.for', () => {
  it('returns a provider scoped to the requested workspace dir', async () => {
    await seedRegistry([
      { id: 'ws-a', name: 'Alpha' },
      { id: 'ws-b', name: 'Beta' },
    ]);
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    const scoped = mwp.for('ws-b');
    const state = await scoped.read();
    expect(state.synced.workspaceId).toBe('ws-b');
  });

  it('returns a provider that errors on read when the dir is missing (post-init invariant)', async () => {
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    const scoped = mwp.for('ws-never-existed');
    // The provider itself constructs fine — the error surfaces on the
    // first read. We assert it throws (the exact message comes from
    // `loadFromFile` in the underlying file-backed helper, which
    // surfaces ENOENT) without binding to a specific message wording.
    await expect(scoped.read()).rejects.toThrow();
  });
});

describe('MultiWorkspaceProvider.setActive', () => {
  it('switches the active provider when called with a known id', async () => {
    await seedRegistry([
      { id: 'ws-a', name: 'Alpha' },
      { id: 'ws-b', name: 'Beta' },
    ]);
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    expect(mwp.activeId()).toBe('ws-a');
    await mwp.setActive('ws-b');
    expect(mwp.activeId()).toBe('ws-b');
    const state = await mwp.activeProvider().read();
    expect(state.synced.workspaceId).toBe('ws-b');
  });

  it('throws WorkspaceNotFoundError for an unknown id', async () => {
    await seedRegistry([{ id: 'ws-a', name: 'Alpha' }]);
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    await expect(mwp.setActive('ws-nope')).rejects.toThrow(WorkspaceNotFoundError);
  });
});

describe('MultiWorkspaceProvider.writeRegistry', () => {
  it('persists a hand-built registry and updates the active provider', async () => {
    await seedRegistry([
      { id: 'ws-a', name: 'Alpha' },
      { id: 'ws-b', name: 'Beta' },
    ]);
    const mwp = new MultiWorkspaceProvider(root);
    await mwp.init();
    await mwp.writeRegistry({
      schemaVersion: 1,
      activeWorkspaceId: 'ws-b',
      workspaces: [
        { id: 'ws-a', name: 'Alpha', createdAt: T0, lastOpenedAt: T0 },
        { id: 'ws-b', name: 'Beta', createdAt: T0, lastOpenedAt: T0 },
      ],
    });
    expect(mwp.activeId()).toBe('ws-b');
  });
});
