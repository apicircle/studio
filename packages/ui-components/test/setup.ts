// Vitest setup for ui-components: enable jest-dom matchers and reset every
// stateful singleton between tests (IndexedDB, localStorage, the Zustand
// store, and the cached DB connection).
import '@testing-library/jest-dom/vitest';
import { afterEach, beforeEach, vi } from 'vitest';
import { cleanup } from '@testing-library/react';
import React from 'react';

// jsdom doesn't ship a ResizeObserver. Components that adapt to their
// container width (the right-side dock's GlobalAssetsDockPanel, future
// container-query consumers) need a no-op stub so the constructor call
// doesn't throw on mount. Tests that exercise the responsive layout can
// still spy/replace this stub if they want to assert on observe calls.
if (typeof globalThis.ResizeObserver === 'undefined') {
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  } as unknown as typeof ResizeObserver;
}
import { __resetAttachmentsForTests } from '../src/persistence/attachments';
import { __resetDbForTests } from '../src/persistence/db';
import { __resetSecretKeyForTests } from '../src/persistence/secretKey';
import { __resetSecretsForTests } from '../src/persistence/secrets';
import { useWorkspaceStore } from '../src/store/workspaceStore';

// Monaco can't render in jsdom (no canvas, no IntersectionObserver, dynamic
// import resolves to a stub). Replace `@monaco-editor/react` with a textarea
// that mirrors the API contract our wrappers depend on (value, onChange,
// readOnly, aria-label) so component tests can drive the editor as a normal
// form field.
vi.mock('@monaco-editor/react', () => {
  const Editor = ({
    value,
    onChange,
    options,
  }: {
    value?: string;
    onChange?: (value: string | undefined) => void;
    options?: { readOnly?: boolean };
  }) =>
    React.createElement('textarea', {
      'data-testid': 'monaco-editor-mock',
      value: value ?? '',
      readOnly: options?.readOnly ?? false,
      onChange: (e: React.ChangeEvent<HTMLTextAreaElement>) => onChange?.(e.target.value),
    });
  // `MonacoEditorBase` calls `loader.config(...)` to point Monaco at the
  // local vendor bundle. The real module exposes it; the mock must too,
  // or the loader throws and the wrapper falls back to a bare textarea.
  return { default: Editor, loader: { config: () => {} } };
});

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
