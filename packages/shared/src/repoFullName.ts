/**
 * Decoding the persisted `repoFullName` back into the `{ owner, name }` pair the
 * Git clients take.
 *
 * This lives in `shared` rather than next to the connect form because two
 * consumers need it and they cannot share a package: `ui-components` is React,
 * and the VS Code extension host must not import React. It sits beside
 * `parseEnvPriorityKey` for the same reason — a composite string persisted in
 * one place and decoded in several.
 */

/**
 * Split a stored `repoFullName` into `{ owner, name }`.
 *
 * Splits on the LAST separator, which is right for every host: GitHub,
 * Bitbucket and Azure DevOps store exactly two segments, and GitLab's extra
 * subgroup levels belong in `owner` — `GitLabClient.project()` is
 * `encodeURIComponent(`${owner}/${name}`)`, so a subgroup is simply an owner
 * containing slashes.
 *
 * The call sites all used `split('/', 2)`, which on `group/subgroup/project`
 * yields `owner: 'group'`, `name: 'subgroup'` and DISCARDS the last segment.
 * Every one of them feeds the result straight into a Git client, so the failure
 * was not a rejection — it was a request addressed at a DIFFERENT repository,
 * with nothing surfacing to say so.
 *
 * A value with no separator is not a repo coordinate. It returns an empty
 * `name` rather than guessing, so the caller fails on a blank path instead of
 * silently addressing `owner/owner`.
 */
export function splitRepoFullName(repoFullName: string): { owner: string; name: string } {
  const at = repoFullName.lastIndexOf('/');
  if (at < 0) return { owner: repoFullName, name: '' };
  return { owner: repoFullName.slice(0, at), name: repoFullName.slice(at + 1) };
}
