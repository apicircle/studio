import { describe, expect, it, vi } from 'vitest';
import { GitHubClient, GitHubError } from '@apicircle/git';
import type { WorkingBranch } from '@apicircle/shared';
import { decideRetirement, parsePrNumberFromUrl, probeBranchRetirement } from './branchRetirement';

function workingBranchFixture(overrides: Partial<WorkingBranch> = {}): WorkingBranch {
  return {
    name: 'apicircle/test-branch',
    baseBranch: 'main',
    repoFullName: 'me/api',
    repoOwner: 'me',
    repoName: 'api',
    headSha: 'sha-1',
    createdAt: '2026-05-09T10:00:00.000Z',
    lastPushedSha: 'sha-2',
    diffSummary: null,
    openPrUrl: null,
    ...overrides,
  };
}

describe('parsePrNumberFromUrl', () => {
  it('extracts the number from a canonical PR URL', () => {
    expect(parsePrNumberFromUrl('https://github.com/me/api/pull/42')).toBe(42);
  });

  it('handles URLs with sub-paths like /files', () => {
    expect(parsePrNumberFromUrl('https://github.com/me/api/pull/7/files')).toBe(7);
  });

  it('handles URLs with fragments and query strings', () => {
    expect(parsePrNumberFromUrl('https://github.com/me/api/pull/123#discussion')).toBe(123);
    expect(parsePrNumberFromUrl('https://github.com/me/api/pull/8?diff=split')).toBe(8);
  });

  it('returns null for null/undefined/empty input', () => {
    expect(parsePrNumberFromUrl(null)).toBeNull();
    expect(parsePrNumberFromUrl(undefined)).toBeNull();
    expect(parsePrNumberFromUrl('')).toBeNull();
  });

  it('returns null for URLs that do not match the /pull/<digits> pattern', () => {
    expect(parsePrNumberFromUrl('https://github.com/me/api/issues/42')).toBeNull();
    expect(parsePrNumberFromUrl('https://github.com/me/api/pulls')).toBeNull();
    expect(parsePrNumberFromUrl('not-a-url-at-all')).toBeNull();
  });

  it('rejects negative or zero numbers (defensive — GitHub never assigns these)', () => {
    expect(parsePrNumberFromUrl('https://github.com/me/api/pull/0')).toBeNull();
  });
});

describe('decideRetirement', () => {
  const branch = workingBranchFixture({
    name: 'apicircle/feat-auth',
    openPrUrl: 'https://github.com/me/api/pull/42',
  });
  const now = new Date('2026-05-09T12:00:00.000Z');

  it('retires with reason `pr-merged` when the PR is merged', () => {
    const result = decideRetirement(
      branch,
      { branchExists: true, branchHeadSha: null, prState: { merged: true, state: 'closed' } },
      now,
    );
    expect(result).toEqual({
      branchName: 'apicircle/feat-auth',
      reason: 'pr-merged',
      retiredAt: '2026-05-09T12:00:00.000Z',
      prUrl: 'https://github.com/me/api/pull/42',
      prNumber: 42,
    });
  });

  it('retires with reason `pr-merged` even when branch is also gone (PR-merged wins)', () => {
    // GitHub's "delete branch on merge" produces both signals; prefer the
    // semantically richer reason so the banner can say "PR was merged".
    const result = decideRetirement(
      branch,
      { branchExists: false, branchHeadSha: null, prState: { merged: true, state: 'closed' } },
      now,
    );
    expect(result?.reason).toBe('pr-merged');
  });

  it('retires with reason `branch-deleted` when branch is gone but PR was not merged', () => {
    const result = decideRetirement(
      branch,
      { branchExists: false, branchHeadSha: null, prState: { merged: false, state: 'closed' } },
      now,
    );
    expect(result?.reason).toBe('branch-deleted');
    expect(result?.prNumber).toBe(42); // still surface the PR for the banner link
  });

  it('retires with reason `branch-deleted` when branch gone and no PR exists', () => {
    const noPrBranch = workingBranchFixture({ openPrUrl: null });
    const result = decideRetirement(
      noPrBranch,
      { branchExists: false, branchHeadSha: null, prState: null },
      now,
    );
    expect(result?.reason).toBe('branch-deleted');
    expect(result?.prNumber).toBeNull();
    expect(result?.prUrl).toBeNull();
  });

  it('does NOT retire when PR is closed-without-merge but branch still exists', () => {
    // Closing a PR without merging is a normal in-flight state (the user
    // might reopen). Retirement requires a definitive end signal.
    expect(
      decideRetirement(
        branch,
        { branchExists: true, branchHeadSha: 'abc', prState: { merged: false, state: 'closed' } },
        now,
      ),
    ).toBeNull();
  });

  it('does NOT retire when both probes are inconclusive (transient failure)', () => {
    expect(
      decideRetirement(branch, { branchExists: null, branchHeadSha: null, prState: null }, now),
    ).toBeNull();
  });

  it('does NOT retire when everything is healthy (branch alive + PR open)', () => {
    expect(
      decideRetirement(
        branch,
        { branchExists: true, branchHeadSha: 'abc', prState: { merged: false, state: 'open' } },
        now,
      ),
    ).toBeNull();
  });
});

