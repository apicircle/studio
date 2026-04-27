// Vitest setup for ui-components: enable jest-dom matchers and reset every
// stateful singleton between tests (IndexedDB, localStorage, the Zustand
// store, and the cached DB connection).
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import { __resetAttachmentsForTests } from '../src/persistence/attachments';
import { __resetDbForTests } from '../src/persistence/db';
import { __resetSecretKeyForTests } from '../src/persistence/secretKey';
import { __resetSecretsForTests } from '../src/persistence/secrets';
import { useWorkspaceStore } from '../src/store/workspaceStore';

// Snapshot the store's initial state on import. Action closures (which carry
// references to the original `set`/`get`) come along, so resetting via
// `setState(initial, true)` restores everything atomically.
const initialStoreState = useWorkspaceStore.getState();

beforeEach(async () => {
  const { IDBFactory } = await import('fake-indexeddb');
  globalThis.indexedDB = new IDBFactory();
  __resetDbForTests();
  __resetAttachmentsForTests();
  __resetSecretKeyForTests();
  __resetSecretsForTests();
  if (typeof localStorage !== 'undefined') localStorage.clear();
  useWorkspaceStore.setState(initialStoreState, true);
  document.documentElement.removeAttribute('data-theme');
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});
