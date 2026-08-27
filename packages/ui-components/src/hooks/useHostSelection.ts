import { useState } from 'react';
import { GIT_HOST_KINDS, hasGitProvider, type GitHostKind } from '@apicircle/git';
import { hostOfWorkspaceSession, useWorkspaceStore } from '../store/workspaceStore';

/**
 * The state behind a Git-host picker: which hosts to offer, and which one is
 * selected.
 *
 * Two things this exists to get right, both of which were wrong in three
 * separate copies before it:
 *
 * 1. **The default follows the session, not the alphabet.** A picker hardcoded
 *    to `'github'` opened on GitHub for a user whose only session is GitLab —
 *    so the vault showed them a *connect form* instead of the session they
 *    already had, and the repo browser asked GitHub for repos with no GitHub
 *    token to ask with.
 *
 * 2. **It keeps following until the user chooses.** A `useState` initialiser
 *    runs once, and the store is usually not hydrated on first render, so
 *    reading the session at mount lands on the fallback and stays there —
 *    reintroducing (1) in a form that looks like it fixed it. Deriving the value
 *    each render, with an explicit choice taking precedence, needs no effect and
 *    cannot get stuck.
 *
 * `hosts` is filtered by `hasGitProvider`, so it can never offer a host this
 * build cannot resolve: open-core Studio registers GitHub alone and the caller
 * renders no picker at all.
 */
export function useHostSelection(): {
  hosts: readonly GitHostKind[];
  host: GitHostKind;
  setHost: (host: GitHostKind) => void;
} {
  // Not memoised on purpose: the registry is populated once at module load, so
  // this is a cheap filter over four entries, and a `useMemo` with an empty dep
  // array would freeze the list if registration ever moved later.
  const hosts = GIT_HOST_KINDS.filter((kind) => hasGitProvider(kind));
  const sessionHost = useWorkspaceStore((s) => hostOfWorkspaceSession(s.local));
  const [chosen, setChosen] = useState<GitHostKind | null>(null);
  return { hosts, host: chosen ?? sessionHost, setHost: setChosen };
}
