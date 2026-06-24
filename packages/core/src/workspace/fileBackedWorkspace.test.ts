import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { applyMutation } from './applyMutation';
import {
  liftLegacyExecutionPlans,
  loadFromFile,
  saveToFile,
  withWorkspace,
} from './fileBackedWorkspace';

const T0 = '2026-04-27T00:00:00.000Z';

function makeSynced(): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    collections: { tree: { id: 'root', type: 'root', children: [] }, requests: {}, folders: {} },
    environments: { items: {}, activeName: null, priorityOrder: [] },
    linkedWorkspaces: {},
    linkedOverrides: { requests: {}, environmentVars: {} },
    releases: { self: null, perLink: {} },
    globalAssets: { schemas: {}, graphql: {} },
    mockServers: {},
    meta: { createdAt: T0, updatedAt: T0, appVersion: '0.1.0' },
  };
}

function makeLocal(): WorkspaceLocal {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
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
      themeId: 'studio-dark',
      fontId: 'system-mono',
      fontSizePercent: 100,
    },
    settings: { validateOnSend: true, monacoConsumesWheel: false },
    snapshots: { entries: [], maxBytes: 50 * 1024 * 1024 },
  };
}

let tmpDir: string;

beforeEach(async () => {
  tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'apicircle-fbw-'));
});

afterEach(async () => {
  await fs.rm(tmpDir, { recursive: true, force: true });
});

describe('fileBackedWorkspace', () => {
  it('round-trips synced + local through disk', async () => {
    const original = { synced: makeSynced(), local: makeLocal() };
    await saveToFile(tmpDir, original);
    const loaded = await loadFromFile(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.synced).toEqual(original.synced);
    expect(loaded!.local).toEqual(original.local);
  });

  it('writes a trailing newline and 2-space indent', async () => {
    await saveToFile(tmpDir, { synced: makeSynced(), local: makeLocal() });
    const raw = await fs.readFile(path.join(tmpDir, 'workspace.json'), 'utf-8');
    expect(raw.endsWith('\n')).toBe(true);
    expect(raw).toContain('  "schemaVersion": 1');
  });

  it('loadFromFile returns null with allowMissing when synced file absent', async () => {
    const out = await loadFromFile(tmpDir, { allowMissing: true });
    expect(out).toBeNull();
  });

  it('loadFromFile throws when synced file absent and allowMissing not set', async () => {
    await expect(loadFromFile(tmpDir)).rejects.toThrow();
  });

  it('loadFromFile fills a default local when only synced exists on disk', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'workspace.json'),
      JSON.stringify(makeSynced(), null, 2),
      'utf-8',
    );
    const loaded = await loadFromFile(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.local.workspaceId).toBe('ws-1');
    expect(loaded!.local.executionPlans).toEqual({});
  });

  it('withWorkspace runs a load -> mutate -> save under one lock', async () => {
    await saveToFile(tmpDir, { synced: makeSynced(), local: makeLocal() });
    const result = await withWorkspace(tmpDir, async (state) => {
      const out = applyMutation(state, {
        kind: 'environment.upsert',
        environment: { name: 'dev', variables: [] },
      });
      return { next: out.next, result: 'ok' };
    });
    expect(result).toBe('ok');
    const loaded = await loadFromFile(tmpDir);
    expect(loaded!.synced.environments.items['dev']).toBeDefined();
  });

  it('withWorkspace creates a default local when only synced exists', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'workspace.json'),
      JSON.stringify(makeSynced(), null, 2),
      'utf-8',
    );
    await withWorkspace(tmpDir, async (state) => {
      expect(state.local.executionPlans).toEqual({});
      return { next: state };
    });
  });

  it('rewrites do not leave .tmp files behind on success', async () => {
    await saveToFile(tmpDir, { synced: makeSynced(), local: makeLocal() });
    await saveToFile(tmpDir, { synced: makeSynced(), local: makeLocal() });
    const entries = await fs.readdir(tmpDir);
    expect(entries.filter((e) => e.endsWith('.tmp'))).toEqual([]);
  });

  it('saveToFile creates the directory if missing', async () => {
    const nested = path.join(tmpDir, 'nested', 'dir');
    await saveToFile(nested, { synced: makeSynced(), local: makeLocal() });
    const stat = await fs.stat(nested);
    expect(stat.isDirectory()).toBe(true);
  });

  it('preserves pre-existing sibling sidecar files/dirs (sidecar contract)', async () => {
    // An external tool (or an edition built on the open core) stored data
    // alongside the workspace JSON under the same directory. saveToFile must
    // not clean it. This also covers the desktop disk mirror, which writes via
    // saveWorkspaceById -> saveToFile.
    await fs.mkdir(path.join(tmpDir, 'codegraph'), { recursive: true });
    await fs.writeFile(path.join(tmpDir, 'codegraph', 'index.json'), '{"endpoints":[]}', 'utf-8');
    await fs.writeFile(path.join(tmpDir, 'NOTES.md'), 'hand-written', 'utf-8');

    await saveToFile(tmpDir, { synced: makeSynced(), local: makeLocal() });

    // Workspace files were written...
    expect(await fs.readFile(path.join(tmpDir, 'workspace.json'), 'utf-8')).toContain(
      '"schemaVersion": 1',
    );
    // ...and the sidecars survived untouched.
    expect(await fs.readFile(path.join(tmpDir, 'codegraph', 'index.json'), 'utf-8')).toBe(
      '{"endpoints":[]}',
    );
    expect(await fs.readFile(path.join(tmpDir, 'NOTES.md'), 'utf-8')).toBe('hand-written');
  });
});

