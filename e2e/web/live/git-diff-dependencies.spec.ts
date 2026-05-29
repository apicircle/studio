// Live GitHub - dependency diff and three-way merge coverage.
//
// This spec validates the Git diff model buckets that are specific to
// workspace dependencies: linkedWorkspace, linkedRequestOverride,
// linkedEnvOverride, and releasePerLink. It also exercises auto-merge and
// conflict resolution against real remote branch edits.

import { summarizeUnpushedChanges } from '@apicircle/core';
import type { WorkspaceSynced } from '@apicircle/shared';
import { expect, test } from '../fixtures/app';
import {
  type LiveGithubConfig,
  assertRemoteWorkspaceHasNoLocalOnlyData,
  connectAndBranch,
  createRepo,
  deleteBranch,
  deleteRepo,
  disconnect,
  fetchWorkspaceJson,
  getBotOwner,
  getLiveConfig,
  getPipelineRepoConfig,
  liveSkipReason,
  makeBranchName,
  makeDeterministicWorkspace,
  seedRepoIfEmpty,
  updateWorkspaceJson,
  writeWorkspaceJson,
} from './_helpers';

interface StatePair {
  base: WorkspaceSynced | null;
  current: WorkspaceSynced;
}

const createdBranches: string[] = [];
const createdRepos: Array<{ owner: string; name: string; token: string }> = [];

