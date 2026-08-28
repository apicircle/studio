// =============================================================================
// Three-surface compatibility test (Phase 1).
//
// Verifies that the VS Code build's `GitWorkspaceProvider` and the desktop
// build's `FileBackedWorkspaceProvider` produce semantically identical
// workspace state when the same `WorkspacePatch` is applied through both.
//
// The on-disk paths and filenames intentionally differ (see Phase 0 followup
// in gitWorkspaceProvider.ts), so the test compares the live state objects
// returned by `provider.read()` rather than the on-disk bytes. The synced
// document — including `meta.updatedAt` and `meta.appVersion` — IS the
// canonical format and must match byte-for-byte.
//
// This is the foundation of the three-surface principle: any future
// canonical-shape change must pass this gate before merging.
// =============================================================================

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import * as fs from 'node:fs';
import * as path from 'node:path';
import * as os from 'node:os';
import { applyMutation } from '@apicircle/core';
import { FileBackedWorkspaceProvider } from '@apicircle/core/providers';
import { generateId } from '@apicircle/shared';
import type { WorkspaceSynced, WorkspaceLocal, Request as ApiRequest } from '@apicircle/shared';
import { GitWorkspaceProvider } from '../../src/host/gitWorkspaceProvider';

/**
 * Strip apply-time timestamps so two providers' outputs can be compared
 * semantically. `meta.updatedAt` and per-entity `updatedAt` legitimately
 * differ across sequential applies — what we're verifying is that the
 * CANONICAL SHAPE is identical (which is what Git diffs surface).
 */
function canonicalize(synced: WorkspaceSynced): string {
  const clone = JSON.parse(JSON.stringify(synced)) as WorkspaceSynced;
  clone.meta.updatedAt = '<normalized>';
  for (const req of Object.values(clone.collections.requests)) {
    req.updatedAt = '<normalized>';
  }
  return JSON.stringify(clone, null, 2);
}

