// Live GitHub - dependency linking and release update flows.
//
// These tests use bot-owned ephemeral source repos so private, dedicated-PAT,
// and public/anonymous linking all hit real api.github.com without depending
// on long-lived fixture data.

import { expect, test } from '../fixtures/app';
import {
  type LiveGithubConfig,
  connectAndBranch,
  createRepo,
  deleteBranch,
  deleteRepo,
  disconnect,
  getBotOwner,
  getDedicatedLinkToken,
  getLiveConfig,
  getPipelineRepoConfig,
  liveSkipReason,
  makeBranchName,
  makeDeterministicWorkspace,
  publishReleaseOnSource,
  seedRepoIfEmpty,
  setRepoTopics,
  updateWorkspaceJson,
  writeWorkspaceJson,
} from './_helpers';

const createdBranches: string[] = [];
const createdRepos: Array<{ owner: string; name: string; token: string }> = [];

async function provisionSourceRepo(
  token: string,
  botOwner: string,
  label: string,
  visibility: 'private' | 'public' = 'private',
): Promise<{ cfg: LiveGithubConfig; branch: string }> {
  const created = await createRepo(token, {
    owner: botOwner,
    name: `apicircle-e2e-dep-${visibility}-${label}-${Date.now() % 1_000_000}`,
    visibility,
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
    makeDeterministicWorkspace(`dep-${label}`, {
      version: '1.0.0',
      notes: `# Dependency ${label} v1\n\n- Initial markdown release note.`,
    }),
    'e2e: seed dependency source v1',
  );
  if (visibility === 'public') {
    await setRepoTopics(cfg, ['apicircle', 'apicircle-e2e']);
  }
  return { cfg, branch: head.name };
}

async function publishV2(
  source: LiveGithubConfig,
  branch: string,
  label: string,
  opts: { deprecated?: boolean; yanked?: boolean } = {},
): Promise<void> {
  await publishReleaseOnSource(
    source,
    branch,
    '1.1.0',
    `# Dependency ${label} v2\n\n- Updated request and environment.`,
    (ws) => {
      const collections = ws.collections as { requests?: Record<string, Record<string, unknown>> };
      const req = Object.values(collections.requests ?? {})[0];
      if (req) {
        req.name = `E2E ${label} request 1.1.0`;
        req.method = 'PATCH';
        req.url = `https://source.example.test/${label}/1.1.0`;
        req.body = { type: 'json', content: JSON.stringify({ version: '1.1.0' }) };
      }
      const envs =
        (
          ws.environments as {
            items?: Record<string, { variables?: Array<Record<string, unknown>> }>;
          }
        ).items ?? {};
      const env = Object.values(envs)[0];
      if (env?.variables) {
        env.variables = env.variables.map((v) =>
          v.key === 'BASE_URL' ? { ...v, value: `https://env.example.test/${label}/1.1.0` } : v,
        );
      }
    },
  );
  if (opts.deprecated || opts.yanked) {
    await updateWorkspaceJson(source, branch, 'e2e: flag dependency release v2', (ws) => {
      const versions = ((ws.releases as any)?.self?.versions ?? []) as Array<
        Record<string, unknown>
      >;
      const v2 = versions.find((v) => v.version === '1.1.0');
      if (v2) {
        if (opts.deprecated) v2.deprecated = true;
        if (opts.yanked) v2.yanked = true;
      }
    });
  }
}

test.describe('Live GitHub - linked workspace dependencies @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let host: LiveGithubConfig;
  let botOwner: string;
  let dedicatedToken: string;

  test.beforeAll(async () => {
    const resolved = getPipelineRepoConfig().privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    host = resolved;
    const owner = getBotOwner();
    test.skip(
      owner === null,
      'GitHub dependency tests create ephemeral repos - set APICIRCLE_E2E_BOT_OWNER.',
    );
    botOwner = owner!;
    const token = getDedicatedLinkToken();
    test.skip(
      !token,
      'Set APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED for dedicated per-link PAT coverage.',
    );
    dedicatedToken = token!;
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

  test('private latest and pinned links read markdown notes; decline stays v1 and adopt updates on demand', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'private-update', 'private');
    const branch = makeBranchName(test.info().workerIndex, 'dep-private-update');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const linked = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const latest = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: null,
        });
        const pinned = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        const view = (id: string) => {
          const link = state.synced.linkedWorkspaces[id];
          const snapshot = state.local.linkedCollections[id];
          const request = Object.values(snapshot.collections.requests)[0] as any;
          const env = Object.values(snapshot.environments.items)[0] as any;
          const ledger = state.synced.releases.perLink[id];
          return {
            id,
            pinnedVersion: link.pinnedVersion,
            requestUrl: request.url,
            requestMethod: request.method,
            envBaseUrl: env.variables.find((v: any) => v.key === 'BASE_URL')?.value,
            releaseNotes: ledger.versions.find((v: any) => v.version === '1.0.0')?.notes ?? '',
            ledgerCurrent: ledger.currentVersion,
          };
        };
        return { latest: view(latest.id), pinned: view(pinned.id) };
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch },
    );
    expect(linked.latest.pinnedVersion).toBe('1.0.0');
    expect(linked.pinned.pinnedVersion).toBe('1.0.0');
    expect(linked.latest.releaseNotes).toContain('# Dependency private-update v1');
    expect(linked.latest.requestUrl).toContain('1.0.0');

    await publishV2(source.cfg, source.branch, 'private-update');

    const after = await app.evaluate(
      async ({ latestId, pinnedId }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const waitForLedgerVersion = async (id: string, version: string) => {
          let lastError: unknown = null;
          let lastVersion: string | null = null;
          for (let attempt = 0; attempt < 10; attempt += 1) {
            try {
              await api.refreshLinkedWorkspace(id);
              const ledger = (window.__apicircleStore!.getState() as any).synced.releases.perLink[
                id
              ];
              lastVersion = ledger?.currentVersion ?? null;
              if (ledger?.currentVersion === version) return;
            } catch (error) {
              lastError = error;
            }
            await new Promise((resolve) => setTimeout(resolve, 1000));
          }
          if (lastError) throw lastError;
          throw new Error(
            `Timed out waiting for linked ledger ${id} to reach ${version}; last version was ${lastVersion}`,
          );
        };
        await waitForLedgerVersion(pinnedId, '1.1.0');
        await waitForLedgerVersion(latestId, '1.1.0');
        for (let attempt = 0; attempt < 10; attempt += 1) {
          await api.previewLinkedUpdateForLink(latestId);
          await api.applyLinkedUpdateForLink({});
          const link = (window.__apicircleStore!.getState() as any).synced.linkedWorkspaces[
            latestId
          ];
          if (link?.pinnedVersion === '1.1.0') break;
          await new Promise((resolve) => setTimeout(resolve, 1000));
        }
        const state = window.__apicircleStore!.getState() as any;
        const view = (id: string) => {
          const link = state.synced.linkedWorkspaces[id];
          const snapshot = state.local.linkedCollections[id];
          const request = Object.values(snapshot.collections.requests)[0] as any;
          const env = Object.values(snapshot.environments.items)[0] as any;
          const ledger = state.synced.releases.perLink[id];
          return {
            pinnedVersion: link.pinnedVersion,
            requestUrl: request.url,
            requestMethod: request.method,
            envBaseUrl: env.variables.find((v: any) => v.key === 'BASE_URL')?.value,
            ledgerCurrent: ledger.currentVersion,
            v2Notes: ledger.versions.find((v: any) => v.version === '1.1.0')?.notes ?? '',
          };
        };
        return { adopted: view(latestId), declined: view(pinnedId) };
      },
      { latestId: linked.latest.id, pinnedId: linked.pinned.id },
    );

    expect(after.declined.ledgerCurrent).toBe('1.1.0');
    expect(after.declined.pinnedVersion).toBe('1.0.0');
    expect(after.declined.requestUrl).toContain('1.0.0');
    expect(after.adopted.pinnedVersion).toBe('1.1.0');
    expect(after.adopted.requestUrl).toContain('1.1.0');
    expect(after.adopted.requestMethod).toBe('PATCH');
    expect(after.adopted.envBaseUrl).toContain('1.1.0');
    expect(after.adopted.v2Notes).toContain('# Dependency private-update v2');

    await disconnect(app);
  });

  test('private link can use a dedicated per-link PAT after workspace GitHub session is removed', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'dedicated', 'private');
    const branch = makeBranchName(test.info().workerIndex, 'dep-dedicated-session');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const result = await app.evaluate(
      async ({ repoFullName, sourceRef, token }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
          sessionMode: 'dedicated',
          linkSessionToken: token,
        });
        await api.disconnectGitHubSession();
        await api.refreshLinkedWorkspace(link.id);
        const state = window.__apicircleStore!.getState() as any;
        return {
          sessionMode: state.synced.linkedWorkspaces[link.id]?.source?.sessionMode,
          hasLinkSession: !!state.local.sessions.github.links?.[link.id],
          hasWorkspaceSession: !!state.local.sessions.github.workspace,
          snapshotPresent: !!state.local.linkedCollections[link.id],
          ledgerCurrent: state.synced.releases.perLink[link.id]?.currentVersion ?? null,
        };
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch, token: dedicatedToken },
    );
    expect(result.sessionMode).toBe('dedicated');
    expect(result.hasLinkSession).toBe(true);
    expect(result.hasWorkspaceSession).toBe(false);
    expect(result.snapshotPresent).toBe(true);
    expect(result.ledgerCurrent).toBe('1.0.0');
  });

  test('public dependency can be discovered anonymously and linked without an active workspace session', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'public-anon', 'public');

    const result = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        await api.disconnectGitHubSession();
        const marketplace = await api.searchMarketplace('apicircle');
        const link = await api.linkPublicWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        const linked = state.synced.linkedWorkspaces[link.id];
        const snapshot = state.local.linkedCollections[link.id];
        return {
          marketplaceIsArray: Array.isArray(marketplace),
          linkedKind: linked.kind,
          repo: linked.source.repoFullName,
          sessionMode: linked.source.sessionMode,
          snapshotRequestCount: Object.keys(snapshot.collections.requests).length,
        };
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch },
    );
    expect(result.marketplaceIsArray).toBe(true);
    expect(result.linkedKind).toBe('public');
    expect(result.repo.toLowerCase()).toBe(source.cfg.fullName.toLowerCase());
    expect(result.sessionMode).toBe('workspace');
    expect(result.snapshotRequestCount).toBeGreaterThan(0);
  });

  test('unlink removes link-specific material and overrides but preserves local workspace entities', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'unlink', 'private');
    const branch = makeBranchName(test.info().workerIndex, 'dep-unlink');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const result = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        const state = window.__apicircleStore!.getState() as any;
        const snapshot = state.local.linkedCollections[link.id];
        const reqId = Object.keys(snapshot.collections.requests)[0];
        const env = Object.values(snapshot.environments.items)[0] as any;
        const envName = env.name;
        const varKey = env.variables[0].key;
        api.setLinkedRequestOverride(link.id, reqId, {
          url: 'https://override.example.test/local',
        });
        api.setLinkedEnvVarOverride(link.id, envName, varKey, { value: 'override-local' });
        const localRequestId = api.addRequest(null, 'local request survives unlink');
        api.unlinkWorkspace(link.id);
        const after = window.__apicircleStore!.getState() as any;
        return {
          linkGone: !after.synced.linkedWorkspaces[link.id],
          requestOverridesGone: !Object.values(after.synced.linkedOverrides.requests).some(
            (o: any) => o.linkedWorkspaceId === link.id,
          ),
          envOverridesGone: !Object.values(after.synced.linkedOverrides.environmentVars).some(
            (o: any) => o.linkedWorkspaceId === link.id,
          ),
          releaseLedgerGone: !after.synced.releases.perLink[link.id],
          localCacheGone: !after.local.linkedCollections[link.id],
          localRequestPresent: !!after.synced.collections.requests[localRequestId],
        };
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch },
    );
    expect(result.linkGone).toBe(true);
    expect(result.requestOverridesGone).toBe(true);
    expect(result.envOverridesGone).toBe(true);
    expect(result.releaseLedgerGone).toBe(true);
    expect(result.localCacheGone).toBe(true);
    expect(result.localRequestPresent).toBe(true);

    await disconnect(app);
  });

  test('deprecated and yanked source releases stay visible and never silently switch pinned consumers', async ({
    app,
  }) => {
    const source = await provisionSourceRepo(host.token, botOwner, 'flagged-release', 'private');
    const branch = makeBranchName(test.info().workerIndex, 'dep-flagged-release');
    createdBranches.push(branch);
    await connectAndBranch(app, host, branch);

    const linkId = await app.evaluate(
      async ({ repoFullName, sourceRef }) => {
        const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
        const link = await api.linkPrivateWorkspace({
          repoFullName,
          branch: sourceRef,
          pinnedVersion: '1.0.0',
        });
        return link.id;
      },
      { repoFullName: source.cfg.fullName, sourceRef: source.branch },
    );
    await publishV2(source.cfg, source.branch, 'flagged-release', {
      deprecated: true,
      yanked: true,
    });

    const result = await app.evaluate(async (id) => {
      const api = window.__apicircleStore!.getState() as unknown as Record<string, any>;
      let lastError: unknown = null;
      let sawV2 = false;
      let lastVersion: string | null = null;
      for (let attempt = 0; attempt < 10; attempt += 1) {
        try {
          await api.refreshLinkedWorkspace(id);
          const ledger = (window.__apicircleStore!.getState() as any).synced.releases.perLink[id];
          lastVersion = ledger?.currentVersion ?? null;
          if (ledger?.currentVersion === '1.1.0') {
            sawV2 = true;
            break;
          }
        } catch (error) {
          lastError = error;
        }
        await new Promise((resolve) => setTimeout(resolve, 1000));
      }
      if (!sawV2 && lastError) throw lastError;
      if (!sawV2) {
        throw new Error(
          `Timed out waiting for flagged release ledger to reach 1.1.0; last version was ${lastVersion}`,
        );
      }
      const state = window.__apicircleStore!.getState() as any;
      const link = state.synced.linkedWorkspaces[id];
      const snapshotReq = Object.values(
        state.local.linkedCollections[id].collections.requests,
      )[0] as any;
      const ledger = state.synced.releases.perLink[id];
      const v2 = ledger.versions.find((v: any) => v.version === '1.1.0');
      return {
        pinnedVersion: link.pinnedVersion,
        requestUrl: snapshotReq.url,
        ledgerCurrent: ledger.currentVersion,
        deprecated: v2?.deprecated ?? false,
        yanked: v2?.yanked ?? false,
      };
    }, linkId);
    expect(result.ledgerCurrent).toBe('1.1.0');
    expect(result.deprecated).toBe(true);
    expect(result.yanked).toBe(true);
    expect(result.pinnedVersion).toBe('1.0.0');
    expect(result.requestUrl).toContain('1.0.0');

    await disconnect(app);
  });
});
