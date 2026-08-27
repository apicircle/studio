import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  MissingScopeError,
  registerGitProvider,
  resetGitProviderRegistry,
  type GitProvider,
} from '@apicircle/git';
import { useWorkspaceStore } from './workspaceStore';

// S3 — a NON-GitHub host can actually be connected.
//
// The seam for this landed in S1/S2, but the connect path itself stayed pinned:
// `REQUIRED_BASE_SCOPES = ['repo']` is GitHub's scope vocabulary, and GitLab,
// Bitbucket and Azure DevOps all report `scopes: { granted: [] }` because none of
// them expose a token's scopes. So every valid non-GitHub token was rejected with
// a MissingScopeError naming a scope that host does not have — the product asking
// for something the host cannot give, and blaming the user for the answer.
//
// Two things are asserted throughout, deliberately separately:
//   1. a non-GitHub token connects, and lands in ITS OWN slot;
//   2. GitHub is byte-identical — same scope enforcement, same session slot, same
//      vault label. Studio is a public product with real installs, so "we didn't
//      change GitHub" has to be a test, not a claim.

/** A provider stub that records calls and reports `granted` from `scopes`. */
function stubProvider(calls: string[], host: string, granted: string[]): GitProvider {
  return {
    getViewer: vi.fn(async () => {
      calls.push(`${host}:getViewer`);
      return { viewer: { login: `${host}-user`, id: 7 }, scopes: { granted, missing: [] } };
    }),
    getRepo: vi.fn(async (_token: string, owner: string, name: string) => {
      calls.push(`${host}:getRepo`);
      return {
        fullName: `${owner}/${name}`,
        owner,
        name,
        defaultBranch: 'main',
        visibility: 'private' as const,
        isPrivate: true,
        pushable: true,
      };
    }),
    listAccessibleRepos: vi.fn(async () => {
      calls.push(`${host}:listAccessibleRepos`);
      return [];
    }),
    listPullRequests: vi.fn(async () => {
      calls.push(`${host}:listPullRequests`);
      return [];
    }),
  } as unknown as GitProvider;
}

/** Stub `fetch` so the built-in GitHub client can answer `GET /user`. */
function stubGitHubFetch(scopes: string) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify({ login: 'gh-user', id: 1 }), {
          status: 200,
          headers: { 'content-type': 'application/json', 'x-oauth-scopes': scopes },
        }),
    ),
  );
}

