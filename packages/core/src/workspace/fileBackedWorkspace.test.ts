import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { promises as fs } from 'node:fs';
import * as os from 'node:os';
import * as path from 'node:path';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { applyMutation } from './applyMutation';
import { loadFromFile, saveToFile, withWorkspace } from './fileBackedWorkspace';

const T0 = '2026-04-27T00:00:00.000Z';

function makeSynced(): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId: 'ws-1',
    workspaceName: 'W',
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
    sessions: { github: null },
    connectedRepo: null,
    workingBranch: null,
    sync: { lastPulledSnapshot: null, lastPulledSha: null, lastPulledAt: null, dirtyKeys: [] },
    linkedCollections: {},
    globalContext: {},
    mockRuntime: { active: {} },
    ui: { activeRequestId: null, sidebarExpandedSections: [], themeId: 'studio-dark' },
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
    const raw = await fs.readFile(path.join(tmpDir, 'workspace.synced.json'), 'utf-8');
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
      path.join(tmpDir, 'workspace.synced.json'),
      JSON.stringify(makeSynced(), null, 2),
      'utf-8',
    );
    const loaded = await loadFromFile(tmpDir);
    expect(loaded).not.toBeNull();
    expect(loaded!.local.workspaceId).toBe('ws-1');
    expect(loaded!.local.executionPlans).toEqual({});
  });

  it('withWorkspace runs a load → mutate → save under one lock', async () => {
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
      path.join(tmpDir, 'workspace.synced.json'),
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
});
