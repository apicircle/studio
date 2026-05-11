import { describe, expect, it } from 'vitest';
import {
  createEmptyWorkspace,
  createWorkspace,
  deleteWorkspace,
  loadWorkspace,
  loadWorkspaceById,
  probeWorkspaceRecords,
  recoverPartialWorkspace,
  saveBoth,
  saveLocal,
  saveSynced,
  setActiveWorkspace,
  updateRegistryEntryName,
} from './workspaceStorage';
import {
  LOCAL_STORE,
  SYNCED_STORE,
  clearAll,
  readRegistry,
  type WorkspaceRegistry,
  writeBoth,
  writeRecord,
  writeRegistry,
} from './db';

async function freshState(): Promise<{
  registry: WorkspaceRegistry;
  workspaceId: string;
}> {
  await clearAll();
  const { registry, synced } = await loadWorkspace();
  return { registry, workspaceId: synced.workspaceId };
}

describe('workspaceStorage — createEmptyWorkspace', () => {
  it('produces a synced + local pair sharing the same workspaceId', () => {
    const { synced, local } = createEmptyWorkspace();
    expect(synced.workspaceId).toBe(local.workspaceId);
    expect(synced.workspaceId).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
  });

  it('initializes the synced doc with sample request, empty environments, links, releases', () => {
    const { synced } = createEmptyWorkspace();
    const requestIds = Object.keys(synced.collections.requests);
    expect(requestIds).toHaveLength(1);
    expect(synced.environments.items).toEqual({});
    expect(synced.linkedWorkspaces).toEqual({});
    expect(synced.linkedOverrides).toEqual({ requests: {}, environmentVars: {} });
    expect(synced.releases).toEqual({ self: null, perLink: {} });
  });

  it('initializes the local doc with the sample request selected and clean sync snapshot', () => {
    const { synced, local } = createEmptyWorkspace();
    expect(local.sessions.github.workspace).toBeNull();
    expect(local.sessions.github.links).toEqual({});
    expect(local.workingBranch).toBeNull();
    expect(local.sync).toEqual({
      lastPulledSnapshot: null,
      lastPulledSha: null,
      lastPulledAt: null,
      dirtyKeys: [],
    });
    expect(local.ui.themeId).toBe('studio-dark');
    expect(local.ui.activeRequestId).toBe(Object.keys(synced.collections.requests)[0]);
  });
});

describe('workspaceStorage — loadWorkspace (B.6 multi-workspace boot)', () => {
  it('seeds a fresh workspace + registry when IDB is empty', async () => {
    await clearAll();
    const { synced, local, registry } = await loadWorkspace();
    expect(synced.workspaceId).toBe(local.workspaceId);
    expect(registry.activeWorkspaceId).toBe(synced.workspaceId);
    expect(registry.workspaces).toHaveLength(1);
    expect(registry.workspaces[0].id).toBe(synced.workspaceId);
    expect(registry.workspaces[0].name).toBe('My Workspace');
  });

  it('returns the same workspace on the second call (no re-seeding)', async () => {
    await clearAll();
    const first = await loadWorkspace();
    const second = await loadWorkspace();
    expect(second.synced.workspaceId).toBe(first.synced.workspaceId);
    expect(second.synced.meta.createdAt).toBe(first.synced.meta.createdAt);
    expect(second.registry.workspaces).toHaveLength(1);
  });
});

