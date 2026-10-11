import { act } from '@testing-library/react';
import { beforeEach, describe, expect, it } from 'vitest';
import type { WorkspaceLocal, WorkspaceSynced } from '@apicircle/shared';
import { useWorkspaceStore } from './workspaceStore';

// `clearWorkspaceContent` — what "Also clear this workspace's Studio data" does
// to the document when a repository is disconnected. It removes everything a
// person would otherwise delete row by row, so the two things that matter most
// are what it must NOT take with it, and that there is a way back.

const store = () => useWorkspaceStore.getState();
const synced = (): WorkspaceSynced => store().synced!;
const local = (): WorkspaceLocal => store().local!;

/** One of everything the clear removes, plus the device state that has to survive it. */
async function fillWorkspace(): Promise<{ requestId: string; secretId: string }> {
  const folderId = store().addFolder(null, 'Orders');
  const requestId = store().addRequest(folderId, 'List orders');
  store().addEnvironment('staging');
  store().setActiveEnvironment('staging');
  store().addGlobalSchema({ name: 'Order' });
  const planId = store().addPlan('Smoke');
  store().addPlanStep(planId, requestId);
  await store().createMockServer({
    name: 'orders-mock',
    source: { kind: 'manual', endpoints: [] },
  });
  const secretId = await store().addSecret({
    label: 'ORDERS_KEY',
    value: 's3cret',
    origin: 'workspace',
  });
  return { requestId, secretId };
}

/** How much of each kind the document holds: all zero once it is cleared. */
function contentCounts(doc: WorkspaceSynced): Record<string, number> {
  return {
    requests: Object.keys(doc.collections.requests).length,
    folders: Object.keys(doc.collections.folders).length,
    treeChildren: doc.collections.tree.children.length,
    environments: Object.keys(doc.environments.items).length,
    schemas: Object.keys(doc.globalAssets.schemas).length,
    graphql: Object.keys(doc.globalAssets.graphql).length,
    files: Object.keys(doc.globalAssets.files ?? {}).length,
    mockServers: Object.keys(doc.mockServers).length,
    plans: Object.keys(doc.executionPlans ?? {}).length,
  };
}

const EMPTY = {
  requests: 0,
  folders: 0,
  treeChildren: 0,
  environments: 0,
  schemas: 0,
  graphql: 0,
  files: 0,
  mockServers: 0,
  plans: 0,
};

