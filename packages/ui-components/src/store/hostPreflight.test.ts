import { describe, expect, it, vi } from 'vitest';
import {
  GitHubError,
  type GitHostKind,
  type GitProvider,
  RateLimitedError,
  UnauthorizedError,
} from '@apicircle/git';
import {
  runHostPreflight,
  scopesAreReported,
  summarizePreflight,
  type PreflightCheck,
} from './hostPreflight';

const REPO = { owner: 'acme', name: 'api' };

interface Answers {
  granted?: string[];
  /** The client's own word on whether scopes were reported; unset = it does not say. */
  reported?: boolean;
  pushable?: boolean;
  getViewer?: () => Promise<unknown>;
  getRepo?: () => Promise<unknown>;
  listBranches?: () => Promise<unknown>;
  listPullRequests?: () => Promise<unknown>;
}

/** A provider that answers the four calls a pre-flight makes, each overridable. */
function provider(answers: Answers = {}) {
  const calls = {
    getViewer: vi.fn(
      answers.getViewer ??
        (async () => ({
          viewer: { login: 'ada', id: 1, name: null, avatarUrl: null },
          scopes: {
            granted: answers.granted ?? ['repo'],
            ...(answers.reported === undefined ? {} : { reported: answers.reported }),
          },
        })),
    ),
    getRepo: vi.fn(
      answers.getRepo ??
        (async () => ({
          fullName: 'acme/api',
          owner: 'acme',
          name: 'api',
          defaultBranch: 'main',
          visibility: 'private',
          isPrivate: true,
          pushable: answers.pushable ?? true,
        })),
    ),
    listBranches: vi.fn(answers.listBranches ?? (async () => [{ name: 'main', commitSha: 'a' }])),
    listPullRequests: vi.fn(answers.listPullRequests ?? (async () => [])),
  };
  return { calls, client: calls as unknown as GitProvider };
}

function run(
  answers: Answers,
  opts: {
    host?: GitHostKind;
    repo?: typeof REPO | null;
    priorPrCapability?: boolean | null;
  } = {},
) {
  const { calls, client } = provider(answers);
  const outcome = runHostPreflight({
    client,
    token: 'tok',
    host: opts.host ?? 'github',
    repo: opts.repo === undefined ? REPO : opts.repo,
    priorPrCapability: opts.priorPrCapability ?? null,
  });
  return { calls, outcome };
}

function check(checks: PreflightCheck[], id: PreflightCheck['id']): PreflightCheck {
  const found = checks.find((c) => c.id === id);
  if (!found) throw new Error(`no ${id} check in [${checks.map((c) => c.id).join(', ')}]`);
  return found;
}

describe('scopesAreReported', () => {
  it('GitHub always reports, so an empty list is a token with no scopes', () => {
    expect(scopesAreReported('github', [])).toBe(true);
  });

  it('an empty list elsewhere means the host did not say', () => {
    expect(scopesAreReported('gitlab', [])).toBe(false);
    expect(scopesAreReported('bitbucket', [])).toBe(false);
    expect(scopesAreReported('azure-devops', [])).toBe(false);
  });

  it('a non-empty list is an answer on any host', () => {
    expect(scopesAreReported('gitlab', ['read_api'])).toBe(true);
  });

  it('takes the client’s word over the per-host rule when it gives one', () => {
    // GitHub sent no scope header: a fine-grained token, nothing was reported.
    expect(scopesAreReported('github', [], false)).toBe(false);
    // GitHub sent an empty one: a classic token with no scopes.
    expect(scopesAreReported('github', [], true)).toBe(true);
    expect(scopesAreReported('gitlab', [], true)).toBe(true);
  });
});