describe('workspaceStorage — multi-workspace registry actions', () => {
  it('createWorkspace registers a new workspace and makes it active', async () => {
    const initial = await freshState();
    const { synced, registry } = await createWorkspace(initial.registry, 'Second');
    expect(synced.workspaceName).toBe('Second');
    expect(synced.workspaceId).not.toBe(initial.workspaceId);
    expect(registry.activeWorkspaceId).toBe(synced.workspaceId);
    expect(registry.workspaces).toHaveLength(2);
    // Reload should pick up the new active.
    const reloaded = await loadWorkspace();
    expect(reloaded.synced.workspaceId).toBe(synced.workspaceId);
    expect(reloaded.synced.workspaceName).toBe('Second');
  });

  it('createWorkspace rejects duplicate names', async () => {
    const initial = await freshState();
    const after = await createWorkspace(initial.registry, 'Unique');
    await expect(createWorkspace(after.registry, 'Unique')).rejects.toThrow(/already exists/);
  });

  it('createWorkspace rejects empty name', async () => {
    const initial = await freshState();
    await expect(createWorkspace(initial.registry, '   ')).rejects.toThrow(/required/);
  });

  it('setActiveWorkspace bumps lastOpenedAt and persists', async () => {
    const initial = await freshState();
    const { registry: afterCreate } = await createWorkspace(initial.registry, 'Second');
    const updated = await setActiveWorkspace(afterCreate, initial.workspaceId);
    expect(updated.activeWorkspaceId).toBe(initial.workspaceId);
    const persisted = await readRegistry();
    expect(persisted?.activeWorkspaceId).toBe(initial.workspaceId);
  });

  it('setActiveWorkspace throws on unknown id', async () => {
    const initial = await freshState();
    await expect(setActiveWorkspace(initial.registry, 'not-a-real-id')).rejects.toThrow(
      /not in registry/,
    );
  });

  it('loadWorkspaceById fetches a non-active workspace without changing the active one', async () => {
    const initial = await freshState();
    const { synced: second, registry: afterCreate } = await createWorkspace(
      initial.registry,
      'Second',
    );
    const reloaded = await loadWorkspaceById(initial.workspaceId, afterCreate);
    expect(reloaded.synced.workspaceId).toBe(initial.workspaceId);
    // The registry's active is still the second one (createWorkspace
    // sets it active; loadWorkspaceById is a read-only fetch and
    // doesn't change it).
    expect(reloaded.registry.activeWorkspaceId).toBe(second.workspaceId);
  });

  it('deleteWorkspace removes records + falls back to next-most-recent', async () => {
    const initial = await freshState();
    const { synced: secondSynced, registry: afterCreate } = await createWorkspace(
      initial.registry,
      'Second',
    );
    const result = await deleteWorkspace(afterCreate, secondSynced.workspaceId);
    expect(result.registry.workspaces).toHaveLength(1);
    expect(result.registry.activeWorkspaceId).toBe(initial.workspaceId);
    expect(result.synced.workspaceId).toBe(initial.workspaceId);
  });

  it('deleteWorkspace seeds a fresh empty workspace when the last one is removed', async () => {
    const initial = await freshState();
    const result = await deleteWorkspace(initial.registry, initial.workspaceId);
    expect(result.registry.workspaces).toHaveLength(1);
    expect(result.registry.workspaces[0].id).not.toBe(initial.workspaceId);
    expect(result.registry.activeWorkspaceId).toBe(result.synced.workspaceId);
  });

  it('updateRegistryEntryName mirrors a workspace rename into the registry', async () => {
    const initial = await freshState();
    const updated = await updateRegistryEntryName(initial.registry, initial.workspaceId, 'Renamed');
    expect(updated.workspaces[0].name).toBe('Renamed');
    const persisted = await readRegistry();
    expect(persisted?.workspaces[0].name).toBe('Renamed');
  });
});

describe('workspaceStorage — recoverPartialWorkspace (multi-workspace)', () => {
  it('returns null when no registry exists', async () => {
    await clearAll();
    const result = await recoverPartialWorkspace();
    expect(result).toBeNull();
  });

  it('rebuilds local with the synced workspaceId when only synced is present', async () => {
    await clearAll();
    const seed = createEmptyWorkspace();
    const syncedWithName = { ...seed.synced, workspaceName: 'Existing Workspace' };
    // Seed a registry that points at this workspace.
    const now = new Date().toISOString();
    const registry: WorkspaceRegistry = {
      schemaVersion: 1,
      activeWorkspaceId: syncedWithName.workspaceId,
      workspaces: [
        {
          id: syncedWithName.workspaceId,
          name: 'Existing Workspace',
          createdAt: now,
          lastOpenedAt: now,
        },
      ],
    };
    await writeRegistry(registry);
    await writeRecord(SYNCED_STORE, syncedWithName);
    const result = await recoverPartialWorkspace();
    expect(result).not.toBeNull();
    expect(result!.synced.workspaceName).toBe('Existing Workspace');
    expect(result!.local.workspaceId).toBe(syncedWithName.workspaceId);
  });

  it('rebuilds synced with the local workspaceId when only local is present', async () => {
    await clearAll();
    const seed = createEmptyWorkspace();
    const now = new Date().toISOString();
    const registry: WorkspaceRegistry = {
      schemaVersion: 1,
      activeWorkspaceId: seed.local.workspaceId,
      workspaces: [
        { id: seed.local.workspaceId, name: 'My Workspace', createdAt: now, lastOpenedAt: now },
      ],
    };
    await writeRegistry(registry);
    await writeRecord(LOCAL_STORE, seed.local);
    const result = await recoverPartialWorkspace();
    expect(result).not.toBeNull();
    expect(result!.synced.workspaceId).toBe(seed.local.workspaceId);
    expect(result!.local).toEqual(seed.local);
  });
});