function diff(pair: StatePair) {
  return summarizeUnpushedChanges(pair.base, pair.current, {
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
}

function expectDiff(pair: StatePair, bucket: string, kind?: string): void {
  const changes = diff(pair).changes;
  const found = changes.some((c) => c.bucket === bucket && (kind ? c.kind === kind : true));
  expect(found, `expected ${kind ?? 'any'} change in bucket ${bucket}`).toBe(true);
}

async function provisionSourceRepo(
  token: string,
  botOwner: string,
  label: string,
): Promise<{ cfg: LiveGithubConfig; branch: string }> {
  const created = await createRepo(token, {
    owner: botOwner,
    name: `apicircle-e2e-diff-source-${label}-${Date.now() % 1_000_000}`,
    visibility: 'private',
  });
  createdRepos.push({ owner: created.owner, name: created.name, token });
  const cfg: LiveGithubConfig = {
    token,
    owner: created.owner,
    name: created.name,
    fullName: created.fullName,
  };
  const head = await seedRepoIfEmpty(cfg);
  await writeWorkspaceJson(
    cfg,
    head.name,
    makeDeterministicWorkspace(`diff-${label}`, {
      version: '1.0.0',
      notes: `# Diff ${label} v1\n\n- Initial dependency ledger.`,
    }),
    'e2e: seed dependency diff source',
  );
  return { cfg, branch: head.name };
}

function addRemoteRequest(ws: Record<string, any>, id: string, name: string): void {
  const now = '2026-01-01T00:00:00.000Z';
  ws.collections.requests[id] = {
    id,
    name,
    folderId: null,
    method: 'GET',
    url: `https://remote.example.test/${id}`,
    headers: [],
    query: [],
    pathParams: {},
    cookies: [],
    body: { type: 'none', content: '' },
    auth: { type: 'none' },
    contextVars: [],
    extractions: [],
    assertions: [],
    createdAt: now,
    updatedAt: now,
  };
  ws.collections.tree.children = [...(ws.collections.tree.children ?? []), { kind: 'request', id }];
}

test.describe('Live GitHub - dependency diff buckets @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let host: LiveGithubConfig;
  let botOwner: string;

  test.beforeAll(async () => {
    const resolved = getPipelineRepoConfig().privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    host = resolved;
    const owner = getBotOwner();
    test.skip(
      owner === null,
      'dependency diff tests create source repos - set APICIRCLE_E2E_BOT_OWNER.',
    );
    botOwner = owner!;
    await seedRepoIfEmpty(host);
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(host, branch);
    }
    for (const repo of createdRepos.splice(0)) {
      try {
        await deleteRepo(repo.token, repo.owner, repo.name);
      } catch {
        /* orphan sweep catches misses */
      }
    }
  });

  test('linked dependency buckets appear before push and reset after successful push', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'buckets');
    const branch = makeBranchName(test.info().workerIndex, 'diff-buckets');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const state = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        const snapshot = window.__apicircleStore!.getState().local!.linkedCollections[link.id];
        const reqId = Object.keys(snapshot.collections.requests)[0];
        const env = Object.values(snapshot.environments.items)[0] as any;
        api.setLinkedRequestOverride(link.id, reqId, {
          url: 'https://override.example.test/request',
          method: 'POST',
        });
        api.setLinkedEnvVarOverride(link.id, env.name, env.variables[0].key, {
          value: 'https://override.example.test/env',
        });
        const current = window.__apicircleStore!.getState() as any;
        return {
          ids: { linkId: link.id, reqId, envName: env.name, varKey: env.variables[0].key },
          pair: {
            base: current.local.sync.lastPulledSnapshot ?? null,
            current: current.synced,
          },
        };
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch },
    );
    expectDiff(state.pair, 'linkedWorkspace', 'added');
    expectDiff(state.pair, 'releasePerLink', 'added');
    expectDiff(state.pair, 'linkedRequestOverride', 'added');
    expectDiff(state.pair, 'linkedEnvOverride', 'added');

    const pushed = await app.evaluate(async () => {
      const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
      await api.pushWorkspace('e2e dependency diff buckets');
      const current = window.__apicircleStore!.getState() as any;
      return {
        pair: {
          base: current.local.sync.lastPulledSnapshot ?? null,
          current: current.synced,
        },
      };
    });
    expect(diff(pushed.pair).total).toBe(0);

    const remote = (await fetchWorkspaceJson(host, branch)).json as Record<string, any>;
    assertRemoteWorkspaceHasNoLocalOnlyData(remote);
    expect(remote.linkedWorkspaces?.[state.ids.linkId]).toBeDefined();
    expect(
      remote.linkedOverrides?.requests?.[`${state.ids.linkId}:${state.ids.reqId}`],
    ).toBeDefined();
    expect(
      remote.linkedOverrides?.environmentVars?.[
        `${state.ids.linkId}:${state.ids.envName}:${state.ids.varKey}`
      ],
    ).toBeDefined();
    expect(remote.releases?.perLink?.[state.ids.linkId]).toBeDefined();

    await disconnect(app);
  });

  test('remote dependency changes and remote core changes auto-merge with local dependency edits', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'auto-merge');
    const branch = makeBranchName(test.info().workerIndex, 'diff-auto-merge');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const setup = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        await api.pushWorkspace('e2e dependency diff baseline');
        const snapshot = window.__apicircleStore!.getState().local!.linkedCollections[link.id];
        const env = Object.values(snapshot.environments.items)[0] as any;
        return { linkId: link.id, envName: env.name, varKey: env.variables[0].key };
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch },
    );

    await updateWorkspaceJson(host, branch, 'e2e: remote dependency and core edits', (ws) => {
      const typed = ws as Record<string, any>;
      typed.linkedWorkspaces[setup.linkId].name = 'remote dependency name';
      typed.releases.perLink[setup.linkId].versions.push({
        version: '1.0.1',
        notes: 'remote ledger-only patch',
        publishedAt: '2026-01-01T00:00:00.000Z',
        workspaceSnapshot: 'remote-ledger-only',
        deprecated: false,
        yanked: false,
      });
      typed.releases.perLink[setup.linkId].currentVersion = '1.0.1';
      addRemoteRequest(typed, 'remote-core-request', 'remote core request');
    });

    const result = await app.evaluate(async ({ linkId, envName, varKey }) => {
      const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
      api.setLinkedEnvVarOverride(linkId, envName, varKey, {
        value: 'local dependency env override',
      });
      const localRequestId = api.addRequest(null, 'local core request');
      const refresh = await api.refreshWorkspace();
      const state = window.__apicircleStore!.getState() as any;
      const snapshot = state.local.snapshots.entries[0];
      return {
        status: refresh.status,
        remoteDependencyName: state.synced.linkedWorkspaces[linkId].name,
        ledgerCurrent: state.synced.releases.perLink[linkId].currentVersion,
        remoteCorePresent: !!state.synced.collections.requests['remote-core-request'],
        localCorePresent: !!state.synced.collections.requests[localRequestId],
        localEnvOverridePresent:
          !!state.synced.linkedOverrides.environmentVars[`${linkId}:${envName}:${varKey}`],
        snapshotTrigger: snapshot?.triggeredBy ?? null,
        pair: {
          base: state.local.sync.lastPulledSnapshot ?? null,
          current: state.synced,
        },
      };
    }, setup);
    expect(result.status).toBe('merged');
    expect(result.remoteDependencyName).toBe('remote dependency name');
    expect(result.ledgerCurrent).toBe('1.0.1');
    expect(result.remoteCorePresent).toBe(true);
    expect(result.localCorePresent).toBe(true);
    expect(result.localEnvOverridePresent).toBe(true);
    expect(result.snapshotTrigger).toBe('pre-merge');
    expectDiff(result.pair, 'linkedEnvOverride');
    expectDiff(result.pair, 'request');

    await disconnect(app);
  });

  test('same dependency key conflict can be cancelled, then resolved as mine and remains unpushed', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'mine-conflict');
    const branch = makeBranchName(test.info().workerIndex, 'diff-conflict-mine');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const setup = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        await api.pushWorkspace('e2e conflict baseline');
        const snapshot = window.__apicircleStore!.getState().local!.linkedCollections[link.id];
        const reqId = Object.keys(snapshot.collections.requests)[0];
        return { linkId: link.id, reqId, key: `${link.id}:${reqId}` };
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch },
    );

    await updateWorkspaceJson(
      host,
      branch,
      'e2e: remote linked request override conflict',
      (ws) => {
        const typed = ws as Record<string, any>;
        typed.linkedOverrides.requests[setup.key] = {
          linkedWorkspaceId: setup.linkId,
          itemId: setup.reqId,
          patch: { url: 'https://remote.example.test/conflict' },
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
      },
    );

    const result = await app.evaluate(async ({ linkId, reqId, key }) => {
      const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
      api.setLinkedRequestOverride(linkId, reqId, {
        url: 'https://local.example.test/conflict',
      });
      const before = JSON.stringify(window.__apicircleStore!.getState().synced);
      const firstRefresh = await api.refreshWorkspace();
      api.cancelRefresh();
      const afterCancel = JSON.stringify(window.__apicircleStore!.getState().synced);
      const secondRefresh = await api.refreshWorkspace();
      await api.commitRefresh({ [`linkedRequestOverride:${key}`]: 'mine' });
      const state = window.__apicircleStore!.getState() as any;
      return {
        firstStatus: firstRefresh.status,
        conflictBucket: firstRefresh.diff?.conflicts?.[0]?.bucket ?? null,
        cancelSame: before === afterCancel,
        secondStatus: secondRefresh.status,
        overrideUrl: state.synced.linkedOverrides.requests[key]?.patch?.url ?? null,
        snapshotTrigger: state.local.snapshots.entries[0]?.triggeredBy ?? null,
        pair: {
          base: state.local.sync.lastPulledSnapshot ?? null,
          current: state.synced,
        },
      };
    }, setup);
    expect(result.firstStatus).toBe('conflicts');
    expect(result.conflictBucket).toBe('linkedRequestOverride');
    expect(result.cancelSame).toBe(true);
    expect(result.secondStatus).toBe('conflicts');
    expect(result.overrideUrl).toBe('https://local.example.test/conflict');
    expect(result.snapshotTrigger).toBe('pre-merge');
    expectDiff(result.pair, 'linkedRequestOverride');

    await disconnect(app);
  });

  test('same dependency key conflict resolved as theirs accepts remote and clears local diff', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'theirs-conflict');
    const branch = makeBranchName(test.info().workerIndex, 'diff-conflict-theirs');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const setup = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        await api.pushWorkspace('e2e conflict theirs baseline');
        const snapshot = window.__apicircleStore!.getState().local!.linkedCollections[link.id];
        const reqId = Object.keys(snapshot.collections.requests)[0];
        return { linkId: link.id, reqId, key: `${link.id}:${reqId}` };
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch },
    );

    await updateWorkspaceJson(host, branch, 'e2e: remote linked request override theirs', (ws) => {
      const typed = ws as Record<string, any>;
      typed.linkedOverrides.requests[setup.key] = {
        linkedWorkspaceId: setup.linkId,
        itemId: setup.reqId,
        patch: { url: 'https://remote.example.test/theirs' },
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
    });

    const result = await app.evaluate(async ({ linkId, reqId, key }) => {
      const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
      api.setLinkedRequestOverride(linkId, reqId, {
        url: 'https://local.example.test/theirs',
      });
      const refresh = await api.refreshWorkspace();
      await api.commitRefresh({ [`linkedRequestOverride:${key}`]: 'theirs' });
      const state = window.__apicircleStore!.getState() as any;
      return {
        status: refresh.status,
        overrideUrl: state.synced.linkedOverrides.requests[key]?.patch?.url ?? null,
        pair: {
          base: state.local.sync.lastPulledSnapshot ?? null,
          current: state.synced,
        },
      };
    }, setup);
    expect(result.status).toBe('conflicts');
    expect(result.overrideUrl).toBe('https://remote.example.test/theirs');
    expect(diff(result.pair).total).toBe(0);

    await disconnect(app);
  });
});
