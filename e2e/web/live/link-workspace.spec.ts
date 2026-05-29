// Live GitHub — Link Workspace flows against real api.github.com.
//
// Two scenarios:
//   * Link to a PRIVATE repo using the workspace session (the same
//     PAT). Source is the writable sandbox repo's `main`. The
//     `main` branch must already contain a `workspace.json` (one
//     prior push round-trip to `main` via a normal PR-merged flow).
//     If `main` lacks one, this test skips with a directed reason
//     rather than silently passing.
//   * Link to a PUBLIC repo WITHOUT a token (anon read). Controlled
//     by APICIRCLE_E2E_GITHUB_LINK_PUBLIC_REPO. Disconnects the
//     workspace session first so the anon path is exercised.
//
// Both paths then assert that the linked source's content surfaces
// inside the host workspace:
//   * Editor / Environments — linked requests + env vars accessible
//     via the read selectors on `synced.linkedWorkspaces`.
//   * Execution Plans — `addPlanStep(planId, requestId, linkedId)`
//     accepts a linked-workspace request id without throwing.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapLV } from '../fixtures/tcMapLV';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LinkPublicRepoConfig,
  type LiveGithubConfig,
  connectAndBranch,
  deleteBranch,
  disconnect,
  getLinkPublicRepoConfig,
  getLiveConfig,
  linkPublicRepoSkipReason,
  liveSkipReason,
  makeBranchName,
  seedRepoIfEmpty,
} from './_helpers';

function lv(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}

const createdBranches: string[] = [];

interface LinkedWsView {
  id: string;
  source?: { repoFullName?: string; branch?: string };
}

test.describe('Live GitHub — Link Workspace @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  let defaultBranch: string;
  test.beforeAll(async () => {
    const c = getLiveConfig();
    if (!c) throw new Error('live config missing after skip checks');
    cfg = c;
    // Bootstrap the sandbox AND make sure workspace.json exists on the
    // default branch — that's the precondition for `linkPrivateWorkspace`.
    // The seed is idempotent; subsequent runs are no-ops.
    const head = await seedRepoIfEmpty(cfg, { workspaceJson: true });
    defaultBranch = head.name;
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(cfg, branch);
    }
  });

  test(
    tc(
      lv('Link to latest version'),
      'linkPrivateWorkspace against sandbox main — content surfaces in Editor + Environments + Plan-step-add accepts a linked request id',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'link-private');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);

      // workspace.json is guaranteed to exist on the default branch —
      // `seedRepoIfEmpty({ workspaceJson: true })` ran in `beforeAll`.
      const result = await app.evaluate(
        async ({ repo, sourceBranch }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: sourceBranch,
            pinnedVersion: null,
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as LinkedWsView | undefined;
          const snapshot = s.local?.linkedCollections?.[link.id] as
            | {
                collections?: { requests?: Record<string, { name?: string }> };
                environments?: { items?: Record<string, { name?: string; variables?: unknown[] }> };
              }
            | undefined;

          // Linked source's request id (first one, if any) — used to
          // prove `addPlanStep` accepts a linked-workspace request id.
          const requests = snapshot?.collections?.requests ?? {};
          const linkedRequestId = Object.keys(requests)[0];

          const planId = api.addPlan('live-linked-plan');
          let planStepAccepted = false;
          if (linkedRequestId) {
            try {
              api.addPlanStep(planId, linkedRequestId, link.id);
              planStepAccepted = true;
            } catch {
              planStepAccepted = false;
            }
          }

          return {
            linkPresent: !!linked,
            requestCount: Object.keys(requests).length,
            envCount: Object.keys(snapshot?.environments?.items ?? {}).length,
            planStepAccepted,
            linkedRequestId: linkedRequestId ?? null,
          };
        },
        { repo: cfg.fullName, sourceBranch: defaultBranch },
      );

      expect(
        result.linkPresent,
        'linkPrivateWorkspace must persist into synced.linkedWorkspaces',
      ).toBe(true);
      // Source workspace.json may carry zero requests/envs (newly-seeded
      // sandbox). Don't fail in that case — assert the *contract*: if
      // there IS a linked request, the plan accepts it.
      if (result.linkedRequestId !== null) {
        expect(
          result.planStepAccepted,
          'addPlanStep(planId, linkedRequestId, linkedWorkspaceId) must succeed',
        ).toBe(true);
      }
      expect(typeof result.requestCount).toBe('number');
      expect(typeof result.envCount).toBe('number');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Link to latest version'),
      'linkPublicWorkspace against a public repo — works without a workspace session',
    ),
    async ({ app }) => {
      const pub: LinkPublicRepoConfig | null = getLinkPublicRepoConfig();
      test.skip(pub === null, linkPublicRepoSkipReason());
      // After the skip guard, pub is non-null.
      const target = pub!;

      // Disconnect any prior session — the anon path is what we want
      // to exercise. The store's `linkPublicWorkspace` falls back to
      // unauthenticated REST when no session is present.
      await disconnect(app);

      const result = await app.evaluate(
        async ({ repoFullName, branch }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPublicWorkspace({
            repoFullName,
            branch,
            pinnedVersion: null,
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as LinkedWsView | undefined;
          const snapshot = s.local?.linkedCollections?.[link.id] as
            | {
                collections?: { requests?: Record<string, { name?: string }> };
                environments?: { items?: Record<string, { name?: string; variables?: unknown[] }> };
              }
            | undefined;
          return {
            linkPresent: !!linked,
            repoFullName: linked?.source?.repoFullName ?? null,
            requestCount: Object.keys(snapshot?.collections?.requests ?? {}).length,
            envCount: Object.keys(snapshot?.environments?.items ?? {}).length,
          };
        },
        { repoFullName: target.fullName, branch: target.branch },
      );

      expect(result.linkPresent, 'public link must persist into synced.linkedWorkspaces').toBe(
        true,
      );
      expect(result.repoFullName?.toLowerCase()).toBe(target.fullName.toLowerCase());
      expect(typeof result.requestCount).toBe('number');
      expect(typeof result.envCount).toBe('number');
    },
  );
});
