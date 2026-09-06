import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitProvider, resetGitProviderRegistry, type GitProvider } from '@apicircle/git';
import { useWorkspaceStore } from '../store/workspaceStore';
import { useHostSelection } from './useHostSelection';

// The picker default. Hardcoding `'github'` opened the vault on GitHub for a
// user whose only session was GitLab — so they were shown a CONNECT FORM instead
// of the session they already had, and the repo browser asked GitHub for repos
// with no GitHub token to ask with. Three separate pickers had the same bug.

const SESSION = {
  accountLogin: 'gl-user',
  tokenSecretId: 'sec1',
  grantedScopes: [],
  addedAt: 't',
  lastVerifiedAt: null,
  canCreatePullRequests: null,
};

function stub(): GitProvider {
  return { getViewer: vi.fn() } as unknown as GitProvider;
}

/** Put a session for `host` into the store without going through connect. */
function seedSession(host: 'github' | 'gitlab' | 'bitbucket'): void {
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local:
      host === 'github'
        ? { ...local, sessions: { ...local.sessions, github: { workspace: SESSION, links: {} } } }
        : {
            ...local,
            sessions: {
              ...local.sessions,
              hosts: { ...local.sessions.hosts, [host]: { workspace: SESSION, links: {} } },
            },
          },
  });
}

describe('useHostSelection', () => {
  beforeEach(async () => {
    resetGitProviderRegistry();
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
  });

  afterEach(() => resetGitProviderRegistry());

  it('offers only the hosts this build registered', () => {
    const { result, rerender } = renderHook(() => useHostSelection());
    expect(result.current.hosts).toEqual(['github']);

    registerGitProvider('gitlab', stub);
    rerender();
    expect(result.current.hosts).toEqual(['github', 'gitlab']);
  });

  it('opens on the host that HAS a session, not on GitHub', () => {
    seedSession('gitlab');
    const { result } = renderHook(() => useHostSelection());
    expect(result.current.host).toBe('gitlab');
  });

  it('falls back to GitHub when no session exists at all', () => {
    const { result } = renderHook(() => useHostSelection());
    expect(result.current.host).toBe('github');
  });

  it('follows a session that arrives AFTER first render', () => {
    // The subtle half. A `useState` initialiser runs once and the store is
    // usually unhydrated on first render, so reading the session at mount lands
    // on the fallback and stays there — the same bug in a form that looks fixed.
    const { result } = renderHook(() => useHostSelection());
    expect(result.current.host).toBe('github');

    act(() => seedSession('gitlab'));
    expect(result.current.host).toBe('gitlab');
  });

  it('stops following once the user picks, and keeps their choice', () => {
    seedSession('gitlab');
    const { result } = renderHook(() => useHostSelection());
    expect(result.current.host).toBe('gitlab');

    act(() => result.current.setHost('github'));
    expect(result.current.host).toBe('github');

    // A later session change must NOT override an explicit choice — silently
    // moving the picker under someone mid-entry is its own defect.
    act(() => seedSession('github'));
    expect(result.current.host).toBe('github');
  });

  it('reports the registered hosts and which of them hold a session', () => {
    registerGitProvider('gitlab', stub);
    registerGitProvider('bitbucket', stub);
    seedSession('bitbucket');
    const { result } = renderHook(() => useHostSelection());
    expect(result.current.registeredHosts).toEqual(['github', 'gitlab', 'bitbucket']);
    expect(result.current.connectedHosts).toEqual(['bitbucket']);
    // Without `connectedOnly` the offered list is still every registered host:
    // the vault is where a NEW host gets connected, so it must offer them all.
    expect(result.current.hosts).toEqual(['github', 'gitlab', 'bitbucket']);
  });

  describe('connectedOnly', () => {
    // The repo browsers. They list repos THROUGH a session, so a host without
    // one can only fail at the token step — offering it read as "choose any of
    // four" when exactly one could answer.
    it('offers only the hosts holding a session, and opens on one of them', () => {
      registerGitProvider('gitlab', stub);
      registerGitProvider('bitbucket', stub);
      seedSession('bitbucket');
      const { result } = renderHook(() => useHostSelection({ connectedOnly: true }));
      expect(result.current.hosts).toEqual(['bitbucket']);
      expect(result.current.host).toBe('bitbucket');
      expect(result.current.registeredHosts).toEqual(['github', 'gitlab', 'bitbucket']);
    });

    it('offers every connected host when more than one holds a session', () => {
      registerGitProvider('gitlab', stub);
      registerGitProvider('bitbucket', stub);
      seedSession('github');
      seedSession('bitbucket');
      const { result } = renderHook(() => useHostSelection({ connectedOnly: true }));
      expect(result.current.hosts).toEqual(['github', 'bitbucket']);
      expect(result.current.host).toBe('github');
    });

    it('falls back to every registered host when no session exists', () => {
      // A caller must always have something to render; an empty picker over a
      // form that still needs a host would leave the form addressing nothing.
      registerGitProvider('gitlab', stub);
      const { result } = renderHook(() => useHostSelection({ connectedOnly: true }));
      expect(result.current.hosts).toEqual(['github', 'gitlab']);
      expect(result.current.host).toBe('github');
    });

    it('yields an explicit choice that the offered list no longer contains', () => {
      // Pick GitHub while it holds a session, then lose that session: the
      // picker cannot show GitHub any more, so the selection must follow the
      // list rather than name a host the list does not offer.
      registerGitProvider('bitbucket', stub);
      seedSession('github');
      seedSession('bitbucket');
      const { result } = renderHook(() => useHostSelection({ connectedOnly: true }));
      act(() => result.current.setHost('github'));
      expect(result.current.host).toBe('github');

      act(() => {
        const local = useWorkspaceStore.getState().local!;
        useWorkspaceStore.setState({
          local: {
            ...local,
            sessions: { ...local.sessions, github: { workspace: null, links: {} } },
          },
        });
      });
      expect(result.current.hosts).toEqual(['bitbucket']);
      expect(result.current.host).toBe('bitbucket');
    });

    it('picks the first offered host when the session host is not offered', () => {
      // `hostOfWorkspaceSession` answers GitHub when nothing holds a session,
      // but a caller can be handed a list that excludes it: with the option off
      // and GitHub simply not registered as first... it always is, so drive the
      // branch through an explicit choice instead: choose a host, then narrow
      // the list to one that contains neither the choice nor the session host.
      registerGitProvider('gitlab', stub);
      registerGitProvider('bitbucket', stub);
      seedSession('gitlab');
      seedSession('bitbucket');
      const { result, rerender } = renderHook(
        ({ connectedOnly }: { connectedOnly: boolean }) => useHostSelection({ connectedOnly }),
        { initialProps: { connectedOnly: false } },
      );
      act(() => result.current.setHost('github'));
      expect(result.current.host).toBe('github');
      // Narrow to connected hosts: GitHub (chosen) is out, and the session host
      // is the first with a session — GitLab — which IS offered, so that wins.
      rerender({ connectedOnly: true });
      expect(result.current.hosts).toEqual(['gitlab', 'bitbucket']);
      expect(result.current.host).toBe('gitlab');
    });
  });
});
