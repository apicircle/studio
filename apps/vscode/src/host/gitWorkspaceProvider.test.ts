import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { GitWorkspaceProvider } from './gitWorkspaceProvider';

function makeEmptySynced(workspaceId = 'gwp-test'): unknown {
  return {
    schemaVersion: 1,
    workspaceId,
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
  };
}

describe('GitWorkspaceProvider', () => {
  let tmp: string;
  let syncedDir: string;
  let localDir: string;
  let provider: GitWorkspaceProvider;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gwp-'));
    syncedDir = path.join(tmp, 'repo', '.apicircle');
    localDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(syncedDir, { recursive: true });
    fs.mkdirSync(localDir, { recursive: true });
    provider = new GitWorkspaceProvider({ syncedDir, localDir });
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  describe('read()', () => {
    it('throws when workspace.json does not exist', async () => {
      await expect(provider.read()).rejects.toThrow(/No workspace found/);
    });

    it('reads synced and synthesizes empty local when local file missing', async () => {
      fs.writeFileSync(path.join(syncedDir, 'workspace.json'), JSON.stringify(makeEmptySynced()));
      const state = await provider.read();
      expect(state.synced.workspaceId).toBe('gwp-test');
      expect(state.local.workspaceId).toBe('gwp-test');
      expect(state.local.history.requestRuns).toEqual([]);
    });

    it('reads both synced + local files when both exist', async () => {
      fs.writeFileSync(path.join(syncedDir, 'workspace.json'), JSON.stringify(makeEmptySynced()));
      const localSeed = {
        schemaVersion: 1,
        workspaceId: 'gwp-test',
        executionPlans: {},
        history: { requestRuns: [{ id: 'r-1' }], planRuns: [] },
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
      fs.writeFileSync(path.join(localDir, 'workspace.local.json'), JSON.stringify(localSeed));
      const state = await provider.read();
      expect(state.local.history.requestRuns).toHaveLength(1);
    });

    it('defaults missing attachmentCache to empty object', async () => {
      fs.writeFileSync(path.join(syncedDir, 'workspace.json'), JSON.stringify(makeEmptySynced()));
      const localSeed = {
        schemaVersion: 1,
        workspaceId: 'gwp-test',
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
        // attachmentCache deliberately omitted
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
      fs.writeFileSync(path.join(localDir, 'workspace.local.json'), JSON.stringify(localSeed));
      const state = await provider.read();
      expect(state.local.attachmentCache).toEqual({});
    });
  });

  describe('apply()', () => {
    beforeEach(() => {
      fs.writeFileSync(path.join(syncedDir, 'workspace.json'), JSON.stringify(makeEmptySynced()));
    });

    it('creates local directory on first apply when synced exists but local does not', async () => {
      const freshTmp = fs.mkdtempSync(path.join(os.tmpdir(), 'gwp-fresh-'));
      const freshSynced = path.join(freshTmp, 'sync');
      const freshLocal = path.join(freshTmp, 'local');
      fs.mkdirSync(freshSynced, { recursive: true });
      // Seed synced but NOT local — apply should mkdir local on first write.
      fs.writeFileSync(
        path.join(freshSynced, 'workspace.json'),
        JSON.stringify(makeEmptySynced('fresh')),
      );
      const p = new GitWorkspaceProvider({ syncedDir: freshSynced, localDir: freshLocal });
      try {
        await p.apply({ kind: 'snapshot.capture', trigger: 'manual', note: 'first' });
        expect(fs.existsSync(freshLocal)).toBe(true);
        expect(fs.existsSync(path.join(freshLocal, 'workspace.local.json'))).toBe(true);
      } finally {
        fs.rmSync(freshTmp, { recursive: true, force: true });
      }
    });

    it('persists synced changes to workspace.json', async () => {
      await provider.apply({
        kind: 'environment.upsert',
        environment: { name: 'staging', variables: [] },
      });
      const written = JSON.parse(fs.readFileSync(path.join(syncedDir, 'workspace.json'), 'utf8'));
      expect(written.environments.items.staging).toBeDefined();
    });

    it('returns changedIds from applyMutation', async () => {
      const result = await provider.apply({
        kind: 'environment.upsert',
        environment: { name: 'staging', variables: [] },
      });
      expect(result.changedIds).toContain('staging');
    });

    it('writes local file on local-touching patches (snapshot.capture)', async () => {
      await provider.apply({ kind: 'snapshot.capture', trigger: 'manual', note: 'first' });
      const localExists = fs.existsSync(path.join(localDir, 'workspace.local.json'));
      expect(localExists).toBe(true);
      const local = JSON.parse(
        fs.readFileSync(path.join(localDir, 'workspace.local.json'), 'utf8'),
      );
      expect(local.snapshots.entries).toHaveLength(1);
      expect(local.snapshots.entries[0].note).toBe('first');
    });

    it('round-trips a multi-patch sequence', async () => {
      await provider.apply({
        kind: 'environment.upsert',
        environment: { name: 'a', variables: [] },
      });
      await provider.apply({
        kind: 'environment.upsert',
        environment: { name: 'b', variables: [] },
      });
      await provider.apply({ kind: 'environment.delete', name: 'a' });
      const state = await provider.read();
      expect(Object.keys(state.synced.environments.items)).toEqual(['b']);
    });
  });

  describe('write()', () => {
    it('persists both synced + local snapshots', async () => {
      const synced = makeEmptySynced('write-test');
      const local = {
        schemaVersion: 1,
        workspaceId: 'write-test',
        executionPlans: {},
        history: {
          requestRuns: [],
          planRuns: [
            {
              id: 'pr-1',
              planId: 'p1',
              startedAt: '2026-01-01',
              durationMs: 100,
              withAssertions: true,
              steps: [],
            },
          ],
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
      };
      // First seed synced so read() works for subsequent operations
      fs.writeFileSync(path.join(syncedDir, 'workspace.json'), JSON.stringify(synced));
      await provider.write({ synced, local } as never);
      const writtenSynced = JSON.parse(
        fs.readFileSync(path.join(syncedDir, 'workspace.json'), 'utf8'),
      );
      const writtenLocal = JSON.parse(
        fs.readFileSync(path.join(localDir, 'workspace.local.json'), 'utf8'),
      );
      expect(writtenSynced.workspaceId).toBe('write-test');
      expect(writtenLocal.history.planRuns).toHaveLength(1);
    });
  });
});