describe('workspaceStore — clearWorkspaceContent', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it('removes requests, folders, environments, mock servers, plans and global assets', async () => {
    await fillWorkspace();
    const before = contentCounts(synced());
    // The seed is real: one of each kind, so "all zero" afterwards means something.
    expect(before).toMatchObject({
      folders: 1,
      environments: 1,
      schemas: 1,
      mockServers: 1,
      plans: 1,
    });
    expect(before.requests).toBeGreaterThanOrEqual(1);

    await store().clearWorkspaceContent();

    expect(contentCounts(synced())).toEqual(EMPTY);
    expect(synced().environments.activeName).toBeNull();
    expect(synced().environments.priorityOrder).toEqual([]);
  });

  it('keeps the workspace itself: its id, its tree root, and when it was created', async () => {
    await fillWorkspace();
    const before = synced();
    await store().clearWorkspaceContent();
    expect(synced().workspaceId).toBe(before.workspaceId);
    expect(synced().collections.tree).toEqual({ ...before.collections.tree, children: [] });
    expect(synced().meta.createdAt).toBe(before.meta.createdAt);
    expect(synced().meta.updatedAt >= before.meta.updatedAt).toBe(true);
    expect(synced().schemaVersion).toBe(1);
  });

  it('captures a "Before clearing" snapshot first, and restoring it puts the document back', async () => {
    await fillWorkspace();
    const before = synced();
    expect(local().snapshots.entries).toHaveLength(0);

    await store().clearWorkspaceContent();

    const [snapshot] = local().snapshots.entries;
    expect(local().snapshots.entries).toHaveLength(1);
    expect(snapshot.triggeredBy).toBe('pre-clear');
    expect(snapshot.note).toBe('Before clearing the workspace');
    // The document as it was, whole: the snapshot is taken before anything goes.
    expect(snapshot.workspaceSyncedSnapshot).toEqual(before);

    expect(store().restoreSnapshot(snapshot.id)).toBe(true);
    expect(contentCounts(synced())).toEqual(contentCounts(before));
    expect(synced().collections.requests).toEqual(before.collections.requests);
    expect(synced().environments).toEqual(before.environments);
  });

  it('leaves run history, the secret vault, the Git connection and linked workspaces alone', async () => {
    const { secretId } = await fillWorkspace();
    const linked: WorkspaceSynced['linkedWorkspaces'][string] = {
      id: 'lw-1',
      kind: 'private',
      name: 'Shared APIs',
      sourceWorkspaceId: 'ws-source',
      source: {
        provider: 'github',
        repoFullName: 'acme/shared',
        branch: 'main',
        sessionMode: 'workspace',
      },
      scope: ['collections', 'environments'],
      pinnedVersion: null,
      updatePolicy: 'manual',
      linkedAt: '2026-10-01T00:00:00.000Z',
      requiredSecretKeyIds: [],
    };
    const session = {
      accountLogin: 'me',
      tokenSecretId: 'sec',
      grantedScopes: ['repo'],
      addedAt: '2026-10-01T00:00:00.000Z',
      lastVerifiedAt: null,
      canCreatePullRequests: true,
    };
    const repo: NonNullable<WorkspaceLocal['connectedRepo']> = {
      fullName: 'acme/api',
      owner: 'acme',
      name: 'api',
      defaultBranch: 'main',
      visibility: 'private',
      isPrivate: true,
      pushable: true,
      connectedAt: '2026-10-01T00:00:00.000Z',
    };
    const history: WorkspaceLocal['history'] = {
      requestRuns: [{ id: 'run-1' } as WorkspaceLocal['history']['requestRuns'][number]],
      planRuns: [],
    };
    act(() =>
      useWorkspaceStore.setState({
        synced: {
          ...synced(),
          linkedWorkspaces: { 'lw-1': linked },
          environments: {
            ...synced().environments,
            priorityOrder: [
              { kind: 'local', name: 'staging' },
              { kind: 'linked', linkedWorkspaceId: 'lw-1', envName: 'shared' },
            ],
          },
        },
        local: {
          ...local(),
          history,
          connectedRepo: repo,
          sessions: { ...local().sessions, github: { workspace: session, links: {} } },
          settings: { ...local().settings, validateOnSend: false },
        },
      }),
    );

    await store().clearWorkspaceContent();

    expect(local().history).toEqual(history);
    expect(local().secretIndex.entries[secretId]).toMatchObject({ label: 'ORDERS_KEY' });
    expect(local().connectedRepo).toEqual(repo);
    expect(local().sessions.github.workspace).toEqual(session);
    expect(local().settings.validateOnSend).toBe(false);
    expect(synced().linkedWorkspaces).toEqual({ 'lw-1': linked });
    // A linked workspace keeps its place in the order; the local environment's went with it.
    expect(synced().environments.priorityOrder).toEqual([
      { kind: 'linked', linkedWorkspaceId: 'lw-1', envName: 'shared' },
    ]);
  });

  it('drops the pulled baseline and the caches of the document it emptied', async () => {
    await fillWorkspace();
    act(() =>
      useWorkspaceStore.setState({
        local: {
          ...local(),
          attachmentCache: {
            'slot-1': {} as NonNullable<WorkspaceLocal['attachmentCache']>[string],
          },
          sync: {
            lastPulledSnapshot: synced(),
            lastPulledSha: 'abc123',
            lastPulledAt: '2026-10-01T00:00:00.000Z',
            dirtyKeys: ['requests:r1'],
          },
        },
      }),
    );

    await store().clearWorkspaceContent();

    // Kept, the next repository would be read as one this workspace had deleted
    // everything from. Null makes it a first connection.
    expect(local().sync).toMatchObject({
      lastPulledSnapshot: null,
      lastPulledSha: null,
      lastPulledAt: null,
    });
    expect(local().attachmentCache).toEqual({});
  });

  it('clears what was on screen with what it showed', async () => {
    const { requestId } = await fillWorkspace();
    act(() => {
      store().setActiveRequestId(requestId);
      useWorkspaceStore.setState({
        activePlanId: 'plan-1',
        activeMockServerId: 'mock-1',
        activeMockEndpointId: 'endpoint-1',
        lastPlanResults: { 'plan-1': [] },
        isExecuting: { [requestId]: true },
      });
    });
    expect(local().ui.activeRequestId).toBe(requestId);

    await store().clearWorkspaceContent();

    expect(local().ui.activeRequestId).toBeNull();
    expect(store()).toMatchObject({
      activePlanId: null,
      activeMockServerId: null,
      activeMockEndpointId: null,
      lastRun: {},
      lastPlanResults: {},
      isExecuting: {},
    });
  });

  it('marks no secret as used once nothing uses one', async () => {
    const { requestId, secretId } = await fillWorkspace();
    act(() =>
      useWorkspaceStore.setState({
        local: {
          ...local(),
          secretIndex: {
            entries: {
              ...local().secretIndex.entries,
              [secretId]: {
                ...local().secretIndex.entries[secretId],
                usedIn: [{ kind: 'request', id: requestId, label: 'List orders' }],
              },
            },
          },
        },
      }),
    );
    await store().clearWorkspaceContent();
    expect(local().secretIndex.entries[secretId].usedIn).toEqual([]);
  });

  it('clears nothing when the snapshot that would bring it back cannot be kept', async () => {
    await fillWorkspace();
    const before = synced();
    // A cap the document alone does not fit under: capturing it evicts it at once.
    act(() => store().setSnapshotMaxBytes(1));

    await expect(store().clearWorkspaceContent()).rejects.toThrow(
      /Nothing was cleared: the snapshot that would bring this workspace back does not fit/,
    );

    expect(synced()).toBe(before);
    expect(local().snapshots.entries).toHaveLength(0);
  });

  it('survives being pressed on a workspace that is already empty', async () => {
    await store().clearWorkspaceContent();
    await store().clearWorkspaceContent();
    expect(contentCounts(synced())).toEqual(EMPTY);
    expect(local().snapshots.entries).toHaveLength(2);
  });

  it('survives a reload: what the store holds is what was written', async () => {
    await fillWorkspace();
    const workspaceId = synced().workspaceId;
    await store().clearWorkspaceContent();
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
    expect(synced().workspaceId).toBe(workspaceId);
    expect(contentCounts(synced())).toEqual(EMPTY);
    expect(local().snapshots.entries[0].triggeredBy).toBe('pre-clear');
  });

  it('refuses before a workspace has loaded', async () => {
    act(() => useWorkspaceStore.setState({ synced: null, local: null }));
    await expect(store().clearWorkspaceContent()).rejects.toThrow('Workspace not ready');
  });
});
