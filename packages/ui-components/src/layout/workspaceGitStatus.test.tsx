import { act, renderHook } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { GitHostKind } from '@apicircle/git';
import { useWorkspaceStore } from '../store/workspaceStore';
import {
  BranchChangeSourcesProvider,
  type BranchChangeSource,
  type BranchChangeSummary,
} from './branchChanges';
import { GitHostAccessProvider, type GitHostAccess } from './gitHostAccess';
import { UNPUSHED_RECOUNT_DELAY_MS, useWorkspaceGitStatus } from './workspaceGitStatus';

const SESSION = {
  accountLogin: 'me',
  tokenSecretId: 's',
  grantedScopes: ['repo'],
  addedAt: 't',
  lastVerifiedAt: 't',
  canCreatePullRequests: true,
};

const REPO = {
  fullName: 'acme/api',
  owner: 'acme',
  name: 'api',
  defaultBranch: 'main',
  visibility: 'private' as const,
  isPrivate: true,
  pushable: true,
  connectedAt: 't',
};

const BRANCH = {
  name: 'apicircle/wb',
  baseBranch: 'main',
  repoFullName: 'acme/api',
  repoOwner: 'acme',
  repoName: 'api',
  headSha: 'abc',
  createdAt: 't',
  lastPushedSha: null,
  diffSummary: null,
  openPrUrl: null,
};

function setLocal(patch: Record<string, unknown>): void {
  act(() => {
    useWorkspaceStore.setState({ local: { ...useWorkspaceStore.getState().local!, ...patch } });
  });
}

function sessionsOn(host: GitHostKind | null) {
  return {
    github: { workspace: host === 'github' ? SESSION : null, links: {} },
    hosts: host && host !== 'github' ? { [host]: { workspace: SESSION, links: {} } } : {},
  };
}

function renderStatus(access?: GitHostAccess) {
  const wrapper = access
    ? ({ children }: { children: ReactNode }) => (
        <GitHostAccessProvider value={access}>{children}</GitHostAccessProvider>
      )
    : undefined;
  return renderHook(() => useWorkspaceGitStatus(), { wrapper });
}

function settle(): void {
  act(() => {
    vi.advanceTimersByTime(UNPUSHED_RECOUNT_DELAY_MS);
  });
}

