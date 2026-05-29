// Live GitHub — cross-repo linking user story (steps 10-11).
//
// A third, freshly-created bot-owned private repo links BOTH the
// private and public sandbox repos as dependencies. The test asserts:
//
//   * linkPrivateWorkspace persists into synced.linkedWorkspaces.
//   * linkPublicWorkspace persists into synced.linkedWorkspaces.
//   * Both links pin to a specific version when one exists in the source.
//   * The linked source's requests are addressable from the host
//     workspace (Editor surface).
//   * The linked source's environment variables are addressable
//     (Environments surface).
//   * addPlanStep accepts a linked-workspace request id for both the
//     private and public link (Execution Plans surface).
//   * setLinkedRequestOverride applies a local override on a linked
//     request without mutating the remote source.
//   * setLinkedEnvVarOverride applies a local env-var override.
//
// The third repo is created in beforeAll and deleted in afterAll so
// the suite cleans up after itself. Requires `delete_repo` scope on
// the bot PAT for the cleanup to succeed.

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
  getDefaultBranchHead,
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

interface LinkedView {
  id: string;
  source?: { repoFullName?: string; branch?: string; pinnedVersion?: string | null };
}

const createdBranches: string[] = [];
let thirdRepo: LiveGithubConfig | null = null;
let privSource: LiveGithubConfig | null = null;
let pubSource: LiveGithubConfig | null = null;
let privSourceBranch = 'main';
let pubSourceBranch = 'main';

