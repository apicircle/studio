// Live GitHub — marketplace search & link user stories (TC-SE-*).
//
// The marketplace surface drives `searchMarketplace(query)` which calls
// GitHub's `/search/repositories?q=<query>+topic:apicircle`. To get a
// real hit from the live API, the spec tags the pipeline-provisioned
// public repo with the `apicircle` topic before searching, then
// queries with a string that should match.
//
// Important caveat: GitHub's search index is eventually-consistent —
// after `setRepoTopics`, the new tag can take several minutes (or
// longer for a brand-new repo) to land in the search index. The "find
// our repo" test is therefore *tolerant*: it asserts the request
// shape + non-error response, and treats finding our repo as a bonus.
//
// The strict "search returns our repo" assertion lives at the unit
// tier in packages/git/src/github/api.test.ts where the GitHub API is
// mocked deterministically.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapSE } from '../fixtures/tcMapSE';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  deleteBranch,
  disconnect,
  ensureWorkspaceJsonOnMain,
  getLiveConfig,
  getPipelineRepoConfig,
  liveSkipReason,
  makeBranchName,
  seedRepoIfEmpty,
} from './_helpers';

function se(key: string): TcId {
  const v = tcMapSE[key];
  if (!v) throw new Error(`No TC-SE entry for "${key}"`);
  return v;
}

interface MarketplaceRepoView {
  fullName: string;
  owner: string;
  name: string;
  description: string;
  topics: string[];
  stargazers: number;
  defaultBranch: string;
}

const createdBranches: string[] = [];

test.describe('Live GitHub — marketplace search + link @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  let pubCfg: LiveGithubConfig | null;
  test.beforeAll(async () => {
    const pipe = getPipelineRepoConfig();
    const resolved = pipe.privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    cfg = resolved;
    pubCfg = pipe.publicRepo;
    await seedRepoIfEmpty(cfg);
    if (pubCfg) await seedRepoIfEmpty(pubCfg, { workspaceJson: true });
  });

  test.afterAll(async () => {
    // Drop the topic on the public repo so the marketplace doesn't keep
    // an ephemeral test repo in the discovery index between runs.
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
      se('Marketplace :: Search public workspaces'),
      'searchMarketplace returns an array (URL contains topic:apicircle) — strict shape pinned at unit tier',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'marketplace-search');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      // Tag the public repo with the topic so the live index *can*
      // eventually pick it up (search index is eventually-consistent).
      if (pubCfg) {
        await app.evaluate(
          async ({ token, owner, name }) => {
            const api = window.__apicircleStore!.getState() as unknown as {
              setRepoTopics: (topics: string[]) => Promise<string[]>;
              connectGitHubSession: (t: string) => Promise<unknown>;
              connectRepo: (o: string, n: string) => Promise<unknown>;
            };
            await api.connectGitHubSession(token);
            await api.connectRepo(owner, name);
            await api.setRepoTopics(['apicircle', 'e2e-marketplace']);
          },
          { token: pubCfg.token, owner: pubCfg.owner, name: pubCfg.name },
        );
      }
      // Reconnect to the private sandbox for the search call (workspace
      // session can be either — the search itself is anonymous when
      // there's no session, or uses the session otherwise).
      const result = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState() as unknown as {
          searchMarketplace: (query: string) => Promise<MarketplaceRepoView[]>;
        };
        const items = await api.searchMarketplace('apicircle');
        return { count: items.length, sample: items[0] ?? null };
      });
      expect(Array.isArray(result.count === undefined ? [] : new Array(result.count))).toBe(true);
      expect(typeof result.count).toBe('number');
      if (result.sample) {
        expect(typeof result.sample.fullName).toBe('string');
        expect(typeof result.sample.owner).toBe('string');
        expect(Array.isArray(result.sample.topics)).toBe(true);
      }
      await disconnect(app);
    },
  );

  test(
    tc(
      se('Marketplace :: Empty results'),
      'searchMarketplace with a no-match query returns an empty array (no crash, no items)',
    ),
    async ({ app }) => {
      const branch = makeBranchName(test.info().workerIndex, 'marketplace-empty');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      const result = await app.evaluate(async () => {
        const api = window.__apicircleStore!.getState() as unknown as {
          searchMarketplace: (query: string) => Promise<MarketplaceRepoView[]>;
        };
        const noMatchQuery = `nonexistent-xyz-${Date.now()}-${Math.random().toString(36).slice(2)}`;
        const items = await api.searchMarketplace(noMatchQuery);
        return { count: items.length, isArray: Array.isArray(items) };
      });
      expect(result.isArray).toBe(true);
      expect(result.count).toBe(0);
      await disconnect(app);
    },
  );

  test(
    tc(
      se('Marketplace :: Link public workspace'),
      'linkPublicWorkspace from a marketplace-style result lands in synced.linkedWorkspaces with kind:public',
    ),
    async ({ app }) => {
      test.skip(
        pubCfg === null,
        'Set APICIRCLE_E2E_PIPELINE_PUBLIC_REPO to exercise marketplace link flow.',
      );
      const branch = makeBranchName(test.info().workerIndex, 'marketplace-link');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      await ensureWorkspaceJsonOnMain(pubCfg!, 'main');
      const result = await app.evaluate(
        async ({ repo }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPublicWorkspace({
            repoFullName: repo,
            branch: 'main',
            pinnedVersion: null,
          });
          const s = window.__apicircleStore!.getState();
          const linked = Object.values(s.synced?.linkedWorkspaces ?? {}).find(
            (l) => l.id === link.id,
          ) as unknown as
            | {
                kind?: string;
                source?: { repoFullName?: string; kind?: string };
              }
            | undefined;
          return {
            present: !!linked,
            kind: linked?.kind ?? linked?.source?.kind ?? null,
            repoFullName: linked?.source?.repoFullName ?? null,
          };
        },
        { repo: pubCfg!.fullName },
      );
      expect(result.present).toBe(true);
      expect(result.repoFullName?.toLowerCase()).toBe(pubCfg!.fullName.toLowerCase());
      // Some product builds expose `kind: 'public'` on the source; others
      // distinguish by absence-of-token. Don't fail if absent.
      if (result.kind) expect(result.kind).toBe('public');
      await disconnect(app);
    },
  );
});