describe('useWorkspaceGitStatus', () => {
  beforeEach(async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('is local before the store has a workspace at all', () => {
    act(() => {
      useWorkspaceStore.setState({ local: null, synced: null });
    });
    expect(renderStatus().result.current).toEqual({ kind: 'local' });
  });

  it('is local with no session on any host', () => {
    expect(renderStatus().result.current).toEqual({ kind: 'local' });
  });

  it('is no-repo on the host holding the session', () => {
    setLocal({ sessions: sessionsOn('gitlab') });
    expect(renderStatus().result.current).toEqual({ kind: 'no-repo', host: 'gitlab' });
  });

  it("is no-branch on the repo's host, which wins over the session's", () => {
    // A GitHub session alongside a repo recorded on Bitbucket: the repo decides.
    setLocal({
      sessions: sessionsOn('github'),
      connectedRepo: { ...REPO, hostKind: 'bitbucket' },
    });
    expect(renderStatus().result.current).toEqual({
      kind: 'no-branch',
      host: 'bitbucket',
      repo: 'acme/api',
    });
  });

  it('treats a repo with no recorded host as GitHub', () => {
    setLocal({ sessions: sessionsOn('github'), connectedRepo: REPO });
    expect(renderStatus().result.current).toEqual({
      kind: 'no-branch',
      host: 'github',
      repo: 'acme/api',
    });
  });

  it('is locked when the edition has locked the workspace host', () => {
    setLocal({
      sessions: sessionsOn('gitlab'),
      connectedRepo: { ...REPO, hostKind: 'gitlab' },
      workingBranch: { ...BRANCH, hostKind: 'gitlab' },
    });
    const { result } = renderStatus({ lockedHosts: ['gitlab'] });
    expect(result.current).toEqual({ kind: 'locked', host: 'gitlab' });
    // Nothing is counted for a host that cannot be pushed to.
    settle();
    expect(result.current).toEqual({ kind: 'locked', host: 'gitlab' });
  });

  it('is locked on a session-only host too', () => {
    setLocal({ sessions: sessionsOn('azure-devops') });
    expect(renderStatus({ lockedHosts: ['azure-devops'] }).result.current).toEqual({
      kind: 'locked',
      host: 'azure-devops',
    });
  });

  it('never locks GitHub, whatever the policy lists', () => {
    setLocal({ sessions: sessionsOn('github') });
    expect(renderStatus({ lockedHosts: ['github'] }).result.current).toEqual({
      kind: 'no-repo',
      host: 'github',
    });
  });

  describe('on a working branch', () => {
    beforeEach(() => {
      setLocal({ sessions: sessionsOn('github'), connectedRepo: REPO, workingBranch: BRANCH });
    });

    it('names the repo and branch, with no count until the workspace has been still', () => {
      const { result } = renderStatus();
      expect(result.current).toEqual({
        kind: 'branch',
        host: 'github',
        repo: 'acme/api',
        branch: 'apicircle/wb',
        unpushed: null,
      });
      act(() => {
        vi.advanceTimersByTime(UNPUSHED_RECOUNT_DELAY_MS - 1);
      });
      expect(result.current).toMatchObject({ unpushed: null });
    });

    it('counts everything as unpushed when the workspace was never pulled', () => {
      const { result } = renderStatus();
      settle();
      expect(result.current).toMatchObject({ kind: 'branch' });
      expect((result.current as { unpushed: number }).unpushed).toBeGreaterThan(0);
    });

    it('counts zero once the workspace matches the last pull, then counts an edit', () => {
      const { synced } = useWorkspaceStore.getState();
      setLocal({
        sync: { ...useWorkspaceStore.getState().local!.sync, lastPulledSnapshot: synced },
      });
      const { result } = renderStatus();
      settle();
      expect(result.current).toMatchObject({ unpushed: 0 });

      act(() => {
        useWorkspaceStore.getState().addRequest(null);
      });
      // The previous figure stays on screen while the recount waits.
      expect(result.current).toMatchObject({ unpushed: 0 });
      settle();
      expect((result.current as { unpushed: number }).unpushed).toBeGreaterThan(0);
    });

    it('recounts once after a burst of edits, not once per edit', () => {
      const { result } = renderStatus();
      settle();
      const before = (result.current as { unpushed: number }).unpushed;

      act(() => {
        useWorkspaceStore.getState().addRequest(null);
      });
      act(() => {
        vi.advanceTimersByTime(UNPUSHED_RECOUNT_DELAY_MS - 1);
      });
      act(() => {
        useWorkspaceStore.getState().addRequest(null);
      });
      act(() => {
        vi.advanceTimersByTime(UNPUSHED_RECOUNT_DELAY_MS - 1);
      });
      // Each edit restarted the wait, so the first has still not been counted.
      expect(result.current).toMatchObject({ unpushed: before });
      settle();
      expect((result.current as { unpushed: number }).unpushed).toBeGreaterThan(before);
    });

    it("falls back to the branch's own repo name when no repo record is connected", () => {
      setLocal({ connectedRepo: null });
      expect(renderStatus().result.current).toMatchObject({
        kind: 'branch',
        repo: 'acme/api',
        branch: 'apicircle/wb',
      });
    });

    it('drops the count when the branch goes away', () => {
      const { result } = renderStatus();
      settle();
      expect(result.current).toMatchObject({ kind: 'branch' });
      setLocal({ workingBranch: null });
      expect(result.current).toEqual({ kind: 'no-branch', host: 'github', repo: 'acme/api' });
    });

    it('counts nothing while there is no workspace document', () => {
      act(() => {
        useWorkspaceStore.setState({ synced: null });
      });
      const { result } = renderStatus();
      settle();
      expect(result.current).toMatchObject({ kind: 'branch', unpushed: null });
    });

    describe('with an edition changing the branch too', () => {
      /** A branch change source whose summary a test can replace. */
      function codeSource(initial: BranchChangeSummary | null) {
        let value = initial;
        const listeners = new Set<() => void>();
        const source: BranchChangeSource = {
          id: 'code',
          label: 'Code changes',
          summary: {
            subscribe: (onChange) => {
              listeners.add(onChange);
              return () => listeners.delete(onChange);
            },
            getSnapshot: () => value,
          },
          Section: () => null,
          push: () => Promise.resolve(null),
        };
        return {
          source,
          set(next: BranchChangeSummary | null) {
            value = next;
            act(() => listeners.forEach((onChange) => onChange()));
          },
        };
      }

      function renderWithSource(source: BranchChangeSource) {
        const sources = [source];
        return renderHook(() => useWorkspaceGitStatus(), {
          wrapper: ({ children }: { children: ReactNode }) => (
            <BranchChangeSourcesProvider value={sources}>{children}</BranchChangeSourcesProvider>
          ),
        });
      }

      /** The workspace as last pulled: Studio itself has nothing to push. */
      function matchLastPull(): void {
        const { synced } = useWorkspaceStore.getState();
        setLocal({
          sync: { ...useWorkspaceStore.getState().local!.sync, lastPulledSnapshot: synced },
        });
      }

      it("adds what the source has included to Studio's own count", () => {
        matchLastPull();
        const code = codeSource({ added: 1, modified: 3, removed: 0, total: 4, included: 3 });
        const { result } = renderWithSource(code.source);
        settle();
        // Three of its four changes are ticked: those are what the push carries.
        expect(result.current).toMatchObject({ kind: 'branch', unpushed: 3 });

        act(() => {
          useWorkspaceStore.getState().addRequest(null);
        });
        settle();
        expect((result.current as { unpushed: number }).unpushed).toBeGreaterThan(3);
      });

      it('follows the source as its changes are ticked in and out, without a recount', () => {
        matchLastPull();
        const code = codeSource({ added: 0, modified: 2, removed: 0, total: 2, included: 2 });
        const { result } = renderWithSource(code.source);
        settle();
        expect(result.current).toMatchObject({ unpushed: 2 });

        code.set({ added: 0, modified: 2, removed: 0, total: 2, included: 1 });
        expect(result.current).toMatchObject({ unpushed: 1 });
      });

      it('counts nothing from a source that cannot push right now', () => {
        matchLastPull();
        const code = codeSource({
          added: 0,
          modified: 2,
          removed: 0,
          total: 2,
          included: 2,
          blockedReason: 'A merge is in progress in this folder.',
        });
        const { result } = renderWithSource(code.source);
        settle();
        expect(result.current).toMatchObject({ unpushed: 0 });
      });

      it('counts nothing from a source with nothing to say about this branch', () => {
        matchLastPull();
        const code = codeSource(null);
        const { result } = renderWithSource(code.source);
        settle();
        expect(result.current).toMatchObject({ unpushed: 0 });
      });

      it("stays uncounted until Studio's own changes have been counted", () => {
        const code = codeSource({ added: 0, modified: 2, removed: 0, total: 2, included: 2 });
        const { result } = renderWithSource(code.source);
        expect(result.current).toMatchObject({ kind: 'branch', unpushed: null });
      });
    });

    it('cancels a pending count on unmount', () => {
      const { unmount } = renderStatus();
      unmount();
      expect(vi.getTimerCount()).toBe(0);
    });
  });
});
