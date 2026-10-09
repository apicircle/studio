import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  GitHubError,
  MissingScopeError,
  RateLimitedError,
  registerGitProvider,
  resetGitProviderRegistry,
  type GitHostKind,
  type GitProvider,
} from '@apicircle/git';
import type { GitHostSession, WorkspaceLocal } from '@apicircle/shared';
import { anyWorkspaceSession, hostOfWorkspaceSession, useWorkspaceStore } from './workspaceStore';
import * as workspaceSharing from '../layout/workspaceSharing';

// This suite covers the workspace-sharing cluster, which is switched OFF in
// shipped builds (`WORKSPACE_SHARING_ENABLED`). Forcing the accessor to `true`
// keeps that coverage alive — the code is still in the repo and still has to
// work the day the switch flips. The shipped, disabled path is covered by
// `layout/workspaceSharingOff.test.tsx`.
//
// A spy rather than `vi.mock`: `test/setup.ts` imports `workspaceStore`, so the
// store — and the accessor it imports — are already evaluated by the time a
// test file's module mocks register, and a `vi.mock` here would only rebind the
// test's own import. Re-applied per test because setup's `afterEach` calls
// `vi.restoreAllMocks()`, and declared first so it lands before any suite's own
// `beforeEach` reaches a gated action.
beforeEach(() => {
  vi.spyOn(workspaceSharing, 'isWorkspaceSharingEnabled').mockReturnValue(true);
});

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

