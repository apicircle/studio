import { describe, expect, it } from 'vitest';
import {
  createEmptyWorkspace,
  loadWorkspace,
  saveBoth,
  saveLocal,
  saveSynced,
} from './workspaceStorage';

describe('workspaceStorage', () => {
  describe('createEmptyWorkspace', () => {
    it('produces a synced + local pair sharing the same workspaceId', () => {
      const { synced, local } = createEmptyWorkspace();
      expect(synced.workspaceId).toBe(local.workspaceId);
      expect(synced.workspaceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('initializes the synced doc with empty collections, environments, links and releases', () => {
      const { synced } = createEmptyWorkspace();
      expect(synced.schemaVersion).toBe(1);
      expect(synced.collections.requests).toEqual({});
      expect(synced.collections.folders).toEqual({});
      expect(synced.collections.tree.type).toBe('root');
      expect(synced.collections.tree.children).toEqual([]);
      expect(synced.environments.items).toEqual({});
      expect(synced.environments.activeName).toBeNull();
      expect(synced.environments.priorityOrder).toEqual([]);
      expect(synced.linkedWorkspaces).toEqual({});
      expect(synced.releases).toEqual({ self: null, perLink: {} });
    });

    it('initializes the local doc with empty maps, no session, and clean sync snapshot', () => {
      const { local } = createEmptyWorkspace();
      expect(local.schemaVersion).toBe(1);
      expect(local.overrides.items).toEqual({});
      expect(local.executionPlans).toEqual({});
      expect(local.history).toEqual({ requestRuns: [], planRuns: [] });
      expect(local.secretIndex.entries).toEqual({});
      expect(local.sessions.github).toBeNull();
      expect(local.workingBranch).toBeNull();
      expect(local.sync).toEqual({
        lastPulledSnapshot: null,
        lastPulledSha: null,
        lastPulledAt: null,
        dirtyKeys: [],
      });
      expect(local.ui.themeId).toBe('studio-dark');
      expect(local.ui.activeRequestId).toBeNull();
      expect(local.ui.sidebarExpandedSections).toEqual([]);
    });

    it('emits matching ISO timestamps for createdAt and updatedAt', () => {
      const { synced } = createEmptyWorkspace();
      expect(synced.meta.createdAt).toBe(synced.meta.updatedAt);
      expect(() => new Date(synced.meta.createdAt).toISOString()).not.toThrow();
    });
  });

  describe('loadWorkspace', () => {
    it('seeds a fresh workspace pair when IDB is empty', async () => {
      const { synced, local } = await loadWorkspace();
      expect(synced.workspaceId).toBe(local.workspaceId);
      expect(synced.workspaceName).toBe('My Workspace');
    });

    it('returns the same pair on the second call (no re-seeding)', async () => {
      const first = await loadWorkspace();
      const second = await loadWorkspace();
      expect(second.synced.workspaceId).toBe(first.synced.workspaceId);
      expect(second.synced.meta.createdAt).toBe(first.synced.meta.createdAt);
    });

    it('reseeds when synced and local workspaceIds disagree (split state recovery)', async () => {
      const a = createEmptyWorkspace();
      const b = createEmptyWorkspace();
      // Force a mismatched pair into IDB.
      await saveSynced(a.synced);
      await saveLocal(b.local);
      const result = await loadWorkspace();
      // Result should be a newly-seeded pair, NOT either of a/b.
      expect(result.synced.workspaceId).toBe(result.local.workspaceId);
      expect(result.synced.workspaceId).not.toBe(a.synced.workspaceId);
      expect(result.synced.workspaceId).not.toBe(b.synced.workspaceId);
    });
  });

  describe('saveSynced / saveLocal / saveBoth', () => {
    it('saveSynced persists only the synced doc', async () => {
      const { synced, local } = createEmptyWorkspace();
      await saveBoth(synced, local);
      const renamed = { ...synced, workspaceName: 'Renamed' };
      await saveSynced(renamed);
      const reloaded = await loadWorkspace();
      expect(reloaded.synced.workspaceName).toBe('Renamed');
      expect(reloaded.local.workspaceId).toBe(local.workspaceId);
    });

    it('saveLocal persists only the local doc', async () => {
      const { synced, local } = createEmptyWorkspace();
      await saveBoth(synced, local);
      const themed = { ...local, ui: { ...local.ui, themeId: 'paper-light' as const } };
      await saveLocal(themed);
      const reloaded = await loadWorkspace();
      expect(reloaded.local.ui.themeId).toBe('paper-light');
      expect(reloaded.synced.workspaceName).toBe('My Workspace');
    });
  });
});
