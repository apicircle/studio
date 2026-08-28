import type { GitHostKind } from '@apicircle/git';

/**
 * Parsing the repo identifier a user types, per host.
 *
 * `RepoRef` is two levels — `{ owner, name }` — on purpose: hosts with a deeper
 * hierarchy fold the extra levels in rather than growing a third field, which is
 * the convention every Tier-A client already follows. What was missing is a
 * parser that knows HOW each host folds. A flat `split('/')` rejecting anything
 * with more than two segments made a legitimate GitLab subgroup path
 * unenterable, and gave an Azure DevOps user no hint that their organisation
 * belongs somewhere else entirely.
 *
 * The rules, read off the clients rather than guessed:
 *
 *   * **GitHub** and **Bitbucket Cloud** — exactly two. `owner/repo` and
 *     `workspace/repo_slug`.
 *   * **GitLab** — two OR MORE. `GitLabClient.project()` is
 *     `encodeURIComponent(`${owner}/${name}`)`, so a subgroup path is simply an
 *     `owner` containing slashes: `group/subgroup/project` parses to
 *     `owner: 'group/subgroup'`, `name: 'project'`.
 *   * **Azure DevOps** — exactly two, and they are `project/repo`. Its client
 *     builds `/{owner}/_apis/git/repositories/{name}` against a base URL that
 *     carries the ORGANISATION (`https://dev.azure.com/{org}`), so an org typed
 *     into this field would be folded into `owner` and silently produce a URL
 *     that addresses nothing.
 */

/** How many `/`-separated segments a host's identifier may carry. */
const SEGMENT_RULE: Record<GitHostKind, { min: number; max: number }> = {
  github: { min: 2, max: 2 },
  gitlab: { min: 2, max: Infinity },
  bitbucket: { min: 2, max: 2 },
  'azure-devops': { min: 2, max: 2 },
};

/** What to show in the input, so the shape is obvious before anything is typed. */
export const REPO_PLACEHOLDER: Record<GitHostKind, string> = {
  // Unchanged, verbatim. GitHub's shape was already right and its copy is what
  // users and tests have read since the form shipped; churning it would be a
  // change with no benefit to the host that never had the problem.
  github: 'owner/name',
  gitlab: 'group/project or group/subgroup/project',
  bitbucket: 'workspace/repo',
  'azure-devops': 'project/repo',
};

/**
 * A one-line hint under the field. Only Azure gets one: it is the sole host
 * where part of the coordinate lives in a DIFFERENT field, and a user who does
 * not know that has no way to work it out from a rejection message.
 */
export const REPO_HINT: Partial<Record<GitHostKind, string>> = {
  'azure-devops':
    'Your organisation goes in the API base URL (https://dev.azure.com/your-org), not here.',
};

export type ParsedRepo = { ok: true; owner: string; name: string } | { ok: false; error: string };

/**
 * Parse `value` as a repo coordinate for `host`.
 *
 * Splits on the LAST separator, so any extra leading segments fold into `owner`
 * exactly the way the clients expect. Rejections name the shape that host wants
 * rather than repeating a generic `owner/name`, because "Format must be
 * `owner/name`" is actively misleading on a host where it is not.
 */
export function parseRepoCoordinate(value: string, host: GitHostKind): ParsedRepo {
  const trimmed = value.trim().replace(/^\/+|\/+$/g, '');
  if (!trimmed) return { ok: false, error: `Enter \`${REPO_PLACEHOLDER[host]}\`` };

  const segments = trimmed.split('/').filter((s) => s.length > 0);
  // A segment count is not enough on its own: `a//b` splits to two non-empty
  // parts but is not a path anyone meant to type.
  if (trimmed.split('/').some((s) => s.length === 0)) {
    return { ok: false, error: `Format must be \`${REPO_PLACEHOLDER[host]}\`` };
  }

  const rule = SEGMENT_RULE[host];
  if (segments.length < rule.min || segments.length > rule.max) {
    return { ok: false, error: `Format must be \`${REPO_PLACEHOLDER[host]}\`` };
  }

  const name = segments[segments.length - 1];
  const owner = segments.slice(0, -1).join('/');
  return { ok: true, owner, name };
}

/** True when `value` is a complete coordinate for `host` — for enabling submit. */
export function isRepoCoordinateComplete(value: string, host: GitHostKind): boolean {
  return parseRepoCoordinate(value, host).ok;
}

/**
 * Re-exported so this module stays the one place the UI asks about repo
 * coordinates. The implementation lives in `@apicircle/shared` because the VS
 * Code extension host needs it too and cannot import a React package.
 */
export { splitRepoFullName } from '@apicircle/shared';
