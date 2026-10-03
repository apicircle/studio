import { createContext, useContext, type ReactNode } from 'react';
import type { GitHostKind } from '@apicircle/git';

// Git host access policy — which of this build's registered Git hosts the
// current user may use right now.
//
// The shell's second commercial limit, expressed like the first
// (`workspaceAccess`) as data rather than a dependency: `ui-components` knows
// nothing about accounts, plans, or entitlements. An edition that registers
// extra hosts (`registerGitProvider`) names the ones that are locked; Studio
// standalone supplies nothing.
//
// Unlike `workspaceAccess`, omitting this one IS a no-op. Open core registers
// GitHub alone, and GitHub can never be locked, so with no edition attached
// there is nothing for a policy to withhold.
//
// What the shell does with a locked host: it stays LISTED where hosts are
// chosen — named, with a lock — so the user can see that it exists and why it
// is unavailable. It is never offered for a new connection or a new repo; a
// session already saved on it is kept, and can be disconnected, but is not
// used; and nothing runs against it in the background.
//
// The shell only decides what it offers. Enforcing USE belongs to the edition
// that registered the host: its provider factory refuses a locked host, and
// every host call this shell makes resolves through that factory, offered or
// not.

export interface GitHostAccess {
  /**
   * Registered hosts the current user may not use. `github` is ignored: it is
   * built into the core, cannot be re-registered, and is never locked.
   */
  lockedHosts: readonly GitHostKind[];
  /**
   * Rendered wherever a locked host would otherwise be usable — in place of its
   * connect form, its session controls and its repo controls. An edition swaps
   * in its own upgrade path; the default explains the lock without pretending
   * there is somewhere to click.
   */
  lockedNotice?: ReactNode;
}

/** No edition attached: nothing is locked. */
export const DEFAULT_GIT_HOST_ACCESS: GitHostAccess = { lockedHosts: [] };

const GitHostAccessContext = createContext<GitHostAccess>(DEFAULT_GIT_HOST_ACCESS);

export const GitHostAccessProvider = GitHostAccessContext.Provider;

export function useGitHostAccess(): GitHostAccess {
  return useContext(GitHostAccessContext);
}

/** Is `host` locked under `access`? Never for `github`. */
export function isGitHostLocked(access: GitHostAccess, host: GitHostKind): boolean {
  return host !== 'github' && access.lockedHosts.includes(host);
}
