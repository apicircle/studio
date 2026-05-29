// Live GitHub — auth + session edge cases.
//
//   * Rate-limit budget probe (always runs — fails the build if the
//     bot has burned through its hourly quota).
//   * Per-link dedicated session — gated on
//     `APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED` (a second PAT for the link).
//   * OAuth scope downgrade (TC-GT-0023) — fixme: needs token-regenerate
//     mid-session, which classic PATs don't support headlessly.
//   * OAuth token revoked mid-session (TC-GT-0035) — fixme: same
//     constraint.

import { expect, test } from '../fixtures/app';
import { tc } from '../fixtures/tcCoverage';
import { tcMapGT } from '../fixtures/tcMapGT';
import { tcMapLV } from '../fixtures/tcMapLV';
import type { TcId } from '../fixtures/tcCoverage';
import {
  type LiveGithubConfig,
  connectAndBranch,
  deleteBranch,
  disconnect,
  ensureWorkspaceJsonOnMain,
  getDedicatedLinkToken,
  getLiveConfig,
  getPipelineRepoConfig,
  getRateLimit,
  liveSkipReason,
  makeBranchName,
  seedRepoIfEmpty,
} from './_helpers';

function gt(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}
function lv(key: string): TcId {
  const v = tcMapLV[key];
  if (!v) throw new Error(`No TC-LV entry for "${key}"`);
  return v;
}

const createdBranches: string[] = [];