describe('runHostPreflight — the token and its scopes', () => {
  it('names the account the host says the token belongs to', async () => {
    const { outcome } = run({}, { repo: null });
    const { report } = await outcome;
    expect(report.host).toBe('github');
    expect(report.accountLogin).toBe('ada');
    expect(report.grantedScopes).toEqual(['repo']);
    expect(check(report.checks, 'token')).toMatchObject({
      status: 'pass',
      detail: 'Signed in as ada.',
    });
  });

  it('lets a rejected token throw, so the caller keeps its own handling of one', async () => {
    const { calls, outcome } = run({
      getViewer: async () => {
        throw new UnauthorizedError('Bad credentials', 401);
      },
    });
    await expect(outcome).rejects.toBeInstanceOf(UnauthorizedError);
    expect(calls.getRepo).not.toHaveBeenCalled();
  });

  it('passes the scope check when the needed scope is granted', async () => {
    const { report } = await run({ granted: ['repo', 'gist'] }, { repo: null }).outcome;
    expect(check(report.checks, 'scopes')).toMatchObject({ status: 'pass', detail: 'Has repo.' });
  });

  it('fails it when GitHub reports a token without `repo`', async () => {
    const { report } = await run({ granted: ['gist'] }, { repo: null }).outcome;
    const scopes = check(report.checks, 'scopes');
    expect(scopes.status).toBe('fail');
    expect(scopes.detail).toMatch(/^Missing repo\./);
  });

  it('fails it for a GitHub token with no scopes at all', async () => {
    const { report } = await run({ granted: [] }, { repo: null }).outcome;
    expect(check(report.checks, 'scopes').status).toBe('fail');
    // A client that does not say whether scopes were reported adds nothing.
    expect(report).not.toHaveProperty('scopesReported');
  });

  it('still fails it when GitHub reported an empty scope list (a classic token)', async () => {
    const { report } = await run({ granted: [], reported: true }, { repo: null }).outcome;
    expect(check(report.checks, 'scopes').status).toBe('fail');
    expect(report.scopesReported).toBe(true);
  });

  it('leaves it open for a GitHub token whose scopes were not reported (fine-grained)', async () => {
    const { report } = await run({ granted: [], reported: false }, { repo: null }).outcome;
    expect(check(report.checks, 'scopes')).toMatchObject({
      status: 'unknown',
      detail:
        "GitHub does not report this token's scopes, so they cannot be checked. A fine-grained token carries permissions instead, and GitHub does not report those either.",
    });
    expect(report.grantedScopes).toEqual([]);
    expect(report.scopesReported).toBe(false);
  });

  it('checks what a fine-grained token can reach on the connected repository', async () => {
    // Nothing is known from scopes, so every answer comes from the repo itself.
    const { report, canCreatePullRequests, pushable } = await run({ granted: [], reported: false })
      .outcome;
    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ['token', 'pass'],
      ['scopes', 'unknown'],
      ['repository', 'pass'],
      ['push', 'unknown'],
      ['branches', 'pass'],
      ['pull-requests', 'pass'],
    ]);
    // The pull-request listing went through, which settles what scopes could not.
    expect(canCreatePullRequests).toBe(true);
    // The account's push flag is still what the repo record says.
    expect(pushable).toBe(true);
  });

  it('does not pass the push check on the account’s access alone for such a token', async () => {
    // The repo record speaks for the account. Seen live: a fine-grained token
    // refused the branch listing of a repo its account could push to.
    const { report } = await run({ granted: [], reported: false }).outcome;
    expect(check(report.checks, 'push')).toMatchObject({
      status: 'unknown',
      detail:
        "This account can push to acme/api, but GitHub does not report whether this token's permissions allow it. The first push is the real test.",
    });
  });

  it('still fails the push check for such a token when the account itself is read-only', async () => {
    const { report } = await run({ granted: [], reported: false, pushable: false }).outcome;
    expect(check(report.checks, 'push')).toMatchObject({
      status: 'fail',
      detail: 'This account has read-only access to acme/api. Push to save will fail.',
    });
  });

  it('names the permission a fine-grained token needs when a listing is refused', async () => {
    const refused = async () => {
      throw new GitHubError('Resource not accessible by personal access token', 403);
    };
    const { report, canCreatePullRequests } = await run({
      granted: [],
      reported: false,
      listBranches: refused,
      listPullRequests: refused,
    }).outcome;

    expect(check(report.checks, 'branches')).toMatchObject({
      status: 'fail',
      detail:
        'GitHub refused to list the branches of acme/api (403). A fine-grained token needs the Contents permission for this.',
    });
    expect(check(report.checks, 'pull-requests')).toMatchObject({
      status: 'fail',
      detail:
        'GitHub refused to list the pull requests of acme/api (403). Creating or reviewing one will fail until the token allows it. A fine-grained token needs the Pull requests permission for this.',
    });
    expect(canCreatePullRequests).toBe(false);
  });

  it('names no permission for a token whose scopes were reported', async () => {
    const { report } = await run({
      granted: ['repo'],
      reported: true,
      listBranches: async () => {
        throw new GitHubError('Forbidden', 403);
      },
    }).outcome;
    expect(check(report.checks, 'branches').detail).toBe(
      'GitHub refused to list the branches of acme/api (403).',
    );
    expect(check(report.checks, 'push').status).toBe('pass');
  });

  it('leaves it open when the host reports no scopes', async () => {
    const { report } = await run({ granted: [] }, { host: 'azure-devops', repo: null }).outcome;
    expect(check(report.checks, 'scopes')).toMatchObject({
      status: 'unknown',
      detail: "Azure DevOps does not report this token's scopes, so they cannot be checked.",
    });
  });

  it('checks GitLab for `api` once GitLab reports the scopes', async () => {
    const ok = await run({ granted: ['api'] }, { host: 'gitlab', repo: null }).outcome;
    expect(check(ok.report.checks, 'scopes')).toMatchObject({ status: 'pass', detail: 'Has api.' });

    const readOnly = await run({ granted: ['read_api'] }, { host: 'gitlab', repo: null }).outcome;
    const scopes = check(readOnly.report.checks, 'scopes');
    expect(scopes.status).toBe('fail');
    expect(scopes.detail).toMatch(/^Missing api\./);
  });

  it('shows what a host reported when it needs nothing in particular from it', async () => {
    const { report } = await run(
      { granted: ['repository', 'pullrequest'] },
      { host: 'bitbucket', repo: null },
    ).outcome;
    expect(check(report.checks, 'scopes')).toMatchObject({
      status: 'pass',
      detail: 'Reports repository, pullrequest.',
    });
  });
});

