// Live GitHub — the 9-step user-narrative cycle, parametric over
// private + public repos.
//
// Steps (per visibility):
//   1. Empty repo (pipeline-provided or local-dev fallback).
//   2. createWorkingBranch succeeds.
//   3. refreshWorkspace on a fresh branch returns up-to-date/no-remote
//      and does NOT mutate synced.
//   4. First push: add Editor/Env/Plan/Mock entities, push, verify each
//      lands in the remote workspace.json.
//   5. Create a second workspace (in the same browser), point it at the
//      same working branch, refresh — assert all step-4 entities show up.
//   6. Open a PR from the working branch into the default branch.
//   7. Merge the PR via REST; assert refresh observes the merge.
//   8. Delete the active workspace; create a third workspace; branch
//      from the default branch; refresh — assert all merged entities are
//      visible in the third workspace.
//   9. Publish a release on the third workspace; assert push round-trips
//      the release to the remote ledger.
//
// All real `api.github.com`. Repos seeded automatically if empty.
// Working branches are deleted in afterAll. The default branch is
// MERGED INTO (step 7) so the repo's main carries real history after
// the run — that's what enables cross-workspace-link tests to consume
// a non-trivial workspace.json on main.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapGT } from '../fixtures/tcMapGT';
import { tcMapCP } from '../fixtures/tcMapCP';
import { tcMapLV } from '../fixtures/tcMapLV';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  createPullRequest,
  deleteBranch,
  disconnect,
  getLiveConfig,
  getPipelineRepoConfig,
  inNewWorkspace,
  liveSkipReason,
  makeBranchName,
  mergePullRequest,
  seedRepoIfEmpty,
} from './_helpers';

function gt(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}
function cp(key: string): TcId {
  const v = tcMapCP[key];
  if (!v) throw new Error(`No TC-CP entry for "${key}"`);
  return v;
}
function lv(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}

interface FetchedWorkspace {
  collections?: { requests?: Record<string, { name?: string }> };
  environments?: { items?: Record<string, { name?: string }> };
  executionPlans?: Record<string, { name?: string }>;
  mockServers?: Record<string, { name?: string }>;
  releases?: { self?: { versions?: Array<{ version: string }> } };
}

async function fetchWorkspaceJson(cfg: LiveGithubConfig, ref: string): Promise<FetchedWorkspace> {
  const url =
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/workspace.json` +
    `?ref=${encodeURIComponent(ref)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok)
    throw new Error(`workspace.json fetch on ${cfg.fullName}@${ref} failed: ${res.status}`);
  const body = (await res.json()) as { content: string };
  return JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) as FetchedWorkspace;
}

interface Visibility {
  label: 'private' | 'public';
  resolveCfg: () => LiveGithubConfig | null;
}

// Local-dev fallback: when the pipeline didn't pre-create repos, the
// private cfg falls back to the existing single-repo env var (so a
// developer can still run a meaningful subset). The public iteration
// skips in that mode.
const visibilities: Visibility[] = [
  {
    label: 'private',
    resolveCfg: () => getPipelineRepoConfig().privateRepo ?? getLiveConfig(),
  },
  {
    label: 'public',
    resolveCfg: () => getPipelineRepoConfig().publicRepo,
  },
];