describe('workspaceStore — a LINK uses its own host, not the workspace (S3d)', () => {
  // A linked workspace lives on its own host, independent of the one this
  // workspace's repo is on. Every part of the link path assumed GitHub: the
  // panel gate read `sessions.github`, no host could be chosen, and
  // `decryptLinkSessionToken` resolved the WORKSPACE's connected host — so a
  // GitLab link on a GitHub workspace fetched with the GitHub PAT.
  let seen: Array<{ host: string; token: string }>;

  function spyProvider(host: string): GitProvider {
    return {
      getViewer: vi.fn(async (token: string) => {
        seen.push({ host, token });
        return { viewer: { login: `${host}-user`, id: 1 }, scopes: { granted: [], missing: [] } };
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
      getContents: vi.fn(async (token: string) => {
        seen.push({ host, token });
        return null;
      }),
      listAccessibleRepos: vi.fn(async () => []),
      listBranches: vi.fn(async () => []),
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

  it('refreshes a GitLab link with the GitLab token, on a GitHub workspace', async () => {
    // Drives `previewLinkedUpdateForLink`, which is where `decryptLinkSessionToken`
    // actually runs. An earlier version of this test drove link CREATION instead —
    // it passed against a deliberately broken build, because creation resolves its
    // own token and never touches the resolver under test. Planting the bug back
    // is what exposed that.
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('GITHUB-SECRET');
    vi.unstubAllGlobals();
    registerGitProvider('gitlab', () => spyProvider('gitlab'));
    await useWorkspaceStore.getState().connectHostSession('GITLAB-SECRET', 'gitlab');

    // A link whose SOURCE is GitLab while the workspace itself is on GitHub —
    // the exact shape that leaked.
    const link = {
      id: 'lnk1',
      name: 'shared',
      kind: 'private' as const,
      source: {
        repoFullName: 'group/shared',
        branch: 'main',
        provider: 'gitlab' as const,
        sessionMode: 'workspace' as const,
      },
    };
    useWorkspaceStore.setState({
      synced: {
        ...useWorkspaceStore.getState().synced!,
        linkedWorkspaces: { lnk1: link as never },
      },
    });
    seen.length = 0;

    await useWorkspaceStore
      .getState()
      .previewLinkedUpdateForLink('lnk1')
      .catch(() => undefined); // the stub serves no workspace.json; the TOKEN is the subject

    expect(seen.length).toBeGreaterThan(0);
    expect(seen.every((s) => s.host === 'gitlab')).toBe(true);
    expect(seen.some((s) => s.token === 'GITHUB-SECRET')).toBe(false);
    expect(seen.every((s) => s.token === 'GITLAB-SECRET')).toBe(true);
  });

  it('names the LINK host when its session is missing, not GitHub', async () => {
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('GITHUB-SECRET');
    vi.unstubAllGlobals();
    registerGitProvider('gitlab', () => spyProvider('gitlab'));

    // GitHub is connected; GitLab is not. A GitLab link must say so rather than
    // silently reaching for the GitHub PAT it can see.
    const link = {
      id: 'lnk2',
      name: 'shared',
      kind: 'private' as const,
      source: {
        repoFullName: 'group/shared',
        branch: 'main',
        provider: 'gitlab' as const,
        sessionMode: 'workspace' as const,
      },
    };
    useWorkspaceStore.setState({
      synced: {
        ...useWorkspaceStore.getState().synced!,
        linkedWorkspaces: { lnk2: link as never },
      },
    });

    await expect(useWorkspaceStore.getState().previewLinkedUpdateForLink('lnk2')).rejects.toThrow(
      /GitLab/,
    );
  });
});

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

  it.each(['gitlab', 'bitbucket', 'azure-devops'] as const)(
    'replaces a %s token that reports no scopes',
    async (host) => {
      // A replacement goes through the connect gate, and the connect gate asks
      // nothing of a host that reports nothing. A rotation that worked before
      // the gate reached this action still works.
      registerGitProvider(host, () => stubProvider(calls, host, []));
      const original = await useWorkspaceStore.getState().connectHostSession('first', host);
      await new Promise((r) => setTimeout(r, 5));

      const updated = await useWorkspaceStore.getState().updateHostToken('second', host);

      expect(updated.tokenSecretId).toBe(original.tokenSecretId);
      expect(updated.grantedScopes).toEqual([]);
      expect(new Date(updated.lastVerifiedAt!).getTime()).toBeGreaterThan(
        new Date(original.lastVerifiedAt!).getTime(),
      );
      expect(useWorkspaceStore.getState().local!.sessions.hosts?.[host]?.workspace).toEqual(
        updated,
      );
    },
  );

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

describe('workspaceStore — connecting a repo settles pull-request capability on its own host', () => {
  // A non-GitHub token connects with `canCreatePullRequests: null`, because
  // nothing its host reports about the token settles it. Connecting a repo is the
  // first moment there is something to ask, and `connectRepo` did ask — but it
  // read and wrote `sessions.github.workspace` whatever host the repo was on. On
  // GitLab, Bitbucket or Azure DevOps that slot is empty, so nothing was asked
  // and the session stayed undecided until someone pressed Test connection.
  const OTHER_HOSTS = ['gitlab', 'bitbucket', 'azure-devops'] as const;
  type OtherHost = (typeof OTHER_HOSTS)[number];
  let calls: string[];

  /** `stubProvider`, with the pull-request listing answering as `listing` does. */
  function providerListing(host: OtherHost, listing: (token: string) => Promise<unknown[]>) {
    return () =>
      ({
        ...stubProvider(calls, host, []),
        listPullRequests: vi.fn(async (token: string) => {
          calls.push(`${host}:listPullRequests`);
          return listing(token);
        }),
      }) as unknown as GitProvider;
  }

  function sessionOn(host: GitHostKind) {
    const { sessions } = useWorkspaceStore.getState().local!;
    return host === 'github' ? sessions.github.workspace! : sessions.hosts![host]!.workspace!;
  }

  /** Put GitHub's session back to "undecided", which connect itself never leaves it in. */
  function undecideGitHub() {
    const local = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...local,
        sessions: {
          ...local.sessions,
          github: {
            ...local.sessions.github,
            workspace: { ...local.sessions.github.workspace!, canCreatePullRequests: null },
          },
        },
      },
    });
  }

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

  it.each(OTHER_HOSTS)('asks %s, with its own token, and records that it can', async (host) => {
    const tokens: string[] = [];
    registerGitProvider(
      host,
      providerListing(host, async (token) => {
        tokens.push(token);
        return [];
      }),
    );
    await useWorkspaceStore.getState().connectHostSession('HOST-SECRET', host);
    expect(sessionOn(host).canCreatePullRequests).toBeNull();
    calls.length = 0;

    await useWorkspaceStore.getState().connectRepo('group', 'api', { host });

    expect(calls).toEqual([`${host}:getRepo`, `${host}:listPullRequests`]);
    expect(tokens).toEqual(['HOST-SECRET']);
    expect(sessionOn(host).canCreatePullRequests).toBe(true);
    // The rest of the session, and the GitHub slot, are as they were.
    expect(sessionOn(host).accountLogin).toBe(`${host}-user`);
    expect(useWorkspaceStore.getState().local!.sessions.github.workspace).toBeNull();
  });

  it.each(OTHER_HOSTS)('records that it cannot when %s refuses the listing', async (host) => {
    registerGitProvider(
      host,
      providerListing(host, async () => {
        throw new GitHubError('Forbidden', 403);
      }),
    );
    await useWorkspaceStore.getState().connectHostSession('HOST-SECRET', host);

    const repo = await useWorkspaceStore.getState().connectRepo('group', 'api', { host });

    expect(sessionOn(host).canCreatePullRequests).toBe(false);
    // A token that cannot open pull requests can still be connected to push.
    expect(repo.hostKind).toBe(host);
    expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe('group/api');
  });

  it.each([
    ['is rate limited', new RateLimitedError('Slow down', 403, Date.now() + 60_000)],
    ['fails on the server', new GitHubError('Bad gateway', 502)],
    ['never arrives', new TypeError('Failed to fetch')],
  ])('leaves it undecided, and still connects, when the listing %s', async (_name, failure) => {
    registerGitProvider(
      'gitlab',
      providerListing('gitlab', async () => {
        throw failure;
      }),
    );
    await useWorkspaceStore.getState().connectHostSession('HOST-SECRET', 'gitlab');

    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });

    expect(calls).toContain('gitlab:listPullRequests');
    expect(sessionOn('gitlab').canCreatePullRequests).toBeNull();
    expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe('group/api');
  });

  it.each([true, false])('does not ask again once the answer is %s', async (decided) => {
    registerGitProvider(
      'gitlab',
      providerListing('gitlab', async () => []),
    );
    await useWorkspaceStore.getState().connectHostSession('HOST-SECRET', 'gitlab');
    const local = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...local,
        sessions: {
          ...local.sessions,
          hosts: {
            ...local.sessions.hosts,
            gitlab: {
              ...local.sessions.hosts!.gitlab!,
              workspace: { ...sessionOn('gitlab'), canCreatePullRequests: decided },
            },
          },
        },
      },
    });
    calls.length = 0;

    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });

    expect(calls).toEqual(['gitlab:getRepo']);
    expect(sessionOn('gitlab').canCreatePullRequests).toBe(decided);
  });

  it("does not write one host's answer onto another host's session", async () => {
    // GitHub's session is undecided too, and the repo being connected is on
    // GitLab. Reading the GitHub slot here asked GitLab about pull requests with
    // the GitLab token and filed the answer under GitHub.
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('GITHUB-SECRET');
    vi.unstubAllGlobals();
    undecideGitHub();
    registerGitProvider(
      'gitlab',
      providerListing('gitlab', async () => {
        throw new GitHubError('Forbidden', 403);
      }),
    );
    await useWorkspaceStore.getState().connectHostSession('GITLAB-SECRET', 'gitlab');

    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });

    expect(sessionOn('gitlab').canCreatePullRequests).toBe(false);
    expect(sessionOn('github').canCreatePullRequests).toBeNull();
  });

  it('still settles GitHub from GitHub, with another host connected beside it', async () => {
    // GitHub's half, unchanged: its own probe, its own slot, and the session
    // on the other host is not touched by it.
    registerGitProvider(
      'gitlab',
      providerListing('gitlab', async () => []),
    );
    await useWorkspaceStore.getState().connectHostSession('GITLAB-SECRET', 'gitlab');
    stubGitHubFetch('repo');
    await useWorkspaceStore.getState().connectGitHubSession('GITHUB-SECRET');
    undecideGitHub();
    const paths: string[] = [];
    vi.stubGlobal(
      'fetch',
      vi.fn(async (input: string | URL) => {
        const path = new URL(input).pathname;
        paths.push(path);
        const body = path.endsWith('/pulls')
          ? []
          : {
              full_name: 'me/api',
              name: 'api',
              owner: { login: 'me' },
              default_branch: 'main',
              visibility: 'private',
              permissions: { push: true, admin: false },
            };
        return new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json' },
        });
      }),
    );
    calls.length = 0;

    await useWorkspaceStore.getState().connectRepo('me', 'api', { host: 'github' });

    expect(paths).toEqual(['/repos/me/api', '/repos/me/api/pulls']);
    expect(calls).toEqual([]);
    expect(sessionOn('github').canCreatePullRequests).toBe(true);
    expect(sessionOn('gitlab').canCreatePullRequests).toBeNull();
  });
});

