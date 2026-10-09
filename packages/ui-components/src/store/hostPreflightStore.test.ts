import { act } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  registerGitProvider,
  resetGitProviderRegistry,
  UnauthorizedError,
  type GitProvider,
} from '@apicircle/git';
import { deleteSecretPayload } from '../persistence/secrets';
import { useWorkspaceStore } from './workspaceStore';

// `preflightHostConnection` — what "Test connection" runs. The checks themselves
// are covered in `hostPreflight.test.ts`; this file covers what the store does
// around them: which repo it asks about, what it records, and what it leaves
// alone when the session changes while the checks are in flight.

interface Canned {
  status?: number;
  body: unknown;
  headers?: Record<string, string>;
}

/**
 * GitHub answers by path, not by call order: the branch and pull-request
 * listings go out together, so a queue of responses would hand each the other's.
 */
function stubGitHub(routes: {
  user?: Canned;
  repo?: Canned;
  branches?: Canned;
  pulls?: Canned;
}): ReturnType<typeof vi.fn> {
  const fetchMock = vi.fn(async (input: string | URL) => {
    const path = new URL(input).pathname;
    const canned =
      path === '/user'
        ? (routes.user ?? {
            body: { login: 'me', id: 1 },
            headers: { 'x-oauth-scopes': 'repo' },
          })
        : path.endsWith('/branches')
          ? (routes.branches ?? { body: [{ name: 'main', commit: { sha: 'a' } }] })
          : path.endsWith('/pulls')
            ? (routes.pulls ?? { body: [] })
            : (routes.repo ?? {
                body: {
                  full_name: 'me/api',
                  name: 'api',
                  owner: { login: 'me' },
                  default_branch: 'main',
                  visibility: 'private',
                  permissions: { push: true, admin: false },
                },
              });
    return new Response(JSON.stringify(canned.body), {
      status: canned.status ?? 200,
      headers: { 'content-type': 'application/json', ...(canned.headers ?? {}) },
    });
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

function pathsOf(fetchMock: ReturnType<typeof vi.fn>): string[] {
  return fetchMock.mock.calls.map(([input]) => new URL(String(input)).pathname);
}

/** A non-GitHub provider that records its calls and can be held open mid-check. */
function stubHost(calls: string[], opts: { pushable?: boolean; gate?: Promise<void> } = {}) {
  return (): GitProvider =>
    ({
      getViewer: vi.fn(async () => {
        calls.push('getViewer');
        await opts.gate;
        return { viewer: { login: 'gl-user', id: 7 }, scopes: { granted: [] } };
      }),
      getRepo: vi.fn(async (_token: string, owner: string, name: string) => {
        calls.push('getRepo');
        return {
          fullName: `${owner}/${name}`,
          owner,
          name,
          defaultBranch: 'main',
          visibility: 'private' as const,
          isPrivate: true,
          pushable: opts.pushable ?? true,
        };
      }),
      listBranches: vi.fn(async () => {
        calls.push('listBranches');
        return [];
      }),
      listPullRequests: vi.fn(async () => {
        calls.push('listPullRequests');
        return [];
      }),
    }) as unknown as GitProvider;
}

describe('workspaceStore — preflightHostConnection', () => {
  beforeEach(async () => {
    resetGitProviderRegistry();
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => {
    resetGitProviderRegistry();
    vi.unstubAllGlobals();
  });

  it('returns null when the host holds no session', async () => {
    expect(await useWorkspaceStore.getState().preflightHostConnection()).toBeNull();
    expect(await useWorkspaceStore.getState().preflightHostConnection('gitlab')).toBeNull();
  });

  it('returns null when the stored token is gone from the vault', async () => {
    stubGitHub({});
    const session = await useWorkspaceStore.getState().connectGitHubSession('tok');
    await deleteSecretPayload(session.tokenSecretId);

    expect(await useWorkspaceStore.getState().preflightHostConnection()).toBeNull();
  });

  it('with no repo connected, checks the token and scopes and asks about no repo', async () => {
    stubGitHub({});
    await useWorkspaceStore.getState().connectGitHubSession('tok');
    const fetchMock = stubGitHub({
      user: { body: { login: 'me', id: 1 }, headers: { 'x-oauth-scopes': 'repo, gist' } },
    });

    const report = await useWorkspaceStore.getState().preflightHostConnection();

    expect(report?.checks.map((c) => [c.id, c.status])).toEqual([
      ['token', 'pass'],
      ['scopes', 'pass'],
      ['repository', 'unknown'],
    ]);
    expect(pathsOf(fetchMock)).toEqual(['/user']);
    const session = useWorkspaceStore.getState().local!.sessions.github.workspace!;
    expect(session.grantedScopes).toEqual(['repo', 'gist']);
    expect(session.canCreatePullRequests).toBe(true);
    expect(session.scopesReported).toBe(true);
  });

  it('tests a fine-grained GitHub token against its repo, with the scope check left open', async () => {
    // No `x-oauth-scopes` header on any response: GitHub reports no scopes for
    // this token, so the answers come from the repo alone.
    const user = { body: { login: 'me', id: 1 } };
    stubGitHub({ user });
    await useWorkspaceStore.getState().connectGitHubSession('github_pat_x');
    await useWorkspaceStore.getState().connectRepo('me', 'api');

    const report = await useWorkspaceStore.getState().preflightHostConnection();

    expect(report?.checks.map((c) => [c.id, c.status])).toEqual([
      ['token', 'pass'],
      ['scopes', 'unknown'],
      ['repository', 'pass'],
      // The account can push; whether this token may is not something a read shows.
      ['push', 'unknown'],
      ['branches', 'pass'],
      ['pull-requests', 'pass'],
    ]);
    const local = useWorkspaceStore.getState().local!;
    const session = local.sessions.github.workspace!;
    expect(session.grantedScopes).toEqual([]);
    expect(session.scopesReported).toBe(false);
    expect(session.canCreatePullRequests).toBe(true);
    expect(local.connectedRepo?.pushable).toBe(true);
  });

  it('records the change when a later test finds the scopes reported', async () => {
    // What a session holds once GitHub starts answering for its token.
    stubGitHub({ user: { body: { login: 'me', id: 1 } } });
    await useWorkspaceStore.getState().connectGitHubSession('github_pat_x');
    expect(useWorkspaceStore.getState().local!.sessions.github.workspace!.scopesReported).toBe(
      false,
    );

    stubGitHub({});
    const report = await useWorkspaceStore.getState().preflightHostConnection();

    expect(report?.checks.find((c) => c.id === 'scopes')?.status).toBe('pass');
    const session = useWorkspaceStore.getState().local!.sessions.github.workspace!;
    expect(session.grantedScopes).toEqual(['repo']);
    expect(session.scopesReported).toBe(true);
  });

  it('adds no such record on a host whose client does not say', async () => {
    const calls: string[] = [];
    registerGitProvider('gitlab', stubHost(calls));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
    await useWorkspaceStore.getState().preflightHostConnection('gitlab');

    const session = useWorkspaceStore.getState().local!.sessions.hosts!.gitlab!.workspace!;
    expect(session).not.toHaveProperty('scopesReported');
  });

  it('checks the connected repo, and refreshes the session and the push flag', async () => {
    stubGitHub({});
    await useWorkspaceStore.getState().connectGitHubSession('tok');
    await useWorkspaceStore.getState().connectRepo('me', 'api');
    const before = useWorkspaceStore.getState().local!;
    expect(before.connectedRepo?.pushable).toBe(true);

    // Since connecting, the account was dropped to read-only on the repo.
    const fetchMock = stubGitHub({
      repo: {
        body: {
          full_name: 'me/api',
          name: 'api',
          owner: { login: 'me' },
          default_branch: 'main',
          visibility: 'private',
          permissions: { push: false, admin: false },
        },
      },
    });
    await new Promise((r) => setTimeout(r, 5));
    const report = await useWorkspaceStore.getState().preflightHostConnection();

    expect(report?.checks.map((c) => [c.id, c.status])).toEqual([
      ['token', 'pass'],
      ['scopes', 'pass'],
      ['repository', 'pass'],
      ['push', 'fail'],
      ['branches', 'pass'],
      ['pull-requests', 'pass'],
    ]);
    expect(pathsOf(fetchMock).sort()).toEqual([
      '/repos/me/api',
      '/repos/me/api/branches',
      '/repos/me/api/pulls',
      '/user',
    ]);
    const after = useWorkspaceStore.getState().local!;
    expect(after.connectedRepo?.pushable).toBe(false);
    // Everything else about the connection is as it was.
    expect({ ...after.connectedRepo, pushable: true }).toEqual(before.connectedRepo);
    expect(new Date(after.sessions.github.workspace!.lastVerifiedAt!).getTime()).toBeGreaterThan(
      new Date(before.sessions.github.workspace!.lastVerifiedAt!).getTime(),
    );
  });

  it('records that pull requests cannot be created when the host refuses to list them', async () => {
    stubGitHub({});
    await useWorkspaceStore.getState().connectGitHubSession('tok');
    await useWorkspaceStore.getState().connectRepo('me', 'api');
    expect(
      useWorkspaceStore.getState().local!.sessions.github.workspace!.canCreatePullRequests,
    ).toBe(true);

    stubGitHub({ pulls: { status: 403, body: { message: 'Resource not accessible' } } });
    const report = await useWorkspaceStore.getState().preflightHostConnection();

    expect(report?.checks.find((c) => c.id === 'pull-requests')?.status).toBe('fail');
    expect(
      useWorkspaceStore.getState().local!.sessions.github.workspace!.canCreatePullRequests,
    ).toBe(false);
  });

  it('lets a rejected token throw and leaves the session as it was', async () => {
    stubGitHub({});
    await useWorkspaceStore.getState().connectGitHubSession('tok');
    const before = useWorkspaceStore.getState().local!.sessions.github.workspace!;

    stubGitHub({ user: { status: 401, body: { message: 'Bad credentials' } } });
    await expect(useWorkspaceStore.getState().preflightHostConnection()).rejects.toBeInstanceOf(
      UnauthorizedError,
    );

    expect(useWorkspaceStore.getState().local!.sessions.github.workspace).toEqual(before);
  });

  it('asks a host only about a repo that lives on it', async () => {
    // GitHub and GitLab both hold a session; the workspace's repo is on GitLab.
    // Testing the GitHub session must not look for `group/api` on github.com.
    stubGitHub({});
    await useWorkspaceStore.getState().connectGitHubSession('tok');
    const calls: string[] = [];
    registerGitProvider('gitlab', stubHost(calls));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });

    const fetchMock = stubGitHub({});
    const report = await useWorkspaceStore.getState().preflightHostConnection('github');

    expect(report?.checks.map((c) => c.id)).toEqual(['token', 'scopes', 'repository']);
    expect(report?.checks.at(-1)?.detail).toMatch(/^No GitHub repository is connected yet/);
    expect(pathsOf(fetchMock)).toEqual(['/user']);
    expect(useWorkspaceStore.getState().local!.connectedRepo?.fullName).toBe('group/api');
  });

  it('tests a non-GitHub host through its own provider, into its own slot', async () => {
    const calls: string[] = [];
    registerGitProvider('gitlab', stubHost(calls, { pushable: false }));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
    // Connected while the account could still push.
    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });
    useWorkspaceStore.setState((s) => ({
      local: { ...s.local!, connectedRepo: { ...s.local!.connectedRepo!, pushable: true } },
    }));
    calls.length = 0;

    const report = await useWorkspaceStore.getState().preflightHostConnection('gitlab');

    expect(report?.host).toBe('gitlab');
    expect(calls.sort()).toEqual(['getRepo', 'getViewer', 'listBranches', 'listPullRequests']);
    const local = useWorkspaceStore.getState().local!;
    expect(local.connectedRepo?.pushable).toBe(false);
    expect(local.sessions.hosts?.gitlab?.workspace?.canCreatePullRequests).toBe(true);
    expect(local.sessions.github.workspace).toBeNull();
  });

  it('writes nothing when the session is disconnected while the checks run', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const calls: string[] = [];
    // Connect ungated, then swap in a provider that holds the identity call open.
    registerGitProvider('gitlab', stubHost(calls));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
    registerGitProvider('gitlab', stubHost(calls, { gate }));

    const pending = useWorkspaceStore.getState().preflightHostConnection('gitlab');
    await vi.waitFor(() => expect(calls.at(-1)).toBe('getViewer'));
    await useWorkspaceStore.getState().disconnectHostSession('gitlab');
    open();
    const report = await pending;

    // The caller still gets the answer it asked for; the store keeps none of it.
    expect(report?.accountLogin).toBe('gl-user');
    expect(useWorkspaceStore.getState().local!.sessions.hosts?.gitlab?.workspace).toBeNull();
  });

  it('does not write one repo’s push flag onto another connected meanwhile', async () => {
    let open!: () => void;
    const gate = new Promise<void>((resolve) => {
      open = resolve;
    });
    const calls: string[] = [];
    registerGitProvider('gitlab', stubHost(calls));
    await useWorkspaceStore.getState().connectHostSession('glpat-x', 'gitlab');
    await useWorkspaceStore.getState().connectRepo('group', 'api', { host: 'gitlab' });
    registerGitProvider('gitlab', stubHost(calls, { gate, pushable: false }));

    const pending = useWorkspaceStore.getState().preflightHostConnection('gitlab');
    await vi.waitFor(() => expect(calls.at(-1)).toBe('getViewer'));
    useWorkspaceStore.setState((s) => ({
      local: {
        ...s.local!,
        connectedRepo: { ...s.local!.connectedRepo!, fullName: 'group/other', name: 'other' },
      },
    }));
    open();
    await pending;

    const local = useWorkspaceStore.getState().local!;
    expect(local.connectedRepo?.fullName).toBe('group/other');
    expect(local.connectedRepo?.pushable).toBe(true);
    // The session itself was still the one tested, so it is refreshed.
    expect(local.sessions.hosts?.gitlab?.workspace?.lastVerifiedAt).not.toBeNull();
  });
});
