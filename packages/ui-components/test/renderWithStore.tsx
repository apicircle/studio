import { act, render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useWorkspaceStore } from '../src/store/workspaceStore';

// Renders a React tree with the workspace store hydrated against the fresh
// fake-indexeddb instance set up in test/setup.ts. After hydrate, this drops
// the onboarding sample request so each test starts from a known-empty
// workspace — tests that need fixtures add them explicitly.
export async function renderWithStore(ui: ReactElement): Promise<RenderResult> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
    const state = useWorkspaceStore.getState();
    if (state.synced && state.local) {
      useWorkspaceStore.setState({
        synced: {
          ...state.synced,
          collections: {
            ...state.synced.collections,
            requests: {},
            folders: {},
            tree: { ...state.synced.collections.tree, children: [] },
          },
        },
        local: { ...state.local, ui: { ...state.local.ui, activeRequestId: null } },
      });
    }
  });
  return render(ui);
}
