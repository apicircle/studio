import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import { workspaceDirFor } from '@apicircle/core/workspace/registry';
import { WorkspaceFileManager } from './workspaceFileManager';
import { WorkspaceWatcher } from './workspaceWatcher';

const T0 = '2026-05-22T00:00:00.000Z';

function makeSynced(workspaceId = 'ws-1'): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId,
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.0.0' },
  };
}

function makeLocal(workspaceId = 'ws-1'): WorkspaceLocal {
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

// Wait until either the predicate returns true or the timeout elapses.
// Used instead of fixed sleeps so the test doesn't tightly couple to
// fs.watch's platform-specific event timing.
async function waitFor(
  predicate: () => boolean,
  { timeout = 2000, interval = 25 }: { timeout?: number; interval?: number } = {},
): Promise<void> {
  const start = Date.now();
  while (Date.now() - start < timeout) {
    if (predicate()) return;
    await new Promise((r) => setTimeout(r, interval));
  }
  throw new Error(`waitFor timed out after ${timeout}ms`);
}

let tmpDir: string;
let workspacesRoot: string;
let manager: WorkspaceFileManager;
let watcher: WorkspaceWatcher;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-watcher-'));
  workspacesRoot = path.join(tmpDir, 'dot-apicircle');
  manager = new WorkspaceFileManager({ workspacesRoot });
  await manager.init();
  // Seed one workspace dir so the watcher has something to watch.
  await saveToFile(workspaceDirFor(workspacesRoot, 'ws-1'), {
    synced: makeSynced('ws-1'),
    local: makeLocal('ws-1'),
  });
  watcher = new WorkspaceWatcher(manager);
  manager.attachWatcher(watcher);
  watcher.start();
});

afterEach(async () => {
  watcher.stop();
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('WorkspaceWatcher', () => {
  it('emits an externalChange event when an outside writer modifies workspace.json', async () => {
    const events: string[] = [];
    watcher.on('externalChange', (e: { workspaceId: string }) => {
      events.push(e.workspaceId);
    });

    // Simulate an external write (MCP server, CLI, hand-edit) by writing
    // the file without going through the manager — i.e. without calling
    // markSelfWrite first.
    const next = makeSynced('ws-1');
    next.meta = { ...next.meta, updatedAt: '2026-05-23T00:00:00.000Z' };
    await saveToFile(workspaceDirFor(workspacesRoot, 'ws-1'), {
      synced: next,
      local: makeLocal('ws-1'),
    });

    await waitFor(() => events.includes('ws-1'));
    expect(events).toContain('ws-1');
  });

  it('suppresses events for self-writes through the manager', async () => {
    const events: string[] = [];
    watcher.on('externalChange', (e: { workspaceId: string }) => {
      events.push(e.workspaceId);
    });

    // Write THROUGH the manager — this calls markSelfWrite before the
    // actual file write, so the watcher should ignore the resulting
    // fs event.
    const next = makeSynced('ws-1');
    next.meta = { ...next.meta, updatedAt: '2026-05-23T00:00:00.000Z' };
    await manager.writeWorkspace('ws-1', { synced: next, local: makeLocal('ws-1') });

    // Wait beyond the debounce + suppression window so any pending
    // emission would have fired by now.
    await new Promise((r) => setTimeout(r, 500));
    expect(events).not.toContain('ws-1');
  });

  it('picks up newly created workspace directories', async () => {
    const events: string[] = [];
    watcher.on('externalChange', (e: { workspaceId: string }) => {
      events.push(e.workspaceId);
    });

    // Create a brand-new workspace dir outside the manager — the
    // root-watch's rename event should re-scan and attach a per-id
    // watcher in time to see the file write below.
    await saveToFile(workspaceDirFor(workspacesRoot, 'ws-2'), {
      synced: makeSynced('ws-2'),
      local: makeLocal('ws-2'),
    });

    // Then mutate the file again so the new per-id watcher has a clear
    // signal to emit on.
    await new Promise((r) => setTimeout(r, 100));
    const next = makeSynced('ws-2');
    next.meta = { ...next.meta, updatedAt: '2026-05-23T00:00:00.000Z' };
    await saveToFile(workspaceDirFor(workspacesRoot, 'ws-2'), {
      synced: next,
      local: makeLocal('ws-2'),
    });

    await waitFor(() => events.includes('ws-2'));
  });

  it('emits an externalChange when an outside writer modifies the file AFTER our self-write (stat differs)', async () => {
    // Regression test for the stat-based suppression: our write
    // records a {mtimeMs, size} snapshot; a subsequent external
    // write changes those values, so the next event is NOT
    // suppressed. Before the switch from time-window to
    // stat-based, this case would have been masked if it fell
    // within 1.5s of our write.
    const events: string[] = [];
    watcher.on('externalChange', (e: { workspaceId: string }) => {
      events.push(e.workspaceId);
    });

    // 1. Self-write via the manager — recorded snapshot.
    const ours = makeSynced('ws-1');
    ours.meta = { ...ours.meta, updatedAt: '2026-05-23T00:00:00.000Z' };
    await manager.writeWorkspace('ws-1', { synced: ours, local: makeLocal('ws-1') });

    // Settle the debounce so our self-write event has had a chance to
    // be suppressed before the external write below.
    await new Promise((r) => setTimeout(r, 300));
    expect(events).not.toContain('ws-1');

    // 2. External write — different content → different mtime/size →
    // stat mismatch → emitted as external.
    const theirs = makeSynced('ws-1');
    theirs.meta = { ...theirs.meta, updatedAt: '2026-05-24T00:00:00.000Z' };
    // Add a few requests so the size definitely changes — on filesystems
    // with second-resolution mtime, content-size delta is the
    // discriminator.
    theirs.collections.requests = {
      'r-1': { id: 'r-1', name: 'external' } as never,
      'r-2': { id: 'r-2', name: 'external-2' } as never,
    };
    await saveToFile(workspaceDirFor(workspacesRoot, 'ws-1'), {
      synced: theirs,
      local: makeLocal('ws-1'),
    });

    await waitFor(() => events.includes('ws-1'));
    expect(events).toContain('ws-1');
  });

  it('emits a registry event when registry.json changes externally', async () => {
    const events: string[] = [];
    watcher.on('externalChange', (e: { workspaceId: string }) => {
      events.push(e.workspaceId);
    });

    await fs.writeFile(
      path.join(workspacesRoot, 'registry.json'),
      JSON.stringify(
        {
          schemaVersion: 1,
          activeWorkspaceId: 'ws-1',
          workspaces: [{ id: 'ws-1', name: 'X', createdAt: T0, lastOpenedAt: T0 }],
        },
        null,
        2,
      ),
      'utf8',
    );

    await waitFor(() => events.includes('registry'));
  });
});