function clientWithSequence(responses: Response[]): GitHubClient {
  let i = 0;
  const fetchImpl = vi.fn<typeof fetch>().mockImplementation(async () => {
    if (i >= responses.length) throw new Error(`Unexpected fetch call #${i + 1}`);
    return responses[i++];
  });
  return new GitHubClient({ fetchImpl });
}

function jsonResponse(body: unknown, init: ResponseInit = {}): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
    ...init,
  });
}

describe('probeBranchRetirement', () => {
  it('returns branchExists=true + prState merged when both probes succeed positively', async () => {
    const branch = workingBranchFixture({ openPrUrl: 'https://github.com/me/api/pull/3' });
    const client = clientWithSequence([
      jsonResponse({ name: branch.name, commit: { sha: 'abc' } }), // getBranchHead
      jsonResponse({ number: 3, html_url: branch.openPrUrl, state: 'closed', merged: true }), // getPullRequest
    ]);
    const probe = await probeBranchRetirement(client, 'tok', branch);
    expect(probe).toEqual({
      branchExists: true,
      branchHeadSha: 'abc',
      prState: { merged: true, state: 'closed' },
    });
  });

  it('reports branchExists=false on a 404 from getBranchHead', async () => {
    const branch = workingBranchFixture({ openPrUrl: null });
    const client = clientWithSequence([
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const probe = await probeBranchRetirement(client, 'tok', branch);
    expect(probe.branchExists).toBe(false);
    expect(probe.prState).toBeNull();
  });

  it('reports branchExists=null on a transient 5xx (not a definitive answer)', async () => {
    const branch = workingBranchFixture({ openPrUrl: null });
    const client = clientWithSequence([
      new Response(JSON.stringify({ message: 'Server' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const probe = await probeBranchRetirement(client, 'tok', branch);
    // Don't pretend we know — let `decideRetirement` keep the branch alive.
    expect(probe.branchExists).toBeNull();
  });

  it('skips the PR probe when no PR URL is set', async () => {
    const branch = workingBranchFixture({ openPrUrl: null });
    const client = clientWithSequence([
      jsonResponse({ name: branch.name, commit: { sha: 'abc' } }),
    ]);
    const probe = await probeBranchRetirement(client, 'tok', branch);
    expect(probe.prState).toBeNull();
  });

  it('reports prState=null when the PR fetch throws (transient)', async () => {
    const branch = workingBranchFixture({ openPrUrl: 'https://github.com/me/api/pull/9' });
    const client = clientWithSequence([
      jsonResponse({ name: branch.name, commit: { sha: 'abc' } }),
      new Response(JSON.stringify({ message: 'Server' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const probe = await probeBranchRetirement(client, 'tok', branch);
    expect(probe.prState).toBeNull();
    // branch still confirmed
    expect(probe.branchExists).toBe(true);
  });

  it('reports prState=null on PR 404 (PR record gone — treat like no PR)', async () => {
    const branch = workingBranchFixture({ openPrUrl: 'https://github.com/me/api/pull/9' });
    const client = clientWithSequence([
      jsonResponse({ name: branch.name, commit: { sha: 'abc' } }),
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    const probe = await probeBranchRetirement(client, 'tok', branch);
    expect(probe.prState).toBeNull();
  });

  it('skips the PR probe when the PR URL is malformed (no number)', async () => {
    const branch = workingBranchFixture({ openPrUrl: 'https://github.com/me/api/pulls' });
    const client = clientWithSequence([
      jsonResponse({ name: branch.name, commit: { sha: 'abc' } }),
    ]);
    // If we tried to probe, the test would fail loudly via "Unexpected fetch call #2".
    const probe = await probeBranchRetirement(client, 'tok', branch);
    expect(probe.prState).toBeNull();
  });
});

describe('GitHubClient.getPullRequest', () => {
  it('parses merged=true into the typed result', async () => {
    const client = clientWithSequence([
      jsonResponse({
        number: 7,
        html_url: 'https://github.com/me/api/pull/7',
        state: 'closed',
        merged: true,
      }),
    ]);
    const pr = await client.getPullRequest('tok', 'me', 'api', 7);
    expect(pr).toEqual({
      number: 7,
      htmlUrl: 'https://github.com/me/api/pull/7',
      state: 'closed',
      merged: true,
    });
  });

  it('treats absent merged field as false (PR open or in-flight)', async () => {
    const client = clientWithSequence([
      jsonResponse({
        number: 8,
        html_url: 'https://github.com/me/api/pull/8',
        state: 'open',
      }),
    ]);
    const pr = await client.getPullRequest('tok', 'me', 'api', 8);
    expect(pr?.merged).toBe(false);
    expect(pr?.state).toBe('open');
  });

  it('returns null on 404 (caller treats as "no PR record")', async () => {
    const client = clientWithSequence([
      new Response(JSON.stringify({ message: 'Not Found' }), {
        status: 404,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    expect(await client.getPullRequest('tok', 'me', 'api', 999)).toBeNull();
  });

  it('rethrows non-404 errors (caller decides retry/surface)', async () => {
    const client = clientWithSequence([
      new Response(JSON.stringify({ message: 'Server' }), {
        status: 500,
        headers: { 'content-type': 'application/json' },
      }),
    ]);
    await expect(client.getPullRequest('tok', 'me', 'api', 42)).rejects.toBeInstanceOf(GitHubError);
  });
});
