import { GitHubError, type GitProvider, MissingScopeError, RateLimitedError } from '@apicircle/git';

/**
 * Decide PR-creation capability from the granted-scope list alone.
 *
 *   - `true`  — scopes definitively cover PR creation. Either `repo`
 *               (classic PATs — covers full PR ops) or `pull_request`
 *               (fine-grained PATs that surface this as a granted scope).
 *   - `null`  — neither scope is granted; we can't tell from headers
 *               alone whether the token can create PRs (some fine-grained
 *               PATs don't surface their permissions via `x-oauth-scopes`).
 *               Caller may fall back to a network probe.
 *
 * We never return `false` here — scope-only inspection cannot disprove
 * capability, only confirm it. A definitive `false` requires GitHub's
 * own 403-with-missing-scopes response (see `probePrCapability`).
 */
export function checkPrCapabilityFromScopes(grantedScopes: readonly string[]): boolean | null {
  if (grantedScopes.includes('repo')) return true;
  if (grantedScopes.includes('pull_request')) return true;
  return null;
}

/**
 * Probe whether the token can list pull requests on a specific repo —
 * used as a fallback when scope inspection is inconclusive (e.g. for
 * fine-grained PATs that don't surface their scopes via the standard
 * `x-oauth-scopes` header).
 *
 * Hits `GET /repos/:owner/:repo/pulls?per_page=1`. A 200 means the token
 * has at least PR-read access; the production `createPullRequest` call
 * declares `requiredScopes: ['repo', 'pull_request']`, so any token
 * GitHub accepts for PR-list will also be accepted for PR-create on
 * classic PATs. Fine-grained PATs split read/write, so a true here can
 * still surface a 403 at create time — that path already routes through
 * `MissingScopeError` and surfaces the update-token modal.
 *
 * Returns:
 *   - `true`  — list-pulls returned 200
 *   - `false` — list-pulls returned 403 with missing-scope hint
 *               (`MissingScopeError`) OR a plain 403
 *   - throws  — anything else (transient network errors, 401, 5xx).
 *               Callers should leave the prior capability flag intact
 *               rather than flip it on a flake.
 */
export async function probePrCapability(
  client: GitProvider,
  token: string,
  owner: string,
  name: string,
): Promise<boolean> {
  try {
    await client.listPullRequests(token, owner, name, { perPage: 1 });
    return true;
  } catch (err) {
    // Rate-limit 403s share the status with permission 403s but mean
    // "ask later", not "this token lacks PR access". Rethrow so the
    // caller leaves the prior capability flag intact.
    if (err instanceof RateLimitedError) throw err;
    if (err instanceof MissingScopeError) return false;
    if (err instanceof GitHubError && err.status === 403) return false;
    throw err;
  }
}

/**
 * Resolve PR capability for a session: scope check first, probe fallback
 * if inconclusive AND a repo is available to probe against. Returns the
 * value that should be persisted on the session.
 *
 * Pure orchestrator — owns no state. The caller decides where the result
 * lands (session.canCreatePullRequests).
 */
export async function resolvePrCapability(args: {
  grantedScopes: readonly string[];
  /** When omitted, no probe is attempted. Returns the scope-only result (which may be `null`). */
  probe?: () => Promise<boolean>;
}): Promise<boolean | null> {
  const fromScope = checkPrCapabilityFromScopes(args.grantedScopes);
  if (fromScope !== null) return fromScope;
  if (!args.probe) return null;
  try {
    return await args.probe();
  } catch {
    // Transient probe failure — leave capability undetermined.
    return null;
  }
}