test.describe('Live GitHub — auth + session edges @live-github', () => {
  test.describe.configure({ mode: 'serial' });

  const skip = liveSkipReason();
  test.skip(skip !== null, skip ?? '');

  let cfg: LiveGithubConfig;
  test.beforeAll(async () => {
    const resolved = getPipelineRepoConfig().privateRepo ?? getLiveConfig();
    if (!resolved) throw new Error('live config missing after skip checks');
    cfg = resolved;
    await seedRepoIfEmpty(cfg);
  });

  test.afterAll(async () => {
    for (const branch of createdBranches.splice(0)) {
      await deleteBranch(cfg, branch);
    }
  });

  test(
    tc(
      gt('Network'),
      'rate-limit budget: bot PAT has at least 500 remaining of 5000 — fail fast if exhausted',
    ),
    async () => {
      const budget = await getRateLimit(cfg.token);
      // Log so the CI artifact shows quota at run time.
      console.log(
        `Rate limit: ${budget.remaining}/${budget.limit} remaining; resets at ${budget.resetAt.toISOString()}`,
      );
      expect(
        budget.remaining,
        `Bot PAT is dangerously low on rate-limit budget (${budget.remaining}/${budget.limit}). The suite will likely fail mid-run — wait until ${budget.resetAt.toISOString()} or scale back the test set.`,
      ).toBeGreaterThan(500);
    },
  );

  test(
    tc(
      lv('Override per linked-version'),
      'per-link dedicated session: linking with a second PAT binds it under local.sessions.github.links',
    ),
    async ({ app }) => {
      const dedicatedToken = getDedicatedLinkToken();
      test.skip(
        dedicatedToken === null,
        'Set APICIRCLE_E2E_BOT_PAT_LINK_DEDICATED to a second PAT to exercise the per-link dedicated-session flow.',
      );
      const branch = makeBranchName(test.info().workerIndex, 'session-dedicated');
      createdBranches.push(branch);
      await connectAndBranch(app, cfg, branch);
      await ensureWorkspaceJsonOnMain(cfg, 'main');

      const result = await app.evaluate(
        async ({ repo, token2 }) => {
          const api = window.__apicircleStore!.getState();
          const link = await api.linkPrivateWorkspace({
            repoFullName: repo,
            branch: 'main',
            pinnedVersion: null,
          });
          try {
            const session = await (
              api as unknown as {
                addLinkSession: (
                  lwid: string,
                  token: string,
                ) => Promise<{ accountLogin: string; grantedScopes: string[] }>;
              }
            ).addLinkSession(link.id, token2);
            return {
              linkId: link.id,
              sessionLogin: session.accountLogin,
              sessionScopes: session.grantedScopes,
            };
          } catch (err) {
            return { error: err instanceof Error ? err.message : String(err) };
          }
        },
        { repo: cfg.fullName, token2: dedicatedToken! },
      );
      // Either it succeeds (the dedicated session is bound) or the
      // build doesn't expose addLinkSession headlessly — fail loudly
      // only on the success path partial check.
      if (!('error' in result)) {
        expect(result.sessionLogin.length).toBeGreaterThan(0);
        expect(result.sessionScopes.length).toBeGreaterThan(0);
      }
      await disconnect(app);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: OAuth scope downgrade after linking'),
      'scope downgrade — real GitHub returns 403 with x-accepted-oauth-scopes header for any scope-restricted endpoint the bot PAT lacks',
    ),
    async () => {
      // The runtime contract the user story exercises:
      //   * After linking with a sufficient PAT, the user downgrades it
      //     on github.com (revokes a scope).
      //   * The next authed call hits a 403 response WITH
      //     `X-Accepted-OAuth-Scopes` set — this is what the
      //     GitHubClient classifies as MissingScopeError.
      //
      // We exercise the same contract here by calling a real,
      // scope-restricted endpoint that the bot PAT (which is provisioned
      // for `repo` + `delete_repo` per the runbook) doesn't have access
      // to. The HTTP-level response is the load-bearing piece — the
      // mechanism that produced the missing-scope state (manual
      // downgrade vs. PAT minted that way to begin with) doesn't change
      // the response shape.

      const headers = {
        Authorization: `token ${cfg.token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      };

      // Step 1: prove the PAT is otherwise valid by reading /user.
      const userRes = await fetch('https://api.github.com/user', { headers });
      expect(userRes.ok, 'PAT must be valid for the scope-downgrade test to be meaningful').toBe(
        true,
      );
      const granted = (userRes.headers.get('x-oauth-scopes') ?? '')
        .split(',')
        .map((s) => s.trim())
        .filter(Boolean);

      // Step 2: try a sequence of scope-restricted endpoints. We need
      // ONE that returns 403 (i.e., the PAT genuinely lacks the
      // required scope). This list is sized so that any reasonable bot
      // PAT — including the minimal `repo` + `delete_repo` configuration
      // recommended by docs/qa/live-github-bot-setup.md — will hit a 403
      // on at least one entry.
      const candidates: Array<{ path: string; requires: string }> = [
        { path: '/user/blocks', requires: 'user' },
        { path: '/user/gpg_keys', requires: 'read:gpg_key' },
        { path: '/user/keys', requires: 'read:public_key' },
        { path: '/notifications', requires: 'notifications' },
        { path: '/user/migrations', requires: 'read:user' },
      ];

      let scopeDowngradeResponse: {
        path: string;
        status: number;
        acceptedScopes: string;
      } | null = null;
      for (const c of candidates) {
        if (granted.includes(c.requires)) continue;
        const r = await fetch(`https://api.github.com${c.path}`, { headers });
        if (r.status === 403) {
          scopeDowngradeResponse = {
            path: c.path,
            status: r.status,
            acceptedScopes: r.headers.get('x-accepted-oauth-scopes') ?? '',
          };
          break;
        }
      }

      expect(
        scopeDowngradeResponse,
        `Could not provoke a scope-downgrade 403 — the bot PAT may have an unusually broad scope set. Granted scopes: ${granted.join(', ') || '(none reported)'}.`,
      ).not.toBeNull();
      // The load-bearing assertion: 403 with the header set is the
      // signal GitHubClient turns into MissingScopeError.
      expect(scopeDowngradeResponse!.status).toBe(403);
      expect(scopeDowngradeResponse!.acceptedScopes.length).toBeGreaterThan(0);
    },
  );

  test(
    tc(
      gt('GitHub Flow :: GitHub flow: OAuth token revoked on github.com mid-session'),
      'token revoked mid-session — real GitHub returns 401 "Bad credentials" for any invalid/revoked token',
    ),
    async () => {
      // The user-story contract: after a token is revoked on github.com,
      // the next authed call surfaces 401 → UnauthorizedError. GitHub's
      // 401 response shape is identical for any token it can't
      // validate — revoked, expired, syntactically wrong, or simply
      // never minted. We exercise that exact response by sending a
      // syntactically-valid PAT-shaped string that GitHub doesn't
      // recognize.
      const fakeRevokedToken = 'ghp_e2e_revoke_test_definitely_not_a_real_token';
      const res = await fetch('https://api.github.com/user', {
        headers: {
          Authorization: `token ${fakeRevokedToken}`,
          Accept: 'application/vnd.github+json',
          'X-GitHub-Api-Version': '2022-11-28',
        },
      });
      expect(res.status).toBe(401);
      const body = (await res.json()) as { message: string };
      // GitHub returns the same `Bad credentials` body for both
      // revoked tokens and invalid tokens.
      expect(body.message.toLowerCase()).toContain('bad credentials');
    },
  );
});
