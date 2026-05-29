import { summarizeUnpushedChanges } from '@apicircle/core';
import { expect, test } from '../fixtures/app';
import {
  connectAndBranchV2,
  createV2HostRepo,
  createV2SourceRepo,
  createV2Tracker,
  getV2BotConfig,
  makeV2BranchName,
  updateWorkspaceJson,
  v2SkipReason,
} from './_helpers';

function diff(pair: { base: any; current: any }) {
  return summarizeUnpushedChanges(pair.base, pair.current, {
    now: () => new Date('2026-01-01T00:00:00.000Z'),
  });
}

function addRemoteRequest(ws: Record<string, any>, id: string): void {
  const now = '2026-01-01T00:00:00.000Z';
  ws.collections.requests[id] = {
    id,
    name: id,
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

test.describe('Live GitHub - refresh conflict resolution @live-github', () => {
  const skip = v2SkipReason();
  test.skip(skip !== null, skip ?? '');

  const tracker = createV2Tracker();
  test.afterEach(async () => {
    await tracker.cleanup();
  });

  async function setupLinkedBaseline(app: any, label: string) {
    const bot = getV2BotConfig();
    const host = await createV2HostRepo(tracker, bot, `${label}-host`);
    const source = await createV2SourceRepo(tracker, bot, `${label}-source`, 'private');
    const branch = makeV2BranchName(test.info().workerIndex, label);
    await connectAndBranchV2(app, host, branch, tracker);
    const setup = await app.evaluate(
      async ({ repoFullName, sourceBranch }) => {
        const api = window.__apicircleStore!.getState() as any;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceBranch,
          pinnedVersion: '1.0.0',
        });
        await api.pushWorkspace('e2e live: refresh baseline');
        const snapshot = window.__apicircleStore!.getState().local.linkedCollections[link.id];
        const reqId = Object.keys(snapshot.collections.requests)[0];
        const env = Object.values(snapshot.environments.items)[0] as any;
        return {
          linkId: link.id,
          reqId,
          envName: env.name,
          varKey: env.variables[0].key,
          key: `${link.id}:${reqId}`,
        };
      },
      { repoFullName: source.cfg.fullName, sourceBranch: source.branch },
    );
    return { host, branch, setup };
  }

  test('remote dependency and unrelated core changes auto-merge with local dependency edits', async ({
    app,
  }) => {
    const { host, branch, setup } = await setupLinkedBaseline(app, 'auto-merge');
    await updateWorkspaceJson(host, branch, 'e2e live: remote dep and core', (ws) => {
      const typed = ws as Record<string, any>;
      typed.linkedWorkspaces[setup.linkId].name = 'remote dependency name';
      typed.releases.perLink[setup.linkId].versions.push({
        version: '1.0.1',
        notes: 'remote dependency ledger',
        publishedAt: '2026-01-01T00:00:00.000Z',
        workspaceSnapshot: 'remote-ledger',
        deprecated: false,
        yanked: false,
      });
      typed.releases.perLink[setup.linkId].currentVersion = '1.0.1';
      addRemoteRequest(typed, 'v2-remote-core-request');
    });
    const result = await app.evaluate(async ({ linkId, envName, varKey }) => {
      const api = window.__apicircleStore!.getState() as any;
      api.setLinkedEnvVarOverride(linkId, envName, varKey, { value: 'local dependency override' });
      const localReq = api.addRequest(null, 'v2 local core request');
      const refresh = await api.refreshWorkspace();
      const state = window.__apicircleStore!.getState() as any;
      return {
        status: refresh.status,
        remoteName: state.synced.linkedWorkspaces[linkId].name,
        ledgerCurrent: state.synced.releases.perLink[linkId].currentVersion,
        remoteCore: !!state.synced.collections.requests['v2-remote-core-request'],
        localCore: !!state.synced.collections.requests[localReq],
        localOverride:
          !!state.synced.linkedOverrides.environmentVars[`${linkId}:${envName}:${varKey}`],
        pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
      };
    }, setup);
    expect(result.status).toBe('merged');
    expect(result.remoteName).toBe('remote dependency name');
    expect(result.ledgerCurrent).toBe('1.0.1');
    expect(result.remoteCore).toBe(true);
    expect(result.localCore).toBe(true);
    expect(result.localOverride).toBe(true);
    expect(diff(result.pair).changes.some((change) => change.bucket === 'linkedEnvOverride')).toBe(
      true,
    );
  });

  test('same dependency key can cancel, then resolve as mine and remain unpushed', async ({
    app,
  }) => {
    const mine = await setupLinkedBaseline(app, 'conflict-mine');
    await updateWorkspaceJson(mine.host, mine.branch, 'e2e live: remote mine conflict', (ws) => {
      const typed = ws as Record<string, any>;
      typed.linkedOverrides.requests[mine.setup.key] = {
        linkedWorkspaceId: mine.setup.linkId,
        itemId: mine.setup.reqId,
        patch: { url: 'https://remote.example.test/mine' },
        updatedAt: '2026-01-01T00:00:00.000Z',
      };
    });
    const mineResult = await app.evaluate(async ({ linkId, reqId, key }) => {
      const api = window.__apicircleStore!.getState() as any;
      api.setLinkedRequestOverride(linkId, reqId, { url: 'https://local.example.test/mine' });
      const before = JSON.stringify(window.__apicircleStore!.getState().synced);
      const first = await api.refreshWorkspace();
      api.cancelRefresh();
      const afterCancel = JSON.stringify(window.__apicircleStore!.getState().synced);
      await api.refreshWorkspace();
      await api.commitRefresh({ [`linkedRequestOverride:${key}`]: 'mine' });
      const state = window.__apicircleStore!.getState() as any;
      return {
        status: first.status,
        cancelSame: before === afterCancel,
        url: state.synced.linkedOverrides.requests[key].patch.url,
        pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
      };
    }, mine.setup);
    expect(mineResult.status).toBe('conflicts');
    expect(mineResult.cancelSame).toBe(true);
    expect(mineResult.url).toBe('https://local.example.test/mine');
    expect(
      diff(mineResult.pair).changes.some((change) => change.bucket === 'linkedRequestOverride'),
    ).toBe(true);
  });

  test('same dependency key resolved as theirs accepts remote and clears local diff', async ({
    app,
  }) => {
    const theirs = await setupLinkedBaseline(app, 'conflict-theirs');
    await updateWorkspaceJson(
      theirs.host,
      theirs.branch,
      'e2e live: remote theirs conflict',
      (ws) => {
        const typed = ws as Record<string, any>;
        typed.linkedOverrides.requests[theirs.setup.key] = {
          linkedWorkspaceId: theirs.setup.linkId,
          itemId: theirs.setup.reqId,
          patch: { url: 'https://remote.example.test/theirs' },
          updatedAt: '2026-01-01T00:00:00.000Z',
        };
      },
    );
    const theirsResult = await app.evaluate(async ({ linkId, reqId, key }) => {
      const api = window.__apicircleStore!.getState() as any;
      api.setLinkedRequestOverride(linkId, reqId, { url: 'https://local.example.test/theirs' });
      const refresh = await api.refreshWorkspace();
      await api.commitRefresh({ [`linkedRequestOverride:${key}`]: 'theirs' });
      const state = window.__apicircleStore!.getState() as any;
      return {
        status: refresh.status,
        url: state.synced.linkedOverrides.requests[key].patch.url,
        pair: { base: state.local.sync.lastPulledSnapshot ?? null, current: state.synced },
      };
    }, theirs.setup);
    expect(theirsResult.status).toBe('conflicts');
    expect(theirsResult.url).toBe('https://remote.example.test/theirs');
    expect(diff(theirsResult.pair).total).toBe(0);
  });
});
