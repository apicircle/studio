import {
  GIT_HOST_LABELS,
  GitHubError,
  type GitHostKind,
  type GitProvider,
  RateLimitedError,
} from '@apicircle/git';
import { checkPrCapabilityFromScopes } from './githubPrCapability';

// What "Test connection" checks.
//
// The button used to make one call — "whose token is this?" — and report the
// connection healthy when it answered. That says the token exists. It says
// nothing about whether the token can do the work: reach the connected repo,
// read its branches and pull requests, push to it. Those failed later, in the
// middle of a push or a review, with the session card still showing green.
//
// A pre-flight asks each of those questions with a read-only call and reports
// the answers one by one. Three outcomes, kept apart on purpose:
//
//   pass     the host answered yes
//   fail     the host answered no — a real problem, with what it will break
//   unknown  the question got no answer: the host does not report it, no repo
//            is connected yet, or the call was rate limited or dropped
//
// `unknown` is never rounded up to `pass` or down to `fail`. A check that
// cannot be made is shown as one that was not made.
//
// Nothing here writes to the host. Write access is therefore read from what the
// host REPORTS (a scope list, a push flag), never tested by writing.

type PreflightCheckId = 'token' | 'scopes' | 'repository' | 'push' | 'branches' | 'pull-requests';

export type PreflightStatus = 'pass' | 'fail' | 'unknown';

export interface PreflightCheck {
  id: PreflightCheckId;
  label: string;
  status: PreflightStatus;
  /** One or two sentences: what was found and, on a failure, what it breaks. */
  detail: string;
}

export interface HostPreflightReport {
  host: GitHostKind;
  /** The account the host says this token belongs to. */
  accountLogin: string;
  /** The scopes the host reported for the token; empty when it reports none. */
  grantedScopes: string[];
  /** The client's own word on whether the host reported any (`ScopeInfo.reported`);
   *  absent when the client does not say. */
  scopesReported?: boolean;
  checks: PreflightCheck[];
}

/** A report, plus what the store records from it. */
export interface HostPreflightOutcome {
  report: HostPreflightReport;
  /** The session's pull-request capability after this run. */
  canCreatePullRequests: boolean | null;
  /** The connected repo's push flag as the host reports it now, or null when
   *  this run learned nothing about it and the recorded flag should stand. */
  pushable: boolean | null;
}

/**
 * The scopes a token must carry, on hosts that say which scopes it has.
 *
 * GitHub reports them for a classic or OAuth token, where `repo` is checkable,
 * and not for a fine-grained one, which carries permissions instead. GitLab
 * reports them for a personal, project or group access token, and `api` is the
 * one scope every write this app makes goes through (commits, merge requests,
 * notes); a `read_api` token connects and reads, then fails at the first push.
 * Bitbucket and Azure DevOps report nothing, so there is nothing to require.
 *
 * Not the connect gate (`REQUIRED_SCOPES_BY_HOST` in the store): that one
 * refuses a token outright, so it names a scope only where the host's client
 * can tell a token without it from a token it said nothing about.
 */
export const SCOPES_NEEDED_WHEN_REPORTED: Record<GitHostKind, readonly string[]> = {
  github: ['repo'],
  gitlab: ['api'],
  bitbucket: [],
  'azure-devops': [],
};

/**
 * Whether `granted` is the host's real answer about a token's scopes.
 *
 * A client that can tell says so itself (`ScopeInfo.reported`), and its word is
 * taken. GitHub's can: a fine-grained token gets no scope list at all, a
 * classic token with no scopes gets an empty one, and only the second is an
 * answer.
 *
 * Without that word the per-host rule applies. GitHub is read as answering, so
 * an empty list there is a token with no scopes — which is how a session
 * recorded before the client said is still read. Everywhere else an empty list
 * means the host was not able to say: every usable token on those hosts has at
 * least one scope.
 */
export function scopesAreReported(
  host: GitHostKind,
  granted: readonly string[],
  reported?: boolean,
): boolean {
  if (reported !== undefined) return reported;
  return host === 'github' || granted.length > 0;
}

/**
 * Whether a host's repo record says if THIS account may push. GitHub and GitLab
 * carry it; Bitbucket's and Azure DevOps's repo records do not, and their
 * clients fill the flag in as `true`, which is not an answer.
 */
const PUSH_ACCESS_REPORTED: Record<GitHostKind, boolean> = {
  github: true,
  gitlab: true,
  bitbucket: false,
  'azure-devops': false,
};

/** The HTTP statuses that mean "the host looked, and the answer is no". */
const DENIED_STATUSES: ReadonlySet<number> = new Set([401, 403, 404]);