describe('workspaceStorage — probeWorkspaceRecords', () => {
  it('returns the registry when present', async () => {
    await clearAll();
    await loadWorkspace();
    const probe = await probeWorkspaceRecords();
    expect(probe.registry).not.toBeNull();
    expect(probe.registry!.workspaces).toHaveLength(1);
  });

  it('returns null registry when IDB is empty', async () => {
    await clearAll();
    const probe = await probeWorkspaceRecords();
    expect(probe.registry).toBeNull();
  });
});

describe('workspaceStorage — saveSynced / saveLocal / saveBoth (multi-workspace key)', () => {
  it('saveSynced persists only the synced doc and round-trips through loadWorkspace', async () => {
    const { workspaceId } = await freshState();
    const { synced } = await loadWorkspace();
    const renamed = { ...synced, workspaceName: 'Renamed' };
    await saveSynced(renamed);
    const reloaded = await loadWorkspace();
    expect(reloaded.synced.workspaceName).toBe('Renamed');
    expect(reloaded.synced.workspaceId).toBe(workspaceId);
  });

  it('saveLocal persists only the local doc and round-trips through loadWorkspace', async () => {
    await freshState();
    const { local } = await loadWorkspace();
    const themed = { ...local, ui: { ...local.ui, themeId: 'paper-light' as const } };
    await saveLocal(themed);
    const reloaded = await loadWorkspace();
    expect(reloaded.local.ui.themeId).toBe('paper-light');
    expect(reloaded.synced.workspaceName).toBe('My Workspace');
  });

  it('saveBoth writes the synced+local pair atomically', async () => {
    await clearAll();
    const seed = createEmptyWorkspace();
    const now = new Date().toISOString();
    const registry: WorkspaceRegistry = {
      schemaVersion: 1,
      activeWorkspaceId: seed.synced.workspaceId,
      workspaces: [
        { id: seed.synced.workspaceId, name: 'My Workspace', createdAt: now, lastOpenedAt: now },
      ],
    };
    await writeRegistry(registry);
    await writeBoth(seed.synced, seed.local);
    await saveBoth(
      { ...seed.synced, workspaceName: 'Both' },
      { ...seed.local, ui: { ...seed.local.ui, themeId: 'paper-light' as const } },
    );
    const reloaded = await loadWorkspace();
    expect(reloaded.synced.workspaceName).toBe('Both');
    expect(reloaded.local.ui.themeId).toBe('paper-light');
  });
});