describe("workspaceStore — the workspace's session is the one on its repo's host", () => {
  // `anyWorkspaceSession` and `hostOfWorkspaceSession` are what a surface reads
  // to show "the" session of a workspace. They answered with the first host
  // holding one, in host order. That is the only answer there is while no repo
  // is connected. Once one is, the workspace is used through ONE host's session,
  // and with a GitHub session beside it the Workspace page showed GitHub's
  // account, scopes and pull-request warning over a repo on another host.
  function sessionOf(host: GitHostKind): GitHostSession {
    return {
      accountLogin: `${host}-user`,
      tokenSecretId: `sec_${host}`,
      grantedScopes: [],
      addedAt: 't',
      lastVerifiedAt: null,
      canCreatePullRequests: null,
    };
  }

  /**
   * A workspace with a session on each of `sessionHosts`, and a repo on
   * `repoHost`. `'unrecorded'` is a repo with no `hostKind`, which is what a
   * workspace persisted before multi-host carries and means GitHub.
   */
  function localWith(
    sessionHosts: readonly GitHostKind[],
    repoHost: GitHostKind | 'unrecorded' | null,
  ): WorkspaceLocal {
    const base = useWorkspaceStore.getState().local!;
    const others = sessionHosts
      .filter((host) => host !== 'github')
      .map((host) => [host, { workspace: sessionOf(host), links: {} }] as const);
    return {
      ...base,
      sessions: {
        github: {
          workspace: sessionHosts.includes('github') ? sessionOf('github') : null,
          links: {},
        },
        ...(others.length > 0 ? { hosts: Object.fromEntries(others) } : {}),
      },
      connectedRepo:
        repoHost === null
          ? null
          : {
              fullName: 'acme/api',
              owner: 'acme',
              name: 'api',
              defaultBranch: 'main',
              visibility: 'private',
              isPrivate: true,
              pushable: true,
              connectedAt: 't',
              ...(repoHost === 'unrecorded' ? {} : { hostKind: repoHost }),
            },
      workingBranch: null,
    };
  }

  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  it.each([
    // The repo's host, whichever hosts hold a session beside it.
    [['github', 'gitlab'], 'gitlab', 'gitlab'],
    [['github', 'bitbucket'], 'bitbucket', 'bitbucket'],
    [['github', 'azure-devops'], 'azure-devops', 'azure-devops'],
    [['gitlab', 'bitbucket'], 'bitbucket', 'bitbucket'],
    [['github', 'gitlab', 'bitbucket', 'azure-devops'], 'bitbucket', 'bitbucket'],
    // A GitHub repo is GitHub's, recorded or not.
    [['github', 'gitlab'], 'github', 'github'],
    [['github', 'gitlab'], 'unrecorded', 'github'],
    // No repo yet: the first host holding a session, as before.
    [['github', 'gitlab'], null, 'github'],
    [['gitlab', 'bitbucket'], null, 'gitlab'],
    [['bitbucket'], null, 'bitbucket'],
    // A single session is the session, whatever the repo record says.
    [['gitlab'], 'gitlab', 'gitlab'],
    [['github'], 'github', 'github'],
  ] as const)('with sessions on %j and the repo on %s, it is %s', (sessions, repoHost, host) => {
    const local = localWith(sessions, repoHost);
    expect(hostOfWorkspaceSession(local)).toBe(host);
    expect(anyWorkspaceSession(local)).toEqual(sessionOf(host));
  });

  it.each([
    [['github'], 'gitlab', 'github'],
    [['bitbucket'], 'unrecorded', 'bitbucket'],
    [['gitlab', 'azure-devops'], 'bitbucket', 'gitlab'],
  ] as const)(
    'with sessions on %j and a repo on %s, which holds none, it falls back to %s',
    (sessions, repoHost, host) => {
      // No action leaves a workspace like this, but a stored one can be. While
      // any host holds a session the workspace must not read as local-only.
      const local = localWith(sessions, repoHost);
      expect(hostOfWorkspaceSession(local)).toBe(host);
      expect(anyWorkspaceSession(local)).toEqual(sessionOf(host));
    },
  );

  it('answers GitHub, and no session, when nothing is connected', () => {
    for (const local of [localWith([], null), localWith([], 'gitlab'), null, undefined]) {
      expect(hostOfWorkspaceSession(local)).toBe('github');
      expect(anyWorkspaceSession(local)).toBeNull();
    }
  });
});