type Probe<T> =
  | { kind: 'ok'; value: T }
  | { kind: 'denied'; status: number }
  | { kind: 'unanswered'; why: string };

/**
 * Run one read-only host call and sort its outcome.
 *
 * A rate limit shares 403 with a refusal but means "ask later", so it is read
 * first. Anything that is not a clear refusal — a timeout, a dropped
 * connection, a 5xx — leaves the question open rather than failing the check.
 */
async function probe<T>(call: () => Promise<T>): Promise<Probe<T>> {
  try {
    return { kind: 'ok', value: await call() };
  } catch (err) {
    if (err instanceof RateLimitedError) {
      return { kind: 'unanswered', why: 'the host is rate limiting requests, try again shortly' };
    }
    if (err instanceof GitHubError && DENIED_STATUSES.has(err.status)) {
      return { kind: 'denied', status: err.status };
    }
    return { kind: 'unanswered', why: err instanceof Error ? err.message : 'unknown error' };
  }
}

/** The row for a probe that did not come back `ok`. */
function unresolved(
  id: PreflightCheckId,
  label: string,
  result: Exclude<Probe<unknown>, { kind: 'ok' }>,
  deniedDetail: (status: number) => string,
): PreflightCheck {
  if (result.kind === 'denied') {
    return { id, label, status: 'fail', detail: deniedDetail(result.status) };
  }
  return {
    id,
    label,
    status: 'unknown',
    detail: `Could not be checked: ${result.why.replace(/\.$/, '')}.`,
  };
}

/**
 * Why a host said nothing about a token's scopes, where there is more to say
 * than that it did not. GitHub stays silent for one kind of token only, and a
 * user who reads "not reported" there should not go looking for scopes to add.
 */
const UNREPORTED_SCOPES_NOTE: Partial<Record<GitHostKind, string>> = {
  github:
    ' A fine-grained token carries permissions instead, and GitHub does not report those either.',
};

function scopesCheck(
  host: GitHostKind,
  granted: readonly string[],
  reported: boolean | undefined,
): PreflightCheck {
  const label = 'Scopes';
  if (!scopesAreReported(host, granted, reported)) {
    return {
      id: 'scopes',
      label,
      status: 'unknown',
      detail: `${GIT_HOST_LABELS[host]} does not report this token's scopes, so they cannot be checked.${UNREPORTED_SCOPES_NOTE[host] ?? ''}`,
    };
  }
  const needed = SCOPES_NEEDED_WHEN_REPORTED[host];
  const missing = needed.filter((scope) => !granted.includes(scope));
  if (missing.length > 0) {
    return {
      id: 'scopes',
      label,
      status: 'fail',
      detail: `Missing ${missing.join(', ')}. Push to save and pull requests will fail until the token is updated.`,
    };
  }
  return {
    id: 'scopes',
    label,
    status: 'pass',
    detail: needed.length > 0 ? `Has ${needed.join(', ')}.` : `Reports ${granted.join(', ')}.`,
  };
}

/**
 * Whether the token can push, as far as a read can tell.
 *
 * The repo record's push flag describes the ACCOUNT. For a token that carries
 * the account's access whole (a classic token) that is the answer. For one with
 * permissions of its own it is half of it: a "no" still settles the question,
 * a "yes" leaves it open, and an open question is never shown as a pass.
 */
function pushCheck(args: {
  hostName: string;
  slug: string;
  /** Whether the host's repo record says if the account may push at all. */
  reported: boolean;
  pushable: boolean;
  /** The token carries permissions of its own, which the host does not report. */
  ownPermissions: boolean;
}): PreflightCheck {
  const { hostName, slug } = args;
  const row = { id: 'push', label: 'Push access' } as const;
  if (!args.reported) {
    return {
      ...row,
      status: 'unknown',
      detail: `${hostName} does not report push access. The first push is the real test.`,
    };
  }
  if (!args.pushable) {
    return {
      ...row,
      status: 'fail',
      detail: `This account has read-only access to ${slug}. Push to save will fail.`,
    };
  }
  if (args.ownPermissions) {
    return {
      ...row,
      status: 'unknown',
      detail: `This account can push to ${slug}, but ${hostName} does not report whether this token's permissions allow it. The first push is the real test.`,
    };
  }
  return { ...row, status: 'pass', detail: `This account can push to ${slug}.` };
}

/**
 * Check a stored token against its host, and against the workspace's connected
 * repo when one lives on that host.
 *
 * Throws only when the host rejects or cannot be asked for the token's identity
 * — the same errors `getViewer` raises, so a caller's existing handling of a
 * revoked token, a rate limit or a dropped connection still applies. Past that
 * point every problem is a row in the report, not an exception.
 */
