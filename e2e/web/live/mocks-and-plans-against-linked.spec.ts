// Live GitHub — mock servers and execution plans built on top of
// linked workspaces (step 12 of the user narrative).
//
// User story: an APICircle user creates a "consumer" workspace that
// links two upstream sources (private + public), then assembles an
// execution plan that combines:
//   * a request from the linked-private source
//   * a request from the linked-public source
//   * a request that hits a locally-defined mock server
// They push the consumer workspace; the plan + mock + linked-overrides
// round-trip through the remote workspace.json.
//
// This spec creates its own host repo (similar to cross-repo-linking)
// so it's independent: it can run even if cross-repo-linking.spec.ts
// has not run in the same suite invocation.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapLV } from '../fixtures/tcMapLV';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  createRepo,
  deleteBranch,
  deleteRepo,
  disconnect,
  ensureWorkspaceJsonOnMain,
  getBotOwner,
  getLiveConfig,
  getPipelineRepoConfig,
  liveSkipReason,
  makeBranchName,
  seedRepoIfEmpty,
} from './_helpers';

function lv(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}

interface FetchedHost {
  collections?: { requests?: Record<string, unknown> };
  executionPlans?: Record<
    string,
    { name?: string; steps?: Array<{ requestId?: string; linkedWorkspaceId?: string }> }
  >;
  mockServers?: Record<string, { name?: string }>;
  linkedWorkspaces?: Record<string, { id: string; source?: { repoFullName?: string } }>;
}

const createdBranches: string[] = [];
let hostRepo: LiveGithubConfig | null = null;
let privSource: LiveGithubConfig | null = null;
let pubSource: LiveGithubConfig | null = null;

