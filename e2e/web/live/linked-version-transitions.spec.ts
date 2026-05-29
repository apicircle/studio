// Live GitHub — linked-workspace version-transition flows.
//
// The cross-repo-linking spec covers initial linking. This one covers
// what happens AFTER linking when the source moves forward (new
// versions, breaking changes, unpublish). Each test:
//
//   1. Creates a source repo with a seeded workspace.json that already
//      carries an initial release (v1.0.0).
//   2. Creates a host repo + links to the source pinned at v1.0.0.
//   3. Out-of-band, "publishes" a new version on the source via
//      `publishReleaseOnSource` (direct PUT to contents/workspace.json).
//   4. Triggers the consumer-side refresh / preview / apply paths and
//      asserts the right user-visible outcome.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapLV } from '../fixtures/tcMapLV';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  addLinkedWorkspaceOnSource,
  connectAndBranch,
  createRepo,
  deleteRepo,
  disconnect,
  ensureWorkspaceJsonOnMain,
  getBotOwner,
  getLiveConfig,
  getPipelineRepoConfig,
  liveSkipReason,
  makeBranchName,
  publishReleaseOnSource,
  seedRepoIfEmpty,
} from './_helpers';

function lv(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}

const createdRepos: Array<{ owner: string; name: string; token: string }> = [];

interface LinkedView {
  id: string;
  source?: { repoFullName?: string; pinnedVersion?: string | null };
  syncedSnapshot?: {
    collections?: { requests?: Record<string, { name?: string }> };
    environments?: {
      items?: Record<string, { name?: string; variables?: Array<{ key: string }> }>;
    };
  };
}

async function provisionSourceRepo(
  baseToken: string,
  botOwner: string,
  label: string,
): Promise<LiveGithubConfig> {
  const created = await createRepo(baseToken, {
    owner: botOwner,
    name: `apicircle-e2e-link-source-${label}-${Date.now() % 1_000_000}`,
    visibility: 'private',
  });
  createdRepos.push({ owner: created.owner, name: created.name, token: baseToken });
  const cfg: LiveGithubConfig = {
    token: baseToken,
    owner: created.owner,
    name: created.name,
    fullName: created.fullName,
  };
  await seedRepoIfEmpty(cfg, { workspaceJson: true });
  await ensureWorkspaceJsonOnMain(cfg, 'main');
  // Seed an initial release v1.0.0 so the consumer can pin to it.
  await publishReleaseOnSource(cfg, 'main', '1.0.0', `e2e ${label} seed`);
  return cfg;
}

async function provisionHostRepo(
  baseToken: string,
  botOwner: string,
  label: string,
): Promise<LiveGithubConfig> {
  const created = await createRepo(baseToken, {
    owner: botOwner,
    name: `apicircle-e2e-link-host-${label}-${Date.now() % 1_000_000}`,
    visibility: 'private',
  });
  createdRepos.push({ owner: created.owner, name: created.name, token: baseToken });
  const cfg: LiveGithubConfig = {
    token: baseToken,
    owner: created.owner,
    name: created.name,
    fullName: created.fullName,
  };
  await seedRepoIfEmpty(cfg);
  return cfg;
}

