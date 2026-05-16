// Opt-in live GitHub credential smoke.
//
// This spec intentionally reads the PAT only from process env at runtime.
// Do not hard-code a token in this file, in package scripts, or in docs.

import { expect, test } from './fixtures/app';
import { tc } from './fixtures/tcCoverage';
import type { TcId } from './fixtures/tcCoverage';
import { tcMapGT } from './fixtures/tcMapGT';

const ENABLE_ENV = 'APICIRCLE_E2E_LIVE_GITHUB';
const TOKEN_ENV = 'APICIRCLE_E2E_GITHUB_PAT';
const REPO_ENV = 'APICIRCLE_E2E_GITHUB_REPO';

function id(key: string): TcId {
  const v = tcMapGT[key];
  if (!v) throw new Error(`No TC-GT entry for "${key}"`);
  return v;
}

interface LiveGithubConfig {
  token: string;
  owner: string;
  name: string;
  fullName: string;
}

function getLiveGithubConfig(): LiveGithubConfig | null {
  if (process.env[ENABLE_ENV] !== '1') return null;
  const token = process.env[TOKEN_ENV]?.trim();
  const repo = process.env[REPO_ENV]?.trim();
  if (!token || !repo) return null;

  const [owner, name, ...rest] = repo.split('/');
  if (!owner || !name || rest.length > 0) return null;
  return { token, owner, name, fullName: `${owner}/${name}` };
}

function liveGithubSkipReason(): string | null {
  if (process.env[ENABLE_ENV] !== '1') {
    return `Set ${ENABLE_ENV}=1 to run live GitHub credential checks.`;
  }
  if (!process.env[TOKEN_ENV]?.trim()) {
    return `Set ${TOKEN_ENV} to a GitHub PAT at runtime.`;
  }
  const repo = process.env[REPO_ENV]?.trim();
  if (!repo) return `Set ${REPO_ENV}=owner/repo for the live target repo.`;
  if (!/^[^/]+\/[^/]+$/.test(repo)) return `${REPO_ENV} must use owner/repo format.`;
  return null;
}

interface StoreApi {
  connectGitHubSession: (token: string) => Promise<{
    accountLogin: string;
    grantedScopes: string[];
    canCreatePullRequests?: boolean | null;
  }>;
  connectRepo: (
    owner: string,
    name: string,
  ) => Promise<{
    fullName: string;
    pushable?: boolean;
    visibility?: string;
  }>;
  disconnectGitHubSession: () => Promise<void>;
  local?: {
    connectedRepo?: { fullName: string } | null;
    sessions?: {
      github?: {
        workspace?: {
          accountLogin?: string;
          grantedScopes?: string[];
          canCreatePullRequests?: boolean | null;
        } | null;
      };
    };
  };
}

test.describe('Live GitHub credential smoke', () => {
  const skipReason = liveGithubSkipReason();
  test.skip(skipReason !== null, skipReason ?? '');

  test(
    tc(
      id('GitHub Flow :: GitHub flow: Link to private repo with personal token'),
      'env PAT connects GitHub session and target repo @live-github',
    ),
    async ({ app }) => {
      const cfg = getLiveGithubConfig();
      expect(cfg, 'live GitHub config should be present after skip checks').not.toBeNull();

      const result = await app.evaluate(async ({ token, owner, name }) => {
        const w = window as unknown as { __apicircleStore?: { getState: () => StoreApi } };
        const store = w.__apicircleStore;
        if (!store) throw new Error('__apicircleStore not exposed in this build');

        const api = store.getState();
        try {
          const session = await api.connectGitHubSession(token);
          const repo = await api.connectRepo(owner, name);
          const state = store.getState();

          return {
            login: session.accountLogin,
            scopes: session.grantedScopes,
            canCreatePullRequests: session.canCreatePullRequests ?? false,
            repoFullName: repo.fullName,
            repoPushable: repo.pushable ?? false,
            repoVisibility: repo.visibility ?? null,
            connectedBeforeCleanup: state.local?.connectedRepo?.fullName ?? null,
            sessionLoginBeforeCleanup:
              state.local?.sessions?.github?.workspace?.accountLogin ?? null,
          };
        } finally {
          await store
            .getState()
            .disconnectGitHubSession()
            .catch(() => undefined);
        }
      }, cfg!);

      expect(result.login.length).toBeGreaterThan(0);
      expect(result.repoFullName.toLowerCase()).toBe(cfg!.fullName.toLowerCase());
      expect(result.connectedBeforeCleanup?.toLowerCase()).toBe(cfg!.fullName.toLowerCase());
      expect(result.sessionLoginBeforeCleanup).toBe(result.login);
      expect(result.scopes.length).toBeGreaterThan(0);
    },
  );
});