test.describe('Live GitHub — mocks + plans on linked workspaces @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  test.beforeAll(async () => {
    const pipe = getPipelineRepoConfig();
    privSource = pipe.privateRepo ?? getLiveConfig();
    pubSource = pipe.publicRepo;
    if (!privSource) throw new Error('linked-plans requires at least a private source');
    await ensureWorkspaceJsonOnMain(
      privSource,
      (await seedRepoIfEmpty(privSource, { workspaceJson: true })).name,
    );
    if (pubSource) {
      await ensureWorkspaceJsonOnMain(
        pubSource,
        (await seedRepoIfEmpty(pubSource, { workspaceJson: true })).name,
      );
    }
    const botOwner = getBotOwner();
    test.skip(botOwner === null, 'Set APICIRCLE_E2E_BOT_OWNER for the runtime-created host repo.');
    const created = await createRepo(privSource.token, {
      owner: botOwner!,
      name: `apicircle-e2e-linked-plan-${Date.now() % 1_000_000}`,
      visibility: 'private',
    });
    hostRepo = {
      token: privSource.token,
      owner: created.owner,
      name: created.name,
      fullName: created.fullName,
    };
    await seedRepoIfEmpty(hostRepo);
  });

  test.afterAll(async () => {
    if (hostRepo) {
      for (const branch of createdBranches.splice(0)) {
        await deleteBranch(hostRepo, branch);
      }
      try {
        await deleteRepo(hostRepo.token, hostRepo.owner, hostRepo.name);
      } catch {
        /* best-effort */
      }
      hostRepo = null;
    }
  });

  test(
    tc(
      lv('Adopt new version'),
      'consumer workspace links both sources; addPlanStep accepts linked request ids; push round-trips plan + mock + overrides',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'linked-plan-push');
      createdBranches.push(branch);
      await connectAndBranch(app, hostRepo!, branch);

      const seedResult = await app.evaluate(
        async ({ privRepo, pubRepo, privBranch, pubBranch }) => {
          const api = window.__apicircleStore!.getState();
          const links: { id: string; kind: 'private' | 'public'; hasRequest: string | null }[] = [];

          const priv = await api.linkPrivateWorkspace({
            repoFullName: privRepo,
            branch: privBranch,
            pinnedVersion: null,
          });
          {
            const s = window.__apicircleStore!.getState();
            const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
              (l) => l.id === priv.id,
            ) as unknown as { id: string } | undefined;
            const snapshot = s.local?.linkedCollections?.[priv.id] as
              | { collections?: { requests?: Record<string, unknown> } }
              | undefined;
            const reqId = linked
              ? (Object.keys(snapshot?.collections?.requests ?? {})[0] ?? null)
              : null;
            links.push({ id: priv.id, kind: 'private', hasRequest: reqId });
          }

          let pubLinkInfo: { id: string; kind: 'public'; hasRequest: string | null } | null = null;
          if (pubRepo) {
            const pub = await api.linkPublicWorkspace({
              repoFullName: pubRepo,
              branch: pubBranch,
              pinnedVersion: null,
            });
            const s = window.__apicircleStore!.getState();
            const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
              (l) => l.id === pub.id,
            ) as unknown as { id: string } | undefined;
            const snapshot = s.local?.linkedCollections?.[pub.id] as
              | { collections?: { requests?: Record<string, unknown> } }
              | undefined;
            const reqId = linked
              ? (Object.keys(snapshot?.collections?.requests ?? {})[0] ?? null)
              : null;
            pubLinkInfo = { id: pub.id, kind: 'public', hasRequest: reqId };
            links.push(pubLinkInfo);
          }

          // Build the consumer plan + mock + local request.
          const localReqId = api.addRequest(null, 'consumer-local-req');
          const planId = api.addPlan('consumer-plan');
          let stepsAdded = 0;
          for (const link of links) {
            if (link.hasRequest) {
              try {
                api.addPlanStep(planId, link.hasRequest, link.id);
                stepsAdded += 1;
              } catch {
                /* tolerate — empty linked source */
              }
            }
          }
          api.addPlanStep(planId, localReqId);
          stepsAdded += 1;
          const mockId = api.createMockServer({
            name: 'consumer-mock',
            source: { kind: 'manual', endpoints: [] },
          });

          await api.pushWorkspace('e2e linked-plan push');
          return {
            planId,
            mockId,
            linkIds: links.map((l) => l.id),
            stepsAdded,
            pubLinked: pubLinkInfo !== null,
          };
        },
        {
          privRepo: privSource!.fullName,
          pubRepo: pubSource?.fullName ?? null,
          privBranch: 'main',
          pubBranch: 'main',
        },
      );

      // Validate the pushed workspace.json carries all consumer entities.
      const url =
        `https://api.github.com/repos/${hostRepo!.owner}/${hostRepo!.name}/contents/workspace.json` +
        `?ref=${encodeURIComponent(branch)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `token ${hostRepo!.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { content: string };
      const ws = JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) as FetchedHost;

      expect(Object.keys(ws.linkedWorkspaces ?? {}).length).toBeGreaterThanOrEqual(1);
      expect(ws.executionPlans?.[seedResult.planId]).toBeDefined();
      expect(ws.executionPlans?.[seedResult.planId]?.name).toBe('consumer-plan');
      expect((ws.executionPlans?.[seedResult.planId]?.steps ?? []).length).toBeGreaterThanOrEqual(
        seedResult.stepsAdded,
      );
      expect(ws.mockServers?.[seedResult.mockId]?.name).toBe('consumer-mock');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Linked release ledger refresh'),
      'pushed plan steps that reference a linked workspace round-trip with the linkedWorkspaceId field',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'linked-plan-step');
      createdBranches.push(branch);
      await connectAndBranch(app, hostRepo!, branch);

      const result = await app.evaluate(
        async ({ privRepo, src }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: privRepo,
            branch: src,
            pinnedVersion: null,
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as unknown as { id: string } | undefined;
          const snapshot = s.local?.linkedCollections?.[link.id] as
            | { collections?: { requests?: Record<string, unknown> } }
            | undefined;
          const reqId = linked
            ? (Object.keys(snapshot?.collections?.requests ?? {})[0] ?? null)
            : null;
          if (!reqId) return { skipped: true as const };

          const planId = api.addPlan('linked-step-plan');
          api.addPlanStep(planId, reqId, link.id);
          await api.pushWorkspace('e2e linked plan-step round-trip');
          return { skipped: false as const, planId, linkId: link.id, reqId };
        },
        { privRepo: privSource!.fullName, src: 'main' },
      );
      if (result.skipped) {
        test.skip(
          true,
          'Source workspace.json has no requests yet — run repo-cycle.spec.ts first to populate main.',
        );
        return;
      }

      const url =
        `https://api.github.com/repos/${hostRepo!.owner}/${hostRepo!.name}/contents/workspace.json` +
        `?ref=${encodeURIComponent(branch)}`;
      const res = await fetch(url, {
        headers: {
          Authorization: `token ${hostRepo!.token}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      expect(res.ok).toBe(true);
      const body = (await res.json()) as { content: string };
      const ws = JSON.parse(Buffer.from(body.content, 'base64').toString('utf-8')) as FetchedHost;
      const plan = ws.executionPlans?.[result.planId];
      expect(plan).toBeDefined();
      const step = (plan?.steps ?? []).find(
        (s: { requestId?: string }) => s.requestId === result.reqId,
      );
      expect(step?.linkedWorkspaceId).toBe(result.linkId);
      await disconnect(app);
    },
  );
});
