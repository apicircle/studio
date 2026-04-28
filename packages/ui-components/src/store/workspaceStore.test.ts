import { act } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useWorkspaceStore } from './workspaceStore';

describe('workspaceStore', () => {
  it('hydrates fresh state from an empty IDB', async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
    const state = useWorkspaceStore.getState();
    expect(state.ready).toBe(true);
    expect(state.synced).not.toBeNull();
    expect(state.local).not.toBeNull();
    expect(state.synced!.workspaceId).toBe(state.local!.workspaceId);
  });

  it('setActivePanel updates store state and persists to localStorage', async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
      useWorkspaceStore.getState().setActivePanel('editor');
    });
    expect(useWorkspaceStore.getState().activePanel).toBe('editor');
    expect(localStorage.getItem('apicircle-v2:active-panel')).toBe('editor');
  });

  it('setThemeId writes through to local doc and applies theme to DOM', async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
      useWorkspaceStore.getState().setThemeId('paper-light');
    });
    expect(useWorkspaceStore.getState().local!.ui.themeId).toBe('paper-light');
    expect(document.documentElement.getAttribute('data-theme')).toBe('paper-light');
  });

  it('setWorkspaceName updates synced doc and bumps updatedAt', async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
    });
    const before = useWorkspaceStore.getState().synced!.meta.updatedAt;
    // Tiny pause so the updatedAt timestamp is strictly newer.
    await new Promise((r) => setTimeout(r, 5));
    act(() => {
      useWorkspaceStore.getState().setWorkspaceName('Payments API');
    });
    const after = useWorkspaceStore.getState().synced!;
    expect(after.workspaceName).toBe('Payments API');
    expect(new Date(after.meta.updatedAt).getTime()).toBeGreaterThanOrEqual(
      new Date(before).getTime(),
    );
  });

  it('toggleSidebarSection toggles a section in/out of the expanded list', async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
      useWorkspaceStore.getState().toggleSidebarSection('workspace.identity');
    });
    expect(useWorkspaceStore.getState().local!.ui.sidebarExpandedSections).toContain(
      'workspace.identity',
    );
    act(() => {
      useWorkspaceStore.getState().toggleSidebarSection('workspace.identity');
    });
    expect(useWorkspaceStore.getState().local!.ui.sidebarExpandedSections).not.toContain(
      'workspace.identity',
    );
  });

  it('setActiveRequestId persists the selection', async () => {
    await act(async () => {
      await useWorkspaceStore.getState().hydrate();
      useWorkspaceStore.getState().setActiveRequestId('req-123');
    });
    expect(useWorkspaceStore.getState().local!.ui.activeRequestId).toBe('req-123');
  });

  it('openSecretVault / closeSecretVault toggles modal state', () => {
    useWorkspaceStore.getState().openSecretVault();
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(true);
    useWorkspaceStore.getState().closeSecretVault();
    expect(useWorkspaceStore.getState().secretVaultOpen).toBe(false);
  });

  describe('post-run context extraction', () => {
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('writes extracted vars into local.globalContext after a successful send', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(
          new Response('{"data":{"token":"abc-123"}}', {
            status: 201,
            statusText: 'Created',
            headers: { 'content-type': 'application/json', 'x-trace-id': 'tr-9' },
          }),
        ),
      );
      vi.stubGlobal('fetch', fetchMock);

      await act(async () => {
        await useWorkspaceStore.getState().hydrate();
      });
      const id = useWorkspaceStore.getState().addRequest(null);
      useWorkspaceStore.getState().setRequestUrl(id, 'https://api.test/auth/login');
      useWorkspaceStore.getState().setActiveRequestId(id);
      useWorkspaceStore.getState().setRequestExtractions(id, [
        { id: 'x1', variable: 'TOKEN', source: 'body', path: 'data.token', enabled: true },
        { id: 'x2', variable: 'TRACE', source: 'header', path: 'x-trace-id', enabled: true },
        { id: 'x3', variable: 'CODE', source: 'status', path: '', enabled: true },
      ]);

      await act(async () => {
        await useWorkspaceStore.getState().executeActiveRequest();
      });

      const ctx = useWorkspaceStore.getState().local!.globalContext;
      expect(ctx).toMatchObject({ TOKEN: 'abc-123', TRACE: 'tr-9', CODE: '201' });
    });

    it('skips extraction when the list is empty (no globalContext mutation)', async () => {
      const fetchMock = vi.fn(() =>
        Promise.resolve(new Response('{}', { status: 200, statusText: 'OK' })),
      );
      vi.stubGlobal('fetch', fetchMock);
      await act(async () => {
        await useWorkspaceStore.getState().hydrate();
      });
      const id = useWorkspaceStore.getState().addRequest(null);
      useWorkspaceStore.getState().setActiveRequestId(id);
      const before = useWorkspaceStore.getState().local!.globalContext;
      await act(async () => {
        await useWorkspaceStore.getState().executeActiveRequest();
      });
      const after = useWorkspaceStore.getState().local!.globalContext;
      expect(after).toEqual(before);
    });
  });

  describe('history clearing', () => {
    async function seed() {
      await act(async () => {
        await useWorkspaceStore.getState().hydrate();
      });
      const local = useWorkspaceStore.getState().local!;
      useWorkspaceStore.setState({
        local: {
          ...local,
          history: {
            requestRuns: [
              {
                id: 'r1',
                requestId: 'q1',
                startedAt: 't',
                durationMs: 1,
                status: 200,
                ok: true,
                assertions: [],
              },
              {
                id: 'r2',
                requestId: 'q2',
                startedAt: 't',
                durationMs: 1,
                status: 500,
                ok: false,
                assertions: [],
              },
            ],
            planRuns: [
              {
                id: 'p1',
                planId: 'plan-x',
                startedAt: 't',
                durationMs: 1,
                withAssertions: false,
                steps: [],
              },
            ],
          },
        },
      });
    }

    it('removeRequestRun drops the matching run', async () => {
      await seed();
      useWorkspaceStore.getState().removeRequestRun('r1');
      const ids = useWorkspaceStore.getState().local!.history.requestRuns.map((r) => r.id);
      expect(ids).toEqual(['r2']);
    });

    it('removePlanRun drops the matching plan run', async () => {
      await seed();
      useWorkspaceStore.getState().removePlanRun('p1');
      expect(useWorkspaceStore.getState().local!.history.planRuns).toEqual([]);
    });

    it('clearRequestRuns with no predicate wipes them all', async () => {
      await seed();
      useWorkspaceStore.getState().clearRequestRuns();
      expect(useWorkspaceStore.getState().local!.history.requestRuns).toEqual([]);
    });

    it('clearRequestRuns with a predicate preserves matching runs', async () => {
      await seed();
      // predicate returns true for runs to KEEP
      useWorkspaceStore.getState().clearRequestRuns((r) => r.id === 'r1');
      const ids = useWorkspaceStore.getState().local!.history.requestRuns.map((r) => r.id);
      expect(ids).toEqual(['r1']);
    });

    it('clearPlanRuns with no predicate wipes them all', async () => {
      await seed();
      useWorkspaceStore.getState().clearPlanRuns();
      expect(useWorkspaceStore.getState().local!.history.planRuns).toEqual([]);
    });
  });
});
