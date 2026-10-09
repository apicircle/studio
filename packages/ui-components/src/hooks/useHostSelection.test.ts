import { act, renderHook } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { registerGitProvider, resetGitProviderRegistry, type GitProvider } from '@apicircle/git';
import { createElement, type ReactNode } from 'react';
import { useWorkspaceStore } from '../store/workspaceStore';
import { GitHostAccessProvider, type GitHostAccess } from '../layout/gitHostAccess';
import { useHostSelection, type HostSelectionOptions } from './useHostSelection';

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

/** Render the hook under an edition's host-access policy. */
function renderLocked(access: GitHostAccess, options?: HostSelectionOptions) {
  const wrapper = ({ children }: { children: ReactNode }) =>
    createElement(GitHostAccessProvider, { value: access }, children);
  return renderHook(() => useHostSelection(options), { wrapper });
}

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

/** Record a connected repo on `host` without going through connect. */
function seedRepo(host: 'github' | 'gitlab' | 'bitbucket'): void {
  const local = useWorkspaceStore.getState().local!;
  useWorkspaceStore.setState({
    local: {
      ...local,
      connectedRepo: {
        fullName: 'acme/api',
        owner: 'acme',
        name: 'api',
        defaultBranch: 'main',
        visibility: 'private',
        isPrivate: true,
        pushable: true,
        connectedAt: 't',
        hostKind: host,
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

  describe('with sessions on more than one host', () => {
    // "The host that has a session" is one host only while one host has one.
    // With two, the first in host order won, so the vault opened on GitHub's
    // card for a workspace whose repo is used through GitLab.
    it("opens on the repo's host, not on the first host holding a session", () => {
      registerGitProvider('gitlab', stub);
      registerGitProvider('bitbucket', stub);
      seedSession('github');
      seedSession('gitlab');
      seedSession('bitbucket');
      seedRepo('bitbucket');
      const { result } = renderHook(() => useHostSelection());
      expect(result.current.connectedHosts).toEqual(['github', 'gitlab', 'bitbucket']);
      expect(result.current.host).toBe('bitbucket');
    });

    it('opens on the first host holding a session while no repo is connected', () => {
      registerGitProvider('gitlab', stub);
      seedSession('github');
      seedSession('gitlab');
      const { result } = renderHook(() => useHostSelection());
      expect(result.current.host).toBe('github');
    });

    it('follows a repo connected after first render, until the user picks', () => {
      registerGitProvider('gitlab', stub);
      seedSession('github');
      seedSession('gitlab');
      const { result } = renderHook(() => useHostSelection());
      expect(result.current.host).toBe('github');

      act(() => seedRepo('gitlab'));
      expect(result.current.host).toBe('gitlab');

      act(() => result.current.setHost('github'));
      act(() => seedRepo('gitlab'));
      expect(result.current.host).toBe('github');
    });

    it('stays on GitHub for a GitHub repo with another host connected beside it', () => {
      registerGitProvider('gitlab', stub);
      seedSession('github');
      seedSession('gitlab');
      seedRepo('github');
      const { result } = renderHook(() => useHostSelection({ connectedOnly: true }));
      expect(result.current.host).toBe('github');
    });
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

  describe('locked hosts (gitHostAccess)', () => {
    // An edition's plan can lock hosts it registered. They are reported, so a
    // caller can say why one is unavailable, but only the vault's strip — which
    // passes `includeLocked` — offers them.
    it('leaves a locked host out of the offered list, but reports it', () => {
      registerGitProvider('gitlab', stub);
      registerGitProvider('bitbucket', stub);
      const { result } = renderLocked({ lockedHosts: ['gitlab'] });
      expect(result.current.registeredHosts).toEqual(['github', 'gitlab', 'bitbucket']);
      expect(result.current.lockedHosts).toEqual(['gitlab']);
      expect(result.current.hosts).toEqual(['github', 'bitbucket']);
    });

    it('offers locked hosts too when the caller asks for them', () => {
      registerGitProvider('gitlab', stub);
      const { result } = renderLocked({ lockedHosts: ['gitlab'] }, { includeLocked: true });
      expect(result.current.hosts).toEqual(['github', 'gitlab']);
      expect(result.current.lockedHosts).toEqual(['gitlab']);
    });

    it('never reports GitHub as locked, so the list is never empty', () => {
      registerGitProvider('gitlab', stub);
      const { result } = renderLocked({ lockedHosts: ['github', 'gitlab'] });
      expect(result.current.lockedHosts).toEqual(['gitlab']);
      expect(result.current.hosts).toEqual(['github']);
      expect(result.current.host).toBe('github');
    });

    it('reports nothing locked for a host this build never registered', () => {
      const { result } = renderLocked({ lockedHosts: ['azure-devops'] });
      expect(result.current.lockedHosts).toEqual([]);
      expect(result.current.hosts).toEqual(['github']);
    });

    it('does not select a locked session host the list leaves out', () => {
      registerGitProvider('gitlab', stub);
      seedSession('gitlab');
      const { result } = renderLocked({ lockedHosts: ['gitlab'] });
      expect(result.current.connectedHosts).toEqual(['gitlab']);
      expect(result.current.host).toBe('github');
    });

    it('opens on the locked session host where the caller includes locked hosts', () => {
      // The vault: a session saved on a host that later locked stays visible,
      // so it can be removed.
      registerGitProvider('gitlab', stub);
      seedSession('gitlab');
      const { result } = renderLocked({ lockedHosts: ['gitlab'] }, { includeLocked: true });
      expect(result.current.host).toBe('gitlab');
    });

    it('connectedOnly leaves out a locked session, falling back to the unlocked hosts', () => {
      registerGitProvider('gitlab', stub);
      registerGitProvider('bitbucket', stub);
      seedSession('bitbucket');
      const { result } = renderLocked({ lockedHosts: ['bitbucket'] }, { connectedOnly: true });
      expect(result.current.hosts).toEqual(['github', 'gitlab']);
      expect(result.current.host).toBe('github');
    });

    it('connectedOnly offers the unlocked session when a locked one sits beside it', () => {
      registerGitProvider('bitbucket', stub);
      seedSession('github');
      seedSession('bitbucket');
      const { result } = renderLocked({ lockedHosts: ['bitbucket'] }, { connectedOnly: true });
      expect(result.current.hosts).toEqual(['github']);
      expect(result.current.host).toBe('github');
    });
  });
});