describe('workspaceStorage — executionPlans local→synced migration', () => {
  it('lifts legacy local.executionPlans into synced.executionPlans on hydrate', async () => {
    // Pre-migration shape: plan lives on local, synced has none.
    await freshState();
    const seed = createEmptyWorkspace();
    const legacyLocal = {
      ...seed.local,
      executionPlans: {
        'plan-legacy': {
          id: 'plan-legacy',
          name: 'Legacy plan',
          steps: [{ requestId: 'r-1' }],
          envPriorityOrder: [],
          createdAt: 't',
          updatedAt: 't',
        },
      },
    };
    const syncedNoPlans = { ...seed.synced };
    delete (syncedNoPlans as Partial<typeof seed.synced>).executionPlans;
    await writeBoth(syncedNoPlans, legacyLocal);
    await writeRegistry({
      schemaVersion: 1,
      activeWorkspaceId: seed.synced.workspaceId,
      workspaces: [
        {
          id: seed.synced.workspaceId,
          name: 'W',
          createdAt: 't',
          lastOpenedAt: 't',
        },
      ],
    });

    const reloaded = await loadWorkspace();
    // The plan migrated up to synced.
    expect(reloaded.synced.executionPlans?.['plan-legacy']).toBeDefined();
    expect(reloaded.synced.executionPlans?.['plan-legacy'].name).toBe('Legacy plan');
    // Local field is cleared so subsequent hydrates don't re-lift.
    expect(reloaded.local.executionPlans).toEqual({});
  });

  it('preserves synced.executionPlans when both sides have plans (synced wins, no overwrite)', async () => {
    await freshState();
    const seed = createEmptyWorkspace();
    const syncedWithPlan = {
      ...seed.synced,
      executionPlans: {
        'plan-from-git': {
          id: 'plan-from-git',
          name: 'Pulled from main',
          steps: [],
          envPriorityOrder: [],
          createdAt: 't',
          updatedAt: 't',
        },
      },
    };
    const localWithStalePlan = {
      ...seed.local,
      executionPlans: {
        'plan-stale': {
          id: 'plan-stale',
          name: 'Stale device-local plan',
          steps: [],
          envPriorityOrder: [],
          createdAt: 't',
          updatedAt: 't',
        },
      },
    };
    await writeBoth(syncedWithPlan, localWithStalePlan);
    await writeRegistry({
      schemaVersion: 1,
      activeWorkspaceId: seed.synced.workspaceId,
      workspaces: [
        {
          id: seed.synced.workspaceId,
          name: 'W',
          createdAt: 't',
          lastOpenedAt: 't',
        },
      ],
    });

    const reloaded = await loadWorkspace();
    // The synced doc wins — its plan is preserved verbatim, the
    // stale local plan is discarded so it can't ghost-revive.
    expect(reloaded.synced.executionPlans).toEqual({
      'plan-from-git': syncedWithPlan.executionPlans['plan-from-git'],
    });
    expect(reloaded.synced.executionPlans?.['plan-stale']).toBeUndefined();
    expect(reloaded.local.executionPlans).toEqual({});
  });

  it('seeds synced.executionPlans = {} when neither side has plans', async () => {
    await freshState();
    const seed = createEmptyWorkspace();
    // Strip executionPlans from synced to simulate an older Git doc.
    const syncedNoPlans = { ...seed.synced };
    delete (syncedNoPlans as Partial<typeof seed.synced>).executionPlans;
    await writeBoth(syncedNoPlans, { ...seed.local, executionPlans: {} });
    await writeRegistry({
      schemaVersion: 1,
      activeWorkspaceId: seed.synced.workspaceId,
      workspaces: [
        {
          id: seed.synced.workspaceId,
          name: 'W',
          createdAt: 't',
          lastOpenedAt: 't',
        },
      ],
    });
    const reloaded = await loadWorkspace();
    // Field is now present + empty, so consumers can rely on it.
    expect(reloaded.synced.executionPlans).toEqual({});
  });

  it('normalizes legacy `string[]` envPriorityOrder entries during the lift', async () => {
    await freshState();
    const seed = createEmptyWorkspace();
    const syncedNoPlans = { ...seed.synced };
    delete (syncedNoPlans as Partial<typeof seed.synced>).executionPlans;
    // Legacy plan with a `string[]` envPriorityOrder — pre-EnvPriorityRef
    // shape. The migration should normalize it to `EnvPriorityRef[]`
    // alongside lifting it onto synced.
    const legacyLocal = {
      ...seed.local,
      executionPlans: {
        'plan-old': {
          id: 'plan-old',
          name: 'Old shape',
          steps: [],
          envPriorityOrder: ['dev', 'prod'] as unknown as never,
          createdAt: 't',
          updatedAt: 't',
        },
      },
    };
    await writeBoth(syncedNoPlans, legacyLocal);
    await writeRegistry({
      schemaVersion: 1,
      activeWorkspaceId: seed.synced.workspaceId,
      workspaces: [
        {
          id: seed.synced.workspaceId,
          name: 'W',
          createdAt: 't',
          lastOpenedAt: 't',
        },
      ],
    });
    const reloaded = await loadWorkspace();
    expect(reloaded.synced.executionPlans?.['plan-old'].envPriorityOrder).toEqual([
      { kind: 'local', name: 'dev' },
      { kind: 'local', name: 'prod' },
    ]);
  });
});