describe('liftLegacyExecutionPlans (headless plan migration)', () => {
  const plan = {
    id: 'p1',
    name: 'Legacy plan',
    steps: [],
    envPriorityOrder: [],
    createdAt: T0,
    updatedAt: T0,
  };

  it('lifts legacy local.executionPlans into synced and clears local', () => {
    const local = makeLocal();
    local.executionPlans = { p1: plan };
    const out = liftLegacyExecutionPlans({ synced: makeSynced(), local });
    expect(out.synced.executionPlans?.p1).toEqual(plan);
    expect(out.local.executionPlans).toEqual({});
  });

  it('is a no-op when synced already has plans (synced wins)', () => {
    const synced = { ...makeSynced(), executionPlans: { p1: plan } };
    const local = makeLocal();
    local.executionPlans = { p2: { ...plan, id: 'p2', name: 'Stale local' } };
    const state = { synced, local };
    const out = liftLegacyExecutionPlans(state);
    // Synced wins: returned unchanged, the stale local copy is NOT merged in.
    expect(out).toBe(state);
    expect(Object.keys(out.synced.executionPlans ?? {})).toEqual(['p1']);
    expect(out.synced.executionPlans?.p2).toBeUndefined();
  });

  it('is a no-op (identity) when there are no legacy local plans', () => {
    const state = { synced: makeSynced(), local: makeLocal() };
    expect(liftLegacyExecutionPlans(state)).toBe(state);
  });

  it('loadFromFile surfaces legacy local plans on synced (visibility after upgrade)', async () => {
    // Simulate a pre-1.1.4 on-disk workspace: plan only in workspace.local.json.
    await fs.writeFile(
      path.join(tmpDir, 'workspace.json'),
      JSON.stringify(makeSynced(), null, 2),
      'utf-8',
    );
    const local = makeLocal();
    local.executionPlans = { p1: plan };
    await fs.writeFile(
      path.join(tmpDir, 'workspace.local.json'),
      JSON.stringify(local, null, 2),
      'utf-8',
    );
    const loaded = await loadFromFile(tmpDir);
    expect(loaded!.synced.executionPlans?.p1).toEqual(plan);
    expect(loaded!.local.executionPlans).toEqual({});
  });

  it('withWorkspace persists the lift to disk on the next write', async () => {
    await fs.writeFile(
      path.join(tmpDir, 'workspace.json'),
      JSON.stringify(makeSynced(), null, 2),
      'utf-8',
    );
    const local = makeLocal();
    local.executionPlans = { p1: plan };
    await fs.writeFile(
      path.join(tmpDir, 'workspace.local.json'),
      JSON.stringify(local, null, 2),
      'utf-8',
    );
    // Any mutation triggers a write; the lift rides along.
    await withWorkspace(tmpDir, async (state) => {
      expect(state.synced.executionPlans?.p1).toEqual(plan);
      return { next: state };
    });
    const onDiskSynced = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'workspace.json'), 'utf-8'),
    ) as WorkspaceSynced;
    const onDiskLocal = JSON.parse(
      await fs.readFile(path.join(tmpDir, 'workspace.local.json'), 'utf-8'),
    ) as WorkspaceLocal;
    expect(onDiskSynced.executionPlans?.p1).toEqual(plan);
    expect(onDiskLocal.executionPlans).toEqual({});
  });
});
