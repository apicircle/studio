import { useState } from 'react';
import { useShallow } from 'zustand/react/shallow';
import { GIT_HOST_KINDS, hasGitProvider, type GitHostKind } from '@apicircle/git';
import {
  hostOfWorkspaceSession,
  useWorkspaceStore,
  workspaceSessionFor,
} from '../store/workspaceStore';

export interface HostSelectionOptions {
  /**
   * Offer only the hosts that currently hold a workspace session.
   *
   * A repo browser can only ask a host it can authenticate to: offering a host
   * with no session invites a request that dies at the token step, and the
   * picker then reads as "choose any of four" when only one can answer. Falls
   * back to every registered host when no session exists at all, so a caller
   * always has something to render.
   */
  connectedOnly?: boolean;
}

export interface HostSelection {
  /** The hosts to offer, per the options. Never empty. */
  hosts: readonly GitHostKind[];
  /** Every host this build can resolve — `['github']` in open-core Studio. */
  registeredHosts: readonly GitHostKind[];
  /** The registered hosts that hold a workspace session right now. */
  connectedHosts: readonly GitHostKind[];
  /** The selected host — always one of `hosts`. */
  host: GitHostKind;
  setHost: (host: GitHostKind) => void;
}

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
 * `registeredHosts` is filtered by `hasGitProvider`, so a picker can never
 * offer a host this build cannot resolve: open-core Studio registers GitHub
 * alone and the caller renders no picker at all. `connectedOnly` narrows that
 * further to the hosts holding a session, for the surfaces that can only act
 * through one.
 *
 * Under `connectedOnly` the selection is also held to the offered list: an
 * explicit choice that falls outside it — a host picked before its session was
 * disconnected, say — yields to the session host rather than being honoured,
 * because a selection the list does not contain would name one host in the
 * label while the picker showed another. Without the option the selection is
 * simply the choice, else the session host — a session on a host this build
 * does not register still surfaces, so the user can see (and disconnect) it.
 */
export function useHostSelection(options: HostSelectionOptions = {}): HostSelection {
  // Not memoised on purpose: the registry is populated once at module load, so
  // this is a cheap filter over four entries, and a `useMemo` with an empty dep
  // array would freeze the list if registration ever moved later.
  const registeredHosts = GIT_HOST_KINDS.filter((kind) => hasGitProvider(kind));
  const connectedHosts = useWorkspaceStore(
    useShallow((s) =>
      registeredHosts.filter((kind) => workspaceSessionFor(s.local, kind) !== null),
    ),
  );
  const sessionHost = useWorkspaceStore((s) => hostOfWorkspaceSession(s.local));
  const [chosen, setChosen] = useState<GitHostKind | null>(null);
  const hosts =
    options.connectedOnly && connectedHosts.length > 0 ? connectedHosts : registeredHosts;
  const preferred = chosen ?? sessionHost;
  const host = !options.connectedOnly
    ? preferred
    : hosts.includes(preferred)
      ? preferred
      : hosts.includes(sessionHost)
        ? sessionHost
        : hosts[0];
  return { hosts, registeredHosts, connectedHosts, host, setHost: setChosen };
}