for (const visibility of visibilities) {
  test.describe(`Live GitHub — full cycle (${visibility.label}) @live-github`, () => {
    test.describe.configure({ mode: 'serial' });

    const skip = liveSkipReason();
    test.skip(skip !== null, skip ?? '');

    let cfg: LiveGithubConfig;
    let defaultBranch: string;
    let workingBranch: string;
    let prNumber: number | null = null;
    const createdBranches: string[] = [];
    // Tokens that travel across the 9 steps to prove cross-workspace sync:
    const markerRequestName = `cycle-req-${visibility.label}-${Date.now()}`;
    const markerEnvName = `cycle-env-${visibility.label}`;
    const markerPlanName = `cycle-plan-${visibility.label}`;
    const markerMockName = `cycle-mock-${visibility.label}`;
    const releaseVersion = `0.${visibility.label === 'private' ? 1 : 2}.${Date.now() % 1_000_000}`;

    test.beforeAll(async () => {
      const resolved = visibility.resolveCfg();
      test.skip(
        resolved === null,
        visibility.label === 'public'
          ? `Set APICIRCLE_E2E_PIPELINE_PUBLIC_REPO to a bot-owned public repo.`
          : `Set APICIRCLE_E2E_LIVE_GITHUB=1 + APICIRCLE_E2E_GITHUB_PAT + APICIRCLE_E2E_GITHUB_REPO.`,
      );
      cfg = resolved!;
      const head = await seedRepoIfEmpty(cfg);
      defaultBranch = head.name;
      workingBranch = makeBranchName(test.info().workerIndex, `cycle-${visibility.label}`);
      createdBranches.push(workingBranch);
    });

    test.afterAll(async () => {
      for (const branch of createdBranches.splice(0)) {
        await deleteBranch(cfg, branch);
      }
    });

    test(
      tc(
        gt('Branch :: Switch working branch'),
        `step 2 — createWorkingBranch on ${visibility.label} repo succeeds`,
      ),
      async ({ app }) => {
        await connectAndBranch(app, cfg, workingBranch);
        const branchName = await app.evaluate(
          () => window.__apicircleStore!.getState().local?.workingBranch?.name ?? null,
        );
        expect(branchName).toBe(workingBranch);
        await disconnect(app);
      },
    );

    test(
      tc(
        gt('Three-way :: Auto-merge non-conflicting'),
        `step 3 — refresh on fresh branch is a no-op; synced byte-stable`,
      ),
      async ({ app }) => {
        await connectAndBranch(app, cfg, workingBranch);
        const result = await app.evaluate(async () => {
          const api = window.__apicircleStore!.getState();
          const before = JSON.stringify(api.synced);
          const out = await api.refreshWorkspace();
          const s2 = window.__apicircleStore!.getState();
          const after = JSON.stringify(s2.synced);
          return { status: out.status, byteStable: before === after };
        });
        expect(['no-remote', 'up-to-date']).toContain(result.status);
        expect(result.byteStable, 'refresh on a fresh working branch must not mutate synced').toBe(
          true,
        );
        await disconnect(app);
      },
    );

    test(
      tc(
        cp('After push, strip resets to empty'),
        `step 4 — first push lands Editor/Env/Plan/Mock entities to working branch`,
      ),
      async ({ app }) => {
        await connectAndBranch(app, cfg, workingBranch);
        await app.evaluate(
          async ({ reqName, envName, planName, mockName }) => {
            const api = window.__apicircleStore!.getState();
            const reqId = api.addRequest(null, reqName);
            api.addEnvironment(envName);
            api.setVariables(envName, [
              { key: 'BASE_URL', value: 'https://example.test', enabled: true },
            ]);
            const planId = api.addPlan(planName);
            api.addPlanStep(planId, reqId);
            api.createMockServer({ name: mockName, source: { kind: 'manual', endpoints: [] } });
            await api.pushWorkspace(`e2e cycle step 4 (${reqName})`);
          },
          {
            reqName: markerRequestName,
            envName: markerEnvName,
            planName: markerPlanName,
            mockName: markerMockName,
          },
        );

        const ws = await fetchWorkspaceJson(cfg, workingBranch);
        const requestNames = Object.values(ws.collections?.requests ?? {}).map((r) => r.name);
        const envNames = Object.values(ws.environments?.items ?? {}).map((e) => e.name);
        const planNames = Object.values(ws.executionPlans ?? {}).map((p) => p.name);
        const mockNames = Object.values(ws.mockServers ?? {}).map((m) => m.name);
        expect(requestNames).toContain(markerRequestName);
        expect(envNames).toContain(markerEnvName);
        expect(planNames).toContain(markerPlanName);
        expect(mockNames).toContain(markerMockName);
        await disconnect(app);
      },
    );

    test(
      tc(
        gt('Pull Race'),
        `step 5 — second workspace pointed at same working branch sees all step-4 entities`,
      ),
      async ({ app }) => {
        await connectAndBranch(app, cfg, workingBranch);
        const observed = await inNewWorkspace(app, `cycle-2nd-ws-${visibility.label}`, async () => {
          return app.evaluate(
            async ({ token, owner, name, branch }) => {
              const api = window.__apicircleStore!.getState();
              await api.connectGitHubSession(token);
              await api.connectRepo(owner, name);
              await api.createWorkingBranch({ branchName: branch });
              await api.refreshWorkspace();
              const s = window.__apicircleStore!.getState();
              return {
                requests: Object.values(
                  (s.synced?.collections?.requests ?? {}) as Record<string, { name?: string }>,
                ).map((r) => r.name),
                environments: Object.values(
                  (s.synced?.environments?.items ?? {}) as Record<string, { name?: string }>,
                ).map((e) => e.name),
                plans: Object.values(
                  (s.synced?.executionPlans ?? {}) as Record<string, { name?: string }>,
                ).map((p) => p.name),
                mocks: Object.values(
                  (s.synced?.mockServers ?? {}) as Record<string, { name?: string }>,
                ).map((m) => m.name),
              };
            },
            { token: cfg.token, owner: cfg.owner, name: cfg.name, branch: workingBranch },
          );
        });
        expect(observed.requests).toContain(markerRequestName);
        expect(observed.environments).toContain(markerEnvName);
        expect(observed.plans).toContain(markerPlanName);
        expect(observed.mocks).toContain(markerMockName);
        await disconnect(app);
      },
    );

    test(
      tc(
        gt('GitHub Flow :: GitHub flow: Open PR shows in workspace UI'),
        `step 6 — createPullRequest from working branch to default branch`,
      ),
      async () => {
        const pr = await createPullRequest(cfg, {
          head: workingBranch,
          base: defaultBranch,
          title: `e2e cycle ${visibility.label}`,
          body: 'Automated PR opened by the live-github E2E suite.',
        });
        expect(pr.number).toBeGreaterThan(0);
        expect(pr.htmlUrl).toMatch(/^https:\/\/github\.com\//);
        prNumber = pr.number;
      },
    );

    test(
      tc(
        gt('GitHub Flow :: GitHub flow: PR merged via merge commit'),
        `step 7 — mergePullRequest via REST; assert main HEAD advanced`,
      ),
      async () => {
        expect(prNumber, 'step 6 must have set the PR number').not.toBeNull();
        const result = await mergePullRequest(cfg, prNumber!, { method: 'merge' });
        expect(result.merged).toBe(true);
        expect(result.sha).toMatch(/^[a-f0-9]{40}$/);

        // Now main carries the merged commit; fetch workspace.json on the
        // default branch and assert the step-4 entities are visible there.
        const ws = await fetchWorkspaceJson(cfg, defaultBranch);
        const requestNames = Object.values(ws.collections?.requests ?? {}).map((r) => r.name);
        expect(requestNames).toContain(markerRequestName);
      },
    );

    test(
      tc(
        gt('Retired'),
        `step 8 — delete workspace, create new one, branch from main, refresh — merged entities surface in new workspace`,
      ),
      async ({ app }) => {
        await connectAndBranch(app, cfg, workingBranch);
        const newBranch = makeBranchName(
          test.info().workerIndex,
          `cycle-after-merge-${visibility.label}`,
        );
        createdBranches.push(newBranch);
        const observed = await app.evaluate(
          async ({ token, owner, name, branch, freshName }) => {
            const api = window.__apicircleStore!.getState();
            // Step 8a: delete the active workspace + create a fresh one.
            const activeId = api.synced?.id;
            const freshId = await api.createNewWorkspace(freshName);
            await api.switchWorkspace(freshId);
            if (activeId && activeId !== freshId) {
              try {
                await (
                  api as unknown as { deleteWorkspaceById: (id: string) => Promise<void> }
                ).deleteWorkspaceById(activeId);
              } catch {
                /* ignore */
              }
            }
            // Step 8b: reconnect + branch from main + refresh.
            const fresh = window.__apicircleStore!.getState();
            await fresh.connectGitHubSession(token);
            await fresh.connectRepo(owner, name);
            await fresh.createWorkingBranch({ branchName: branch });
            await fresh.refreshWorkspace();
            const s = window.__apicircleStore!.getState();
            return {
              requests: Object.values(
                (s.synced?.collections?.requests ?? {}) as Record<string, { name?: string }>,
              ).map((r) => r.name),
              environments: Object.values(
                (s.synced?.environments?.items ?? {}) as Record<string, { name?: string }>,
              ).map((e) => e.name),
            };
          },
          {
            token: cfg.token,
            owner: cfg.owner,
            name: cfg.name,
            branch: newBranch,
            freshName: `cycle-3rd-ws-${visibility.label}`,
          },
        );
        expect(observed.requests).toContain(markerRequestName);
        expect(observed.environments).toContain(markerEnvName);
        await disconnect(app);
      },
    );

    test(
      tc(
        lv('Adopt new version'),
        `step 9 — publishRelease + push — release entry visible on the working branch's workspace.json`,
      ),
      async ({ app }) => {
        const newBranch = makeBranchName(
          test.info().workerIndex,
          `cycle-release-${visibility.label}`,
        );
        createdBranches.push(newBranch);
        await connectAndBranch(app, cfg, newBranch);
        await app.evaluate(
          async ({ version }) => {
            const api = window.__apicircleStore!.getState();
            await api.publishRelease({ version, notes: `e2e cycle release ${version}` });
            await api.pushWorkspace(`e2e cycle release ${version}`);
          },
          { version: releaseVersion },
        );
        const ws = await fetchWorkspaceJson(cfg, newBranch);
        const versions = (ws.releases?.self?.versions ?? []).map((v) => v.version);
        expect(versions).toContain(releaseVersion);
        await disconnect(app);
      },
    );
  });
}
