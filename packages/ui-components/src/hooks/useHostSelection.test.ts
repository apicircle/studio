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
function seedSession(host: 'github' | 'gitlab'): void {
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
});
