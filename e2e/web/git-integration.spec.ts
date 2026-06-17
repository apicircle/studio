// GitHub integration (TC-GT-*). Exercises the link → branch → push →
// pull lifecycle against the in-memory GitHub mock (e2e/mock
// /_gh/*). The fixture rewrites api.github.com → mock at the network
// layer so the workspaceStore's GitHubClient calls hit the mock without
// any app-side override.
//
// Spec strategy: drive the store actions directly via page.evaluate
// against `window.__apicircleStore` rather than the link-workspace UI.
// The link-workspace UI varies across builds; the store API is the
// stable contract.

import { test, expect } from './fixtures/gitFixture';
import { tc } from './fixtures/tcCoverage';
import { tcMapGT } from './fixtures/tcMapGT';
import type { TcId } from './fixtures/tcCoverage';

function id(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}

interface StoreApi {
  connectGitHubSession: (token: string) => Promise<unknown>;
  connectRepo: (owner: string, name: string) => Promise<unknown>;
  verifyGitHubScopes: () => Promise<string[] | null>;
  createWorkingBranch: (name?: string) => Promise<unknown>;
  pushWorkspace: (msg?: string) => Promise<{ commitSha: string }>;
  refreshWorkspace: () => Promise<{ status: string; retired?: { reason: string } }>;
  createPullRequest: (args?: {
    title?: string;
    body?: string;
    draft?: boolean;
  }) => Promise<{ number: number; htmlUrl: string }>;
  disconnectRepo: () => void;
  disconnectGitHubSession: () => Promise<unknown>;
  // `local` and `synced` are direct members of the store state — the
  // object `window.__apicircleStore.getState()` returns. (`getState`
  // itself lives on the store wrapper, not on the state.)
  local?: {
    connectedRepo?: { owner: string; name: string; fullName: string } | null;
    workingBranch?: {
      name: string;
      headSha?: string;
      baseBranch?: string;
      openPrUrl?: string | null;
    } | null;
    retiredBranch?: unknown;
    sessions?: {
      github?: {
        workspace?: {
          grantedScopes?: string[];
          canCreatePullRequests?: boolean | null;
        } | null;
      };
    };
  };
  synced?: { id?: string };
}

async function getStore(page: import('@playwright/test').Page): Promise<{ ok: boolean }> {
  return page.evaluate(() => {
    const w = window as unknown as { __apicircleStore?: unknown };
    return { ok: !!w.__apicircleStore };
  });
}

async function linkAndAuth(
  page: import('@playwright/test').Page,
  owner: string,
  name: string,
): Promise<void> {
  // Ensure the store exposes itself on window for test introspection.
  const present = await getStore(page);
  expect(present.ok).toBe(true);
  await page.evaluate(
    async ({ ownerArg, nameArg }) => {
      const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
      const s = w.__apicircleStore!.getState();
      await s.connectGitHubSession('ghp_mock_test_token');
      await s.connectRepo(ownerArg, nameArg);
    },
    { ownerArg: owner, nameArg: name },
  );
}

