import { describe, expect, it } from 'vitest';
import {
  createEmptyWorkspace,
  loadWorkspace,
  probeWorkspaceRecords,
  recoverPartialWorkspace,
  saveBoth,
  saveLocal,
  saveSynced,
} from './workspaceStorage';
import { LOCAL_STORE, SYNCED_STORE, clearAll, writeRecord } from './db';

describe('workspaceStorage', () => {
  describe('createEmptyWorkspace', () => {
    it('produces a synced + local pair sharing the same workspaceId', () => {
      const { synced, local } = createEmptyWorkspace();
      expect(synced.workspaceId).toBe(local.workspaceId);
      expect(synced.workspaceId).toMatch(
        /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
      );
    });

    it('initializes the synced doc with a sample request, empty environments, links and releases', () => {
      const { synced } = createEmptyWorkspace();
      expect(synced.schemaVersion).toBe(1);
      // The fresh workspace ships with one onboarding sample request so the
      // sidebar isn't empty on first run.
      const requestIds = Object.keys(synced.collections.requests);
      expect(requestIds).toHaveLength(1);
      expect(synced.collections.folders).toEqual({});
      expect(synced.collections.tree.type).toBe('root');
      expect(synced.collections.tree.children).toEqual([{ kind: 'request', id: requestIds[0] }]);
      expect(synced.environments.items).toEqual({});
      expect(synced.environments.activeName).toBeNull();
      expect(synced.environments.priorityOrder).toEqual([]);
      expect(synced.linkedWorkspaces).toEqual({});
      expect(synced.releases).toEqual({ self: null, perLink: {} });
    });

    it('initializes the local doc with sample request selected and clean sync snapshot', () => {
      const { synced, local } = createEmptyWorkspace();
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
      // The seeded sample request should be selected so the editor opens
      // ready-to-send instead of on the empty placeholder.
      expect(local.ui.activeRequestId).toBe(Object.keys(synced.collections.requests)[0]);
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

    it('throws WorkspaceMismatchError when synced and local workspaceIds disagree', async () => {
      const a = createEmptyWorkspace();
      const b = createEmptyWorkspace();
      // Force a mismatched pair into IDB.
      await saveSynced(a.synced);
      await saveLocal(b.local);
      await expect(loadWorkspace()).rejects.toMatchObject({
        kind: 'workspace-mismatch',
        syncedWorkspaceId: a.synced.workspaceId,
        localWorkspaceId: b.local.workspaceId,
      });
      // IDB records are NOT touched by the failed load — explicit reset is required.
      const stillSynced = await import('./db').then((m) =>
        m.readRecord<{ workspaceId: string }>(m.SYNCED_STORE),
      );
      expect(stillSynced?.workspaceId).toBe(a.synced.workspaceId);
    });

    it('resetWorkspace replaces both records with a fresh pair', async () => {
      const a = createEmptyWorkspace();
      await saveSynced(a.synced);
      await saveLocal(a.local);
      const { resetWorkspace } = await import('./workspaceStorage');
      const fresh = await resetWorkspace();
      expect(fresh.synced.workspaceId).toBe(fresh.local.workspaceId);
      expect(fresh.synced.workspaceId).not.toBe(a.synced.workspaceId);
    });
  });

  describe('recoverPartialWorkspace', () => {
    it('returns null when both records are missing', async () => {
      await clearAll();
      const result = await recoverPartialWorkspace();
      expect(result).toBeNull();
    });

    it('rebuilds local with the synced workspaceId when only synced is present', async () => {
      await clearAll();
      const seed = createEmptyWorkspace();
      // Mutate the synced doc so we can confirm it survives recovery
      const syncedWithName = { ...seed.synced, workspaceName: 'Existing Workspace' };
      await writeRecord(SYNCED_STORE, syncedWithName);
      const result = await recoverPartialWorkspace();
      expect(result).not.toBeNull();
      expect(result!.synced.workspaceName).toBe('Existing Workspace');
      expect(result!.local.workspaceId).toBe(syncedWithName.workspaceId);
      // Persisted: a follow-up loadWorkspace should now succeed.
      const reloaded = await loadWorkspace();
      expect(reloaded.synced.workspaceName).toBe('Existing Workspace');
    });

    it('rebuilds synced with the local workspaceId when only local is present', async () => {
      await clearAll();
      const seed = createEmptyWorkspace();
      await writeRecord(LOCAL_STORE, seed.local);
      const result = await recoverPartialWorkspace();
      expect(result).not.toBeNull();
      expect(result!.synced.workspaceId).toBe(seed.local.workspaceId);
      expect(result!.local).toEqual(seed.local);
    });

    it('keeps synced and rebuilds local when ids mismatch', async () => {
      await clearAll();
      const a = createEmptyWorkspace();
      const b = createEmptyWorkspace();
      await writeRecord(SYNCED_STORE, a.synced);
      await writeRecord(LOCAL_STORE, b.local);
      const result = await recoverPartialWorkspace();
      expect(result).not.toBeNull();
      // Synced is preferred (collections > local session state)
      expect(result!.synced.workspaceId).toBe(a.synced.workspaceId);
      expect(result!.local.workspaceId).toBe(a.synced.workspaceId);
    });

    it('returns the matched pair untouched when both are present and aligned', async () => {
      await clearAll();
      const seed = createEmptyWorkspace();
      await saveBoth(seed.synced, seed.local);
      const result = await recoverPartialWorkspace();
      expect(result).not.toBeNull();
      expect(result!.synced.workspaceId).toBe(seed.synced.workspaceId);
      expect(result!.local.workspaceId).toBe(seed.local.workspaceId);
    });
  });

  describe('probeWorkspaceRecords', () => {
    it('returns whatever is in IDB without throwing on partial state', async () => {
      await clearAll();
      const seed = createEmptyWorkspace();
      await writeRecord(SYNCED_STORE, seed.synced);
      const probe = await probeWorkspaceRecords();
      expect(probe.synced?.workspaceId).toBe(seed.synced.workspaceId);
      expect(probe.local).toBeNull();
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
