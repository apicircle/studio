// What each Git host's API can and cannot do.
//
// The `GitProvider` contract is derived from `GitHubClient`, so every host is
// typed as if it could do everything GitHub can. That is a deliberate
// simplification of the TYPE — it is not true of the APIs. GitLab has no
// equivalent of GitHub's low-level git-data write recipe; Bitbucket Cloud repos
// have no topics at all; an Azure DevOps "Release" is a deployment pipeline, not
// a tag annotation. A provider for those hosts satisfies the type by rejecting
// the calls it cannot serve.
//
// WHY THE UI NEEDS THIS AHEAD OF THE CALL. A rejection is only discoverable by
// making the request, which means the user finds out by clicking a control that
// was offered to them and getting an error back. That is what happened with
// "Release & topics": the modal offered a GitHub Release checkbox and a topics
// editor on every host, and on Bitbucket / Azure DevOps the save failed with a
// raw provider error. A surface can only decline to offer a control if it can
// ask the question BEFORE the call — which is what this module is for.
//
// WHY THE TABLE LIVES HERE rather than being declared by each provider at
// registration. Open core resolves GitHub alone; the other three hosts are
// registered by the Enterprise edition. If the answer arrived with the
// registration, open core could not answer the question at all, and a host that
// registered without declaring anything would silently claim full support — the
// same failure in a new place. These are stable properties of the hosts' public
// APIs, and `GitHostKind` is already a closed union naming all four, so the
// table is complete by construction: adding a host to the union fails the
// typecheck here until its capabilities are stated.
//
// KEEPING IT HONEST. The table is a claim about providers implemented in
// another package. `capabilities.test.ts` pins its shape; the Enterprise edition
// additionally asserts each entry against what its clients actually reject, so
// the two cannot drift apart silently.

import type { GitHostKind } from '@apicircle/shared';
import type { GitProviderMethod } from './provider';

/**
 * Per host, the contract methods its API has no equivalent for.
 *
 * GitHub is the reference implementation the contract is derived from, so its
 * list is empty by definition. An entry here is a statement about the HOST, not
 * about the state of an implementation — "not built yet" does not belong in
 * this table, because callers use it to decide whether to offer a control at
 * all, and a temporary gap would render as a permanent absence.
 */
const UNSUPPORTED: Record<GitHostKind, readonly GitProviderMethod[]> = {
  github: [],

  // `commitFiles` is absent from EVERY list — supported everywhere — and that
  // is a statement about the hosts, not an oversight. Each of the four commits
  // a set of whole files in a single call: GitLab a commit with `actions[]`,
  // Bitbucket a `/src` POST, Azure DevOps a push with `changes[]`, GitHub the
  // blob/tree/commit/ref sequence it wraps. The git-data PRIMITIVES below stay
  // unsupported off GitHub, so a caller that wants to write files asks for
  // `commitFiles` rather than building a tree.

  // GitLab: no low-level git-data write recipe (single-file writes go through
  // `putContents`), and MR notes are not issue comments.
  gitlab: [
    'getCommit',
    'createBlob',
    'createTree',
    'createCommit',
    'updateRef',
    'listIssueComments',
    'createIssueComment',
    'updateIssueComment',
  ],

  // Bitbucket Cloud: no git-data recipe, no OAuth device flow, no releases, and
  // repos have no topics. `listRepoTopics` is supported and answers with an
  // empty list — reading the absence of topics is meaningful; writing is not.
  bitbucket: [
    'getCommit',
    'createBlob',
    'createTree',
    'createCommit',
    'updateRef',
    'startDeviceFlow',
    'pollDeviceToken',
    'createRelease',
    'setRepoTopics',
    'listIssueComments',
    'createIssueComment',
    'updateIssueComment',
  ],

  // Azure DevOps: as Bitbucket, except `getCommit` IS available. Its "Releases"
  // are deployment pipelines rather than tag annotations, so `createRelease`
  // has no equivalent even though tagging works.
  'azure-devops': [
    'createBlob',
    'createTree',
    'createCommit',
    'updateRef',
    'startDeviceFlow',
    'pollDeviceToken',
    'createRelease',
    'setRepoTopics',
    'listIssueComments',
    'createIssueComment',
    'updateIssueComment',
  ],
};

/**
 * Whether `kind` can perform `method`.
 *
 * Ask this before OFFERING a control, not before calling — a call that reaches
 * an unsupported method still rejects, and should. The point is to keep a
 * button that cannot work off the screen in the first place.
 */
export function supportsGitMethod(kind: GitHostKind, method: GitProviderMethod): boolean {
  return !UNSUPPORTED[kind].includes(method);
}

/**
 * Everything `kind` cannot do. Useful for a surface that wants to explain the
 * shape of a host's limitations rather than test one method at a time.
 */
export function unsupportedGitMethods(kind: GitHostKind): readonly GitProviderMethod[] {
  return UNSUPPORTED[kind];
}