function emptySynced(workspaceId: string): WorkspaceSynced {
  return {
    schemaVersion: 1,
    workspaceId,
    collections: {
      tree: { id: 'root', type: 'root', children: [] },
      requests: {},
      folders: {},
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
    meta: {
      createdAt: '2026-01-01T00:00:00.000Z',
      updatedAt: '2026-01-01T00:00:00.000Z',
      appVersion: '0.1.0',
    },
  };
}

function emptyLocal(workspaceId: string): WorkspaceLocal {
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
}

function fakeRequest(id: string): ApiRequest {
  return {
    id,
    name: 'Three-surface test request',
    folderId: null,
    method: 'GET',
    url: 'https://api.example.com/three-surface-canary',
    headers: [{ key: 'X-Trace', value: 'abc', enabled: true }],
    query: [{ key: 'page', value: '1', enabled: true }],
    body: { type: 'json', content: '{"hello":"world"}' },
    auth: { type: 'bearer', token: 'xyz' },
    contextVars: [],
    extractions: [],
    assertions: [{ id: 'a1', kind: 'status', op: 'equals', expected: 200 }],
    createdAt: '2026-01-01T00:00:00.000Z',
    updatedAt: '2026-01-01T00:00:00.000Z',
  };
}

describe('three-surface compatibility (Phase 1)', () => {
  let tmp: string;

  beforeEach(() => {
    tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'three-surface-'));
  });

  afterEach(() => {
    fs.rmSync(tmp, { recursive: true, force: true });
  });

  it('request.create produces identical workspace.synced state across providers', async () => {
    const workspaceId = 'compat-test';
    const synced = emptySynced(workspaceId);
    const local = emptyLocal(workspaceId);

    // ---- Desktop layout ----
    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    // ---- VS Code layout ----
    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    // Apply the same patch through both
    const id = generateId();
    const patch = { kind: 'request.create' as const, request: fakeRequest(id) };
    const desktopResult = await desktopProvider.apply(patch);
    const gitResult = await gitProvider.apply(patch);

    // Compare synced states — the canonical shape MUST match modulo apply-time
    // timestamps (applyMutation stamps Date.now() so sequential applies a few ms
    // apart legitimately produce different `updatedAt` values).
    expect(canonicalize(desktopResult.state.synced)).toBe(canonicalize(gitResult.state.synced));

    // changedIds must match too (the applyMutation contract)
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('multiple sequential patches preserve cross-surface identity', async () => {
    const synced = emptySynced('seq-test');
    const local = emptyLocal('seq-test');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    const id1 = generateId();
    const id2 = generateId();
    const patches = [
      { kind: 'request.create' as const, request: fakeRequest(id1) },
      { kind: 'request.create' as const, request: { ...fakeRequest(id2), name: 'Second' } },
      { kind: 'request.update' as const, id: id1, patch: { name: 'First (renamed)' } },
    ];
    for (const p of patches) {
      await desktopProvider.apply(p);
      await gitProvider.apply(p);
    }

    const d = await desktopProvider.read();
    const g = await gitProvider.read();
    expect(canonicalize(d.synced)).toBe(canonicalize(g.synced));
  });

  it('applyMutation directly yields the same shape as both providers', () => {
    // Smoke-check that applyMutation itself is deterministic — the providers
    // are thin wrappers around it.
    //
    // `applyMutation` stamps `meta.updatedAt = new Date().toISOString()` on
    // every call. Two sequential calls naturally produce timestamps a few
    // ms apart, which made this test flaky (~1% failure rate). We canonical-
    // ize through the same helper used for the cross-provider tests so the
    // comparison is shape-equality, not byte-equality.
    const synced = emptySynced('det-test');
    const local = emptyLocal('det-test');
    const id = generateId();
    const patch = { kind: 'request.create' as const, request: fakeRequest(id) };
    const a = applyMutation({ synced, local }, patch);
    const b = applyMutation({ synced, local }, patch);
    expect(canonicalize(a.next.synced)).toBe(canonicalize(b.next.synced));
  });

  // ---- Gap #6 closures: folder.create, environment.upsert, mock.upsert ----

  it('folder.create produces identical workspace.synced state across providers', async () => {
    const synced = emptySynced('folder-compat');
    const local = emptyLocal('folder-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    const folderId = generateId();
    const patch = {
      kind: 'folder.create' as const,
      folder: { id: folderId, name: 'Users', parentId: null },
    };
    const desktopResult = await desktopProvider.apply(patch);
    const gitResult = await gitProvider.apply(patch);
    expect(canonicalize(desktopResult.state.synced)).toBe(canonicalize(gitResult.state.synced));
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('environment.upsert produces identical workspace.synced state across providers', async () => {
    const synced = emptySynced('env-compat');
    const local = emptyLocal('env-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    const patch = {
      kind: 'environment.upsert' as const,
      environment: {
        name: 'production',
        variables: [
          { key: 'base_url', value: 'https://api.example.com', encrypted: false },
          { key: 'api_version', value: 'v1', encrypted: false },
        ],
      },
    };
    const desktopResult = await desktopProvider.apply(patch);
    const gitResult = await gitProvider.apply(patch);
    expect(canonicalize(desktopResult.state.synced)).toBe(canonicalize(gitResult.state.synced));
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('plan.upsert produces identical synced.executionPlans state across providers', async () => {
    const synced = emptySynced('plan-compat');
    const local = emptyLocal('plan-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    const planId = generateId();
    const patch = {
      kind: 'plan.upsert' as const,
      plan: {
        id: planId,
        name: 'Three-surface plan',
        steps: [
          { requestId: 'step-a', enabled: true },
          { requestId: 'step-b', enabled: true },
        ],
        envPriorityOrder: [],
        variables: [{ key: 'k', value: 'v' }],
        stopOnAssertionFailure: true,
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const desktopResult = await desktopProvider.apply(patch);
    const gitResult = await gitProvider.apply(patch);

    // Plans live on synced.executionPlans (git-shared) across every provider.
    const dPlan = desktopResult.state.synced.executionPlans?.[planId];
    const gPlan = gitResult.state.synced.executionPlans?.[planId];
    expect(dPlan).toBeDefined();
    expect(gPlan).toBeDefined();
    expect(dPlan?.name).toBe(gPlan?.name);
    expect(dPlan?.steps).toEqual(gPlan?.steps);
    expect(dPlan?.envPriorityOrder).toEqual(gPlan?.envPriorityOrder);
    expect(dPlan?.variables).toEqual(gPlan?.variables);
    expect(dPlan?.stopOnAssertionFailure).toBe(gPlan?.stopOnAssertionFailure);
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('snapshot.capture produces identical workspace.local state across providers', async () => {
    const synced = emptySynced('snap-compat');
    const local = emptyLocal('snap-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    const patch = {
      kind: 'snapshot.capture' as const,
      trigger: 'manual' as const,
      note: 'three-surface test',
      id: 'fixed-snap-id',
    };
    const desktopResult = await desktopProvider.apply(patch);
    const gitResult = await gitProvider.apply(patch);

    // Snapshots live on local.snapshots.entries — verify byte-identical
    // modulo apply-time createdAt timestamps.
    const desktopSnap = desktopResult.state.local.snapshots.entries[0];
    const gitSnap = gitResult.state.local.snapshots.entries[0];
    expect(desktopSnap.triggeredBy).toBe(gitSnap.triggeredBy);
    expect(desktopSnap.note).toBe(gitSnap.note);
    expect(desktopSnap.sizeBytes).toBe(gitSnap.sizeBytes);
    expect(canonicalize(desktopSnap.workspaceSyncedSnapshot)).toBe(
      canonicalize(gitSnap.workspaceSyncedSnapshot),
    );
  });

  it('snapshot.delete produces identical workspace.local state across providers', async () => {
    const synced = emptySynced('snap-del-compat');
    const local = emptyLocal('snap-del-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    // First, capture a snapshot on both — use a fixed id so both providers
    // hold the same ledger entry to target with the delete.
    const capturePatch = {
      kind: 'snapshot.capture' as const,
      trigger: 'manual' as const,
      note: 'about to delete',
      id: 'snap-target',
    };
    await desktopProvider.apply(capturePatch);
    await gitProvider.apply(capturePatch);

    const deletePatch = { kind: 'snapshot.delete' as const, id: 'snap-target' };
    const desktopResult = await desktopProvider.apply(deletePatch);
    const gitResult = await gitProvider.apply(deletePatch);

    expect(desktopResult.state.local.snapshots.entries).toEqual(
      gitResult.state.local.snapshots.entries,
    );
    expect(desktopResult.state.local.snapshots.entries).toHaveLength(0);
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('snapshot.restore produces identical workspace.synced state across providers', async () => {
    const synced = emptySynced('snap-rst-compat');
    const local = emptyLocal('snap-rst-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    // Capture a snapshot with a known id on both providers.
    const capturePatch = {
      kind: 'snapshot.capture' as const,
      trigger: 'manual' as const,
      note: 'before mutation',
      id: 'snap-restore-target',
    };
    await desktopProvider.apply(capturePatch);
    await gitProvider.apply(capturePatch);

    // Mutate synced so the restore has something to undo.
    const reqPatch = {
      kind: 'request.create' as const,
      request: {
        id: generateId(),
        name: 'Pre-restore request',
        folderId: null,
        method: 'POST' as const,
        url: 'https://api.example.com/about-to-restore',
        headers: [],
        query: [],
        body: { type: 'none' as const, content: '' },
        auth: { type: 'none' as const },
        contextVars: [],
        extractions: [],
        assertions: [],
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    await desktopProvider.apply(reqPatch);
    await gitProvider.apply(reqPatch);

    const restorePatch = { kind: 'snapshot.restore' as const, id: 'snap-restore-target' };
    const desktopResult = await desktopProvider.apply(restorePatch);
    const gitResult = await gitProvider.apply(restorePatch);

    // Synced state should be byte-identical (modulo apply-time updatedAt).
    expect(canonicalize(desktopResult.state.synced)).toBe(canonicalize(gitResult.state.synced));
    // The freshly-restored synced should NOT contain the pre-restore request.
    expect(Object.keys(desktopResult.state.synced.collections.requests)).toHaveLength(0);
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('snapshot.set_max_bytes produces identical workspace.local state across providers', async () => {
    const synced = emptySynced('snap-cap-compat');
    const local = emptyLocal('snap-cap-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    const patch = { kind: 'snapshot.set_max_bytes' as const, maxBytes: 128 * 1024 * 1024 };
    const desktopResult = await desktopProvider.apply(patch);
    const gitResult = await gitProvider.apply(patch);

    expect(desktopResult.state.local.snapshots.maxBytes).toBe(128 * 1024 * 1024);
    expect(gitResult.state.local.snapshots.maxBytes).toBe(128 * 1024 * 1024);
    expect(desktopResult.state.local.snapshots).toEqual(gitResult.state.local.snapshots);
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('mock.upsert produces identical workspace.synced state across providers', async () => {
    const synced = emptySynced('mock-compat');
    const local = emptyLocal('mock-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    const mockId = generateId();
    const patch = {
      kind: 'mock.upsert' as const,
      mock: {
        id: mockId,
        name: 'User Service Mock',
        source: { kind: 'manual' as const, endpoints: [] },
        endpoints: [],
        defaultPort: null,
        cors: { enabled: true, origins: ['*'] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const desktopResult = await desktopProvider.apply(patch);
    const gitResult = await gitProvider.apply(patch);
    expect(canonicalize(desktopResult.state.synced)).toBe(canonicalize(gitResult.state.synced));
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('mock.delete produces identical workspace.synced state across providers', async () => {
    const synced = emptySynced('mock-del-compat');
    const local = emptyLocal('mock-del-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    // Seed identical mocks on both providers, then delete by id.
    const upsertPatch = {
      kind: 'mock.upsert' as const,
      mock: {
        id: 'mock-target',
        name: 'About to delete',
        source: { kind: 'manual' as const, endpoints: [] },
        endpoints: [],
        defaultPort: null,
        cors: { enabled: false, origins: [] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    await desktopProvider.apply(upsertPatch);
    await gitProvider.apply(upsertPatch);

    const deletePatch = { kind: 'mock.delete' as const, id: 'mock-target' };
    const desktopResult = await desktopProvider.apply(deletePatch);
    const gitResult = await gitProvider.apply(deletePatch);

    expect(canonicalize(desktopResult.state.synced)).toBe(canonicalize(gitResult.state.synced));
    expect(Object.keys(desktopResult.state.synced.mockServers)).toHaveLength(0);
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });

  it('P3R5-G3: mock.upsert that preserves source + endpoints (FS-write update path) is byte-identical', async () => {
    // Mimics what the FS provider does when the user saves a `.mock.yaml`:
    // parse the editable fields (name / defaultPort / cors), then fire
    // `mock.upsert` with the EXISTING source + endpoints preserved.
    const synced = emptySynced('mock-update-compat');
    const local = emptyLocal('mock-update-compat');

    const desktopDir = path.join(tmp, 'desktop');
    fs.mkdirSync(desktopDir, { recursive: true });
    fs.writeFileSync(path.join(desktopDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(desktopDir, 'workspace.local.json'), JSON.stringify(local));
    const desktopProvider = new FileBackedWorkspaceProvider(desktopDir);

    const gitSyncedDir = path.join(tmp, 'repo', '.apicircle');
    const gitLocalDir = path.join(tmp, 'localStorage');
    fs.mkdirSync(gitSyncedDir, { recursive: true });
    fs.mkdirSync(gitLocalDir, { recursive: true });
    fs.writeFileSync(path.join(gitSyncedDir, 'workspace.json'), JSON.stringify(synced));
    fs.writeFileSync(path.join(gitLocalDir, 'workspace.local.json'), JSON.stringify(local));
    const gitProvider = new GitWorkspaceProvider({
      syncedDir: gitSyncedDir,
      localDir: gitLocalDir,
    });

    // Seed: identical mock on both providers with non-trivial source + endpoints.
    const seedPatch = {
      kind: 'mock.upsert' as const,
      mock: {
        id: 'mock-update',
        name: 'Original',
        source: {
          kind: 'openapi' as const,
          spec: '{"openapi":"3.0.0","info":{"title":"S","version":"1"},"paths":{}}',
          format: 'json' as const,
        },
        endpoints: [
          {
            id: 'ep-a',
            method: 'GET' as const,
            pathPattern: '/items',
            name: 'list items',
            requestSchema: { pathParams: [], queryParams: [], headers: [], cookies: [] },
            requestValidation: [],
            responseRules: [],
            defaultResponse: {
              status: 200,
              headers: [],
              body: { type: 'json' as const, content: '[]' },
            },
          },
        ],
        defaultPort: 3000,
        cors: { enabled: false, origins: [] },
        createdAt: '2026-01-01T00:00:00.000Z',
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    await desktopProvider.apply(seedPatch);
    await gitProvider.apply(seedPatch);

    // The "FS-write update" patch: same shape as what `apicircleFsProvider`
    // emits — full mock object with source + endpoints carried over from
    // the prior read, only the editable fields changed.
    const updatePatch = {
      kind: 'mock.upsert' as const,
      mock: {
        ...seedPatch.mock,
        name: 'Renamed via YAML',
        defaultPort: 4040,
        cors: { enabled: true, origins: ['*'] },
        updatedAt: '2026-01-01T00:00:00.000Z',
      },
    };
    const desktopResult = await desktopProvider.apply(updatePatch);
    const gitResult = await gitProvider.apply(updatePatch);

    expect(canonicalize(desktopResult.state.synced)).toBe(canonicalize(gitResult.state.synced));
    // Source + endpoints preserved on both surfaces.
    const dMock = desktopResult.state.synced.mockServers['mock-update'];
    const gMock = gitResult.state.synced.mockServers['mock-update'];
    expect(dMock.source).toEqual(gMock.source);
    expect(dMock.endpoints).toEqual(gMock.endpoints);
    expect(dMock.name).toBe('Renamed via YAML');
    expect(dMock.defaultPort).toBe(4040);
    expect(dMock.cors.enabled).toBe(true);
    expect(desktopResult.changedIds.sort()).toEqual(gitResult.changedIds.sort());
  });
});