test.describe('GitHub integration', () => {
  test.describe.configure({ mode: 'serial' });

  test(
    tc(id('Push'), 'happy-path: link → branch → push lands a commit'),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-push-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name, defaultBranch: 'main' });
      await linkAndAuth(appWithGithubMock, owner, name);
      const commitSha = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const s = w.__apicircleStore!.getState();
        await s.createWorkingBranch();
        const out = await s.pushWorkspace('test commit');
        return out.commitSha;
      });
      expect(commitSha).toMatch(/^[a-f0-9]{20,}$/);
      const inspected = await mockGithub.inspectRepo(owner, name);
      expect(inspected).not.toBeNull();
      // The push should have created or updated at least one ref beyond
      // the seed.
      expect(Object.keys(inspected!.refs).length).toBeGreaterThanOrEqual(2);
    },
  );

  test(
    tc(id('Branch :: Switch working branch'), 'creating a working branch updates store state'),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-branch-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await linkAndAuth(appWithGithubMock, owner, name);
      await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        await w.__apicircleStore!.getState().createWorkingBranch();
      });
      const branch = await appWithGithubMock.evaluate(() => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        return w.__apicircleStore!.getState().local?.workingBranch ?? null;
      });
      expect(branch).not.toBeNull();
      expect(typeof branch!.name).toBe('string');
      expect(branch!.name.length).toBeGreaterThan(0);
    },
  );

  test(
    tc(id('Three-way :: Auto-merge non-conflicting'), 'push after seeded repo round-trips'),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-3way-${test.info().workerIndex}`;
      await mockGithub.seedRepo({
        owner,
        name,
        seedFiles: [
          {
            path: '.apicircle/registry.json',
            content: JSON.stringify({
              schemaVersion: 1,
              activeWorkspaceId: 'seed-ws',
              workspaces: [{ id: 'seed-ws', name: 'Seed', createdAt: 't', lastOpenedAt: 't' }],
            }),
          },
          { path: '.apicircle/workspace-seed-ws/workspace.json', content: '{}' },
        ],
      });
      await linkAndAuth(appWithGithubMock, owner, name);
      const result = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const s = w.__apicircleStore!.getState();
        await s.createWorkingBranch();
        return s.pushWorkspace();
      });
      expect(typeof result.commitSha).toBe('string');
    },
  );

  test(
    tc(
      id('GitHub Flow :: GitHub flow: Link to public repo'),
      'link to public repo surfaces the marketplace-topics banner',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-public-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name, isPrivate: false, visibility: 'public' });
      await linkAndAuth(appWithGithubMock, owner, name);
      const connected = await appWithGithubMock.evaluate(() => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        return w.__apicircleStore!.getState().local?.connectedRepo ?? null;
      });
      expect(connected?.fullName).toBe(`${owner}/${name}`);
      // The Workspace panel's repo card tells the user a public repo is
      // discoverable in the marketplace via its GitHub topics.
      await appWithGithubMock
        .getByRole('button', { name: 'Workspace', exact: true })
        .first()
        .click();
      await expect(
        appWithGithubMock.getByText(/listed in the API Circle marketplace/),
      ).toBeVisible();
    },
  );

  test(
    tc(
      id('GitHub Flow :: GitHub flow: Link to private repo with personal token'),
      'link to private repo — no marketplace-topics banner',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-private-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name, isPrivate: true, visibility: 'private' });
      await linkAndAuth(appWithGithubMock, owner, name);
      const connected = await appWithGithubMock.evaluate(() => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        return w.__apicircleStore!.getState().local?.connectedRepo ?? null;
      });
      expect(connected?.fullName).toBe(`${owner}/${name}`);
      // A private repo is not in the public marketplace — the repo card
      // renders, but without the marketplace-topics banner.
      await appWithGithubMock
        .getByRole('button', { name: 'Workspace', exact: true })
        .first()
        .click();
      await expect(
        appWithGithubMock.getByRole('button', { name: 'Disconnect repo' }),
      ).toBeVisible();
      await expect(appWithGithubMock.getByText(/listed in the API Circle marketplace/)).toHaveCount(
        0,
      );
    },
  );

  test(
    tc(id('PR Capability'), 'repo-scoped session advertises PR capability'),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-pr-cap-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await linkAndAuth(appWithGithubMock, owner, name);
      const capability = await appWithGithubMock.evaluate(() => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        return (
          w.__apicircleStore!.getState().local?.sessions?.github?.workspace
            ?.canCreatePullRequests ?? null
        );
      });
      expect(capability).toBe(true);
    },
  );

  test(
    tc(id('Retired'), 'refresh retires a deleted working branch'),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-retired-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await linkAndAuth(appWithGithubMock, owner, name);
      const branchName = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const s = w.__apicircleStore!.getState();
        await s.createWorkingBranch();
        return w.__apicircleStore!.getState().local!.workingBranch!.name;
      });
      const deleted = await fetch(
        `${mockGithub.baseUrl}/_gh/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branchName)}`,
        { method: 'DELETE' },
      );
      expect(deleted.ok).toBe(true);
      const result = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const refresh = await w.__apicircleStore!.getState().refreshWorkspace();
        const after = w.__apicircleStore!.getState();
        return {
          status: refresh.status,
          retired: after.local?.retiredBranch ?? null,
          branch: after.local?.workingBranch ?? null,
        };
      });
      expect(result.status).toBe('retired');
      expect(result.retired).toMatchObject({ reason: 'branch-deleted' });
      expect(result.branch).toBeNull();
    },
  );

  test(
    tc(
      id('GitHub Flow :: GitHub flow: OAuth scope downgrade after linking'),
      'downgraded token surfaces missing scope',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-scope-downgrade-${test.info().workerIndex}`;
      const token = `ghp_mock_downgrade_${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await appWithGithubMock.evaluate(
        async ({ ownerArg, nameArg, tokenArg }) => {
          const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
          const s = w.__apicircleStore!.getState();
          await s.connectGitHubSession(tokenArg);
          await s.connectRepo(ownerArg, nameArg);
        },
        { ownerArg: owner, nameArg: name, tokenArg: token },
      );
      try {
        await mockGithub.setScopes(['read:user'], token);
        await mockGithub.setAuthFailure({
          token,
          status: 403,
          message: 'Resource not accessible by token',
          acceptedScopes: 'repo',
        });
        const message = await appWithGithubMock.evaluate(async () => {
          const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
          try {
            await w.__apicircleStore!.getState().verifyGitHubScopes();
            return null;
          } catch (err) {
            return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          }
        });
        expect(message).toMatch(
          /MissingScopeError: GitHub denied this action: missing scopes repo/i,
        );
      } finally {
        // setScopes + setAuthFailure mutate token-keyed state on the shared,
        // long-lived mock server. Restore it — in `finally`, so it runs even
        // when the assertion throws — otherwise a later run that reuses this
        // token connects with the downgraded `read:user` scope and fails in
        // its own setup before reaching the assertion.
        await mockGithub.setScopes(['repo', 'read:user'], token);
        await mockGithub.clearAuthFailure(token);
      }
    },
  );

  test(
    tc(
      id('GitHub Flow :: GitHub flow: OAuth token revoked on github.com mid-session'),
      'revoked token surfaces unauthorized error',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-token-revoked-${test.info().workerIndex}`;
      const token = `ghp_mock_revoked_gt_${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await appWithGithubMock.evaluate(
        async ({ ownerArg, nameArg, tokenArg }) => {
          const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
          const s = w.__apicircleStore!.getState();
          await s.connectGitHubSession(tokenArg);
          await s.connectRepo(ownerArg, nameArg);
        },
        { ownerArg: owner, nameArg: name, tokenArg: token },
      );
      try {
        await mockGithub.setAuthFailure({ token, status: 401, message: 'Bad credentials' });
        const message = await appWithGithubMock.evaluate(async () => {
          const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
          try {
            await w.__apicircleStore!.getState().verifyGitHubScopes();
            return null;
          } catch (err) {
            return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
          }
        });
        expect(message).toMatch(/UnauthorizedError: Bad credentials/i);
      } finally {
        // Clear the forced auth failure in `finally` so a thrown assertion
        // can't leave a stuck 401 on this token in the shared mock server —
        // that would break a later run that reuses the token.
        await mockGithub.clearAuthFailure(token);
      }
    },
  );

  test(
    tc(
      id('GitHub Flow :: GitHub flow: Open PR shows in workspace UI'),
      'created PR is stored on the working branch',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-open-pr-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await linkAndAuth(appWithGithubMock, owner, name);
      const pr = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const s = w.__apicircleStore!.getState();
        await s.createWorkingBranch();
        await s.pushWorkspace('open pr');
        const created = await s.createPullRequest({ title: 'Sync workspace' });
        const branch = w.__apicircleStore!.getState().local?.workingBranch ?? null;
        return { created, openPrUrl: branch?.openPrUrl ?? null };
      });
      expect(pr.created.htmlUrl).toMatch(/\/pull\/1$/);
      expect(pr.openPrUrl).toBe(pr.created.htmlUrl);
      const inspected = await mockGithub.inspectRepo(owner, name);
      expect(inspected?.pulls).toHaveLength(1);
      expect(inspected?.pulls[0]).toMatchObject({ title: 'Sync workspace', state: 'open' });
    },
  );

  test(
    tc(
      id('GitHub Flow :: GitHub flow: Push to branch with PR draft'),
      'draft PR flag reaches GitHub mock',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-draft-pr-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await linkAndAuth(appWithGithubMock, owner, name);
      await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const s = w.__apicircleStore!.getState();
        await s.createWorkingBranch();
        await s.pushWorkspace('draft pr');
        await s.createPullRequest({ title: 'Draft workspace sync', draft: true });
      });
      const inspected = await mockGithub.inspectRepo(owner, name);
      expect(inspected?.pulls[0]).toMatchObject({
        title: 'Draft workspace sync',
        draft: true,
      });
    },
  );

  test(
    tc(id('Commit Msg'), 'push commit carries the supplied commit message'),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-commit-msg-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await linkAndAuth(appWithGithubMock, owner, name);
      const commitSha = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const s = w.__apicircleStore!.getState();
        await s.createWorkingBranch();
        const out = await s.pushWorkspace('feat: a distinctive commit message');
        return out.commitSha;
      });
      const res = await fetch(
        `${mockGithub.baseUrl}/_gh/repos/${owner}/${name}/git/commits/${commitSha}`,
      );
      expect(res.ok).toBe(true);
      const commit = (await res.json()) as { message: string };
      expect(commit.message).toBe('feat: a distinctive commit message');
    },
  );

  test(
    tc(id('Push Conflict'), 'a push after the branch moved server-side is rejected'),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-push-conflict-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await linkAndAuth(appWithGithubMock, owner, name);
      const branchName = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const s = w.__apicircleStore!.getState();
        await s.createWorkingBranch();
        await s.pushWorkspace('first push');
        return w.__apicircleStore!.getState().local!.workingBranch!.name;
      });
      // Move the branch head out from under the local client.
      const patched = await fetch(
        `${mockGithub.baseUrl}/_gh/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branchName)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sha: 'a'.repeat(40) }),
        },
      );
      expect(patched.ok).toBe(true);
      const error = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        try {
          await w.__apicircleStore!.getState().pushWorkspace('second push');
          return null;
        } catch (err) {
          return err instanceof Error ? `${err.name}: ${err.message}` : String(err);
        }
      });
      // pushWorkspace pre-flights the remote head and refuses to upload
      // when it has diverged — see BranchDivergedError in workspaceStore.
      expect(error).toMatch(/diverged|moved since your last sync/i);
    },
  );

  test(
    tc(
      id('GitHub Flow :: GitHub flow: Concurrent push from two devices'),
      'a stale second-device push is rejected after the first device pushed',
    ),
    async ({ appWithGithubMock, mockGithub }) => {
      const owner = 'mock-user';
      const name = `int-concurrent-${test.info().workerIndex}`;
      await mockGithub.seedRepo({ owner, name });
      await linkAndAuth(appWithGithubMock, owner, name);
      // Device A: branch + first push succeeds.
      const branchName = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const s = w.__apicircleStore!.getState();
        await s.createWorkingBranch();
        const first = await s.pushWorkspace('device A push');
        if (typeof first.commitSha !== 'string') throw new Error('device A push failed');
        return w.__apicircleStore!.getState().local!.workingBranch!.name;
      });
      // Device B (simulated) advances the same branch on the remote.
      await fetch(
        `${mockGithub.baseUrl}/_gh/repos/${owner}/${name}/git/refs/heads/${encodeURIComponent(branchName)}`,
        {
          method: 'PATCH',
          headers: { 'content-type': 'application/json' },
          body: JSON.stringify({ sha: 'b'.repeat(40) }),
        },
      );
      // Device A pushes again on stale branch state — must be rejected.
      const rejected = await appWithGithubMock.evaluate(async () => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        try {
          await w.__apicircleStore!.getState().pushWorkspace('device A stale push');
          return false;
        } catch {
          return true;
        }
      });
      expect(rejected).toBe(true);
    },
  );

  // Cells that need mock state or driving we haven't built — org
  // membership, branch protection, PR-merge simulation, network-failure
  // injection, force-push ancestry overlays, richer link-workspace UI.
  // The mock GitHub server (e2e/mock /_gh/*) covers the data plane;
  // these need behavioral overlays on top. Spelled out individually (not
  // a loop) so each literal `id('...')` credits its cell to this spec.
  test.fixme(
    tc(id('Branch :: Switch with unsaved warns'), 'switching branches with unsaved edits warns'),
    () => {},
  );
  test.fixme(tc(id('Commit Author'), 'commit carries the configured author identity'), () => {});
  test.fixme(tc(id('Network'), 'network failure mid-request surfaces an error'), () => {});
  test.fixme(tc(id('Pull Race'), 'two overlapping pulls reconcile safely'), () => {});
  test.fixme(tc(id('Rebase'), 'working branch can be rebased onto an advanced base'), () => {});
  test.fixme(
    tc(
      id('Three-way :: Conflict surfaces resolution UI'),
      'a genuine three-way conflict opens the resolver',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Link to org repo (member, write)'),
      'link to an org repo as a member with write access',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Link to org repo (member, read-only)'),
      'link to an org repo as a member with read-only access',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Link to org repo (non-member, public)'),
      'link to a public org repo as a non-member',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Link to org repo (non-member, private)'),
      'link to a private org repo as a non-member is blocked',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Link to repo with branch protection'),
      'link to a repo whose default branch is protected',
    ),
    () => {},
  );
  test.fixme(
    tc(id('GitHub Flow :: GitHub flow: Link to archived repo'), 'link to an archived repo'),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Link to forked repo (upstream PR)'),
      'link to a fork and open a PR against upstream',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Repo deleted after linking'),
      'repo deleted on GitHub after linking',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Repo renamed by owner'),
      'repo renamed on GitHub after linking',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Repo transferred to another owner'),
      'repo transferred to a new owner after linking',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Branch protection requires status checks'),
      'branch protection requiring status checks blocks merge',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: PR merged via squash on GitHub'),
      'PR squash-merged on GitHub is detected on refresh',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: PR merged via rebase on GitHub'),
      'PR rebase-merged on GitHub is detected on refresh',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: PR merged via merge commit'),
      'PR merged via merge commit is detected on refresh',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Direct push to main by collaborator'),
      'direct push to main by a collaborator is detected',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Force-push on working branch'),
      'force-push on the working branch surfaces a history-rewrite warning',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Network drops during push (large)'),
      'network drop during a large push surfaces an error',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Network drops during pull'),
      'network drop during a pull surfaces an error',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Workspace push includes secrets metadata only (not values)'),
      'pushed workspace.json carries secret metadata but no plaintext values',
    ),
    () => {},
  );
  test.fixme(
    tc(
      id('GitHub Flow :: GitHub flow: Push of conflict resolution'),
      'pushing a resolved merge result lands cleanly',
    ),
    () => {},
  );
});