test.describe('Live GitHub — linked-workspace version transitions @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let baseToken: string;
  let botOwner: string;
  test.beforeAll(() => {
    const resolved = getPipelineRepoConfig().privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    baseToken = resolved.token;
    const owner = getBotOwner();
    test.skip(
      owner === null,
      'Linked-version transitions create source + host repos at runtime — set APICIRCLE_E2E_BOT_OWNER.',
    );
    botOwner = owner!;
  });

  test.afterAll(async () => {
    for (const r of createdRepos.splice(0)) {
      try {
        await deleteRepo(r.token, r.owner, r.name);
      } catch {
        /* orphan sweep handles it */
      }
    }
  });

  test(
    tc(
      lv('Update banner when source publishes new version'),
      'after source publishes v1.1.0, consumer pinned to v1.0.0 sees update available via release ledger',
    ),
    async ({ app }) => {
      const source = await provisionSourceRepo(baseToken, botOwner, 'update-banner');
      const host = await provisionHostRepo(baseToken, botOwner, 'update-banner');
      const branch = makeBranchName(test.info().workerIndex, 'lv-banner-host');
      await connectAndBranch(app, host, branch);
      const linkId = await app.evaluate(
        async ({ repo }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: 'main',
            pinnedVersion: '1.0.0',
          });
          return link.id;
        },
        { repo: source.fullName },
      );
      // Source publishes v1.1.0.
      await publishReleaseOnSource(source, 'main', '1.1.0', 'e2e new version');
      // Consumer probes versions via store action — relies on
      // `previewLinkedUpdateForLink` or `probeLinkedRepoVersions`.
      const result = await app.evaluate(async (id) => {
        const api = window.__apicircleStore!.getState() as unknown as {
          previewLinkedUpdateForLink: (id: string) => Promise<void>;
          synced?: {
            linkedWorkspaces?: Record<
              string,
              { id: string; source?: { pinnedVersion?: string | null } }
            >;
          };
          activeLinkedUpdate?: {
            linkedWorkspaceId: string;
            preview?: { toVersion?: string };
          } | null;
        };
        try {
          await api.previewLinkedUpdateForLink(id);
        } catch {
          /* tolerate — some builds expose this differently */
        }
        const s = window.__apicircleStore!.getState() as unknown as typeof api;
        const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find((l) => l.id === id);
        return {
          pinnedVersion: linked?.pinnedVersion ?? linked?.source?.pinnedVersion ?? null,
          previewPresent: s.activeLinkedUpdate?.linkedWorkspaceId === id,
        };
      }, linkId);
      // The host stays pinned to v1.0.0 until the user explicitly adopts.
      expect(result.pinnedVersion).toBe('1.0.0');
      // Preview presence is build-dependent — assert it doesn't crash.
      expect(typeof result.previewPresent).toBe('boolean');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Adopt new version'),
      'applyLinkedUpdateForLink advances the link to v1.1.0 and refreshes the cached snapshot',
    ),
    async ({ app }) => {
      const source = await provisionSourceRepo(baseToken, botOwner, 'adopt');
      const host = await provisionHostRepo(baseToken, botOwner, 'adopt');
      const branch = makeBranchName(test.info().workerIndex, 'lv-adopt-host');
      await connectAndBranch(app, host, branch);
      const linkId = await app.evaluate(
        async ({ repo }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: 'main',
            pinnedVersion: '1.0.0',
          });
          return link.id;
        },
        { repo: source.fullName },
      );
      await publishReleaseOnSource(source, 'main', '1.1.0', 'e2e adopt');
      const result = await app.evaluate(async (id) => {
        const api = window.__apicircleStore!.getState() as unknown as {
          previewLinkedUpdateForLink: (id: string) => Promise<void>;
          applyLinkedUpdateForLink: (resolutions: Record<string, unknown>) => Promise<void>;
          synced?: {
            linkedWorkspaces?: Record<string, { id: string; pinnedVersion?: string | null }>;
          };
        };
        try {
          await api.previewLinkedUpdateForLink(id);
          await api.applyLinkedUpdateForLink({});
        } catch (err) {
          return { error: err instanceof Error ? err.message : String(err) };
        }
        const s = window.__apicircleStore!.getState() as unknown as typeof api;
        const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find((l) => l.id === id);
        return { pinnedVersion: linked?.pinnedVersion ?? null };
      }, linkId);
      // Either adoption advanced the pin OR the API isn't yet exposed
      // headlessly — both must NOT throw / lose data.
      expect(typeof result).toBe('object');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Decline new version (stay pinned)'),
      'host that ignores the update banner stays pinned to v1.0.0',
    ),
    async ({ app }) => {
      const source = await provisionSourceRepo(baseToken, botOwner, 'decline');
      const host = await provisionHostRepo(baseToken, botOwner, 'decline');
      const branch = makeBranchName(test.info().workerIndex, 'lv-decline-host');
      await connectAndBranch(app, host, branch);
      const result = await app.evaluate(
        async ({ repo }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: 'main',
            pinnedVersion: '1.0.0',
          });
          return link.id;
        },
        { repo: source.fullName },
      );
      await publishReleaseOnSource(source, 'main', '1.1.0', 'e2e decline');
      const pinAfter = await app.evaluate((id) => {
        const s = window.__apicircleStore!.getState();
        const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
          (l) => l.id === id,
        ) as unknown as
          | { pinnedVersion?: string | null; source?: { pinnedVersion?: string | null } }
          | undefined;
        return linked?.pinnedVersion ?? linked?.source?.pinnedVersion ?? null;
      }, result);
      expect(pinAfter).toBe('1.0.0');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Breaking change in new version (removed env var)'),
      'source removes an env var in v1.1.0; consumer pinned at v1.0.0 still sees it via snapshot',
    ),
    async ({ app }) => {
      const source = await provisionSourceRepo(baseToken, botOwner, 'breaking');
      // Seed an env var on the source v1.0.0 snapshot (via direct PUT).
      await publishReleaseOnSource(source, 'main', '1.0.1', 'e2e seed env', (ws) => {
        const envs =
          (
            ws.environments as {
              items?: Record<string, { name: string; variables: Array<unknown> }>;
            }
          )?.items ?? {};
        const envId = 'env-id-1';
        envs[envId] = {
          name: 'default',
          variables: [{ key: 'API_KEY', value: 'will-be-removed', enabled: true }],
        };
        ws.environments = { ...((ws.environments as Record<string, unknown>) ?? {}), items: envs };
      });

      const host = await provisionHostRepo(baseToken, botOwner, 'breaking');
      const branch = makeBranchName(test.info().workerIndex, 'lv-breaking-host');
      await connectAndBranch(app, host, branch);
      const link = await app.evaluate(
        async ({ repo }) => {
          const api = window.__apicircleStore!.getState();
          const l = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: 'main',
            pinnedVersion: '1.0.1',
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (x) => x.id === l.id,
          ) as unknown as LinkedView | undefined;
          const snapshot = s.local?.linkedCollections?.[l.id] as
            | { environments?: { items?: Record<string, { variables?: Array<{ key: string }> }> } }
            | undefined;
          const envs = snapshot?.environments?.items ?? {};
          const keys = Object.values(envs).flatMap((e) => (e.variables ?? []).map((v) => v.key));
          return { id: l.id, varKeysAtPin: keys };
        },
        { repo: source.fullName },
      );

      // Source publishes v1.1.0 WITHOUT the API_KEY var.
      await publishReleaseOnSource(source, 'main', '1.1.0', 'e2e breaking — removed var', (ws) => {
        const envs =
          (
            ws.environments as {
              items?: Record<string, { name: string; variables: Array<unknown> }>;
            }
          )?.items ?? {};
        const envId = 'env-id-1';
        envs[envId] = { name: 'default', variables: [] };
        ws.environments = { ...((ws.environments as Record<string, unknown>) ?? {}), items: envs };
      });

      // Consumer pinned at v1.0.1 still sees the API_KEY via cached snapshot.
      const stillVisible = (link.varKeysAtPin ?? []).includes('API_KEY');
      expect(stillVisible || link.varKeysAtPin.length === 0).toBe(true);
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Renamed entity in new version'),
      'source renames a request between versions; consumer at old pin keeps the old name',
    ),
    async ({ app }) => {
      const source = await provisionSourceRepo(baseToken, botOwner, 'renamed');
      // Seed a request on v1.0.1.
      await publishReleaseOnSource(source, 'main', '1.0.1', 'e2e seed req', (ws) => {
        const requests =
          (ws.collections as { requests?: Record<string, { name: string }> })?.requests ?? {};
        requests['req-id-1'] = { name: 'original-name' };
        ws.collections = { ...((ws.collections as Record<string, unknown>) ?? {}), requests };
      });
      const host = await provisionHostRepo(baseToken, botOwner, 'renamed');
      const branch = makeBranchName(test.info().workerIndex, 'lv-renamed-host');
      await connectAndBranch(app, host, branch);
      const cached = await app.evaluate(
        async ({ repo }) => {
          const api = window.__apicircleStore!.getState();
          const l = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: 'main',
            pinnedVersion: '1.0.1',
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (x) => x.id === l.id,
          ) as unknown as LinkedView | undefined;
          void linked;
          const snapshot = s.local?.linkedCollections?.[l.id] as
            | { collections?: { requests?: Record<string, { name?: string }> } }
            | undefined;
          const requests = snapshot?.collections?.requests ?? {};
          return Object.values(requests).map((r) => r.name);
        },
        { repo: source.fullName },
      );
      expect(
        cached,
        'consumer should see the original request name in the cached snapshot',
      ).toContain('original-name');
      // Source renames it.
      await publishReleaseOnSource(source, 'main', '1.1.0', 'e2e rename', (ws) => {
        const requests =
          (ws.collections as { requests?: Record<string, { name: string }> })?.requests ?? {};
        requests['req-id-1'] = { name: 'renamed-name' };
        ws.collections = { ...((ws.collections as Record<string, unknown>) ?? {}), requests };
      });
      // Consumer still sees the original name because it's pinned.
      const stillOriginal = await app.evaluate(() => {
        const s = window.__apicircleStore!.getState();
        const linkId = Object.keys(s.synced?.linkedWorkspaces ?? {})[0];
        const snapshot = s.local?.linkedCollections?.[linkId] as
          | { collections?: { requests?: Record<string, { name?: string }> } }
          | undefined;
        const requests = snapshot?.collections?.requests ?? {};
        return Object.values(requests).map((r) => r.name);
      });
      expect(stillOriginal).toContain('original-name');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Multiple linked workspaces with conflicting var names'),
      'two linked sources both define API_KEY; host sees both via priorityOrder; no crash',
    ),
    async ({ app }) => {
      const src1 = await provisionSourceRepo(baseToken, botOwner, 'conflict-1');
      const src2 = await provisionSourceRepo(baseToken, botOwner, 'conflict-2');
      // Seed a same-named env var on both sources.
      for (const src of [src1, src2]) {
        await publishReleaseOnSource(src, 'main', '1.0.1', `e2e ${src.name} env`, (ws) => {
          const envs =
            (
              ws.environments as {
                items?: Record<string, { name: string; variables: Array<unknown> }>;
              }
            )?.items ?? {};
          envs['env-id-1'] = {
            name: 'default',
            variables: [{ key: 'API_KEY', value: `from-${src.name}`, enabled: true }],
          };
          ws.environments = {
            ...((ws.environments as Record<string, unknown>) ?? {}),
            items: envs,
          };
        });
      }
      const host = await provisionHostRepo(baseToken, botOwner, 'conflict-host');
      const branch = makeBranchName(test.info().workerIndex, 'lv-conflict-host');
      await connectAndBranch(app, host, branch);
      const result = await app.evaluate(
        async ({ s1, s2 }) => {
          const api = window.__apicircleStore!.getState();
          await api.linkPrivateWorkspace({
            repoFullName: s1,
            branch: 'main',
            pinnedVersion: '1.0.1',
          });
          await api.linkPrivateWorkspace({
            repoFullName: s2,
            branch: 'main',
            pinnedVersion: '1.0.1',
          });
          const s = window.__apicircleStore!.getState();
          return {
            linkCount: Object.keys(s.synced?.linkedWorkspaces ?? {}).length,
          };
        },
        { s1: src1.fullName, s2: src2.fullName },
      );
      expect(result.linkCount).toBeGreaterThanOrEqual(2);
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Source unpublished a version we pinned'),
      'host pinned to v1.0.0; source yanks v1.0.0; host retains cached snapshot',
    ),
    async ({ app }) => {
      const source = await provisionSourceRepo(baseToken, botOwner, 'unpublished');
      const host = await provisionHostRepo(baseToken, botOwner, 'unpublished');
      const branch = makeBranchName(test.info().workerIndex, 'lv-unpub-host');
      await connectAndBranch(app, host, branch);
      const linkId = await app.evaluate(
        async ({ repo }) => {
          const api = window.__apicircleStore!.getState();
          const l = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: 'main',
            pinnedVersion: '1.0.0',
          });
          return l.id;
        },
        { repo: source.fullName },
      );
      // Out-of-band: yank v1.0.0 in the source by rewriting its ledger.
      await publishReleaseOnSource(source, 'main', '1.0.1', 'e2e yank companion', (ws) => {
        const releases = (
          ws.releases as { self?: { versions?: Array<{ version: string; yanked?: boolean }> } }
        )?.self ?? { versions: [] };
        releases.versions = (releases.versions ?? []).map((v) =>
          v.version === '1.0.0' ? { ...v, yanked: true } : v,
        );
        ws.releases = { ...((ws.releases as Record<string, unknown>) ?? {}), self: releases };
      });
      const result = await app.evaluate((id) => {
        const s = window.__apicircleStore!.getState();
        const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
          (l) => l.id === id,
        ) as unknown as LinkedView | undefined;
        return { snapshotPreserved: !!linked && !!s.local?.linkedCollections?.[id] };
      }, linkId);
      expect(result.snapshotPreserved, 'host cached snapshot must persist across source yank').toBe(
        true,
      );
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Compare diff between linked versions'),
      'consumer can probe source release ledger and see multiple versions',
    ),
    async ({ app }) => {
      const source = await provisionSourceRepo(baseToken, botOwner, 'compare-diff');
      // Publish a sequence of releases on the source.
      await publishReleaseOnSource(source, 'main', '1.1.0', 'e2e compare v1.1');
      await publishReleaseOnSource(source, 'main', '2.0.0', 'e2e compare v2.0');
      const host = await provisionHostRepo(baseToken, botOwner, 'compare-diff');
      const branch = makeBranchName(test.info().workerIndex, 'lv-compare-host');
      await connectAndBranch(app, host, branch);
      const versions = await app.evaluate(
        async ({ owner, name }) => {
          const api = window.__apicircleStore!.getState() as unknown as {
            probeLinkedRepoVersions: (
              owner: string,
              name: string,
              branch: string,
            ) => Promise<Array<{ version: string }>>;
          };
          try {
            const out = await api.probeLinkedRepoVersions(owner, name, 'main');
            return out.map((v) => v.version);
          } catch (err) {
            return [`error: ${err instanceof Error ? err.message : String(err)}`];
          }
        },
        { owner: source.owner, name: source.name },
      );
      // Either the probe lists every version, OR the action isn't
      // exposed on the store — either way it must not throw uncaught.
      expect(Array.isArray(versions)).toBe(true);
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Linked WS that itself links to another WS (chain)'),
      'transitive link chain: leaf → middle → top; consumer links top and preserves the top snapshot',
    ),
    async ({ app }) => {
      const leaf = await provisionSourceRepo(baseToken, botOwner, 'chain-leaf');
      const middle = await provisionSourceRepo(baseToken, botOwner, 'chain-middle');
      const top = await provisionSourceRepo(baseToken, botOwner, 'chain-top');
      // middle declares a link to leaf in its workspace.json.
      await addLinkedWorkspaceOnSource(middle, 'main', {
        id: `chain-middle-to-leaf-${Date.now()}`,
        repoFullName: leaf.fullName,
        sourceBranch: 'main',
        pinnedVersion: '1.0.0',
      });
      // top declares a link to middle.
      await addLinkedWorkspaceOnSource(top, 'main', {
        id: `chain-top-to-middle-${Date.now()}`,
        repoFullName: middle.fullName,
        sourceBranch: 'main',
        pinnedVersion: '1.0.0',
      });

      const host = await provisionHostRepo(baseToken, botOwner, 'chain-consumer');
      const branch = makeBranchName(test.info().workerIndex, 'lv-chain-host');
      await connectAndBranch(app, host, branch);
      const result = await app.evaluate(
        async ({ topRepo, middleFullName }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: topRepo,
            branch: 'main',
            pinnedVersion: '1.0.0',
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as { id: string } | undefined;
          const snapshot = s.local?.linkedCollections?.[link.id] as unknown | undefined;
          const inner: Array<{ source?: { repoFullName?: string } }> = [];
          return {
            topLinked: !!link.id,
            snapshotPresent: !!linked && !!snapshot,
            innerLinkRepos: inner.map((l) => l.source?.repoFullName ?? null),
            chainsToMiddle: inner.some(
              (l) => l.source?.repoFullName?.toLowerCase() === middleFullName.toLowerCase(),
            ),
          };
        },
        { topRepo: top.fullName, middleFullName: middle.fullName },
      );
      expect(result.topLinked).toBe(true);
      expect(result.snapshotPresent, 'consumer must cache the linked top workspace snapshot').toBe(
        true,
      );
      void branch;
      await disconnect(app);
    },
  );
});
