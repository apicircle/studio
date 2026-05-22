import { describe, expect, it } from 'vitest';
import { afterEach, beforeEach } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import { workspaceListTool } from './workspaceList';
import { workspaceReadTool } from './crud';
import { MultiWorkspaceProvider } from '../providers/MultiWorkspaceProvider';
import { InProcessMockController } from '../providers/InProcessMockController';
import { saveToFile } from '@apicircle/core/workspace/file-backed';
import { registerWorkspace, saveRegistry } from '@apicircle/core/workspace/registry';
import type { WorkspaceState } from '@apicircle/core';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';

const T0 = '2026-05-22T00:00:00.000Z';

function makeState(workspaceId: string, requestCount = 0): WorkspaceState {
  const requests: Record<string, never> = {};
  // Synthesise N empty request entries so the per-workspace count surfaces
  // a non-zero value in the summary envelope.
  void requestCount;
  const synced: WorkspaceSynced = {
    schemaVersion: 1,
    workspaceId,
    collections: { tree: { id: 'r', type: 'root', children: [] }, requests, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '1.0.0' },
  };
  const local: WorkspaceLocal = {
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
  return { synced, local };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-wl-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

async function seedTwoWorkspaces(): Promise<MultiWorkspaceProvider> {
  await saveToFile(path.join(tmpDir, 'ws-a'), makeState('ws-a'));
  await saveToFile(path.join(tmpDir, 'ws-b'), makeState('ws-b'));
  await registerWorkspace(tmpDir, {
    id: 'ws-a',
    name: 'Alpha',
    createdAt: T0,
    lastOpenedAt: T0,
  });
  await registerWorkspace(tmpDir, {
    id: 'ws-b',
    name: 'Beta',
    createdAt: T0,
    lastOpenedAt: '2026-06-01T00:00:00.000Z',
  });
  await saveRegistry(tmpDir, {
    schemaVersion: 1,
    activeWorkspaceId: 'ws-a',
    workspaces: [
      { id: 'ws-a', name: 'Alpha', createdAt: T0, lastOpenedAt: T0 },
      { id: 'ws-b', name: 'Beta', createdAt: T0, lastOpenedAt: '2026-06-01T00:00:00.000Z' },
    ],
  });
  const provider = new MultiWorkspaceProvider(tmpDir);
  await provider.init();
  return provider;
}

describe('workspace.list tool', () => {
  it('returns every workspace with isActive flagged', async () => {
    const workspaces = await seedTwoWorkspaces();
    const ctx = {
      workspace: workspaces.activeProvider(),
      workspaces,
      mock: new InProcessMockController(),
    };
    const out = (await workspaceListTool.handler({}, ctx)) as {
      workspaceCount: number;
      activeWorkspaceId: string;
      workspaces: Array<{ id: string; name: string; isActive: boolean }>;
      hint: string;
    };
    expect(out.workspaceCount).toBe(2);
    expect(out.activeWorkspaceId).toBe('ws-a');
    const ids = out.workspaces.map((w) => w.id).sort();
    expect(ids).toEqual(['ws-a', 'ws-b']);
    expect(out.workspaces.find((w) => w.id === 'ws-a')?.isActive).toBe(true);
    expect(out.workspaces.find((w) => w.id === 'ws-b')?.isActive).toBe(false);
    expect(out.hint).toMatch(/Multiple workspaces/i);
  });

  it('surfaces a one-workspace hint when only one is registered', async () => {
    await saveToFile(path.join(tmpDir, 'ws-only'), makeState('ws-only'));
    await registerWorkspace(tmpDir, {
      id: 'ws-only',
      name: 'Solo',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    const workspaces = new MultiWorkspaceProvider(tmpDir);
    await workspaces.init();
    const ctx = {
      workspace: workspaces.activeProvider(),
      workspaces,
      mock: new InProcessMockController(),
    };
    const out = (await workspaceListTool.handler({}, ctx)) as { hint: string };
    expect(out.hint).toMatch(/Only one workspace/i);
  });
});

describe('workspace.read multi-workspace envelope', () => {
  it('returns the multiple-workspaces envelope when no workspaceId + N>1', async () => {
    const workspaces = await seedTwoWorkspaces();
    const ctx = {
      workspace: workspaces.activeProvider(),
      workspaces,
      mock: new InProcessMockController(),
    };
    const out = (await workspaceReadTool.handler({}, ctx)) as {
      kind: string;
      workspaceCount?: number;
    };
    expect(out.kind).toBe('multiple-workspaces');
    expect(out.workspaceCount).toBe(2);
  });

  it('returns a single envelope when no workspaceId + only one workspace', async () => {
    await saveToFile(path.join(tmpDir, 'ws-only'), makeState('ws-only'));
    await registerWorkspace(tmpDir, {
      id: 'ws-only',
      name: 'Solo',
      createdAt: T0,
      lastOpenedAt: T0,
    });
    const workspaces = new MultiWorkspaceProvider(tmpDir);
    await workspaces.init();
    const ctx = {
      workspace: workspaces.activeProvider(),
      workspaces,
      mock: new InProcessMockController(),
    };
    const out = (await workspaceReadTool.handler({}, ctx)) as { kind: string; workspaceId: string };
    expect(out.kind).toBe('single');
    expect(out.workspaceId).toBe('ws-only');
  });

  it('returns the targeted workspace when workspaceId is given', async () => {
    const workspaces = await seedTwoWorkspaces();
    const ctx = {
      workspace: workspaces.activeProvider(),
      workspaces,
      mock: new InProcessMockController(),
    };
    const out = (await workspaceReadTool.handler({ workspaceId: 'ws-b' }, ctx)) as {
      kind: string;
      workspaceId: string;
    };
    expect(out.kind).toBe('single');
    expect(out.workspaceId).toBe('ws-b');
  });
});