describe('runHostPreflight — with no repository connected', () => {
  it('says so and asks the host nothing about one', async () => {
    const { calls, outcome } = run({}, { repo: null });
    const { report, pushable } = await outcome;
    expect(report.checks.map((c) => c.id)).toEqual(['token', 'scopes', 'repository']);
    expect(check(report.checks, 'repository')).toMatchObject({
      status: 'unknown',
      detail: 'No GitHub repository is connected yet, so access to one was not checked.',
    });
    expect(pushable).toBeNull();
    expect(calls.getRepo).not.toHaveBeenCalled();
    expect(calls.listBranches).not.toHaveBeenCalled();
    expect(calls.listPullRequests).not.toHaveBeenCalled();
  });

  it('reads the pull-request capability from the scopes alone', async () => {
    expect((await run({ granted: ['repo'] }, { repo: null }).outcome).canCreatePullRequests).toBe(
      true,
    );
  });

  it('keeps the recorded capability when the scopes do not settle it', async () => {
    const outcome = await run({ granted: [] }, { repo: null, priorPrCapability: false }).outcome;
    expect(outcome.canCreatePullRequests).toBe(false);
  });
});

describe('runHostPreflight — against the connected repository', () => {
  it('passes every check for a token that can do the work', async () => {
    const { calls, outcome } = run({});
    const { report, canCreatePullRequests, pushable } = await outcome;

    expect(report.checks.map((c) => [c.id, c.status])).toEqual([
      ['token', 'pass'],
      ['scopes', 'pass'],
      ['repository', 'pass'],
      ['push', 'pass'],
      ['branches', 'pass'],
      ['pull-requests', 'pass'],
    ]);
    expect(check(report.checks, 'repository').detail).toBe('acme/api is reachable.');
    expect(check(report.checks, 'push').detail).toBe('This account can push to acme/api.');
    expect(canCreatePullRequests).toBe(true);
    expect(pushable).toBe(true);
    expect(calls.getRepo).toHaveBeenCalledWith('tok', 'acme', 'api');
    expect(calls.listBranches).toHaveBeenCalledWith('tok', 'acme', 'api');
    // One row is enough to learn whether the listing is allowed.
    expect(calls.listPullRequests).toHaveBeenCalledWith('tok', 'acme', 'api', { perPage: 1 });
  });

  it('fails the repository check when the host does not return the repo, and stops there', async () => {
    const { calls, outcome } = run({
      getRepo: async () => {
        throw new GitHubError('Not Found', 404);
      },
    });
    const { report, pushable, canCreatePullRequests } = await outcome;

    expect(report.checks.map((c) => c.id)).toEqual(['token', 'scopes', 'repository']);
    expect(check(report.checks, 'repository')).toMatchObject({
      status: 'fail',
      detail:
        'GitHub did not return acme/api (404). The token may not cover this repository, or it was moved or deleted.',
    });
    expect(pushable).toBeNull();
    // Scopes still answer the capability; the listing was never asked.
    expect(canCreatePullRequests).toBe(true);
    expect(calls.listBranches).not.toHaveBeenCalled();
    expect(calls.listPullRequests).not.toHaveBeenCalled();
  });

  it('leaves the repository check open when the call never got an answer', async () => {
    const { report } = await run({
      getRepo: async () => {
        throw new Error('Failed to fetch.');
      },
    }).outcome;
    expect(check(report.checks, 'repository')).toMatchObject({
      status: 'unknown',
      detail: 'Could not be checked: Failed to fetch.',
    });
  });

  it('leaves a check open on a server error rather than calling it a refusal', async () => {
    const { report } = await run({
      listBranches: async () => {
        throw new GitHubError('Bad gateway', 502);
      },
    }).outcome;
    expect(check(report.checks, 'branches')).toMatchObject({
      status: 'unknown',
      detail: 'Could not be checked: Bad gateway.',
    });
  });

  it('copes with a rejection that is not an Error', async () => {
    const { report } = await run({
      listBranches: vi.fn().mockRejectedValue('weird'),
    }).outcome;
    expect(check(report.checks, 'branches').detail).toBe('Could not be checked: unknown error.');
  });

  it('fails the push check for read-only access, and reports the flag', async () => {
    const { report, pushable } = await run({ pushable: false }).outcome;
    expect(check(report.checks, 'push')).toMatchObject({
      status: 'fail',
      detail: 'This account has read-only access to acme/api. Push to save will fail.',
    });
    expect(pushable).toBe(false);
  });

  it('leaves the push check open on a host whose repo record does not say', async () => {
    const { report, pushable } = await run({ granted: [] }, { host: 'bitbucket' }).outcome;
    expect(check(report.checks, 'push')).toMatchObject({
      status: 'unknown',
      detail: 'Bitbucket does not report push access. The first push is the real test.',
    });
    // The client's filled-in `true` is not an answer, so nothing is recorded.
    expect(pushable).toBeNull();
  });

  it('reads a rate limit as "ask later", not as a refusal', async () => {
    const { report } = await run({
      listBranches: async () => {
        throw new RateLimitedError('slow down', 403, Date.now() + 60_000);
      },
    }).outcome;
    expect(check(report.checks, 'branches')).toMatchObject({
      status: 'unknown',
      detail: 'Could not be checked: the host is rate limiting requests, try again shortly.',
    });
  });

  it('fails the branches check when the host refuses the listing', async () => {
    const { report } = await run({
      listBranches: async () => {
        throw new GitHubError('Forbidden', 403);
      },
    }).outcome;
    expect(check(report.checks, 'branches')).toMatchObject({
      status: 'fail',
      detail: 'GitHub refused to list the branches of acme/api (403).',
    });
  });

  it('a refused pull-request listing overrules a scope list that claims the capability', async () => {
    const { report, canCreatePullRequests } = await run({
      granted: ['repo'],
      listPullRequests: async () => {
        throw new UnauthorizedError('Forbidden', 403);
      },
    }).outcome;
    const pulls = check(report.checks, 'pull-requests');
    expect(pulls.status).toBe('fail');
    expect(pulls.detail).toMatch(
      /^GitHub refused to list the pull requests of acme\/api \(403\)\./,
    );
    expect(canCreatePullRequests).toBe(false);
  });

  it('a listing that works confirms the capability where the scopes could not', async () => {
    const { canCreatePullRequests } = await run({ granted: [] }, { host: 'gitlab' }).outcome;
    expect(canCreatePullRequests).toBe(true);
  });

  it('keeps the recorded capability when neither the scopes nor the listing settle it', async () => {
    const unanswered = {
      granted: [] as string[],
      listPullRequests: async () => {
        throw new Error('timed out');
      },
    };
    const kept = await run(unanswered, { host: 'gitlab', priorPrCapability: true }).outcome;
    expect(check(kept.report.checks, 'pull-requests').status).toBe('unknown');
    expect(kept.canCreatePullRequests).toBe(true);

    const none = await run(unanswered, { host: 'gitlab', priorPrCapability: null }).outcome;
    expect(none.canCreatePullRequests).toBeNull();
  });
});

describe('summarizePreflight', () => {
  it('counts the checks in each outcome', async () => {
    const { report } = await run({ pushable: false, granted: [] }, { host: 'gitlab' }).outcome;
    // token pass · scopes unknown · repository pass · push fail · branches pass · pull requests pass
    expect(summarizePreflight(report)).toEqual({ pass: 4, fail: 1, unknown: 1 });
  });
});
