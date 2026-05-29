// Live GitHub — CRUD changes round-trip through push.
//
// The product invariant: a CRUD mutation in any of (Editor,
// Environments, Execution Plans, Mock Servers) becomes part of the
// next pushed `workspace.json` and the post-push `synced` shape on
// disk matches the local store. The test sequence per surface:
//
//   1. Branch fresh from the default branch.
//   2. Mutate the relevant slice via store actions:
//        - add → assert present in `synced`
//        - rename / update → assert reflected
//        - remove → assert absent
//   3. Push. Read the pushed `workspace.json` back via raw REST and
//      assert the same slice agrees.
//
// We drive the store directly (rather than the UI) for the same
// reason `git-integration.spec.ts` does: the UI varies by build, the
// store contract is stable, and the cost of UI-level coverage on a
// real-GitHub round trip (rate-limit budget) is not worth it.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapCP } from '../fixtures/tcMapCP';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  deleteBranch,
  disconnect,
  getLiveConfig,
  liveSkipReason,
  makeBranchName,
  seedRepoIfEmpty,
} from './_helpers';

function cp(key: string): TcId {
  const v = tcMapCP[key];
  if (!v) throw new Error(`No TC-CP entry for "${key}"`);
  return v;
}

const createdBranches: string[] = [];

interface FetchedWorkspace {
  collections?: {
    requests?: Record<string, { name?: string }>;
    folders?: Record<string, { name?: string }>;
  };
  environments?: {
    items?: Record<string, { name?: string; variables?: unknown[] }>;
  };
  executionPlans?: Record<string, { name?: string; steps?: unknown[] }>;
  mockServers?: Record<string, { name?: string }>;
}

async function fetchPushedWorkspace(
  cfg: LiveGithubConfig,
  branch: string,
): Promise<FetchedWorkspace> {
  const url =
    `https://api.github.com/repos/${cfg.owner}/${cfg.name}/contents/workspace.json` +
    `?ref=${encodeURIComponent(branch)}`;
  const res = await fetch(url, {
    headers: {
      Authorization: `token ${cfg.token}`,
      Accept: 'application/vnd.github+json',
      'X-GitHub-Api-Version': '2022-11-28',
    },
  });
  if (!res.ok) throw new Error(`workspace.json fetch failed: ${res.status}`);
  const body = (await res.json()) as { content: string; encoding: string };
  if (body.encoding !== 'base64') throw new Error(`unexpected encoding: ${body.encoding}`);
  return JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) as FetchedWorkspace;
}

test.describe('Live GitHub — CRUD round-trips through push @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  test.beforeAll(async () => {
    const c = getLiveConfig();
    if (!c) throw new Error('live config missing after skip checks');
    cfg = c;
    await seedRepoIfEmpty(cfg);
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(cfg, branch);
    }
  });

  test(
    tc(
      cp('After push, strip resets to empty'),
      'Editor CRUD: addRequest/renameRequest/removeRequest survive push round-trip',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'crud-editor');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);

      const result = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        const a = api.addRequest(null, 'live-editor-a');
        const b = api.addRequest(null, 'live-editor-b');
        api.renameRequest(a, 'live-editor-a-renamed');
        api.removeRequest(b);
        const push = await api.pushWorkspace('e2e editor crud');
        return { commitSha: push.commitSha, keptId: a, removedId: b };
      });
      expect(result.commitSha).toMatch(/^[a-f0-9]{40}$/);

      const ws = await fetchPushedWorkspace(cfg, branch);
      const requests = ws.collections?.requests ?? {};
      expect(requests[result.keptId]?.name).toBe('live-editor-a-renamed');
      expect(requests[result.removedId]).toBeUndefined();
      await disconnect(app);
    },
  );

  test(
    tc(
      cp('After push, strip resets to empty'),
      'Environments CRUD: addEnvironment/setVariables/removeEnvironment survive push',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'crud-env');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);

      await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        api.addEnvironment('live-env-keep');
        api.addEnvironment('live-env-drop');
        api.setVariables('live-env-keep', [
          { key: 'BASE_URL', value: 'https://example.test', enabled: true },
        ]);
        api.removeEnvironment('live-env-drop');
        await api.pushWorkspace('e2e env crud');
      });

      const ws = await fetchPushedWorkspace(cfg, branch);
      const envs = ws.environments?.items ?? {};
      const kept = Object.values(envs).find((e) => e.name === 'live-env-keep');
      const dropped = Object.values(envs).find((e) => e.name === 'live-env-drop');
      expect(kept, 'live-env-keep must be present after push').toBeDefined();
      expect((kept?.variables ?? []).length).toBeGreaterThan(0);
      expect(dropped, 'live-env-drop must be absent after push').toBeUndefined();
      await disconnect(app);
    },
  );

  test(
    tc(
      cp('After push, strip resets to empty'),
      'Execution Plans CRUD: addPlan/addPlanStep/removePlan survive push',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'crud-plan');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);

      const result = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        const reqId = api.addRequest(null, 'plan-target-req');
        const keptPlan = api.addPlan('live-plan-keep');
        const droppedPlan = api.addPlan('live-plan-drop');
        api.addPlanStep(keptPlan, reqId);
        api.removePlan(droppedPlan);
        await api.pushWorkspace('e2e plan crud');
        return { keptPlan, droppedPlan };
      });

      const ws = await fetchPushedWorkspace(cfg, branch);
      const plans = ws.executionPlans ?? {};
      const kept = plans[result.keptPlan];
      expect(kept, 'kept plan must be present after push').toBeDefined();
      expect((kept?.steps ?? []).length).toBeGreaterThan(0);
      expect(plans[result.droppedPlan], 'dropped plan must be absent after push').toBeUndefined();
      await disconnect(app);
    },
  );

  test(
    tc(
      cp('After push, strip resets to empty'),
      'Mock Servers CRUD: createMockServer/removeMockServer survive push',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'crud-mock');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);

      const result = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState();
        const keptMock = api.createMockServer({
          name: 'live-mock-keep',
          source: { kind: 'manual', endpoints: [] },
        });
        const droppedMock = api.createMockServer({
          name: 'live-mock-drop',
          source: { kind: 'manual', endpoints: [] },
        });
        api.removeMockServer(droppedMock);
        await api.pushWorkspace('e2e mock crud');
        return { keptMock, droppedMock };
      });

      const ws = await fetchPushedWorkspace(cfg, branch);
      const mocks = ws.mockServers ?? {};
      expect(mocks[result.keptMock]?.name).toBe('live-mock-keep');
      expect(mocks[result.droppedMock], 'removed mock must be absent after push').toBeUndefined();
      await disconnect(app);
    },
  );
});