export async function runHostPreflight(args: {
  client: GitProvider;
  token: string;
  host: GitHostKind;
  /** The connected repo when it lives on `host`; null when none does. */
  repo: { owner: string; name: string } | null;
  /** The session's recorded pull-request capability, kept when this run cannot decide. */
  priorPrCapability: boolean | null;
}): Promise<HostPreflightOutcome> {
  const { client, token, host, repo, priorPrCapability } = args;
  const hostName = GIT_HOST_LABELS[host];

  const { viewer, scopes } = await client.getViewer(token);
  const granted = scopes.granted;
  const checks: PreflightCheck[] = [
    { id: 'token', label: 'Token', status: 'pass', detail: `Signed in as ${viewer.login}.` },
    scopesCheck(host, granted, scopes.reported),
  ];
  const report: HostPreflightReport = {
    host,
    accountLogin: viewer.login,
    grantedScopes: granted,
    ...(scopes.reported === undefined ? {} : { scopesReported: scopes.reported }),
    checks,
  };
  // A scope list that covers pull requests settles the capability; otherwise it
  // stands as recorded until the listing below says more.
  const prFromScopes = checkPrCapabilityFromScopes(granted);
  const prUndecided = prFromScopes ?? priorPrCapability;

  if (!repo) {
    checks.push({
      id: 'repository',
      label: 'Repository',
      status: 'unknown',
      detail: `No ${hostName} repository is connected yet, so access to one was not checked.`,
    });
    return { report, canCreatePullRequests: prUndecided, pushable: null };
  }

  const slug = `${repo.owner}/${repo.name}`;
  const found = await probe(() => client.getRepo(token, repo.owner, repo.name));
  if (found.kind !== 'ok') {
    // The checks below all ask about this repo; without it they would only
    // repeat the same refusal three more times.
    checks.push(
      unresolved(
        'repository',
        'Repository',
        found,
        (status) =>
          `${hostName} did not return ${slug} (${status}). The token may not cover this repository, or it was moved or deleted.`,
      ),
    );
    return { report, canCreatePullRequests: prUndecided, pushable: null };
  }
  checks.push({
    id: 'repository',
    label: 'Repository',
    status: 'pass',
    detail: `${slug} is reachable.`,
  });

  // A token whose scopes went unreported carries permissions of its own (a
  // fine-grained GitHub token), and they can be narrower than its account's
  // access. Seen live: one was refused the branch listing of a repo its account
  // could push to. So what the repo record says of the account is not yet an
  // answer about the token, and a refused listing has a likely cause to name.
  const ownPermissions = scopes.reported === false;
  const needs = (permission: string) =>
    ownPermissions ? ` A fine-grained token needs the ${permission} permission for this.` : '';

  const pushReported = PUSH_ACCESS_REPORTED[host];
  const pushable = found.value.pushable;
  checks.push(pushCheck({ hostName, slug, reported: pushReported, pushable, ownPermissions }));

  const [branches, pulls] = await Promise.all([
    probe(() => client.listBranches(token, repo.owner, repo.name)),
    probe(() => client.listPullRequests(token, repo.owner, repo.name, { perPage: 1 })),
  ]);
  checks.push(
    branches.kind === 'ok'
      ? { id: 'branches', label: 'Branches', status: 'pass', detail: 'Branches can be read.' }
      : unresolved(
          'branches',
          'Branches',
          branches,
          (status) =>
            `${hostName} refused to list the branches of ${slug} (${status}).${needs('Contents')}`,
        ),
  );
  checks.push(
    pulls.kind === 'ok'
      ? {
          id: 'pull-requests',
          label: 'Pull requests',
          status: 'pass',
          detail: 'Pull requests can be read.',
        }
      : unresolved(
          'pull-requests',
          'Pull requests',
          pulls,
          (status) =>
            `${hostName} refused to list the pull requests of ${slug} (${status}). Creating or reviewing one will fail until the token allows it.${needs('Pull requests')}`,
        ),
  );

  // A refused listing overrules the scope list: whatever the token claims, the
  // host just declined to show it this repo's pull requests. A listing that
  // went through confirms the capability where the scopes could not.
  const canCreatePullRequests =
    pulls.kind === 'denied' ? false : (prFromScopes ?? (pulls.kind === 'ok' ? true : prUndecided));

  return { report, canCreatePullRequests, pushable: pushReported ? pushable : null };
}

/** How many checks landed in each outcome. */
export function summarizePreflight(report: HostPreflightReport): Record<PreflightStatus, number> {
  const count = (status: PreflightStatus) =>
    report.checks.filter((check) => check.status === status).length;
  return { pass: count('pass'), fail: count('fail'), unknown: count('unknown') };
}
