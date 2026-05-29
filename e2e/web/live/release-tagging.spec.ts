// Live GitHub — release tagging on real main + repo-topic round-trip.
//
// Builds on the cycle spec: once a release entry exists in
// `workspace.json` on main (the cycle spec leaves that state), the
// release-tagging flow can create a Git tag + GitHub Release pointed
// at main's HEAD. We also exercise repo-topics (the public-discovery
// surface) round-trip end-to-end:
//
//   * listRepoTopics → returns whatever's currently set.
//   * setRepoTopics(['apicircle', 'e2e']) — assert PUT succeeds.
//   * listRepoTopics again — returns the same set.
//   * Cleanup in afterAll: setRepoTopics([]) on the public repo so the
//     ephemeral repo doesn't get marketplace-discovered for the few
//     hours before pipeline teardown.
//
// Public-repo only for the topic story — private repos can carry
// topics but aren't marketplace-discoverable, so the user story
// doesn't apply.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapLV } from '../fixtures/tcMapLV';
import { tcMapSE } from '../fixtures/tcMapSE';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  createPullRequest,
  deleteBranch,
  disconnect,
  getLiveConfig,
  getPipelineRepoConfig,
  liveSkipReason,
  makeBranchName,
  mergePullRequest,
  seedRepoIfEmpty,
} from './_helpers';

function lv(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}
function se(key: string): TcId {
  const v = tcMapSE[key];
  if (!v) throw new Error(`No TC-SE entry for "${key}"`);
  return v;
}

const createdBranches: string[] = [];

test.describe('Live GitHub — release tagging & topics @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  let pubCfg: LiveGithubConfig | null;
  let defaultBranch: string;
  const releaseVersion = `1.0.${Date.now() % 1_000_000}`;
  test.beforeAll(async () => {
    const pipe = getPipelineRepoConfig();
    const resolved = pipe.privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    cfg = resolved;
    pubCfg = pipe.publicRepo;
    const head = await seedRepoIfEmpty(cfg);
    defaultBranch = head.name;
  });

  test.afterAll(async () => {
    // Cleanup: drop ephemeral topics on the public repo so we don't
    // pollute the marketplace discovery surface between runs.
    if (pubCfg) {
      try {
        await fetch(`https://api.github.com/repos/${pubCfg.owner}/${pubCfg.name}/topics`, {
          method: 'PUT',
          headers: {
            Authorization: `token ${pubCfg.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ names: [] }),
        });
      } catch {
        /* best-effort */
      }
    }
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(cfg, branch);
    }
  });

  test(
    tc(
      lv('Release notes Markdown rendered'),
      'tagReleaseVersion creates refs/tags/vX.Y.Z + a GitHub Release pointed at main HEAD',
    ),
    async ({ app }) => {
      // Seed a release on a working branch + merge to main first.
      const branch = makeBranchName(test.info().workerIndex, 'tag-prep');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      await app.evaluate(
        async ({ version }) => {
          const api = window.__apicircleStore!.getState();
          await api.publishRelease({ version, notes: `e2e tag prep ${version}` });
          await api.pushWorkspace(`e2e tag prep ${version}`);
        },
        { version: releaseVersion },
      );
      const pr = await createPullRequest(cfg, {
        head: branch,
        base: defaultBranch,
        title: `e2e tag prep ${releaseVersion}`,
      });
      const merge = await mergePullRequest(cfg, pr.number);
      expect(merge.merged).toBe(true);

      // Now `tagReleaseVersion` should resolve main HEAD → tag → release.
      const result = await app.evaluate(
        async ({ version }) => {
          const api = window.__apicircleStore!.getState();
          // Refresh first so workingBranch is cleared (PR merged).
          await api.refreshWorkspace().catch(() => undefined);
          try {
            const tag = await (
              api as unknown as {
                tagReleaseVersion: (a: {
                  version: string;
                  notes?: string;
                  createGitHubRelease?: boolean;
                }) => Promise<{
                  tagRef: string;
                  sha: string;
                  releaseUrl?: string;
                }>;
              }
            ).tagReleaseVersion({
              version,
              notes: `e2e tag ${version}`,
              createGitHubRelease: true,
            });
            return {
              ok: true,
              tagRef: tag.tagRef,
              sha: tag.sha,
              releaseUrl: tag.releaseUrl ?? null,
            };
          } catch (err) {
            return {
              ok: false,
              error: err instanceof Error ? err.message : String(err),
              tagRef: null,
              sha: null,
              releaseUrl: null,
            };
          }
        },
        { version: releaseVersion },
      );
      expect(
        result.ok,
        result.ok ? '' : `tagReleaseVersion failed: ${(result as { error?: string }).error}`,
      ).toBe(true);
      expect(result.tagRef).toContain(releaseVersion);
      expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
      // releaseUrl is only set when createGitHubRelease succeeded.
      expect(result.releaseUrl).toBeTruthy();
      await disconnect(app);
    },
  );

  test(
    tc(
      se('Marketplace :: Link public workspace'),
      'setRepoTopics + listRepoTopics round-trip on the PUBLIC repo (marketplace discovery surface)',
    ),
    async ({ app }) => {
      test.skip(
        pubCfg === null,
        'Set APICIRCLE_E2E_PIPELINE_PUBLIC_REPO to exercise repo-topics round-trip.',
      );
      const branch = makeBranchName(test.info().workerIndex, 'topics');
      createdBranches.push(branch);
      // We connect to the PUBLIC repo for this test specifically.
      await app.evaluate(
        async ({ token, owner, name, branchName }) => {
          const api = window.__apicircleStore!.getState();
          await api.connectGitHubSession(token);
          await api.connectRepo(owner, name);
          await api.createWorkingBranch({ branchName: branchName });
        },
        { token: pubCfg!.token, owner: pubCfg!.owner, name: pubCfg!.name, branchName: branch },
      );

      const result = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState() as unknown as {
          listRepoTopics: () => Promise<string[]>;
          setRepoTopics: (topics: string[]) => Promise<string[]>;
        };
        const initial = await api.listRepoTopics();
        const desired = ['apicircle', 'e2e-test'];
        const persisted = await api.setRepoTopics(desired);
        const reload = await api.listRepoTopics();
        return { initial, persisted, reload };
      });
      expect(result.persisted).toEqual(expect.arrayContaining(['apicircle', 'e2e-test']));
      expect(result.reload).toEqual(expect.arrayContaining(['apicircle', 'e2e-test']));
      await disconnect(app);
    },
  );
});
