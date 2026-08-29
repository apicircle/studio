import { describe, expect, it } from 'vitest';
import { GIT_HOST_KINDS, type GitHostKind } from '@apicircle/shared';
import { supportsGitMethod, unsupportedGitMethods } from './capabilities';

// The table is a claim about hosts, consumed by the UI to decide whether to
// OFFER a control. Two ways it can be wrong, and both are worse than a runtime
// rejection because they are silent:
//
//   over-claiming  — a control is offered, the user clicks, the provider
//                    rejects. This is the bug the table exists to fix.
//   under-claiming — a control is hidden on a host that can in fact do it, and
//                    nobody reports a missing feature they never saw.
//
// These tests pin the shape and the invariants. The Enterprise edition asserts
// the entries against what its clients actually reject; that check has to live
// where both halves are visible, which is not here.

describe('supportsGitMethod', () => {
  it('says GitHub can do everything — it is the contract', () => {
    // The provider contract is `Pick<GitHubClient, GitProviderMethod>`, so a
    // method GitHub cannot perform could not be in the union in the first place.
    expect(unsupportedGitMethods('github')).toEqual([]);
    for (const method of ['createRelease', 'setRepoTopics', 'createTag', 'createBlob'] as const) {
      expect(supportsGitMethod('github', method)).toBe(true);
    }
  });

  it('covers every host in the union, so a new host cannot default to full support', () => {
    // The Record type makes this total at compile time; asserting it at runtime
    // catches a host added to GIT_HOST_KINDS whose entry was never written.
    for (const kind of GIT_HOST_KINDS) {
      expect(Array.isArray(unsupportedGitMethods(kind as GitHostKind))).toBe(true);
    }
  });

  it('reports the release/topics facts the Release modal gates on', () => {
    // Tagging works on all four — the modal must keep offering it everywhere.
    for (const kind of GIT_HOST_KINDS) {
      expect(supportsGitMethod(kind as GitHostKind, 'createTag')).toBe(true);
      expect(supportsGitMethod(kind as GitHostKind, 'getTagSha')).toBe(true);
    }

    // A GitHub-style Release exists on GitLab, and nowhere else. Azure's
    // "Releases" are deployment pipelines; Bitbucket Cloud has none.
    expect(supportsGitMethod('gitlab', 'createRelease')).toBe(true);
    expect(supportsGitMethod('bitbucket', 'createRelease')).toBe(false);
    expect(supportsGitMethod('azure-devops', 'createRelease')).toBe(false);

    // Topics are READABLE everywhere and WRITABLE on two hosts. That asymmetry
    // is the point: Bitbucket answers `listRepoTopics` with an empty list, and
    // "this host has no topics" is a real answer worth rendering.
    for (const kind of GIT_HOST_KINDS) {
      expect(supportsGitMethod(kind as GitHostKind, 'listRepoTopics')).toBe(true);
    }
    expect(supportsGitMethod('gitlab', 'setRepoTopics')).toBe(true);
    expect(supportsGitMethod('bitbucket', 'setRepoTopics')).toBe(false);
    expect(supportsGitMethod('azure-devops', 'setRepoTopics')).toBe(false);
  });

  it('reports the git-data write recipe as absent on every non-GitHub host', () => {
    // The scaffold -> draft-PR path uses this recipe. It is listed so a surface
    // offering that flow can decline rather than fail mid-way through a
    // multi-call sequence, having already created a blob and a tree.
    for (const kind of ['gitlab', 'bitbucket', 'azure-devops'] as const) {
      for (const method of ['createBlob', 'createTree', 'createCommit', 'updateRef'] as const) {
        expect(supportsGitMethod(kind, method)).toBe(false);
      }
    }
  });

  it('does not confuse the two hosts that differ only by getCommit', () => {
    // Azure implements it, Bitbucket does not. A copy-paste of one entry into
    // the other would pass every assertion above.
    expect(supportsGitMethod('azure-devops', 'getCommit')).toBe(true);
    expect(supportsGitMethod('bitbucket', 'getCommit')).toBe(false);
  });
});
