import { GitHubError, type GitHubClient } from '@apicircle/git';
import type { RetiredBranch, WorkingBranch } from '@apicircle/shared';

/**
 * Extract the PR number from a GitHub PR HTML URL like
 * `https://github.com/owner/name/pull/42`. Returns `null` for any URL
 * that doesn't match the standard pattern (forked clones, stale state,
 * malformed input). The caller decides whether to skip the PR-state probe
 * or fall back to listing PRs by branch name when this returns `null`.
 *
 * The match anchors on `/pull/<digits>` and ignores anything after — PR
 * URLs sometimes carry `/files`, `/commits`, fragments etc., and we don't
 * want those to stop us from finding the number.
 */
export function parsePrNumberFromUrl(url: string | null | undefined): number | null {
  if (!url) return null;
  const match = url.match(/\/pull\/(\d+)(?:\/|#|\?|$)/);
  if (!match) return null;
  const n = Number.parseInt(match[1], 10);
  return Number.isFinite(n) && n > 0 ? n : null;
}

/**
 * Probe-driven snapshot of a branch's GitHub-side state. Returned by
 * `probeBranchRetirement` so the caller can decide whether to retire,
 * keep refreshing normally, or surface an error.
 */
export interface BranchProbeResult {
  /** Whether the branch ref still exists on GitHub. `null` = couldn't tell (transient). */
  branchExists: boolean | null;
  /**
   * Head commit SHA on the remote branch when `branchExists === true`,
   * else `null`. Surfaced so callers (`refreshWorkspace`) can compare it
   * against `branch.lastPushedSha` for ancestry without a second `getRef`.
   */
  branchHeadSha: string | null;
  /** PR state if a PR was opened and we could fetch it. `null` = no PR or fetch failed. */
  prState: { merged: boolean; state: 'open' | 'closed' } | null;
}

/**
 * Probe GitHub for the working branch's current state — branch existence
 * (404 = deleted) and, if a PR was opened, the PR's merge status. Both
 * probes are best-effort: on transient failures they return `null` rather
 * than throwing, so a flaky network doesn't accidentally retire a branch
 * the user is still actively working on.
 *
 * The caller (`refreshWorkspace`) feeds this into `decideRetirement` to
 * choose between retiring, continuing, or no-op'ing.
 */
export async function probeBranchRetirement(
  client: GitHubClient,
  token: string,
  branch: WorkingBranch,
): Promise<BranchProbeResult> {
  const head = await probeBranchHead(client, token, branch);
  const prState = await probePrState(client, token, branch);
  return {
    branchExists: head.exists,
    branchHeadSha: head.sha,
    prState,
  };
}

async function probeBranchHead(
  client: GitHubClient,
  token: string,
  branch: WorkingBranch,
): Promise<{ exists: boolean | null; sha: string | null }> {
  try {
    const result = await client.getBranchHead(
      token,
      branch.repoOwner,
      branch.repoName,
      branch.name,
    );
    return { exists: true, sha: result.commitSha };
  } catch (err) {
    if (err instanceof GitHubError && err.status === 404) {
      return { exists: false, sha: null };
    }
    // Auth/rate/network — don't pretend we know.
    return { exists: null, sha: null };
  }
}

async function probePrState(
  client: GitHubClient,
  token: string,
  branch: WorkingBranch,
): Promise<{ merged: boolean; state: 'open' | 'closed' } | null> {
  if (!branch.openPrUrl) return null;
  const prNumber = parsePrNumberFromUrl(branch.openPrUrl);
  if (prNumber === null) return null;
  try {
    const pr = await client.getPullRequest(token, branch.repoOwner, branch.repoName, prNumber);
    if (!pr) return null; // 404 → PR record gone (rare; treat as no PR)
    return { merged: pr.merged, state: pr.state };
  } catch {
    return null;
  }
}

/**
 * Decide whether the working branch should be retired based on the probe
 * result. Returns the `RetiredBranch` payload to persist, or `null` if
 * the branch should keep going.
 *
 * Decision matrix:
 *   - PR merged              → retire with reason `pr-merged`
 *   - Branch confirmed gone  → retire with reason `branch-deleted`
 *   - Anything inconclusive  → don't retire (let normal refresh continue
 *                              or surface the underlying error)
 *
 * PR-closed-without-merge while the branch still exists is intentionally
 * NOT a retirement — the user might still want to push fixes and reopen
 * the PR. Closing without merging is a normal in-flight state on GitHub.
 */
export function decideRetirement(
  branch: WorkingBranch,
  probe: BranchProbeResult,
  now: Date = new Date(),
): RetiredBranch | null {
  const prNumber = parsePrNumberFromUrl(branch.openPrUrl);
  if (probe.prState?.merged === true) {
    return {
      branchName: branch.name,
      reason: 'pr-merged',
      retiredAt: now.toISOString(),
      prUrl: branch.openPrUrl,
      prNumber,
    };
  }
  if (probe.branchExists === false) {
    return {
      branchName: branch.name,
      reason: 'branch-deleted',
      retiredAt: now.toISOString(),
      prUrl: branch.openPrUrl,
      prNumber,
    };
  }
  return null;
}
