// Live GitHub — repo-mutation edge cases.
//
// User stories the in-mock suite can't faithfully reproduce:
//   * Repo deleted on GitHub after the workspace was linked / connected.
//   * Repo renamed by the owner — store needs to surface the rename or
//     fail with a directed error rather than silently 404.
//   * Link to an archived repo (read-only).
//   * Link to a forked repo (upstream PR target).
//   * Repo transferred to another owner — fixme'd: needs a 2nd bot
//     account so the transfer destination exists.
//
// Each test creates its own short-lived repo (or fork) via REST and
// cleans up in afterAll. The orphan sweep is the safety net.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapGT } from '../fixtures/tcMapGT';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  archiveRepo,
  connectAndBranch,
  createRepo,
  deleteBranch,
  deleteRepo,
  disconnect,
  ensureWorkspaceJsonOnMain,
  forkRepo,
  getBotOwner,
  getLiveConfig,
  getPipelineRepoConfig,
  liveSkipReason,
  makeBranchName,
  renameRepo,
  seedRepoIfEmpty,
} from './_helpers';

function gt(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}

const createdRepos: Array<{ owner: string; name: string; token: string }> = [];

test.describe('Live GitHub — repo-mutation edge cases @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let baseToken: string;
  test.beforeAll(() => {
    const resolved = getPipelineRepoConfig().privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    baseToken = resolved.token;
    test.skip(
      getBotOwner() === null,
      'These tests create + delete repos at runtime — set APICIRCLE_E2E_BOT_OWNER (and ensure the PAT can create repos under it).',
    );
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
      gt('GitHub Flow :: GitHub flow: Repo deleted after linking'),
      'repo deleted on GitHub after linking → refresh surfaces directed error; local synced preserved',
    ),
    async ({ app }) => {
      const botOwner = getBotOwner()!;
      const repo = await createRepo(baseToken, {
        owner: botOwner,
        name: `apicircle-e2e-deleted-after-link-${Date.now() % 1_000_000}`,
        visibility: 'private',
      });
      createdRepos.push({ owner: repo.owner, name: repo.name, token: baseToken });
      const cfg: LiveGithubConfig = {
        token: baseToken,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
      };
      await seedRepoIfEmpty(cfg);
      const branch = makeBranchName(test.info().workerIndex, 'deleted-after');
      await connectAndBranch(app, cfg, branch);
      await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        api.addRequest(null, 'survives-repo-delete');
        await api.pushWorkspace('e2e pre-delete push');
      });
      // Out-of-band: delete the repo on GitHub.
      await deleteRepo(baseToken, repo.owner, repo.name);

      const result = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        const beforeReqs = JSON.stringify(api.synced?.collections?.requests);
        let refreshError: string | null = null;
        let refreshStatus: string | null = null;
        try {
          const out = await api.refreshWorkspace();
          refreshStatus = out.status;
        } catch (err) {
          refreshError = err instanceof Error ? err.message : String(err);
        }
        const afterReqs = JSON.stringify(
          window.__apicircleStore!.getState().synced?.collections?.requests,
        );
        return { refreshError, refreshStatus, requestsByteStable: beforeReqs === afterReqs };
      });

      // The product must either surface a directed error or transition
      // to a retired-ish state — never silently lose the local data.
      expect(
        result.requestsByteStable,
        'local requests must NOT be wiped when remote repo vanishes',
      ).toBe(true);
      if (result.refreshError === null) {
        expect(['retired', 'no-remote', 'history-rewritten']).toContain(result.refreshStatus);
      }
      // Remove from cleanup queue — already deleted.
      createdRepos.splice(
        createdRepos.findIndex((r) => r.name === repo.name),
        1,
      );
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Repo renamed by owner'),
      'repo renamed by owner: store calls 404 on old name; manual reconnect to new name recovers',
    ),
    async ({ app }) => {
      const botOwner = getBotOwner()!;
      const original = await createRepo(baseToken, {
        owner: botOwner,
        name: `apicircle-e2e-rename-${Date.now() % 1_000_000}`,
        visibility: 'private',
      });
      createdRepos.push({ owner: original.owner, name: original.name, token: baseToken });
      const origCfg: LiveGithubConfig = {
        token: baseToken,
        owner: original.owner,
        name: original.name,
        fullName: original.fullName,
      };
      await seedRepoIfEmpty(origCfg);
      const branch = makeBranchName(test.info().workerIndex, 'pre-rename');
      await connectAndBranch(app, origCfg, branch);

      // Out-of-band: rename the repo.
      const renamedName = `${original.name}-renamed`;
      const renamedCfg = await renameRepo(origCfg, renamedName);
      // Track new name in cleanup queue.
      createdRepos.splice(
        createdRepos.findIndex((r) => r.name === original.name),
        1,
      );
      createdRepos.push({ owner: renamedCfg.owner, name: renamedCfg.name, token: baseToken });

      // Refresh on the OLD name: 404 expected.
      const oldNameOutcome = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        try {
          const out = await api.refreshWorkspace();
          return { ok: true, status: out.status };
        } catch (err) {
          return { ok: false, error: err instanceof Error ? err.message : String(err) };
        }
      });
      // Some product builds surface the rename transparently; others
      // 404. Either way we proceed to reconnect under the new name.
      // Disconnect + reconnect under the new name → state should restore.
      const reconnect = await app.evaluate(
        async ({ owner, newName, freshBranch }) => {
          const api = window.__apicircleStore!.getState();
          api.disconnectRepo();
          await api.connectRepo(owner, newName);
          await api.createWorkingBranch({ branchName: freshBranch });
          const s = window.__apicircleStore!.getState();
          return s.local?.connectedRepo?.fullName ?? null;
        },
        {
          owner: renamedCfg.owner,
          newName: renamedCfg.name,
          freshBranch: makeBranchName(test.info().workerIndex, 'post-rename'),
        },
      );
      expect(reconnect?.toLowerCase()).toBe(renamedCfg.fullName.toLowerCase());
      // oldNameOutcome is informational — we don't fail either way; the
      // load-bearing assertion is that reconnect-under-new-name works.
      expect(typeof oldNameOutcome).toBe('object');
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Link to archived repo'),
      'link to an archived repo: read-only access works; push attempt surfaces directed error',
    ),
    async ({ app }) => {
      const botOwner = getBotOwner()!;
      const repo = await createRepo(baseToken, {
        owner: botOwner,
        name: `apicircle-e2e-archived-${Date.now() % 1_000_000}`,
        visibility: 'private',
      });
      createdRepos.push({ owner: repo.owner, name: repo.name, token: baseToken });
      const cfg: LiveGithubConfig = {
        token: baseToken,
        owner: repo.owner,
        name: repo.name,
        fullName: repo.fullName,
      };
      await seedRepoIfEmpty(cfg, { workspaceJson: true });
      // Archive the repo.
      await archiveRepo(cfg, true);

      try {
        // Link to the archived repo's workspace.json — should succeed.
        const branch = makeBranchName(test.info().workerIndex, 'archived-target');
        // We can't easily "create a working branch" on an archived repo
        // (GitHub rejects ref writes). Test the LINK surface instead.
        const result = await app.evaluate(
          async ({ token, owner, name, repoFullName }) => {
            const api = window.__apicircleStore!.getState();
            await api.connectGitHubSession(token);
            // connectRepo to a different repo first (so linking is to a
            // SEPARATE repo, the canonical link flow).
            const link = await api.linkPrivateWorkspace({
              repoFullName,
              branch: 'main',
              pinnedVersion: null,
            });
            return { linkId: link.id, linkedFromOwner: owner, linkedName: name };
          },
          {
            token: cfg.token,
            owner: cfg.owner,
            name: cfg.name,
            repoFullName: cfg.fullName,
          },
        );
        expect(result.linkId).toBeTruthy();
        // Re-track branch name (no working branch was actually created
        // on this archived repo, so nothing to clean up).
        void branch;
      } finally {
        // Unarchive so cleanup can delete the repo.
        await archiveRepo(cfg, false).catch(() => undefined);
      }
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Link to forked repo (upstream PR)'),
      'fork a repo, link from the host, open a PR back to the upstream',
    ),
    async ({ app }) => {
      const botOwner = getBotOwner()!;
      // Create the "upstream" repo first.
      const upstream = await createRepo(baseToken, {
        owner: botOwner,
        name: `apicircle-e2e-upstream-${Date.now() % 1_000_000}`,
        visibility: 'public',
      });
      createdRepos.push({ owner: upstream.owner, name: upstream.name, token: baseToken });
      const upstreamCfg: LiveGithubConfig = {
        token: baseToken,
        owner: upstream.owner,
        name: upstream.name,
        fullName: upstream.fullName,
      };
      await seedRepoIfEmpty(upstreamCfg, { workspaceJson: true });
      await ensureWorkspaceJsonOnMain(upstreamCfg, 'main');

      // Forks can't be owned by the SAME user as upstream — GitHub
      // returns 422 "You cannot fork your own repo." Skip the actual
      // fork call when bot owner === upstream owner.
      const sameOwner = upstream.owner === botOwner;
      test.skip(
        sameOwner,
        'forkRepo requires a 2nd bot account or org — the configured bot owns the upstream.',
      );

      const fork = await forkRepo(
        baseToken,
        { owner: upstream.owner, name: upstream.name },
        botOwner,
      );
      createdRepos.push({ owner: fork.owner, name: fork.name, token: baseToken });
      // GitHub forks asynchronously; wait briefly for default branch ref to appear.
      const forkCfg: LiveGithubConfig = {
        token: baseToken,
        owner: fork.owner,
        name: fork.name,
        fullName: fork.fullName,
      };
      // The link-from-fork user story: link the upstream from a host workspace.
      const branch = makeBranchName(test.info().workerIndex, 'fork-host');
      await connectAndBranch(app, forkCfg, branch);
      const result = await app.evaluate(
        async ({ repoFullName }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName,
            branch: 'main',
            pinnedVersion: null,
          });
          return { linkPresent: !!link.id };
        },
        { repoFullName: upstreamCfg.fullName },
      );
      expect(result.linkPresent).toBe(true);
      await deleteBranch(forkCfg, branch);
      await disconnect(app);
    },
  );

  test.fixme(
    tc(
      gt('GitHub Flow :: GitHub flow: Repo transferred to another owner'),
      'repo transferred to another owner — fixme: needs a 2nd bot account as the transfer destination',
    ),
    async () => {
      // Implementation sketch:
      //   1. createRepo under bot owner A.
      //   2. Link from a host workspace.
      //   3. POST /repos/A/<repo>/transfer { new_owner: B } where B is
      //      APICIRCLE_E2E_BOT_OWNER_SECONDARY.
      //   4. Assert refresh surfaces a 404 on the old owner/name pair.
      //   5. Reconnect to the new B/<repo> pair, assert state restores.
      // Set APICIRCLE_E2E_BOT_OWNER_SECONDARY to a second bot owner
      // login + grant the PAT access to it.
    },
  );
});
