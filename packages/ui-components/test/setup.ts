// Vitest setup for ui-components: enable jest-dom matchers and reset every
// stateful singleton between tests (IndexedDB, localStorage, the Zustand
// store, and the cached DB connection).
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { __resetDbForTests } from '../src/persistence/db';
import { useWorkspaceStore } from '../src/store/workspaceStore';

const initialStoreState = useWorkspaceStore.getState();

beforeEach(async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  globalThis.indexedDB = new IDBFactory();
  __resetDbForTests();
  if (typeof localStorage !== 'undefined') localStorage.clear();
  // Reset the Zustand singleton so prior-test theme/panel/secret-vault state
  // doesn't bleed into the next test.
  useWorkspaceStore.setState(
    {
      ready: false,
      synced: null,
      local: null,
      activePanel: 'editor',
      secretVaultOpen: false,
      hydrate: initialStoreState.hydrate,
      setActivePanel: initialStoreState.setActivePanel,
      setActiveRequestId: initialStoreState.setActiveRequestId,
      toggleSidebarSection: initialStoreState.toggleSidebarSection,
      setThemeId: initialStoreState.setThemeId,
      setWorkspaceName: initialStoreState.setWorkspaceName,
      openSecretVault: initialStoreState.openSecretVault,
      closeSecretVault: initialStoreState.closeSecretVault,
    },
    true,
  );
  // Clear any data-theme attribute the previous test may have set.
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