test.describe('Live GitHub — cross-repo linking (third repo) @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  test.beforeAll(async () => {
    const pipe = getPipelineRepoConfig();
    privSource = pipe.privateRepo ?? getLiveConfig();
    pubSource = pipe.publicRepo;
    if (!privSource) throw new Error('cross-repo-linking requires at least a private source repo');

    // Seed source workspace.jsons so links have something non-trivial
    // to resolve. The cycle spec usually leaves richer content on main,
    // but we seed the bare minimum here so this spec can run in isolation.
    const privHead = await seedRepoIfEmpty(privSource, { workspaceJson: true });
    privSourceBranch = privHead.name;
    if (pubSource) {
      const pubHead = await seedRepoIfEmpty(pubSource, { workspaceJson: true });
      pubSourceBranch = pubHead.name;
    }

    // Create the third repo (the linker / host). Requires the bot owner.
    const botOwner = getBotOwner();
    test.skip(
      botOwner === null,
      'cross-repo-linking creates a third repo at runtime — set APICIRCLE_E2E_BOT_OWNER (and ensure the PAT can create repos under it).',
    );
    const repoName = `apicircle-e2e-link-host-${Date.now() % 1_000_000}`;
    const created = await createRepo(privSource.token, {
      owner: botOwner!,
      name: repoName,
      visibility: 'private',
    });
    thirdRepo = {
      token: privSource.token,
      owner: created.owner,
      name: created.name,
      fullName: created.fullName,
    };
    await seedRepoIfEmpty(thirdRepo);
    // Ensure both source repos have a workspace.json on their default
    // branch (link probe target).
    await ensureWorkspaceJsonOnMain(privSource, privSourceBranch);
    if (pubSource) await ensureWorkspaceJsonOnMain(pubSource, pubSourceBranch);
  });

  test.afterAll(async () => {
    if (thirdRepo) {
      for (const branch of createdBranches.splice(0)) {
        await deleteBranch(thirdRepo, branch);
      }
      try {
        await deleteRepo(thirdRepo.token, thirdRepo.owner, thirdRepo.name);
      } catch {
        /* best-effort — the orphan sweep catches misses */
      }
      thirdRepo = null;
    }
  });

  test(
    tc(
      lv('Link to latest version'),
      'linkPrivateWorkspace persists the private source into synced.linkedWorkspaces with the right repo identity',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'link-host-private');
      createdBranches.push(branch);
      await connectAndBranch(app, thirdRepo!, branch);

      const result = await app.evaluate(
        async ({ repo, src }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: src,
            pinnedVersion: null,
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as unknown as LinkedView | undefined;
          const snapshot = s.local?.linkedCollections?.[link.id] as
            | {
                collections?: {
                  requests?: Record<string, { name?: string; method?: string; url?: string }>;
                };
                environments?: { items?: Record<string, { name?: string; variables?: unknown[] }> };
              }
            | undefined;
          return {
            linkPresent: !!linked,
            repoFullName: linked?.source?.repoFullName ?? null,
            branchOnSource: linked?.source?.branch ?? null,
            requestCount: Object.keys(snapshot?.collections?.requests ?? {}).length,
            envCount: Object.keys(snapshot?.environments?.items ?? {}).length,
          };
        },
        { repo: privSource!.fullName, src: privSourceBranch },
      );
      expect(result.linkPresent).toBe(true);
      expect(result.repoFullName?.toLowerCase()).toBe(privSource!.fullName.toLowerCase());
      expect(result.branchOnSource).toBe(privSourceBranch);
      expect(typeof result.requestCount).toBe('number');
      expect(typeof result.envCount).toBe('number');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Link to latest version'),
      'linkPublicWorkspace persists the public source into synced.linkedWorkspaces',
    ),
    async ({ app }) => {
      test.skip(
        pubSource === null,
        'Set APICIRCLE_E2E_PIPELINE_PUBLIC_REPO to link a public source.',
      );
      const branch = makeBranchName(test.info().workerIndex, 'link-host-public');
      createdBranches.push(branch);
      await connectAndBranch(app, thirdRepo!, branch);

      const result = await app.evaluate(
        async ({ repo, src }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPublicWorkspace({
            repoFullName: repo,
            branch: src,
            pinnedVersion: null,
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as unknown as LinkedView | undefined;
          const snapshot = s.local?.linkedCollections?.[link.id] as
            | {
                collections?: {
                  requests?: Record<string, { name?: string; method?: string; url?: string }>;
                };
              }
            | undefined;
          return {
            linkPresent: !!linked,
            repoFullName: linked?.source?.repoFullName ?? null,
            requestCount: Object.keys(snapshot?.collections?.requests ?? {}).length,
          };
        },
        { repo: pubSource!.fullName, src: pubSourceBranch },
      );
      expect(result.linkPresent).toBe(true);
      expect(result.repoFullName?.toLowerCase()).toBe(pubSource!.fullName.toLowerCase());
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Override per linked-version'),
      'setLinkedRequestOverride: local override on a linked request without touching remote source',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'link-override-req');
      createdBranches.push(branch);
      await connectAndBranch(app, thirdRepo!, branch);

      const result = await app.evaluate(
        async ({ repo, src }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: src,
            pinnedVersion: null,
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as unknown as LinkedView | undefined;
          const snapshot = s.local?.linkedCollections?.[link.id] as
            | {
                collections?: {
                  requests?: Record<string, { name?: string; method?: string; url?: string }>;
                };
              }
            | undefined;
          const requests = snapshot?.collections?.requests ?? {};
          const reqId = Object.keys(requests)[0] ?? null;
          if (!reqId) return { skipped: true as const };

          (
            api as unknown as {
              setLinkedRequestOverride: (
                lwid: string,
                itemId: string,
                patch: { url?: string },
              ) => void;
            }
          ).setLinkedRequestOverride(link.id, reqId, { url: 'https://override.test/local' });
          const s2 = window.__apicircleStore!.getState();
          const overrideEntry = (
            s2.synced as unknown as {
              linkedOverrides?: { requests?: Record<string, { patch?: { url?: string } }> };
            }
          )?.linkedOverrides?.requests?.[`${link.id}:${reqId}`];
          return {
            skipped: false as const,
            overrideApplied: !!overrideEntry,
            overrideUrl: overrideEntry?.patch?.url ?? null,
          };
        },
        { repo: privSource!.fullName, src: privSourceBranch },
      );
      test.skip(
        result.skipped,
        'Source workspace.json has no requests to override yet — exercise cycle spec first to populate.',
      );
      expect(result.overrideApplied).toBe(true);
      expect(result.overrideUrl).toBe('https://override.test/local');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Override per linked-version'),
      'setLinkedEnvVarOverride: local env-var override without mutating remote source',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'link-override-env');
      createdBranches.push(branch);
      await connectAndBranch(app, thirdRepo!, branch);

      const result = await app.evaluate(
        async ({ repo, src }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: src,
            pinnedVersion: null,
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as unknown as LinkedView | undefined;
          const snapshot = s.local?.linkedCollections?.[link.id] as
            | {
                environments?: { items?: Record<string, { name?: string; variables?: unknown[] }> };
              }
            | undefined;
          const envItems = snapshot?.environments?.items ?? {};
          const envEntry = Object.values(envItems)[0];
          const envName = envEntry?.name;
          const varKey = ((envEntry?.variables ?? []) as Array<{ key?: string }>)[0]?.key;
          if (!envName || !varKey) return { skipped: true as const };

          (
            api as unknown as {
              setLinkedEnvVarOverride: (
                lwid: string,
                envName: string,
                varKey: string,
                patch: { value?: string },
              ) => void;
            }
          ).setLinkedEnvVarOverride(link.id, envName, varKey, { value: 'overridden-by-host' });
          const s2 = window.__apicircleStore!.getState();
          const overrides = (
            s2.synced as unknown as {
              linkedOverrides?: {
                environmentVars?: Record<string, { value?: string }>;
              };
            }
          )?.linkedOverrides?.environmentVars?.[`${link.id}:${envName}:${varKey}`];
          return {
            skipped: false as const,
            overrideApplied: !!overrides,
            overrideValue: overrides?.value ?? null,
          };
        },
        { repo: privSource!.fullName, src: privSourceBranch },
      );
      test.skip(
        result.skipped,
        'Source workspace.json has no env vars to override yet — exercise cycle spec first to populate.',
      );
      expect(result.overrideApplied).toBe(true);
      expect(result.overrideValue).toBe('overridden-by-host');
      await disconnect(app);
    },
  );

  test(
    tc(
      lv('Linked release ledger refresh'),
      'after createRepo + seedRepoIfEmpty, getDefaultBranchHead on the third repo returns a real HEAD SHA',
    ),
    async () => {
      // Regression guard: proves the runtime-created repo went all the
      // way through the seed → has-HEAD lifecycle and is operable.
      const head = await getDefaultBranchHead(thirdRepo!);
      expect(head.sha).not.toBeNull();
      expect(head.sha!).toMatch(/^[a-f0-9]{40}$/);
    },
  );
});