describe('workspaceStore — connecting a non-GitHub host (S3)', () => {
  let calls: string[];

  beforeEach(async () => {
    calls = [];
    resetGitProviderRegistry();
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    resetGitProviderRegistry();
    vi.unstubAllGlobals();
  });

  it('accepts a GitLab token that reports NO scopes at all', async () => {
    // The whole point. GitLab's `/user` carries no scope information, so the
    // client reports `granted: []`; requiring `repo` there rejected every valid
    // token. Enforcing a scope the host cannot report is a false gate, and a
    // false gate is worse than a late error because it blames the wrong thing.
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab', []));

    const session = await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');

    expect(session.accountLogin).toBe('gitlab-user');
    expect(calls).toContain('gitlab:getViewer');
    const local = useWorkspaceStore.getState().local!;
    expect(local.sessions.hosts?.gitlab?.workspace?.accountLogin).toBe('gitlab-user');
    // …and it must NOT have been written into the GitHub slot.
    expect(local.sessions.github.workspace).toBeNull();
  });

  it('still enforces `repo` on GitHub, so the existing gate is unchanged', async () => {
    stubGitHubFetch('read:user'); // a token WITHOUT `repo`
    await expect(useWorkspaceStore.getState().connectGitHubSession('ghp-x')).rejects.toThrow(
      MissingScopeError,
    );
    expect(useWorkspaceStore.getState().local!.sessions.github.workspace).toBeNull();
  });

  it('connects GitHub into its own slot, exactly as before', async () => {
    stubGitHubFetch('repo');
    const session = await useWorkspaceStore.getState().connectGitHubSession('ghp-x');

    const local = useWorkspaceStore.getState().local!;
    expect(session.accountLogin).toBe('gh-user');
    expect(local.sessions.github.workspace?.accountLogin).toBe('gh-user');
    // GitHub is deliberately NOT mirrored into `sessions.hosts`, so a GitHub PAT
    // lives in exactly one place and the two copies cannot disagree. That is
    // enforced by the TYPE — `hosts` is keyed by `Exclude<GitHostKind, 'github'>`,
    // so a runtime assertion here would not compile, which is the stronger
    // guarantee. Asserting the map stayed empty is what is left to check.
    expect(Object.keys(local.sessions.hosts ?? {})).toEqual([]);
    // The vault label keeps its original prefix, so labels already on disk still
    // resolve — a rename here would orphan every stored GitHub token.
    const labels = Object.values(local.secretIndex.entries).map((e) => e.label);
    expect(labels).toContain('github-token:gh-user');
  });

  it('keeps a GitHub session when a second host is connected beside it', async () => {
    // The regression this guards: nine sites once rebuilt `sessions` as an object
    // literal, which drops `sessions.hosts` without any type error because `hosts`
    // is optional. Connecting two hosts is the shortest path to catching a tenth.
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('ghp-x');
    vi.unstubAllGlobals();
    registerGitProvider('bitbucket', () => stubProvider(calls, 'bitbucket', []));
    await useWorkspaceStore.getState().connectHostSession('bb-x', 'bitbucket');

    const local = useWorkspaceStore.getState().local!;
    expect(local.sessions.github.workspace?.accountLogin).toBe('gh-user');
    expect(local.sessions.hosts?.bitbucket?.workspace?.accountLogin).toBe('bitbucket-user');
  });

  it("labels each host's token separately, so the same login cannot collide", async () => {
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab', []));
    registerGitProvider('bitbucket', () => stubProvider(calls, 'bitbucket', []));
    await useWorkspaceStore.getState().connectHostSession('a', 'gitlab');
    await useWorkspaceStore.getState().connectHostSession('b', 'bitbucket');

    const labels = Object.values(useWorkspaceStore.getState().local!.secretIndex.entries).map(
      (e) => e.label,
    );
    expect(labels).toContain('gitlab-token:gitlab-user');
    expect(labels).toContain('bitbucket-token:bitbucket-user');
  });

  it('records the REAL host and base URL on the connected repo', async () => {
    // `hostKind: 'github'` used to be a hardcoded literal here. It was consistent
    // only while GitHub was the sole connectable host; once it is not, a repo that
    // claims GitHub while every later call resolves GitLab is a live defect.
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab', []));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');

    const repo = await useWorkspaceStore
      .getState()
      .connectRepo('group', 'api', { host: 'gitlab', baseUrl: 'https://git.internal/api/v4' });

    expect(repo.hostKind).toBe('gitlab');
    expect(repo.apiBaseUrl).toBe('https://git.internal/api/v4');
    expect(calls).toContain('gitlab:getRepo');
  });

  it('sends the GitLab token to GitLab, not the GitHub one', async () => {
    // The credential-leak guard. Before S3 every repo-bound action decrypted
    // `sessions.github` whatever host the repo was on — so a GitLab-connected
    // workspace would have sent the user's GitHub PAT to gitlab.com. Unreachable
    // while GitHub was the only connectable host; reachable the moment it is not.
    const tokens: string[] = [];
    registerGitProvider('gitlab', () => ({
      ...stubProvider(calls, 'gitlab', []),
      getRepo: vi.fn(async (token: string, owner: string, name: string) => {
        tokens.push(token);
        return {
          fullName: `${owner}/${name}`,
          owner,
          name,
          defaultBranch: 'main',
          visibility: 'private' as const,
          isPrivate: true,
          pushable: true,
        };
      }),
    }));
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('GITHUB-SECRET');
    vi.unstubAllGlobals();
    await useWorkspaceStore.getState().connectHostSession('GITLAB-SECRET', 'gitlab');

    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });

    expect(tokens).toEqual(['GITLAB-SECRET']);
    expect(tokens).not.toContain('GITHUB-SECRET');
  });

  it('reports an unconnected host by name rather than saying "GitHub"', async () => {
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab', []));
    await expect(
      useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' }),
    ).rejects.toThrow(/No GitLab session/);
  });
});
