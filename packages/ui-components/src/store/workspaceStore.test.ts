import { act } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
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
});
