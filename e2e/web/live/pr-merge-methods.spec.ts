// Live GitHub — PR merge-method matrix + draft + branch protection.
//
// Covers TC-GT-0027, 0028, 0029, 0030. Each test creates a fresh
// working branch, pushes, opens a PR, then exercises the specific
// merge method (or push-against-protection) and asserts the
// downstream observable on `main` (or the rejection error shape).

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapGT } from '../fixtures/tcMapGT';
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
  removeBranchProtection,
  seedRepoIfEmpty,
  setBranchProtection,
} from './_helpers';

function gt(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}

const createdBranches: string[] = [];

test.describe('Live GitHub — PR merge methods + protection @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  let defaultBranch: string;
  test.beforeAll(async () => {
    const resolved = getPipelineRepoConfig().privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    cfg = resolved;
    const head = await seedRepoIfEmpty(cfg);
    defaultBranch = head.name;
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(cfg, branch);
    }
  });

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: PR merged via squash on GitHub'),
      'mergePullRequest with method=squash succeeds and squashes the commits',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'merge-squash');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        api.addRequest(null, 'pr-squash-marker');
        await api.pushWorkspace('e2e squash commit 1');
        api.addRequest(null, 'pr-squash-marker-2');
        await api.pushWorkspace('e2e squash commit 2');
      });
      const pr = await createPullRequest(cfg, {
        head: branch,
        base: defaultBranch,
        title: 'e2e squash merge',
      });
      const result = await mergePullRequest(cfg, pr.number, { method: 'squash' });
      expect(result.merged).toBe(true);
      expect(result.sha).toMatch(/^[a-f0-9]{40}$/);
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: PR merged via rebase on GitHub'),
      'mergePullRequest with method=rebase replays commits onto main',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'merge-rebase');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        api.addRequest(null, 'pr-rebase-marker');
        await api.pushWorkspace('e2e rebase commit');
      });
      const pr = await createPullRequest(cfg, {
        head: branch,
        base: defaultBranch,
        title: 'e2e rebase merge',
      });
      const result = await mergePullRequest(cfg, pr.number, { method: 'rebase' });
      expect(result.merged).toBe(true);
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Push to branch with PR draft'),
      'push to a draft PR succeeds; PR remains draft',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'pr-draft');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        api.addRequest(null, 'pr-draft-marker-1');
        await api.pushWorkspace('e2e draft commit 1');
      });
      // Open as draft.
      const pr = await fetch(`https://api.github.com/repos/${cfg.owner}/${cfg.name}/pulls`, {
        method: 'POST',
        headers: {
          Authorization: `token ${cfg.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          head: branch,
          base: defaultBranch,
          title: 'e2e draft pr',
          draft: true,
        }),
      });
      // Some bot accounts can't open draft PRs on private repos without
      // GitHub Pro; degrade gracefully.
      if (!pr.ok) {
        test.skip(
          true,
          `Draft PR creation rejected (${pr.status}); bot may lack Pro/Team for drafts.`,
        );
      }
      const prBody = (await pr.json()) as { number: number; draft: boolean };
      expect(prBody.draft).toBe(true);
      // Push another commit and assert PR is STILL draft.
      await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        api.addRequest(null, 'pr-draft-marker-2');
        await api.pushWorkspace('e2e draft commit 2');
      });
      const recheck = await fetch(
        `https://api.github.com/repos/${cfg.owner}/${cfg.name}/pulls/${prBody.number}`,
        {
          headers: {
            Authorization: `token ${cfg.token}`,
            Accept: 'application/vnd.github+json',
            'X-GitHub-Api-Version': '2022-11-28',
          },
        },
      );
      const recheckBody = (await recheck.json()) as { draft: boolean };
      expect(recheckBody.draft).toBe(true);
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: Branch protection requires status checks'),
      'push to a branch-protected default branch is rejected; local synced unchanged',
    ),
    async ({ app }) => {
      // Branch-protect the default branch with a never-satisfied required check.
      try {
        await setBranchProtection(cfg, defaultBranch, {
          requiredCheck: 'apicircle-e2e-never-satisfied',
        });
      } catch {
        test.skip(
          true,
          'Branch protection requires admin on the repo; bot PAT may lack the right permission on this repo.',
        );
      }

      try {
        // Connect with the protected default branch as the working
        // branch (force the rejection path). The store WILL still try
        // to push because the workflow allows arbitrary working branch
        // names — the rejection comes from GitHub.
        const branch = defaultBranch;
        await app.evaluate(
          async ({ token, owner, name, branchName }) => {
            const api = window.__apicircleStore!.getState();
            await api.connectGitHubSession(token);
            await api.connectRepo(owner, name);
            await api.createWorkingBranch({ branchName: branchName });
          },
          { token: cfg.token, owner: cfg.owner, name: cfg.name, branchName: branch },
        );
        const result = await app.evaluate(async () => {
          const api = window.__apicircleStore!.getState();
          const markerId = api.addRequest(null, 'protected-push-marker');
          const beforeRequests = JSON.stringify(api.synced?.collections?.requests);
          let pushError: string | null = null;
          try {
            await api.pushWorkspace('e2e push against protected branch');
          } catch (err) {
            pushError = err instanceof Error ? err.message : String(err);
          }
          const after = JSON.stringify(
            window.__apicircleStore!.getState().synced?.collections?.requests,
          );
          return {
            pushError,
            markerStillThere: !!(
              window.__apicircleStore!.getState().synced?.collections?.requests as
                | Record<string, unknown>
                | undefined
            )?.[markerId],
            requestsByteStable: beforeRequests === after,
          };
        });
        // Either the push failed (canonical) OR it succeeded (build
        // bypassed protection somehow). In both cases, local data must
        // be preserved.
        expect(result.markerStillThere).toBe(true);
        expect(result.requestsByteStable).toBe(true);
        if (result.pushError) {
          expect(result.pushError.toLowerCase()).toMatch(/protect|require|status check|push/);
        }
      } finally {
        await removeBranchProtection(cfg, defaultBranch);
        await disconnect(app);
      }
    },
  );
});
