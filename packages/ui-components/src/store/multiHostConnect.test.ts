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

describe('workspaceStore — a token never reaches another host (S3c)', () => {
  // The credential-crossing class. Every instance had one shape: a client built
  // for one host beside a token resolved for another. They agreed while GitHub
  // was the only connectable host and stopped agreeing the moment it was not.
  //
  // These assert on the TOKEN THE CLIENT RECEIVED, not on which call was made —
  // "it called GitLab" is true of both the correct and the leaking version.
  // This block records the TOKEN each client received, not which calls happened —
  // "it called GitLab" is true of the leaking version too.
  let seen: Array<{ host: string; token: string }>;

  /** A provider that records the token handed to it. */
  function spyProvider(host: string): GitProvider {
    return {
      getViewer: vi.fn(async (token: string) => {
        seen.push({ host, token });
        return { viewer: { login: `${host}-user`, id: 1 }, scopes: { granted: [], missing: [] } };
      }),
      listAccessibleRepos: vi.fn(async (token: string) => {
        seen.push({ host, token });
        return [];
      }),
      listBranches: vi.fn(async (token: string) => {
        seen.push({ host, token });
        return [];
      }),
      getRepo: vi.fn(async (token: string, owner: string, name: string) => {
        seen.push({ host, token });
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
      searchMarketplaceRepos: vi.fn(async (token: string | null) => {
        seen.push({ host, token: token ?? '<anonymous>' });
        return [];
      }),
    } as unknown as GitProvider;
  }

  beforeEach(async () => {
    seen = [];
    resetGitProviderRegistry();
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    resetGitProviderRegistry();
    vi.unstubAllGlobals();
  });

  it('sends the GitLab token — not the GitHub one — when the repo browser targets GitLab', async () => {
    // The headline leak. `listAccessibleRepos` runs BEFORE a repo is connected,
    // which is exactly when the connected-host fallback still answers 'github',
    // so the GitHub PAT went to whichever host the picker named.
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('GITHUB-SECRET');
    vi.unstubAllGlobals();
    registerGitProvider('gitlab', () => spyProvider('gitlab'));
    await useWorkspaceStore.getState().connectHostSession('GITLAB-SECRET', 'gitlab');
    seen.length = 0;

    await useWorkspaceStore.getState().listAccessibleRepos({ host: 'gitlab' });

    expect(seen).toEqual([{ host: 'gitlab', token: 'GITLAB-SECRET' }]);
    expect(seen.some((s) => s.token === 'GITHUB-SECRET')).toBe(false);
  });

  it('sends the right token when listing branches on a caller-named host', async () => {
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('GITHUB-SECRET');
    vi.unstubAllGlobals();
    registerGitProvider('bitbucket', () => spyProvider('bitbucket'));
    await useWorkspaceStore.getState().connectHostSession('BB-SECRET', 'bitbucket');
    seen.length = 0;

    await useWorkspaceStore.getState().listRepoBranches('team', 'api', { host: 'bitbucket' });

    expect(seen).toEqual([{ host: 'bitbucket', token: 'BB-SECRET' }]);
  });

  it('never sends a non-GitHub token to the GitHub marketplace', async () => {
    // The reverse direction, and one no reviewer flagged: marketplace search is
    // deliberately pinned to GitHub, but the token came from the CONNECTED host —
    // so a GitLab-only workspace sent its GitLab PAT to github.com.
    registerGitProvider('gitlab', () => spyProvider('gitlab'));
    await useWorkspaceStore.getState().connectHostSession('GITLAB-SECRET', 'gitlab');
    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });

    const marketplaceTokens: Array<string | null> = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (_url: string, init?: RequestInit) => {
        const auth = (init?.headers as Record<string, string> | undefined)?.Authorization ?? null;
        marketplaceTokens.push(auth);
        return new Response(JSON.stringify({ items: [] }), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    await useWorkspaceStore.getState().searchMarketplace('anything');

    // No GitHub session exists, so the search must go out ANONYMOUSLY rather
    // than carrying the GitLab credential.
    expect(marketplaceTokens.every((t) => t === null || !t.includes('GITLAB-SECRET'))).toBe(true);
  });

  it('honours an explicit tokenOverride without consulting any session', async () => {
    registerGitProvider('gitlab', () => spyProvider('gitlab'));
    await useWorkspaceStore.getState().connectHostSession('GITLAB-SECRET', 'gitlab');
    seen.length = 0;

    await useWorkspaceStore
      .getState()
      .listAccessibleRepos({ host: 'gitlab', tokenOverride: 'DEDICATED-LINK-TOKEN' });

    expect(seen).toEqual([{ host: 'gitlab', token: 'DEDICATED-LINK-TOKEN' }]);
  });
});

describe('workspaceStore — the session lifecycle is host-aware (S3b)', () => {
  // Connect shipped in S3; verify / rotate / disconnect stayed pinned to the
  // GitHub slot, so a GitLab session could be created and then never tested,
  // rotated or removed — and `disconnectGitHubSession` also clears
  // `connectedRepo` + `workingBranch`, so pressing Disconnect on what the UI
  // labelled GitLab destroyed the GitHub binding instead.
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

  it('verifies the GitLab token against GitLab, and writes the answer to its own slot', async () => {
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab', []));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
    calls.length = 0;

    const granted = await useWorkspaceStore.getState().verifyHostScopes('gitlab');

    expect(calls).toContain('gitlab:getViewer');
    expect(granted).toEqual([]);
    const local = useWorkspaceStore.getState().local!;
    expect(local.sessions.hosts?.gitlab?.workspace?.lastVerifiedAt).not.toBeNull();
  });

  it('rotates the GitLab token in place without touching GitHub', async () => {
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('ghp-x');
    vi.unstubAllGlobals();
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab', []));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');

    await useWorkspaceStore.getState().updateHostToken('glpat-new', 'gitlab');

    const local = useWorkspaceStore.getState().local!;
    expect(local.sessions.hosts?.gitlab?.workspace?.accountLogin).toBe('gitlab-user');
    expect(local.sessions.github.workspace?.accountLogin).toBe('gh-user');
  });

  it('disconnects ONLY the named host, and keeps a repo that belongs to another', async () => {
    // The destructive one. Disconnect clears the connected repo + working branch,
    // which is right when they belong to the host being disconnected and is data
    // loss when they do not. Driven as "disconnect GitHub, keep the GitLab repo"
    // because that is the direction a user actually hits: they tidy up an old
    // GitHub session and expect their GitLab workspace to survive it.
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('ghp-x');
    vi.unstubAllGlobals();
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab', []));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });

    await useWorkspaceStore.getState().disconnectHostSession('github');

    const local = useWorkspaceStore.getState().local!;
    expect(local.sessions.github.workspace).toBeNull();
    // GitLab's session and its repo are untouched.
    expect(local.sessions.hosts?.gitlab?.workspace?.accountLogin).toBe('gitlab-user');
    expect(local.connectedRepo?.fullName).toBe('group/api');
    expect(local.connectedRepo?.hostKind).toBe('gitlab');
  });

  it('still clears the repo when the disconnected host is the one that owns it', async () => {
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab', []));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });

    await useWorkspaceStore.getState().disconnectHostSession('gitlab');

    const local = useWorkspaceStore.getState().local!;
    expect(local.connectedRepo).toBeNull();
    expect(local.workingBranch).toBeNull();
  });

  it('the GitHub-named actions still delegate, so existing callers are unchanged', async () => {
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('ghp-x');
    await useWorkspaceStore.getState().verifyGitHubScopes();
    await useWorkspaceStore.getState().disconnectGitHubSession();

    expect(useWorkspaceStore.getState().local!.sessions.github.workspace).toBeNull();
  });
});

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
