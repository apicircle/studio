import { act, render, type RenderResult } from '@testing-library/react';
import type { ReactElement } from 'react';
import { useWorkspaceStore } from '../src/store/workspaceStore';

// Renders a React tree with the workspace store hydrated against the fresh
// fake-indexeddb instance set up in test/setup.ts. Returns RTL's render result.
export async function renderWithStore(ui: ReactElement): Promise<RenderResult> {
  await act(async () => {
    await useWorkspaceStore.getState().hydrate();
  });
  return render(ui);
}
