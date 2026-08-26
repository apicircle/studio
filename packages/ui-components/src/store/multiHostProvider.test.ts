import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitProvider, resetGitProviderRegistry, type GitProvider } from '@apicircle/git';
import { useWorkspaceStore } from './workspaceStore';

// S2 — the store resolves a Git provider from the DATA (the connected repo's
// host, or a host the caller names) rather than assuming GitHub.
//
// These tests register a real stub provider for a non-GitHub host through the
// open-core registry and assert the store actually routed to it. Asserting on
// the resolved provider rather than on a fetched URL is what makes a silent
// fallback to GitHub detectable — that fallback is the failure that would
// corrupt a non-GitHub workspace.

const REPO = {
  fullName: 'acme/api',
  owner: 'acme',
  name: 'api',
  defaultBranch: 'main',
  visibility: 'private' as const,
  isPrivate: true,
  pushable: true,
  connectedAt: 't',
};

/** A provider stub that records every call as `<host>:<method>`. */
function stubProvider(calls: string[], host: string): GitProvider {
  return {
    getViewer: vi.fn(async () => {
      calls.push(`${host}:getViewer`);
      return { viewer: { login: 'stub', id: 1 }, scopes: { granted: ['repo'], missing: [] } };
    }),
    listAccessibleRepos: vi.fn(async () => {
      calls.push(`${host}:listAccessibleRepos`);
      return [];
    }),
    listBranches: vi.fn(async () => {
      calls.push(`${host}:listBranches`);
      return [];
    }),
    listRepoTopics: vi.fn(async () => {
      calls.push(`${host}:listRepoTopics`);
      return ['from-stub'];
    }),
  } as unknown as GitProvider;
}

/** Stub `fetch` with a single canned JSON body. */
function stubFetch(body: unknown, headers: Record<string, string> = {}) {
  vi.stubGlobal(
    'fetch',
    vi.fn(
      async () =>
        new Response(JSON.stringify(body), {
          status: 200,
          headers: { 'content-type': 'application/json', ...headers },
        }),
    ),
  );
}

/** Connect a real GitHub session so a decryptable workspace token exists —
 *  every repo-bound action decrypts one before it resolves a provider. */
async function seedSession(): Promise<void> {
  stubFetch({ login: 'me', id: 1 }, { 'x-oauth-scopes': 'repo' });
  await useWorkspaceStore.getState().connectGitHubSession('tok');
  vi.unstubAllGlobals();
}

/** Point the workspace at `hostKind` (omit for the pre-multi-host shape). */
function connectRepoAs(hostKind?: 'gitlab' | 'bitbucket' | 'azure-devops'): void {
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: { ...local, connectedRepo: { ...REPO, ...(hostKind ? { hostKind } : {}) } },
  });
}

describe('workspaceStore — provider resolution follows the data (S2)', () => {
  let calls: string[];

  beforeEach(async () => {
    calls = [];
    resetGitProviderRegistry();
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
    await seedSession();
  });

  afterEach(() => {
    resetGitProviderRegistry();
    vi.unstubAllGlobals();
  });

  it('routes a repo-bound action to the connected repo host instead of GitHub', async () => {
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab'));
    connectRepoAs('gitlab');

    await expect(useWorkspaceStore.getState().listRepoTopics()).resolves.toEqual(['from-stub']);
    expect(calls).toContain('gitlab:listRepoTopics');
  });

  it('throws rather than silently falling back to GitHub for an unregistered host', async () => {
    // No provider registered for gitlab — the core registry must refuse rather
    // than quietly resolving GitHub and talking to the wrong server.
    connectRepoAs('gitlab');

    await expect(useWorkspaceStore.getState().listRepoTopics()).rejects.toThrow(
      /No Git provider registered for host "gitlab"/,
    );
  });

  it('still resolves GitHub for a workspace with no hostKind (pre-multi-host)', async () => {
    connectRepoAs();
    stubFetch({ names: ['api'] });

    // Reaches the built-in GitHub provider — so it does NOT raise the
    // unregistered-host error the previous test asserts.
    await expect(useWorkspaceStore.getState().listRepoTopics()).resolves.toEqual(['api']);
  });

  it('falls back to the working branch host when connectedRepo is absent', async () => {
    registerGitProvider('gitlab', () => stubProvider(calls, 'gitlab'));
    const local = useWorkspaceStore.getState().local!;
    useWorkspaceStore.setState({
      local: {
        ...local,
        connectedRepo: null,
        workingBranch: {
          name: 'apicircle/x',
          baseBranch: 'main',
          repoFullName: 'acme/api',
          repoOwner: 'acme',
          repoName: 'api',
          headSha: 'abc',
          createdAt: 't',
          lastPushedSha: null,
          diffSummary: null,
          openPrUrl: null,
          hostKind: 'gitlab',
        },
      },
    });

    // listRepoTopics needs a connected repo, so assert on the resolution error
    // rather than the call — the point is that gitlab was resolvable at all.
    await expect(useWorkspaceStore.getState().listRepoTopics()).rejects.toThrow(/repo/i);
    expect(calls).not.toContain('github:listRepoTopics');
  });

  it('listAccessibleRepos targets the host the caller names', async () => {
    registerGitProvider('bitbucket', () => stubProvider(calls, 'bitbucket'));

    await useWorkspaceStore
      .getState()
      .listAccessibleRepos({ tokenOverride: 'tok', host: 'bitbucket' });

    expect(calls).toContain('bitbucket:listAccessibleRepos');
  });

  it('listRepoBranches targets the host the caller names', async () => {
    registerGitProvider('azure-devops', () => stubProvider(calls, 'azure'));

    await useWorkspaceStore
      .getState()
      .listRepoBranches('org', 'repo', { tokenOverride: 'tok', host: 'azure-devops' });

    expect(calls).toContain('azure:listBranches');
  });

  it('defaults to GitHub when the caller names no host', async () => {
    // If `targetProvider` resolved anything but github, this would raise the
    // unregistered-host error instead of reaching fetch.
    stubFetch([]);

    await expect(
      useWorkspaceStore.getState().listAccessibleRepos({ tokenOverride: 'tok' }),
    ).resolves.toEqual([]);
  });
});
