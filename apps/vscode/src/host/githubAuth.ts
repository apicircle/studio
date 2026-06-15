import * as vscode from 'vscode';
import type { LinkedWorkspace } from '@apicircle/shared';

// =============================================================================
// GitHub auth for the extension — uses VS Code's built-in GitHub authentication
// provider (`vscode.authentication.getSession('github', …)`) rather than a
// PAT-in-vault model. The returned access token is handed per-call to
// `@apicircle/git`'s GitHubClient (which never stores it).
//
// `scopes: ['repo']` covers reading private repos' `.apicircle/` workspace files
// plus creating tags / releases / topic edits on the user's own repos.
// =============================================================================

const GITHUB_SCOPES = ['repo'] as const;

/**
 * Get a GitHub access token.
 *
 *   - `interactive: true` — prompt the user to sign in if there's no session
 *     (used by link / tag actions that genuinely need a token).
 *   - `interactive: false` — return an existing session's token or null, never
 *     prompting (used by anonymous-friendly flows like marketplace search,
 *     which work without a token but get higher rate limits with one).
 */
/** SecretStorage key for a link's dedicated PAT. */
export function linkSessionSecretKey(linkId: string): string {
  return `apicircle.linkSession.${linkId}`;
}

/** SecretStorage key for a provisioned value of a link's required secret. */
export function linkedSecretStorageKey(linkId: string, keyId: string): string {
  return `apicircle.linkedSecret.${linkId}.${keyId}`;
}

/**
 * Resolve the token to fetch a specific link with. `dedicated` links read their
 * per-link PAT from SecretStorage (null if not yet set); `workspace` links use
 * the built-in GitHub session (interactive only for private sources).
 */
export async function getLinkToken(
  secrets: vscode.SecretStorage,
  link: LinkedWorkspace,
): Promise<string | null> {
  if (link.source.sessionMode === 'dedicated') {
    return (await secrets.get(linkSessionSecretKey(link.id))) ?? null;
  }
  return getGitHubToken(link.kind === 'private');
}

export async function getGitHubToken(interactive: boolean): Promise<string | null> {
  try {
    const session = await vscode.authentication.getSession('github', [...GITHUB_SCOPES], {
      createIfNone: interactive,
      silent: !interactive,
    });
    return session?.accessToken ?? null;
  } catch {
    // User cancelled the sign-in prompt, or no provider — treat as no token.
    return null;
  }
}
